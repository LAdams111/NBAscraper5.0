import { BalldontlieClient } from "../balldontlieClient.js";
import { IngestClient } from "../ingestClient.js";
import { toIngestPayload } from "../transform.js";
import type { AppConfig } from "../config.js";
import type { BdlPlayer } from "../types.js";
import type {
  HoopCentralIngestPayload,
  NbaPlayerSeasonRecord,
  ScrapeOptions,
  ScrapeResultItem,
  ScrapeSummary,
} from "../types.js";
import { AsyncMutex } from "../utils/asyncMutex.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { bdlSeasonToLabel } from "../utils/season.js";
import {
  DEFAULT_BACKFILL_CHECKPOINT,
  DEFAULT_BACKFILL_LOG,
  ensureCheckpoint,
  markPlayerComplete,
  resolveBackfillPlayers,
  type BackfillCheckpoint,
} from "./checkpoint.js";
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

interface PlayerJobResult {
  player: BdlPlayer;
  playerIndex: number;
  playerName: string;
  playerSucceeded: number;
  playerFailed: number;
  playerSkipped: number;
  createdPlayers: number;
  reusedPlayers: number;
  results: ScrapeResultItem[];
  shouldCheckpoint: boolean;
  elapsedMs: number;
}

async function processPlayer(
  player: BdlPlayer,
  playerIndex: number,
  totalPlayers: number,
  options: ScrapeOptions,
  bdl: BalldontlieClient,
  ingest: IngestClient,
): Promise<PlayerJobResult> {
  const playerName = `${player.first_name} ${player.last_name}`.trim();
  const seasonYears = seasonsForPlayer(
    player,
    options.bdlSeasonYear,
    options.allSeasons,
  );
  const seasonConcurrency = options.seasonConcurrency ?? 1;
  const ingestConcurrency = options.ingestConcurrency ?? 1;

  const playerStarted = Date.now();
  console.log(
    `Processing player ${playerIndex + 1}/${totalPlayers}: ${playerName} (${seasonYears.length} seasons to check)`,
  );

  const records = await mapWithConcurrency(
    seasonYears,
    seasonConcurrency,
    async (seasonYear) => {
      try {
        return await fetchPlayerSeasonRecord(bdl, player, seasonYear);
      } catch (error) {
        const label = `${playerName} ${bdlSeasonToLabel(seasonYear)}`;
        const message = error instanceof Error ? error.message : String(error);
        console.log(`→ fetch failed ${label}: ${message}`);
        return null;
      }
    },
  );

  const toIngest: NbaPlayerSeasonRecord[] = [];
  let playerSkipped = 0;
  for (const record of records) {
    if (record) toIngest.push(record);
    else playerSkipped += 1;
  }

  let playerFailed = 0;
  let playerSucceeded = 0;
  let createdPlayers = 0;
  let reusedPlayers = 0;
  const results: ScrapeResultItem[] = [];

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
      const label = formatLabel(payload);

      if (outcome.status === "success") {
        playerSucceeded += 1;
        if (outcome.reusedPlayer === false) createdPlayers += 1;
        else if (outcome.reusedPlayer === true) reusedPlayers += 1;

        results.push({
          index: 0,
          total: 0,
          label,
          payload,
          status: "success",
          playerId: outcome.playerId,
          reusedPlayer: outcome.reusedPlayer,
        });
      } else {
        playerFailed += 1;
        console.log(`→ failed ${label}: ${outcome.error}`);
        results.push({
          index: 0,
          total: 0,
          label,
          payload,
          status: "failed",
          error: outcome.error,
        });
      }
    }
  }

  const playerMs = Date.now() - playerStarted;
  const doneParts = [`${playerSucceeded} ingested`];
  if (playerFailed > 0) doneParts.push(`${playerFailed} failed`);
  if (playerSkipped > 0) doneParts.push(`${playerSkipped} skipped`);
  console.log(
    `Done ${playerName}: ${doneParts.join(", ")} (${(playerMs / 1000).toFixed(1)}s)`,
  );

  return {
    player,
    playerIndex,
    playerName,
    playerSucceeded,
    playerFailed,
    playerSkipped,
    createdPlayers,
    reusedPlayers,
    results,
    shouldCheckpoint:
      options.scrapeMode === "backfill" &&
      !options.dryRun &&
      toIngest.length > 0 &&
      playerFailed === 0,
    elapsedMs: playerMs,
  };
}

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ results: ScrapeResultItem[]; summary: ScrapeSummary }> {
  const isBackfill = options.scrapeMode === "backfill";
  const playerConcurrency =
    options.playerConcurrency ?? (isBackfill ? 6 : 1);
  const seasonConcurrency =
    options.seasonConcurrency ?? (isBackfill ? 8 : 1);
  const ingestConcurrency =
    options.ingestConcurrency ?? (isBackfill ? 2 : 1);

  const rateLimiter = new RateLimiter(config.balldontlieRequestsPerMinute);
  const bdl = new BalldontlieClient(config.balldontlieApiKey, rateLimiter);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  console.log(`Job: ${modeLabel(options)}`);
  console.log(`Target season through: ${options.seasonLabel}`);
  console.log(
    `Concurrency: ${playerConcurrency} players, ${seasonConcurrency} season fetches/player, ${ingestConcurrency} ingests/player`,
  );
  console.log(`balldontlie rate limit: ${config.balldontlieRequestsPerMinute} req/min`);
  console.log("");

  if (!options.dryRun) {
    const health = await ingest.healthCheck();
    if (!health.ok) {
      throw new Error(
        `Hoop Central health check failed (HTTP ${health.status}). Is the API running at ${config.hoopCentralApiUrl}?`,
      );
    }
  }

  const allPlayers = await collectTargetPlayers(bdl, {
    playerIds: options.playerIds,
    searchNames: options.searchNames,
    allPlayers: options.allPlayers,
    limit: options.limit,
    refreshPlayerCache: options.fresh === true,
  });

  const checkpointPath = options.checkpointPath ?? DEFAULT_BACKFILL_CHECKPOINT;
  const logPath = options.logPath ?? DEFAULT_BACKFILL_LOG;
  const useResume = options.scrapeMode === "backfill" && options.resume !== false;

  const { pending: players, skipped: resumedSkipped, checkpoint: initialCheckpoint } =
    options.scrapeMode === "backfill"
      ? resolveBackfillPlayers(allPlayers, {
          bdlSeasonYear: options.bdlSeasonYear,
          resume: useResume && !options.fresh,
          fresh: options.fresh === true,
          checkpointPath,
          logPath,
        })
      : { pending: allPlayers, skipped: 0, checkpoint: null as BackfillCheckpoint | null };

  console.log(`Loaded ${allPlayers.length} player(s) total`);
  if (resumedSkipped > 0) {
    console.log(
      `Resuming backfill: skipping ${resumedSkipped} already-completed player(s)`,
    );
  }
  console.log(`Processing ${players.length} player(s)`);
  console.log("");

  let checkpoint = initialCheckpoint;
  const checkpointMutex = new AsyncMutex();

  const scrapeOptions: ScrapeOptions = {
    ...options,
    seasonConcurrency,
    ingestConcurrency,
  };

  const startedAt = Date.now();
  let completedPlayers = 0;

  const playerResults = await mapWithConcurrency(
    players,
    playerConcurrency,
    async (player, index) => {
      const result = await processPlayer(
        player,
        index,
        players.length,
        scrapeOptions,
        bdl,
        ingest,
      );

      if (result.shouldCheckpoint) {
        await checkpointMutex.run(async () => {
          checkpoint = ensureCheckpoint(checkpoint, options.bdlSeasonYear);
          checkpoint = markPlayerComplete(
            checkpoint,
            result.player.id,
            checkpointPath,
          );
        });
      }

      completedPlayers += 1;
      if (
        result.playerSucceeded > 0 &&
        completedPlayers % 25 === 0
      ) {
        const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
        console.log(
          `[progress] players=${completedPlayers}/${players.length} elapsed=${elapsed}m`,
        );
      }

      return result;
    },
  );

  const results: ScrapeResultItem[] = [];
  let createdPlayers = 0;
  let reusedPlayers = 0;
  let ingested = 0;
  let skipped = 0;
  let resultIndex = 0;

  for (const pr of playerResults) {
    skipped += pr.playerSkipped;
    ingested += pr.playerSucceeded;
    createdPlayers += pr.createdPlayers;
    reusedPlayers += pr.reusedPlayers;

    for (const item of pr.results) {
      resultIndex += 1;
      results.push({
        ...item,
        index: resultIndex,
        total: resultIndex,
      });
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
