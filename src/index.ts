// ============================================================
// MCP AI Evidence Browser — エントリポイント
// ============================================================

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { CacheStore } from "./modules/cache-store/index.js";
import { getConfig } from "./config.js";
import { ensureSearchBackend } from "./utils/docker-manager.js";
import { join } from "path";

async function main() {
  const log = (msg: string) => console.error(`[evidence-browser] ${msg}`);
  log("Starting v0.3.0...");

  const config = getConfig();

  // 1. キャッシュクリーンアップ
  try {
    const cacheStore = new CacheStore(join(config.cache_dir, "cache.db"));
    const cleaned = cacheStore.cleanup();
    if (cleaned.searchDeleted > 0 || cleaned.pageDeleted > 0) {
      log(`Cache cleanup: ${cleaned.searchDeleted} search + ${cleaned.pageDeleted} page expired`);
    }
    cacheStore.close();
  } catch {
    // キャッシュクリーンアップ失敗は致命的ではない
  }

  // 2. SearXNG 自動起動（Docker必須）
  log("Ensuring SearXNG is running...");
  await ensureSearchBackend(config.searxng_url);

  // 3. MCP Server 起動
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("Server connected via stdio");
  log("Tools: browser.research, browser.open_evidence, browser.audit_answer");
}

main().catch((error) => {
  console.error("[evidence-browser] Fatal error:", error);
  process.exit(1);
});
