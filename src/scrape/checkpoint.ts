import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { BdlPlayer } from "../types.js";

export const DEFAULT_BACKFILL_CHECKPOINT = "scrape-backfill.checkpoint.json";
export const DEFAULT_BACKFILL_LOG = "scrape-backfill.log";

export interface BackfillCheckpoint {
  version: 1;
  bdlSeasonYear: number;
  completedPlayerIds: number[];
  updatedAt: string;
}

function playerDisplayName(player: BdlPlayer): string {
  return `${player.first_name} ${player.last_name}`.trim();
}

export function parseCompletedNamesFromLog(logContent: string): Set<string> {
  const names = new Set<string>();
  for (const line of logContent.split("\n")) {
    const match = line.match(/^Done (.+?): \d+ seasons/);
    if (match) names.add(match[1].trim());
  }
  return names;
}

export function parseFailedNamesFromLog(logContent: string): Set<string> {
  const names = new Set<string>();
  for (const line of logContent.split("\n")) {
    const match = line.match(/^→ failed (.+?) \d{4}-\d{2} /);
    if (match) names.add(match[1].trim());
  }
  return names;
}

const FAILED_INGEST_LINE =
  /^→ failed (.+?) (\d{4}-\d{2}) ([^:]+): Ingest failed/;

export interface FailedIngestEntry {
  playerName: string;
  seasonLabel: string;
  teamName: string;
}

export function parseFailedIngestEntries(logContent: string): FailedIngestEntry[] {
  const seen = new Set<string>();
  const entries: FailedIngestEntry[] = [];

  for (const line of logContent.split("\n")) {
    const match = line.match(FAILED_INGEST_LINE);
    if (!match) continue;

    const entry: FailedIngestEntry = {
      playerName: match[1].trim(),
      seasonLabel: match[2].trim(),
      teamName: match[3].trim(),
    };
    const key = `${entry.playerName}|${entry.seasonLabel}|${entry.teamName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  return entries;
}

export function loadCheckpoint(path: string): BackfillCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as BackfillCheckpoint;
    if (raw.version !== 1 || !Array.isArray(raw.completedPlayerIds)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveCheckpoint(path: string, checkpoint: BackfillCheckpoint): void {
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

export function bootstrapCheckpointFromLog(
  logPath: string,
  players: BdlPlayer[],
  bdlSeasonYear: number,
): BackfillCheckpoint | null {
  if (!existsSync(logPath)) return null;

  const logContent = readFileSync(logPath, "utf8");
  const names = parseCompletedNamesFromLog(logContent);
  if (names.size === 0) return null;

  for (const failedName of parseFailedNamesFromLog(logContent)) {
    names.delete(failedName);
  }

  const completedPlayerIds: number[] = [];
  for (const player of players) {
    if (names.has(playerDisplayName(player))) {
      completedPlayerIds.push(player.id);
    }
  }

  if (completedPlayerIds.length === 0) return null;

  return {
    version: 1,
    bdlSeasonYear,
    completedPlayerIds,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveBackfillPlayers(
  players: BdlPlayer[],
  options: {
    bdlSeasonYear: number;
    resume: boolean;
    fresh: boolean;
    checkpointPath: string;
    logPath: string;
  },
): { pending: BdlPlayer[]; skipped: number; checkpoint: BackfillCheckpoint | null } {
  if (options.fresh) {
    return { pending: players, skipped: 0, checkpoint: null };
  }

  if (!options.resume) {
    return { pending: players, skipped: 0, checkpoint: null };
  }

  let checkpoint = loadCheckpoint(options.checkpointPath);

  if (
    !checkpoint ||
    checkpoint.bdlSeasonYear !== options.bdlSeasonYear
  ) {
    checkpoint = bootstrapCheckpointFromLog(
      options.logPath,
      players,
      options.bdlSeasonYear,
    );
    if (checkpoint) {
      saveCheckpoint(options.checkpointPath, checkpoint);
    }
  }

  if (!checkpoint || checkpoint.completedPlayerIds.length === 0) {
    return { pending: players, skipped: 0, checkpoint: null };
  }

  if (existsSync(options.logPath)) {
    const failedNames = parseFailedNamesFromLog(readFileSync(options.logPath, "utf8"));
    if (failedNames.size > 0) {
      const failedIds = new Set(
        players
          .filter((p) => failedNames.has(playerDisplayName(p)))
          .map((p) => p.id),
      );
      if (failedIds.size > 0) {
        checkpoint = {
          ...checkpoint,
          completedPlayerIds: checkpoint.completedPlayerIds.filter(
            (id) => !failedIds.has(id),
          ),
        };
        saveCheckpoint(options.checkpointPath, checkpoint);
      }
    }
  }

  const completed = new Set(checkpoint.completedPlayerIds);
  const pending = players.filter((p) => !completed.has(p.id));

  return {
    pending,
    skipped: players.length - pending.length,
    checkpoint,
  };
}

export function ensureCheckpoint(
  checkpoint: BackfillCheckpoint | null,
  bdlSeasonYear: number,
): BackfillCheckpoint {
  if (checkpoint) return checkpoint;
  return {
    version: 1,
    bdlSeasonYear,
    completedPlayerIds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function markPlayerComplete(
  checkpoint: BackfillCheckpoint,
  playerId: number,
  checkpointPath: string,
): BackfillCheckpoint {
  if (!checkpoint.completedPlayerIds.includes(playerId)) {
    checkpoint.completedPlayerIds.push(playerId);
  }
  checkpoint.updatedAt = new Date().toISOString();
  saveCheckpoint(checkpointPath, checkpoint);
  return checkpoint;
}
