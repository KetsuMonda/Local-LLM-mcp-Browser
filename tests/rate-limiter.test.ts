import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../src/utils/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests within limit", async () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 10000, minIntervalMs: 0 });
    
    const start = Date.now();
    await limiter.acquire("test");
    await limiter.acquire("test");
    await limiter.acquire("test");
    const elapsed = Date.now() - start;
    
    // 3リクエストは即座に通る
    expect(elapsed).toBeLessThan(100);
  });

  it("tracks separate keys independently", async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10000, minIntervalMs: 0 });

    await limiter.acquire("key-a");
    await limiter.acquire("key-a");
    // key-aは2/2消費、key-bはまだ0/2
    
    const status = limiter.getStatus("key-a");
    expect(status.remaining).toBe(0);
    
    const statusB = limiter.getStatus("key-b");
    expect(statusB.remaining).toBe(2);
  });

  it("reports remaining capacity correctly", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000, minIntervalMs: 0 });
    
    const status = limiter.getStatus("fresh-key");
    expect(status.remaining).toBe(5);
    expect(status.resetInMs).toBe(0);
  });

  it("enforces minimum interval between requests", async () => {
    const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000, minIntervalMs: 50 });
    
    const start = Date.now();
    await limiter.acquire("interval-test");
    await limiter.acquire("interval-test");
    const elapsed = Date.now() - start;
    
    // 2番目のリクエストで少なくとも50ms待機するはず
    expect(elapsed).toBeGreaterThanOrEqual(40); // 少しマージン
  });
});
