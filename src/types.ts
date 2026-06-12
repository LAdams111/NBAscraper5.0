/** balldontlie API shapes (subset used by this scraper). */

export interface BdlTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface BdlPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  college: string | null;
  country: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team?: BdlTeam;
}

export interface BdlSeasonAverages {
  games_played: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  min: string;
  player_id: number;
  season: number;
}

export interface BdlGameStat {
  id: number;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  player: BdlPlayer;
  team: BdlTeam;
  game: {
    id: number;
    date: string;
    season: number;
    status: string;
  };
}

export interface BdlPaginatedMeta {
  next_cursor?: number | null;
  per_page?: number;
}

export interface BdlListResponse<T> {
  data: T[];
  meta?: BdlPaginatedMeta;
}

export interface BdlSingleResponse<T> {
  data: T;
}

/** Normalized player-season record before Hoop Central transform. */
export interface NbaPlayerSeasonRecord {
  source: "balldontlie";
  externalId: string;
  displayName: string;
  birthDate: string | null;
  position: string | null;
  heightCm: number | null;
  weightKg: number | null;
  hometown: string | null;
  headshotUrl: string | null;
  college: string | null;
  country: string | null;
  leagueSlug: "nba";
  leagueName: "NBA";
  teamSlug: string;
  teamName: string;
  teamAbbreviation: string;
  seasonLabel: string;
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame: number;
    blocksPerGame: number;
  };
}

/** Hoop Central POST /api/ingest/player-season */
export interface HoopCentralIngestPayload {
  source: string;
  externalId: string;
  player: {
    displayName: string;
    birthDate?: string | null;
    position?: string | null;
    heightCm?: number | null;
    weightKg?: number | null;
    hometown?: string | null;
    headshotUrl?: string | null;
  };
  league: {
    slug: string;
    name: string;
  };
  team: {
    slug: string;
    name: string;
    abbreviation: string;
  };
  season: {
    label: string;
  };
  stats: {
    gamesPlayed: number;
    pointsPerGame: number;
    reboundsPerGame: number;
    assistsPerGame: number;
    stealsPerGame: number;
    blocksPerGame: number;
  };
}

export interface HoopCentralIngestResponse {
  ok: true;
  playerId: number;
  created: {
    player: boolean;
    league: boolean;
    team: boolean;
    season: boolean;
    stint: boolean;
    stats: boolean;
  };
}

export interface ScrapeResultItem {
  index: number;
  total: number;
  label: string;
  payload: HoopCentralIngestPayload;
  status: "success" | "failed" | "skipped";
  playerId?: number;
  reusedPlayer?: boolean;
  error?: string;
}

export interface ScrapeSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  createdPlayers: number;
  reusedPlayers: number;
}

export type ScrapeMode = "backfill" | "daily" | "custom";

export interface ScrapeOptions {
  scrapeMode: ScrapeMode;
  seasonLabel: string;
  bdlSeasonYear: number;
  playerIds?: number[];
  searchNames?: string[];
  allPlayers: boolean;
  allSeasons: boolean;
  limit?: number;
  dryRun: boolean;
  requestDelayMs?: number;
  /** Parallel players processed at once (backfill default: 10). */
  playerConcurrency?: number;
  /** Parallel balldontlie season fetches per player (backfill default: 12). */
  seasonConcurrency?: number;
  /** Parallel ingest POSTs per player (backfill default: 6). */
  ingestConcurrency?: number;
  /** Resume backfill from checkpoint / log (default true for --backfill). */
  resume?: boolean;
  /** Ignore checkpoint and process all players. */
  fresh?: boolean;
  /** Re-ingest season rows that failed during a prior backfill run. */
  repairFailed?: boolean;
  /** Skip players already complete on Hoop Central (default true for backfill). */
  skipWebsiteVerify?: boolean;
  checkpointPath?: string;
  logPath?: string;
}
