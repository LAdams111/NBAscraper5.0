import { readFileSync, existsSync } from "node:fs";
import { BalldontlieClient } from "../balldontlieClient.js";
import { RateLimiter } from "../utils/rateLimiter.js";
import { IngestClient } from "../ingestClient.js";
import type { AppConfig } from "../config.js";
import { toIngestPayload } from "../transform.js";
import type { BdlPlayer, ScrapeSummary } from "../types.js";
import { parseSeasonArg, sleep } from "../utils/season.js";
import {
  DEFAULT_BACKFILL_LOG,
  parseFailedIngestEntries,
} from "./checkpoint.js";
import { fetchPlayerSeasonRecord } from "./playerSeason.js";

function displayName(player: BdlPlayer): string {
  return `${player.first_name} ${player.last_name}`.trim();
}

async function buildPlayerNameMap(
  client: BalldontlieClient,
): Promise<Map<string, BdlPlayer>> {
  const map = new Map<string, BdlPlayer>();
  let count = 0;

  for await (const player of client.listAllPlayers()) {
    map.set(displayName(player).toLowerCase(), player);
    count += 1;
    if (count % 500 === 0) {
      console.log(`Indexed ${count} balldontlie players...`);
    }
  }

  console.log(`Indexed ${count} balldontlie players for name lookup.`);
  console.log("");
  return map;
}

export async function runRepairFailed(
  config: AppConfig,
  options: { dryRun: boolean; logPath?: string; requestDelayMs?: number },
): Promise<ScrapeSummary> {
  const logPath = options.logPath ?? DEFAULT_BACKFILL_LOG;
  if (!existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const entries = parseFailedIngestEntries(readFileSync(logPath, "utf8"));
  if (entries.length === 0) {
    console.log("No failed ingest entries found in log.");
    return {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      createdPlayers: 0,
      reusedPlayers: 0,
    };
  }

  const rateLimiter = new RateLimiter(config.balldontlieRequestsPerMinute);
  const bdl = new BalldontlieClient(config.balldontlieApiKey, rateLimiter);
  const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);

  if (!options.dryRun) {
    const health = await ingest.healthCheck();
    if (!health.ok) {
      throw new Error(
        `Hoop Central health check failed (HTTP ${health.status}). Is the API running at ${config.hoopCentralApiUrl}?`,
      );
    }
  }

  console.log(`Repairing ${entries.length} failed season row(s) from ${logPath}`);
  console.log("");

  const requestDelayMs = options.requestDelayMs ?? config.requestDelayMs;
  const playerByName = await buildPlayerNameMap(bdl);
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let createdPlayers = 0;
  let reusedPlayers = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const label = `${entry.playerName} ${entry.seasonLabel} ${entry.teamName}`;
    console.log(`Repair ${i + 1}/${entries.length}: ${label}`);

    const player = playerByName.get(entry.playerName.trim().toLowerCase());
    if (!player) {
      skipped += 1;
      console.log(`→ skipped: no balldontlie player found for "${entry.playerName}"`);
      continue;
    }

    const { bdlYear } = parseSeasonArg(entry.seasonLabel);
    let record;
    try {
      record = await fetchPlayerSeasonRecord(bdl, player, bdlYear);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`→ failed fetch: ${message}`);
      continue;
    }

    if (!record) {
      skipped += 1;
      console.log("→ skipped: no season stats from balldontlie");
      continue;
    }

    const payload = toIngestPayload(record);
    if (options.dryRun) {
      success += 1;
      console.log("→ dry-run ok");
      continue;
    }

    try {
      const response = await ingest.sendPlayerSeason(payload);
      success += 1;
      if (!response.created.player) reusedPlayers += 1;
      else createdPlayers += 1;
      console.log("→ repaired");
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`→ failed ingest: ${message}`);
    }

    if (requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  return {
    total: success + failed,
    success,
    failed,
    skipped,
    createdPlayers,
    reusedPlayers,
  };
}
