import { resolveTeam } from "./utils/teams.js";
import type {
  HoopCentralIngestPayload,
  NbaPlayerSeasonRecord,
} from "./types.js";

export function toIngestPayload(record: NbaPlayerSeasonRecord): HoopCentralIngestPayload {
  return {
    source: record.source,
    externalId: record.externalId,
    player: {
      displayName: record.displayName,
      birthDate: record.birthDate,
      position: record.position,
      heightCm: record.heightCm,
      weightKg: record.weightKg,
      hometown: record.hometown,
      headshotUrl: record.headshotUrl,
    },
    league: {
      slug: record.leagueSlug,
      name: record.leagueName,
    },
    team: {
      slug: record.teamSlug,
      name: record.teamName,
      abbreviation: record.teamAbbreviation,
    },
    season: {
      label: record.seasonLabel,
    },
    stats: record.stats,
  };
}

export function buildPlayerSeasonRecord(input: {
  playerId: number;
  displayName: string;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  hometown: string | null;
  teamFullName: string;
  teamAbbreviation: string;
  seasonLabel: string;
  gamesPlayed: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
}): NbaPlayerSeasonRecord {
  const team = resolveTeam(input.teamFullName, input.teamAbbreviation);

  return {
    source: "balldontlie",
    externalId: String(input.playerId),
    displayName: input.displayName,
    birthDate: null,
    position: input.position,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    hometown: input.hometown,
    headshotUrl: null,
    college: null,
    country: null,
    leagueSlug: "nba",
    leagueName: "NBA",
    teamSlug: team.slug,
    teamName: team.name,
    teamAbbreviation: team.abbreviation,
    seasonLabel: input.seasonLabel,
    stats: {
      gamesPlayed: input.gamesPlayed,
      pointsPerGame: input.pointsPerGame,
      reboundsPerGame: input.reboundsPerGame,
      assistsPerGame: input.assistsPerGame,
    },
  };
}
