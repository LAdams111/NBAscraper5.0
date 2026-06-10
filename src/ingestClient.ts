import type { HoopCentralIngestPayload, HoopCentralIngestResponse } from "./types.js";

export class IngestClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "IngestClientError";
  }
}

export class IngestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  async healthCheck(): Promise<{ ok: boolean; status: number }> {
    const url = `${this.baseUrl}/api/health`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IngestClientError(`Health check failed: ${message}`);
    }
    return { ok: response.ok, status: response.status };
  }

  async sendPlayerSeason(
    payload: HoopCentralIngestPayload,
  ): Promise<HoopCentralIngestResponse> {
    const url = `${this.baseUrl}/api/ingest/player-season`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["x-ingest-api-key"] = this.apiKey;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new IngestClientError(`Network error posting ingest payload: ${message}`);
    }

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new IngestClientError(
          `Invalid JSON from Hoop Central (${response.status})`,
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
      throw new IngestClientError(
        `Ingest failed (${response.status}): ${detail}`,
        response.status,
        body,
      );
    }

    return body as HoopCentralIngestResponse;
  }
}
