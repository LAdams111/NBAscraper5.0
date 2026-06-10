import { BalldontlieClient } from "../balldontlieClient.js";
import { IngestClient } from "../ingestClient.js";
import { toIngestPayload } from "../transform.js";
import type { AppConfig } from "../config.js";
import type {
  HoopCentralIngestPayload,
  NbaPlayerSeasonRecord,
  ScrapeOptions,
  ScrapeResultItem,
  ScrapeSummary,
} from "../types.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { sleep } from "../utils/season.js";
import {
  collectTargetPlayers,
  fetchPlayerSeasonRecord,
  seasonsForPlayer,
} from "./playerSeason.js";

function formatLabel(payload: HoopCentralIngestPayload): string {
  return `${payload.player.displayName} ${payload.season.label} ${payload.team.name}`;
}

function modeLabel(options: ScrapeOptions): string {
  if (options.scrapeMode === "backfill") return "backfill (all players, full career, fast parallel)";
  if (options.scrapeMode === "daily") return "daily (all players, current season only)";
  if (options.allSeasons) return "custom (all seasons through target)";
  return "custom (single season)";
}

async function ingestPayload(
  ingest: IngestClient,
  payload: HoopCentralIngestPayload,
  dryRun: boolean,
): Promise<{
  status: "success" | "failed";
  playerId?: number;
  reusedPlayer?: boolean;
  error?: string;
}> {
  if (dryRun) return { status: "success" };

  try {
    const response = await ingest.sendPlayerSeason(payload);
    return {
      status: "success",
      playerId: response.playerId,
      reusedPlayer: !response.created.player,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ results: ScrapeResultItem[]; summary: ScrapeSummary }> {
  const requestDelayMs = options.requestDelayMs ?? config.requestDelayMs;
  const seasonConcurrency =
    options.seasonConcurrency ?? (options.scrapeMode === "backfill" ? 16 : 1);
  const ingestConcurrency =
    options.ingestConcurrency ?? (options.scrapeMode === "backfill" ? 8 : 1);

  const bdl = new BalldontlieClient(config.balldontlieApiKey);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  console.log(`Job: ${modeLabel(options)}`);
  console.log(`Target season through: ${options.seasonLabel}`);
  console.log(
    `Concurrency: ${seasonConcurrency} season fetches, ${ingestConcurrency} ingests`,
  );
  console.log("");

  if (!options.dryRun) {
    const health = await ingest.healthCheck();
    if (!health.ok) {
      throw new Error(
        `Hoop Central health check failed (HTTP ${health.status}). Is the API running at ${config.hoopCentralApiUrl}?`,
      );
    }
  }

  const players = await collectTargetPlayers(bdl, {
    playerIds: options.playerIds,
    searchNames: options.searchNames,
    allPlayers: options.allPlayers,
    limit: options.limit,
  });

  console.log(`Loaded ${players.length} player(s) to process`);
  console.log("");

  const results: ScrapeResultItem[] = [];
  let createdPlayers = 0;
  let reusedPlayers = 0;
  let ingested = 0;
  let skipped = 0;
  let resultIndex = 0;
  const startedAt = Date.now();

  for (let p = 0; p < players.length; p += 1) {
    const player = players[p];
    const playerName = `${player.first_name} ${player.last_name}`.trim();
    const seasonYears = seasonsForPlayer(
      player,
      options.bdlSeasonYear,
      options.allSeasons,
    );

    const playerStarted = Date.now();
    console.log(
      `Processing player ${p + 1}/${players.length}: ${playerName} (${seasonYears.length} seasons to check)`,
    );

    const records = await mapWithConcurrency(
      seasonYears,
      seasonConcurrency,
      (seasonYear) => fetchPlayerSeasonRecord(bdl, player, seasonYear),
    );

    const toIngest: NbaPlayerSeasonRecord[] = [];
    for (const record of records) {
      if (record) toIngest.push(record);
      else skipped += 1;
    }

    if (toIngest.length > 0) {
      const ingestResults = await mapWithConcurrency(
        toIngest,
        ingestConcurrency,
        async (record) => {
          const payload = toIngestPayload(record);
          const outcome = await ingestPayload(ingest, payload, options.dryRun);
          return { payload, outcome };
        },
      );

      for (const { payload, outcome } of ingestResults) {
        resultIndex += 1;
        const label = formatLabel(payload);

        if (outcome.status === "success") {
          ingested += 1;
          if (outcome.reusedPlayer === false) createdPlayers += 1;
          else if (outcome.reusedPlayer === true) reusedPlayers += 1;

          results.push({
            index: resultIndex,
            total: resultIndex,
            label,
            payload,
            status: "success",
            playerId: outcome.playerId,
            reusedPlayer: outcome.reusedPlayer,
          });
        } else {
          console.log(`→ failed ${label}: ${outcome.error}`);
          results.push({
            index: resultIndex,
            total: resultIndex,
            label,
            payload,
            status: "failed",
            error: outcome.error,
          });
        }
      }
    }

    const playerMs = Date.now() - playerStarted;
    console.log(
      `Done ${playerName}: ${toIngest.length} seasons ingested, ${seasonYears.length - toIngest.length} skipped (${(playerMs / 1000).toFixed(1)}s)`,
    );

    if (ingested > 0 && ingested % 100 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
      console.log(
        `[progress] ingested=${ingested} skipped=${skipped} failed=${results.filter((r) => r.status === "failed").length} elapsed=${elapsed}m`,
      );
    }

    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  const summary: ScrapeSummary = {
    total: ingested + results.filter((r) => r.status === "failed").length,
    success: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped,
    createdPlayers,
    reusedPlayers,
  };

  return { results, summary };
}

export function printSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log("Finished");
  console.log(`Ingested: ${summary.success}`);
  console.log(`Skipped (no stats): ${summary.skipped}`);
  console.log(`Failed: ${summary.failed}`);
  if (!dryRun) {
    console.log(`New players created: ${summary.createdPlayers}`);
    console.log(`Existing players reused: ${summary.reusedPlayers}`);
  }
}
