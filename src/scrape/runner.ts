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

export async function runScrape(
  config: AppConfig,
  options: ScrapeOptions,
): Promise<{ results: ScrapeResultItem[]; summary: ScrapeSummary }> {
  const requestDelayMs = options.requestDelayMs ?? config.requestDelayMs;
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

  const players = await collectTargetPlayers(bdl, {
    playerIds: options.playerIds,
    searchNames: options.searchNames,
    allPlayers: options.allPlayers,
    limit: options.limit,
  });

  console.log(`Loaded ${players.length} player(s) to process`);
  console.log("");

  const payloads: HoopCentralIngestPayload[] = [];

  for (const player of players) {
    const seasonYears = seasonsForPlayer(
      player,
      options.bdlSeasonYear,
      options.allSeasons,
    );

    for (const seasonYear of seasonYears) {
      const record = await fetchPlayerSeasonRecord(bdl, player, seasonYear);
      if (requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }
      if (!record) continue;
      payloads.push(toIngestPayload(record));
    }
  }

  const results: ScrapeResultItem[] = [];
  let createdPlayers = 0;
  let reusedPlayers = 0;

  for (let i = 0; i < payloads.length; i += 1) {
    const payload = payloads[i];
    const label = formatLabel(payload);
    const index = i + 1;
    const total = payloads.length;

    if (options.dryRun) {
      console.log(`[${index}/${total}] ${label}`);
      console.log(JSON.stringify(payload, null, 2));
      results.push({ index, total, label, payload, status: "success" });
      continue;
    }

    console.log(`[${index}/${total}] ${label}`);

    try {
      const response = await ingest.sendPlayerSeason(payload);
      const reusedPlayer = !response.created.player;
      if (response.created.player) createdPlayers += 1;
      else reusedPlayers += 1;

      console.log(
        `→ success playerId=${response.playerId} reusedPlayer=${reusedPlayer}`,
      );

      results.push({
        index,
        total,
        label,
        payload,
        status: "success",
        playerId: response.playerId,
        reusedPlayer,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`→ failed ${message}`);
      results.push({
        index,
        total,
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

  const summary: ScrapeSummary = {
    total: results.length,
    success: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: 0,
    createdPlayers,
    reusedPlayers,
  };

  return { results, summary };
}

export function printSummary(summary: ScrapeSummary, dryRun: boolean): void {
  console.log("");
  console.log("Finished");
  console.log(`Total payloads: ${summary.total}`);
  console.log(`Successful: ${summary.success}`);
  console.log(`Failed: ${summary.failed}`);
  if (!dryRun) {
    console.log(`Created players: ${summary.createdPlayers}`);
    console.log(`Reused players: ${summary.reusedPlayers}`);
  }
}
