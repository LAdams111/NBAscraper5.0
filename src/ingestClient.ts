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

  private static readonly RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
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

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await this.sleep(500 * attempt);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new IngestClientError(`Network error posting ingest payload: ${message}`);
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader
        ? Math.max(1000, Number.parseInt(retryAfterHeader, 10) * 1000 || 2000)
        : 500 * attempt;

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          if (
            IngestClient.RETRYABLE_STATUSES.has(response.status) &&
            attempt < maxAttempts
          ) {
            await this.sleep(retryAfterMs);
            continue;
          }
          throw new IngestClientError(
            `Invalid JSON from Hoop Central (${response.status})`,
            response.status,
            text,
          );
        }
      }

      if (!response.ok) {
        if (
          IngestClient.RETRYABLE_STATUSES.has(response.status) &&
          attempt < maxAttempts
        ) {
          await this.sleep(retryAfterMs);
          continue;
        }
        const detail = formatIngestError(body, text, response.statusText);
        throw new IngestClientError(
          `Ingest failed (${response.status}): ${detail}`,
          response.status,
          body,
        );
      }

      return body as HoopCentralIngestResponse;
    }

    throw new IngestClientError("Ingest failed after retries");
  }
}

function formatIngestError(body: unknown, text: string, statusText: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const obj = err as { message?: unknown; code?: unknown };
      if (typeof obj.message === "string") {
        return typeof obj.code === "string" ? `${obj.code}: ${obj.message}` : obj.message;
      }
      return JSON.stringify(err);
    }
  }
  return text || statusText;
}
