import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseOptionalInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

export interface AppConfig {
  hoopCentralApiUrl: string;
  ingestApiKey: string | null;
  balldontlieApiKey: string;
  requestDelayMs: number;
  /** Max balldontlie requests per minute (GOAT: 600, ALL-STAR: 60). */
  balldontlieRequestsPerMinute: number;
}

export function loadConfig(): AppConfig {
  const hoopCentralApiUrl = normalizeBaseUrl(
    requireEnv(
      "HOOP_CENTRAL_API_URL",
      process.env.HOOP_CENTRAL_API_URL ?? process.env.HOOPCENTRAL_API_URL,
    ),
  );

  const ingestApiKey = process.env.INGEST_API_KEY?.trim() || null;
  const balldontlieApiKey = requireEnv(
    "BALLDONTLIE_API_KEY",
    process.env.BALLDONTLIE_API_KEY,
  );

  return {
    hoopCentralApiUrl,
    ingestApiKey,
    balldontlieApiKey,
    requestDelayMs: parseOptionalInt(process.env.SCRAPE_REQUEST_DELAY_MS, 0),
    balldontlieRequestsPerMinute: parseOptionalInt(
      process.env.BALLDONTLIE_REQUESTS_PER_MINUTE,
      55,
    ),
  };
}
