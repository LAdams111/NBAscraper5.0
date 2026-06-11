import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { BdlPlayer } from "../types.js";

export const DEFAULT_PLAYER_CACHE = "scrape-players.cache.json";

interface PlayerCacheFile {
  version: 1;
  fetchedAt: string;
  players: BdlPlayer[];
}

export function loadPlayerCache(path: string): BdlPlayer[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as PlayerCacheFile;
    if (raw.version !== 1 || !Array.isArray(raw.players)) return null;
    return raw.players;
  } catch {
    return null;
  }
}

export function savePlayerCache(path: string, players: BdlPlayer[]): void {
  const payload: PlayerCacheFile = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    players,
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}
