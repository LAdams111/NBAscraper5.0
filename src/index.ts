#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runScrape, printSummary } from "./scrape/runner.js";
import type { ScrapeOptions } from "./types.js";
import { currentBdlSeasonYear, parseSeasonArg } from "./utils/season.js";

const TEST_PLAYER_IDS = [237, 115, 246, 56677822]; // LeBron, Curry, Jokic, Wembanyama

function printUsage(): void {
  console.log(`Scraper-NBA — balldontlie → Hoop Central ingest

Usage:
  npm run scrape -- [options]

Options:
  --dry-run              Normalize and print payloads; do not POST
  --health               Check Hoop Central /api/health and exit
  --season <label>       Season (default: current). e.g. 2024-25 or 2024
  --player-ids <ids>     Comma-separated balldontlie player IDs
  --search <names>       Comma-separated player name searches
  --test                 Shortcut for default test players (LeBron, Curry, Jokic, Wembanyama)
  --all-players          Scrape every player balldontlie returns (use with --limit first!)
  --all-seasons          For each player, attempt every season from draft year through target
  --limit <n>            Cap number of players processed
  --delay <ms>           Delay between API calls (overrides SCRAPE_REQUEST_DELAY_MS)

Safety:
  Running npm run scrape with NO player flags does nothing (prints this help).
  Use --test or --player-ids for a small test run before --all-players.

Examples:
  npm run scrape:dry-run -- --test --season 2024-25
  npm run scrape -- --test --season 2024-25
  npm run scrape -- --player-ids 237 --season 2024-25
  npm run scrape -- --search "LeBron James" --dry-run
  npm run scrape -- --all-players --limit 10 --season 2024-25 --dry-run
`);
}

function parseArgs(argv: string[]): ScrapeOptions & { health: boolean; showHelp: boolean } {
  const current = currentBdlSeasonYear();
  let seasonLabel = `${current}-${String((current + 1) % 100).padStart(2, "0")}`;
  let bdlSeasonYear = current;
  let dryRun = false;
  let health = false;
  let allPlayers = false;
  let allSeasons = false;
  let testMode = false;
  let playerIds: number[] | undefined;
  let searchNames: string[] | undefined;
  let limit: number | undefined;
  let requestDelayMs: number | undefined;
  let showHelp = false;

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
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (testMode) {
    playerIds = TEST_PLAYER_IDS;
  }

  const hasPlayerSelection =
    allPlayers || (playerIds?.length ?? 0) > 0 || (searchNames?.length ?? 0) > 0;

  if (!health && !showHelp && !hasPlayerSelection) {
    showHelp = true;
  }

  return {
    seasonLabel,
    bdlSeasonYear,
    playerIds,
    searchNames,
    allPlayers,
    allSeasons,
    limit,
    dryRun,
    requestDelayMs,
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
  console.log(`Season: ${args.seasonLabel} (balldontlie year ${args.bdlSeasonYear})`);
  console.log("");

  if (args.health) {
    const { IngestClient } = await import("./ingestClient.js");
    const ingest = new IngestClient(config.hoopCentralApiUrl, config.ingestApiKey);
    const result = await ingest.healthCheck();
    console.log(`Health: ${result.ok ? "OK" : "FAILED"} (HTTP ${result.status})`);
    process.exit(result.ok ? 0 : 1);
  }

  const { summary } = await runScrape(config, scrapeOptions);
  printSummary(summary, scrapeOptions.dryRun);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
