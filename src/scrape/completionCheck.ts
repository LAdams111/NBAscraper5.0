import type { BalldontlieClient } from "../balldontlieClient.js";
import type { IngestClient } from "../ingestClient.js";
import type { BdlPlayer } from "../types.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { bdlSeasonToLabel, round1 } from "../utils/season.js";
import { seasonsForPlayer } from "./playerSeason.js";

export interface HcSeasonStat {
  seasonLabel: string;
  gamesPlayed: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
}

export interface HcPlayerStatus {
  playerId: number;
  externalId: string;
  seasons: HcSeasonStat[];
}

interface AggregatedHcSeason {
  gamesPlayed: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
}

function aggregateHcSeason(rows: HcSeasonStat[]): AggregatedHcSeason | null {
  if (rows.length === 0) return null;

  let totalGames = 0;
  let ptsWeighted = 0;
  let rebWeighted = 0;
  let astWeighted = 0;

  for (const row of rows) {
    totalGames += row.gamesPlayed;
    ptsWeighted += row.gamesPlayed * row.pointsPerGame;
    rebWeighted += row.gamesPlayed * row.reboundsPerGame;
    astWeighted += row.gamesPlayed * row.assistsPerGame;
  }

  if (totalGames <= 0) return null;

  return {
    gamesPlayed: totalGames,
    pointsPerGame: round1(ptsWeighted / totalGames),
    reboundsPerGame: round1(rebWeighted / totalGames),
    assistsPerGame: round1(astWeighted / totalGames),
  };
}

function statsMatch(
  bdl: {
    games_played: number;
    pts: number;
    reb: number;
    ast: number;
  },
  hc: AggregatedHcSeason,
): boolean {
  return (
    bdl.games_played === hc.gamesPlayed &&
    round1(bdl.pts) === hc.pointsPerGame &&
    round1(bdl.reb) === hc.reboundsPerGame &&
    round1(bdl.ast) === hc.assistsPerGame
  );
}

async function isPlayerCompleteOnWebsite(
  player: BdlPlayer,
  hcStatus: HcPlayerStatus | undefined,
  bdl: BalldontlieClient,
  bdlSeasonYear: number,
): Promise<boolean> {
  if (!hcStatus || hcStatus.seasons.length === 0) return false;

  const hcBySeason = new Map<string, HcSeasonStat[]>();
  for (const row of hcStatus.seasons) {
    const existing = hcBySeason.get(row.seasonLabel) ?? [];
    existing.push(row);
    hcBySeason.set(row.seasonLabel, existing);
  }

  const seasonYears = seasonsForPlayer(player, bdlSeasonYear, true);
  const averagesList = await mapWithConcurrency(
    seasonYears,
    8,
    async (seasonYear) => ({
      seasonYear,
      label: bdlSeasonToLabel(seasonYear),
      averages: await bdl.getSeasonAverages(player.id, seasonYear),
    }),
  );

  for (const { label, averages } of averagesList) {
    if (!averages || averages.games_played <= 0) continue;

    const hcRows = hcBySeason.get(label);
    if (!hcRows?.length) return false;

    const aggregated = aggregateHcSeason(hcRows);
    if (!aggregated || !statsMatch(averages, aggregated)) return false;
  }

  return true;
}

export async function filterPlayersByWebsiteCompletion(
  pending: BdlPlayer[],
  options: {
    ingest: IngestClient;
    bdl: BalldontlieClient;
    bdlSeasonYear: number;
    verifyConcurrency?: number;
    source?: string;
  },
): Promise<{ complete: BdlPlayer[]; stillPending: BdlPlayer[] }> {
  const source = options.source ?? "balldontlie";
  const verifyConcurrency = options.verifyConcurrency ?? 6;

  console.log("Checking website for already-complete players...");
  const statusPayload = await options.ingest.getCompletionStatus(source);
  const statusByExternalId = new Map<string, HcPlayerStatus>();

  for (const entry of statusPayload.players) {
    statusByExternalId.set(entry.externalId, entry);
  }

  console.log(
    `Loaded ${statusByExternalId.size} ingested player(s) from Hoop Central (${source}).`,
  );
  const toVerify: BdlPlayer[] = [];
  const stillPending: BdlPlayer[] = [];

  for (const player of pending) {
    if (statusByExternalId.has(String(player.id))) {
      toVerify.push(player);
    } else {
      stillPending.push(player);
    }
  }

  console.log(
    `Verifying ${toVerify.length} on-site player(s) against balldontlie (${stillPending.length} not on site yet)...`,
  );
  console.log("");

  const complete: BdlPlayer[] = [];
  let checked = 0;

  const results = await mapWithConcurrency(
    toVerify,
    verifyConcurrency,
    async (player) => {
      const hcStatus = statusByExternalId.get(String(player.id));
      const done = await isPlayerCompleteOnWebsite(
        player,
        hcStatus,
        options.bdl,
        options.bdlSeasonYear,
      );
      checked += 1;
      if (checked % 50 === 0) {
        console.log(`[verify] checked ${checked}/${toVerify.length} on-site players...`);
      }
      return { player, done };
    },
  );

  for (const { player, done } of results) {
    if (done) complete.push(player);
    else stillPending.push(player);
  }

  console.log(
    `Website verification: ${complete.length} already complete, ${stillPending.length} need scraping.`,
  );
  console.log("");

  return { complete, stillPending };
}
