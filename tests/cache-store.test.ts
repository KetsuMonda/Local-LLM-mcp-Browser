import { describe, it, expect, afterEach } from "vitest";
import { CacheStore } from "../src/modules/cache-store/index.js";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DIR = join(process.cwd(), "test-data-cache");
const TEST_DB = join(TEST_DIR, "test-cache.db");

describe("CacheStore", () => {
  let cache: CacheStore;

  afterEach(() => {
    if (cache) cache.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("stores and retrieves search cache", () => {
    cache = new CacheStore(TEST_DB);
    const results = [
      { title: "Test Result", url: "https://example.com", snippet: "Hello" },
    ];

    cache.setSearchCache("typescript tutorial", results);
    const cached = cache.getSearchCache("typescript tutorial");

    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(1);
    expect((cached![0] as any).title).toBe("Test Result");
  });

  it("normalizes query keys for cache lookup", () => {
    cache = new CacheStore(TEST_DB);
    cache.setSearchCache("TypeScript  Tutorial", [{ id: 1 }]);

    // 正規化後の同一クエリでヒットする
    const cached = cache.getSearchCache("typescript tutorial");
    expect(cached).not.toBeNull();
  });

  it("returns null for expired cache", () => {
    cache = new CacheStore(TEST_DB);
    // 通常挿入
    cache.setSearchCache("old query", [{ id: 1 }], 1);

    // DBに直接過去の日付を書き込んで期限切れをシミュレート
    const db = (cache as any).db;
    const pastDate = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2時間前
    db.prepare(`UPDATE search_cache SET created_at = ? WHERE query_key = ?`).run(pastDate, "old query");

    const cached = cache.getSearchCache("old query");
    expect(cached).toBeNull();
  });

  it("stores and retrieves page cache", () => {
    cache = new CacheStore(TEST_DB);
    cache.setPageCache(
      "https://example.com/article",
      "text/html",
      "<html>...</html>",
      "Test Article",
      "This is the extracted text content.",
      24
    );

    const cached = cache.getPageCache("https://example.com/article");
    expect(cached).not.toBeNull();
    expect(cached!.title).toBe("Test Article");
    expect(cached!.extractedText).toBe("This is the extracted text content.");
  });

  it("reports cache statistics", () => {
    cache = new CacheStore(TEST_DB);
    cache.setSearchCache("query1", [{ id: 1 }]);
    cache.setSearchCache("query2", [{ id: 2 }]);
    cache.setPageCache("https://a.com", "text/html", "body", "A", "text", 24);

    const stats = cache.getStats();
    expect(stats.searchEntries).toBe(2);
    expect(stats.pageEntries).toBe(1);
    expect(stats.dbSizeBytes).toBeGreaterThan(0);
  });
});
