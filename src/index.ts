#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runRepairFailed } from "./scrape/repairFailed.js";
import { runScrape, printSummary } from "./scrape/runner.js";
import type { ScrapeMode, ScrapeOptions } from "./types.js";
import { currentBdlSeasonYear, parseSeasonArg, bdlSeasonToLabel } from "./utils/season.js";

const TEST_PLAYER_IDS = [237, 115, 246, 56677822]; // LeBron, Curry, Jokic, Wembanyama

function currentSeasonDefaults() {
  const bdlSeasonYear = currentBdlSeasonYear();
  return {
    bdlSeasonYear,
    seasonLabel: bdlSeasonToLabel(bdlSeasonYear),
  };
}

function printUsage(): void {
  const { seasonLabel } = currentSeasonDefaults();
  console.log(`Scraper-NBA — balldontlie → Hoop Central ingest

Usage:
  npm run scrape -- [options]

Primary jobs:
  --backfill             ONE-TIME: all ~5,500 players, every season through current
  --daily                DAILY: all players, current season (${seasonLabel}) only

Other options:
  --dry-run              Print payloads; do not POST
  --health               Check Hoop Central /api/health and exit
  --season <label>       Override season (default: current)
  --player-ids <ids>     Comma-separated balldontlie player IDs
  --search <names>       Comma-separated player name searches
  --test                 Shortcut for 4 test players
  --all-players          All balldontlie players (included in --backfill/--daily)
  --all-seasons          Full career through target season (included in --backfill)
  --limit <n>            Cap players processed (testing)
  --delay <ms>           Delay between API calls
  --fresh                Ignore checkpoint and reprocess all players
  --repair-failed        Re-ingest season rows that failed in scrape-backfill.log

Resume:
  --backfill auto-resumes from scrape-backfill.checkpoint.json (or bootstraps
  from scrape-backfill.log). Completed players are skipped; ingest is idempotent.

Idempotency:
  Uses source "balldontlie" + stable player ID. Re-running never duplicates
  players, stints, or stats — Hoop Central upserts by identity + season + team.

Examples:
  npm run scrape:backfill              # one-time full history (long!)
  npm run scrape:daily                 # current season only
  npm run scrape:dry-run -- --test
  npm run scrape -- --backfill --limit 5 --dry-run
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { health: boolean; showHelp: boolean } {
  const defaults = currentSeasonDefaults();
  let seasonLabel = defaults.seasonLabel;
  let bdlSeasonYear = defaults.bdlSeasonYear;
  let dryRun = false;
  let health = false;
  let allPlayers = false;
  let allSeasons = false;
  let backfill = false;
  let daily = false;
  let testMode = false;
  let playerIds: number[] | undefined;
  let searchNames: string[] | undefined;
  let limit: number | undefined;
  let requestDelayMs: number | undefined;
  let showHelp = false;
  let fresh = false;
  let repairFailed = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        showHelp = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--health":
        health = true;
        break;
      case "--backfill":
        backfill = true;
        break;
      case "--daily":
        daily = true;
        break;
      case "--all-players":
        allPlayers = true;
        break;
      case "--all-seasons":
        allSeasons = true;
        break;
      case "--test":
        testMode = true;
        break;
      case "--season": {
        const value = argv[++i];
        if (!value) throw new Error("--season requires a value");
        const parsed = parseSeasonArg(value);
        seasonLabel = parsed.label;
        bdlSeasonYear = parsed.bdlYear;
        break;
      }
      case "--player-ids": {
        const value = argv[++i];
        if (!value) throw new Error("--player-ids requires a value");
        playerIds = value.split(",").map((s) => {
          const id = Number.parseInt(s.trim(), 10);
          if (Number.isNaN(id)) throw new Error(`Invalid player id: ${s}`);
          return id;
        });
        break;
      }
      case "--search": {
        const value = argv[++i];
        if (!value) throw new Error("--search requires a value");
        searchNames = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      }
      case "--limit": {
        const value = argv[++i];
        if (!value) throw new Error("--limit requires a value");
        limit = Number.parseInt(value, 10);
        if (Number.isNaN(limit) || limit <= 0) throw new Error(`Invalid limit: ${value}`);
        break;
      }
      case "--delay": {
        const value = argv[++i];
        if (!value) throw new Error("--delay requires a value");
        requestDelayMs = Number.parseInt(value, 10);
        if (Number.isNaN(requestDelayMs) || requestDelayMs < 0) {
          throw new Error(`Invalid delay: ${value}`);
        }
        break;
      }
      case "--fresh":
        fresh = true;
        break;
      case "--repair-failed":
        repairFailed = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (backfill && daily) {
    throw new Error("Use either --backfill or --daily, not both");
  }

  if (backfill) {
    allPlayers = true;
    allSeasons = true;
    requestDelayMs = 0;
    const current = currentSeasonDefaults();
    seasonLabel = current.seasonLabel;
    bdlSeasonYear = current.bdlSeasonYear;
  }

  if (daily) {
    allPlayers = true;
    allSeasons = false;
    requestDelayMs = requestDelayMs ?? 50;
    const current = currentSeasonDefaults();
    seasonLabel = current.seasonLabel;
    bdlSeasonYear = current.bdlSeasonYear;
  }

  if (testMode) {
    playerIds = TEST_PLAYER_IDS;
  }

  const hasPlayerSelection =
    allPlayers ||
    (playerIds?.length ?? 0) > 0 ||
    (searchNames?.length ?? 0) > 0 ||
    repairFailed;

  if (!health && !showHelp && !hasPlayerSelection) {
    showHelp = true;
  }

  let scrapeMode: ScrapeMode = "custom";
  if (backfill) scrapeMode = "backfill";
  else if (daily) scrapeMode = "daily";

  return {
    scrapeMode,
    seasonLabel,
    bdlSeasonYear,
    playerIds,
    searchNames,
    allPlayers,
    allSeasons,
    limit,
    dryRun,
    requestDelayMs,
    seasonConcurrency: backfill ? 4 : undefined,
    ingestConcurrency: backfill ? 1 : undefined,
    resume: backfill ? true : undefined,
    fresh: fresh || undefined,
    repairFailed: repairFailed || undefined,
    health,
    showHelp,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();
  const { health, showHelp, ...scrapeArgs } = args;
  const scrapeOptions: ScrapeOptions = {
    ...scrapeArgs,
    requestDelayMs: scrapeArgs.requestDelayMs ?? config.requestDelayMs,
  };

  console.log("Starting Scraper-NBA");
  console.log(`Target: ${config.hoopCentralApiUrl}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "live ingest"}`);
  console.log("");

  if (args.health) {
    const { IngestClient } = await import("./ingestClient.js");
    const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);
    const result = await ingest.healthCheck();
    console.log(`Health: ${result.ok ? "OK" : "FAILED"} (HTTP ${result.status})`);
    process.exit(result.ok ? 0 : 1);
  }

  const summary = scrapeOptions.repairFailed
    ? await runRepairFailed(config, {
        dryRun: scrapeOptions.dryRun,
        logPath: scrapeOptions.logPath,
        requestDelayMs: scrapeOptions.requestDelayMs,
      })
    : (await runScrape(config, scrapeOptions)).summary;

  printSummary(summary, scrapeOptions.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
