// ============================================================
// Retrieval Engine — SearXNG検索 + リトライ機構
// ============================================================

import type { RawSearchResult, SearchBackend } from "../../types.js";

// ============================================================
// リトライ付き検索ラッパー
// ============================================================

async function searchWithRetry(
  backend: SearchBackend,
  query: string,
  maxResults: number,
  maxRetries: number = 2,
  backoffMs: number = 3000,
): Promise<RawSearchResult[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const results = await backend.search(query, maxResults);

      // 空結果は再試行しない（検索結果がないのは正常）
      return results;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[retrieval] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, lastError.message);

      if (attempt < maxRetries) {
        const wait = backoffMs * Math.pow(2, attempt); // exponential backoff
        console.error(`[retrieval] Retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  console.error(`[retrieval] All ${maxRetries + 1} attempts failed.`);
  return [];
}

// ============================================================
// SearXNG クライアント
// ============================================================

export class SearXNGBackend implements SearchBackend {
  constructor(private baseUrl: string) {}

  async search(query: string, maxResults: number): Promise<RawSearchResult[]> {
    try {
      const isJapanese = /[\u3000-\u9fff\uff00-\uffef]/.test(query);
      const params = new URLSearchParams({
        q: query,
        format: "json",
        pageno: "1",
        ...(isJapanese ? { language: "ja" } : {}),
      });

      const response = await fetch(`${this.baseUrl}/search?${params}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "mcp-ai-evidence-browser/0.3",
        },
      });

      if (!response.ok) {
        console.error(`[searxng] HTTP ${response.status}`);
        throw new Error(`searxng: HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        results: Array<{
          title: string;
          url: string;
          content: string;
          publishedDate?: string;
        }>;
      };

      return data.results.slice(0, maxResults).map((r) => ({
        title: r.title || "",
        url: r.url,
        snippet: r.content || "",
        published_at: r.publishedDate || null,
      }));
    } catch (error) {
      console.error(`[searxng] Search failed:`, error);
      throw error;
    }
  }
}

// ============================================================
// バックエンドファクトリ（リトライ付き）
// ============================================================

export function createSearchBackend(
  _type: string,
  config: { searxng_url?: string }
): SearchBackend {
  const backend = new SearXNGBackend(config.searxng_url || "http://localhost:8080");

  // リトライ付きラッパーを返す
  return {
    search: (query: string, maxResults: number) =>
      searchWithRetry(backend, query, maxResults),
  };
}
