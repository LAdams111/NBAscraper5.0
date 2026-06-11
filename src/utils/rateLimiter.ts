import { sleep } from "./season.js";

/** Token-bucket limiter to stay under balldontlie requests/min without hammering 429s. */
export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(private readonly perMinute: number) {
    this.tokens = perMinute;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) return;

    const added = (elapsedMs / 60_000) * this.perMinute;
    if (added < 0.01) return;

    this.tokens = Math.min(this.perMinute, this.tokens + added);
    this.lastRefillMs = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const msPerToken = 60_000 / this.perMinute;
    await sleep(Math.max(10, Math.ceil(msPerToken)));
    return this.acquire();
  }
}
