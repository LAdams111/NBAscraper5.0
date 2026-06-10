import { BalldontlieClient } from "../balldontlieClient.js";
import { IngestClient } from "../ingestClient.js";
import { toIngestPayload } from "../transform.js";
import type { AppConfig } from "../config.js";
import type {
  HoopCentralIngestPayload,
  ScrapeOptions,
  ScrapeResultItem,
  ScrapeSummary,
} from "../types.js";
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
  if (options.scrapeMode === "backfill") return "backfill (all players, full career)";
  if (options.scrapeMode === "daily") return "daily (all players, current season only)";
  if (options.allSeasons) return "custom (all seasons through target)";
  return "custom (single season)";
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ results: ScrapeResultItem[]; summary: ScrapeSummary }> {
  const requestDelayMs = options.requestDelayMs ?? config.requestDelayMs;
  const bdl = new BalldontlieClient(config.balldontlieApiKey);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  console.log(`Job: ${modeLabel(options)}`);
  console.log(`Target season through: ${options.seasonLabel}`);
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

  for (let p = 0; p < players.length; p += 1) {
    const player = players[p];
    const playerName = `${player.first_name} ${player.last_name}`.trim();
    const seasonYears = seasonsForPlayer(
      player,
      options.bdlSeasonYear,
      options.allSeasons,
    );

    if ((p + 1) % 100 === 0 || p === 0) {
      console.log(`Processing player ${p + 1}/${players.length}: ${playerName}`);
    }

    for (const seasonYear of seasonYears) {
      const record = await fetchPlayerSeasonRecord(bdl, player, seasonYear);

      if (!record) {
        skipped += 1;
        continue;
      }

      const payload = toIngestPayload(record);
      resultIndex += 1;
      const label = formatLabel(payload);

      if (options.dryRun) {
        console.log(`[dry-run] ${label}`);
        results.push({
          index: resultIndex,
          total: resultIndex,
          label,
          payload,
          status: "success",
        });
        ingested += 1;
        continue;
      }

      try {
        const response = await ingest.sendPlayerSeason(payload);
        const reusedPlayer = !response.created.player;
        if (response.created.player) createdPlayers += 1;
        else reusedPlayers += 1;
        ingested += 1;

        if (ingested % 50 === 0) {
          console.log(
            `[progress] ingested=${ingested} skipped=${skipped} failed=${results.filter((r) => r.status === "failed").length} latest=${label}`,
          );
        }

        results.push({
          index: resultIndex,
          total: resultIndex,
          label,
          payload,
          status: "success",
          playerId: response.playerId,
          reusedPlayer,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`→ failed ${label}: ${message}`);
        results.push({
          index: resultIndex,
          total: resultIndex,
          label,
          payload,
          status: "failed",
          error: message,
        });
      }

      if (requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
    }

    if ((p + 1) % 25 === 0) {
      console.log(
        `Completed ${p + 1}/${players.length} players — ingested=${ingested} skipped=${skipped}`,
      );
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
