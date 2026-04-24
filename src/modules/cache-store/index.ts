// ============================================================
// Cache Store — SQLiteベースの検索・フェッチキャッシュ
// ============================================================

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export class CacheStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        query_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        results_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_hours INTEGER NOT NULL DEFAULT 24
      );

      CREATE TABLE IF NOT EXISTS page_cache (
        url TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        body TEXT NOT NULL,
        title TEXT,
        extracted_text TEXT,
        created_at TEXT NOT NULL,
        ttl_hours INTEGER NOT NULL DEFAULT 24
      );
    `);
  }

  // ============================================================
  // 検索キャッシュ
  // ============================================================

  /**
   * 検索結果をキャッシュに保存
   */
  setSearchCache(query: string, results: unknown[], ttlHours: number = 24): void {
    const key = this.normalizeQueryKey(query);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO search_cache (query_key, query, results_json, created_at, ttl_hours)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(key, query, JSON.stringify(results), now, ttlHours);
  }

  /**
   * 検索キャッシュを取得（TTL切れはnull）
   */
  getSearchCache(query: string): unknown[] | null {
    const key = this.normalizeQueryKey(query);
    const row = this.db
      .prepare(`SELECT results_json, created_at, ttl_hours FROM search_cache WHERE query_key = ?`)
      .get(key) as { results_json: string; created_at: string; ttl_hours: number } | undefined;

    if (!row) return null;
    if (this.isExpired(row.created_at, row.ttl_hours)) {
      this.db.prepare(`DELETE FROM search_cache WHERE query_key = ?`).run(key);
      return null;
    }

    return JSON.parse(row.results_json);
  }

  // ============================================================
  // ページキャッシュ
  // ============================================================

  /**
   * ページ取得結果をキャッシュに保存
   */
  setPageCache(
    url: string,
    contentType: string,
    body: string,
    title: string | null,
    extractedText: string | null,
    ttlHours: number = 24
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO page_cache (url, content_type, body, title, extracted_text, created_at, ttl_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(url, contentType, body, title, extractedText, now, ttlHours);
  }

  /**
   * ページキャッシュを取得（TTL切れはnull）
   */
  getPageCache(url: string): { contentType: string; body: string; title: string | null; extractedText: string | null } | null {
    const row = this.db
      .prepare(`SELECT content_type, body, title, extracted_text, created_at, ttl_hours FROM page_cache WHERE url = ?`)
      .get(url) as {
        content_type: string; body: string; title: string | null;
        extracted_text: string | null; created_at: string; ttl_hours: number;
      } | undefined;

    if (!row) return null;
    if (this.isExpired(row.created_at, row.ttl_hours)) {
      this.db.prepare(`DELETE FROM page_cache WHERE url = ?`).run(url);
      return null;
    }

    return {
      contentType: row.content_type,
      body: row.body,
      title: row.title,
      extractedText: row.extracted_text,
    };
  }

  // ============================================================
  // ユーティリティ
  // ============================================================

  /**
   * 期限切れキャッシュを一括削除
   */
  cleanup(): { searchDeleted: number; pageDeleted: number } {
    const now = new Date();
    const s = this.db.prepare(
      `DELETE FROM search_cache WHERE datetime(created_at, '+' || ttl_hours || ' hours') < datetime(?)`
    ).run(now.toISOString());
    const p = this.db.prepare(
      `DELETE FROM page_cache WHERE datetime(created_at, '+' || ttl_hours || ' hours') < datetime(?)`
    ).run(now.toISOString());
    return { searchDeleted: s.changes, pageDeleted: p.changes };
  }

  /**
   * キャッシュ統計
   */
  getStats(): { searchEntries: number; pageEntries: number; dbSizeBytes: number } {
    const sc = this.db.prepare(`SELECT COUNT(*) as cnt FROM search_cache`).get() as { cnt: number };
    const pc = this.db.prepare(`SELECT COUNT(*) as cnt FROM page_cache`).get() as { cnt: number };
    const size = this.db.prepare(`SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()`).get() as { size: number };
    return {
      searchEntries: sc.cnt,
      pageEntries: pc.cnt,
      dbSizeBytes: size?.size ?? 0,
    };
  }

  private normalizeQueryKey(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, " ");
  }

  private isExpired(createdAt: string, ttlHours: number): boolean {
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return now - created > ttlHours * 3600_000;
  }

  close(): void {
    this.db.close();
  }
}
