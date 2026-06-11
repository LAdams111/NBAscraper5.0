import { readFileSync, existsSync } from "node:fs";
import { BalldontlieClient } from "../balldontlieClient.js";
import { IngestClient } from "../ingestClient.js";
import type { AppConfig } from "../config.js";
import { toIngestPayload } from "../transform.js";
import type { BdlPlayer, ScrapeSummary } from "../types.js";
import { parseSeasonArg } from "../utils/season.js";
import {
  DEFAULT_BACKFILL_LOG,
  parseFailedIngestEntries,
  type FailedIngestEntry,
} from "./checkpoint.js";
import { fetchPlayerSeasonRecord } from "./playerSeason.js";

function displayName(player: BdlPlayer): string {
  return `${player.first_name} ${player.last_name}`.trim();
}

async function resolvePlayerByName(
  client: BalldontlieClient,
  name: string,
  cache: Map<string, BdlPlayer>,
): Promise<BdlPlayer | null> {
  const cached = cache.get(name);
  if (cached) return cached;

  const matches = await client.searchPlayers(name);
  if (matches.length === 0) return null;

  const exact = matches.find(
    (p) => displayName(p).toLowerCase() === name.trim().toLowerCase(),
  );
  const player = exact ?? matches[0];
  cache.set(name, player);
  return player;
}

export async function runRepairFailed(
  config: AppConfig,
  options: { dryRun: boolean; logPath?: string },
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

  const bdl = new BalldontlieClient(config.balldontlieApiKey);
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

  const playerCache = new Map<string, BdlPlayer>();
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let createdPlayers = 0;
  let reusedPlayers = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const label = `${entry.playerName} ${entry.seasonLabel} ${entry.teamName}`;
    console.log(`Repair ${i + 1}/${entries.length}: ${label}`);

    const player = await resolvePlayerByName(bdl, entry.playerName, playerCache);
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
