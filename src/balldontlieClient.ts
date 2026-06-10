import type {
  BdlGameStat,
  BdlListResponse,
  BdlPlayer,
  BdlSeasonAverages,
  BdlSingleResponse,
} from "./types.js";

const BASE_URL = "https://api.balldontlie.io";

export class BalldontlieApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BalldontlieApiError";
  }
}

export class BalldontlieClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, BASE_URL);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: this.apiKey,
          Accept: "application/json",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BalldontlieApiError(`Network error calling balldontlie: ${message}`);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new BalldontlieApiError(
          `Invalid JSON from balldontlie (${response.status})`,
          response.status,
          text,
        );
      }
    }

    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : text || response.statusText;
      throw new BalldontlieApiError(
        `balldontlie API error ${response.status}: ${detail}`,
        response.status,
        body,
      );
    }

    return body as T;
  }

  async getPlayer(playerId: number): Promise<BdlPlayer> {
    const result = await this.request<BdlSingleResponse<BdlPlayer>>(
      `/nba/v1/players/${playerId}`,
    );
    return result.data;
  }

  async searchPlayers(query: string): Promise<BdlPlayer[]> {
    const result = await this.request<BdlListResponse<BdlPlayer>>("/nba/v1/players", {
      search: query,
      per_page: "25",
    });
    return result.data;
  }

  async listPlayersPage(cursor?: number, perPage = 100): Promise<BdlListResponse<BdlPlayer>> {
    const query: Record<string, string> = { per_page: String(perPage) };
    if (cursor !== undefined) {
      query.cursor = String(cursor);
    }
    return this.request<BdlListResponse<BdlPlayer>>("/nba/v1/players", query);
  }

  async *listAllPlayers(perPage = 100): AsyncGenerator<BdlPlayer> {
    let cursor: number | undefined;
    for (;;) {
      const page = await this.listPlayersPage(cursor, perPage);
      for (const player of page.data) {
        yield player;
      }
      const next = page.meta?.next_cursor;
      if (next === null || next === undefined) break;
      cursor = next;
    }
  }

  async getSeasonAverages(
    playerId: number,
    seasonYear: number,
  ): Promise<BdlSeasonAverages | null> {
    const result = await this.request<BdlListResponse<BdlSeasonAverages>>(
      "/nba/v1/season_averages",
      {
        season: String(seasonYear),
        player_id: String(playerId),
      },
    );
    return result.data[0] ?? null;
  }

  async getGameStatsForSeason(
    playerId: number,
    seasonYear: number,
  ): Promise<BdlGameStat[]> {
    const stats: BdlGameStat[] = [];
    let cursor: number | undefined;

    for (;;) {
      const query: Record<string, string> = {
        "seasons[]": String(seasonYear),
        "player_ids[]": String(playerId),
        per_page: "100",
      };
      if (cursor !== undefined) {
        query.cursor = String(cursor);
      }

      const page = await this.request<BdlListResponse<BdlGameStat>>(
        "/nba/v1/stats",
        query,
      );
      stats.push(...page.data);

      const next = page.meta?.next_cursor;
      if (next === null || next === undefined) break;
      cursor = next;
    }

    return stats;
  }
}

/** Team the player appeared for most in a season (handles mid-season trades). */
export function primaryTeamFromGameStats(gameStats: BdlGameStat[]): {
  full_name: string;
  abbreviation: string;
} | null {
  if (gameStats.length === 0) return null;

  const counts = new Map<string, { full_name: string; abbreviation: string; games: number }>();

  for (const row of gameStats) {
    const key = row.team.full_name;
    const existing = counts.get(key);
    if (existing) {
      existing.games += 1;
    } else {
      counts.set(key, {
        full_name: row.team.full_name,
        abbreviation: row.team.abbreviation,
        games: 1,
      });
    }
  }

  let best: { full_name: string; abbreviation: string; games: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.games > best.games) {
      best = entry;
    }
  }

  return best
    ? { full_name: best.full_name, abbreviation: best.abbreviation }
    : null;
}
