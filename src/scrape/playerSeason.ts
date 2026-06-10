import {
  BalldontlieClient,
  primaryTeamFromGameStats,
} from "../balldontlieClient.js";
import { buildPlayerSeasonRecord } from "../transform.js";
import type { BdlPlayer, NbaPlayerSeasonRecord } from "../types.js";
import {
  bdlSeasonToLabel,
  careerSeasonYears,
  round1,
} from "../utils/season.js";
import { heightToCm, normalizePosition, weightToKg } from "../utils/physical.js";
import { resolveTeam } from "../utils/teams.js";

export class PlayerSeasonFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayerSeasonFetchError";
  }
}

function displayName(player: BdlPlayer): string {
  return `${player.first_name} ${player.last_name}`.trim();
}

function hometownFromPlayer(player: BdlPlayer): string | null {
  if (player.college?.trim()) return player.college.trim();
  if (player.country?.trim()) return player.country.trim();
  return null;
}

export async function fetchPlayerSeasonRecord(
  client: BalldontlieClient,
  player: BdlPlayer,
  bdlSeasonYear: number,
): Promise<NbaPlayerSeasonRecord | null> {
  const seasonLabel = bdlSeasonToLabel(bdlSeasonYear);
  const averages = await client.getSeasonAverages(player.id, bdlSeasonYear);
  if (!averages || averages.games_played <= 0) {
    return null;
  }

  const gameStats = await client.getGameStatsForSeason(player.id, bdlSeasonYear);
  const primaryTeam = primaryTeamFromGameStats(gameStats);

  let teamFullName: string;
  let teamAbbreviation: string;

  if (primaryTeam) {
    teamFullName = primaryTeam.full_name;
    teamAbbreviation = primaryTeam.abbreviation;
  } else if (player.team) {
    teamFullName = player.team.full_name;
    teamAbbreviation = player.team.abbreviation;
  } else {
    throw new PlayerSeasonFetchError(
      `No team found for ${displayName(player)} ${seasonLabel}`,
    );
  }

  const team = resolveTeam(teamFullName, teamAbbreviation);

  return buildPlayerSeasonRecord({
    playerId: player.id,
    displayName: displayName(player),
    position: normalizePosition(player.position),
    heightCm: heightToCm(player.height),
    weightKg: weightToKg(player.weight),
    hometown: hometownFromPlayer(player),
    teamFullName: team.name,
    teamAbbreviation: team.abbreviation,
    seasonLabel,
    gamesPlayed: averages.games_played,
    pointsPerGame: round1(averages.pts),
    reboundsPerGame: round1(averages.reb),
    assistsPerGame: round1(averages.ast),
  });
}

export async function resolvePlayerIds(
  client: BalldontlieClient,
  playerIds: number[] | undefined,
  searchNames: string[] | undefined,
): Promise<BdlPlayer[]> {
  const resolved = new Map<number, BdlPlayer>();

  if (playerIds?.length) {
    for (const id of playerIds) {
      const player = await client.getPlayer(id);
      resolved.set(player.id, player);
    }
  }

  if (searchNames?.length) {
    for (const name of searchNames) {
      const matches = await client.searchPlayers(name);
      if (matches.length === 0) {
        throw new PlayerSeasonFetchError(`No player found for search "${name}"`);
      }
      const exact = matches.find(
        (p) => displayName(p).toLowerCase() === name.trim().toLowerCase(),
      );
      const pick = exact ?? matches[0];
      resolved.set(pick.id, pick);
    }
  }

  return [...resolved.values()];
}

export async function collectTargetPlayers(
  client: BalldontlieClient,
  options: {
    playerIds?: number[];
    searchNames?: string[];
    allPlayers: boolean;
    limit?: number;
  },
): Promise<BdlPlayer[]> {
  if (options.allPlayers) {
    const players: BdlPlayer[] = [];
    let page = 0;
    for await (const player of client.listAllPlayers()) {
      players.push(player);
      page += 1;
      if (page % 500 === 0) {
        console.log(`Fetched ${page} players from balldontlie...`);
      }
      if (options.limit && players.length >= options.limit) break;
    }
    console.log(`Fetched ${players.length} total players from balldontlie.`);
    return players;
  }

  const players = await resolvePlayerIds(
    client,
    options.playerIds,
    options.searchNames,
  );

  if (players.length === 0) {
    throw new PlayerSeasonFetchError(
      "No players selected. Pass --player-ids, --search, or --all-players.",
    );
  }

  if (options.limit) {
    return players.slice(0, options.limit);
  }

  return players;
}

export function seasonsForPlayer(
  player: BdlPlayer,
  bdlSeasonYear: number,
  allSeasons: boolean,
): number[] {
  if (allSeasons) {
    return careerSeasonYears(player.draft_year, bdlSeasonYear);
  }
  return [bdlSeasonYear];
}
