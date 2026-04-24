// ============================================================
// MCP Server — ツール登録とセットアップ
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CacheStore } from "./modules/cache-store/index.js";
import { EvidenceLedger } from "./modules/evidence-ledger/index.js";
import { executeResearch } from "./tools/research.js";
import { executeOpenEvidence } from "./tools/open-evidence.js";
import { executeAuditAnswer } from "./tools/audit-answer.js";
import { getConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** nullフィールド除去+コンパクトJSON */
function toJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => (value === null ? undefined : value));
}

export function createServer(): McpServer {
  const config = getConfig();
  const dataDir = config.cache_dir;

  const cacheStore = new CacheStore(join(dataDir, "cache.db"));
  const ledger = new EvidenceLedger(join(dataDir, "evidence.db"));

  const server = new McpServer({
    name: "mcp-ai-evidence-browser",
    version: "0.3.0",
  });

  // ════════════════════════════════════════
  // Evidence Browser Tools
  // ════════════════════════════════════════

  // ────────────────────────────────────────
  // Tool: browser.research
  // ────────────────────────────────────────
  server.registerTool(
    "browser.research",
    {
      title: "Web Research",
      description: "質問からWeb検索→証拠抽出を一括実行しEvidence Cardを返す。情報収集はまずこのツールを使う。",
      inputSchema: {
        question: z.string().describe("質問（自然文）"),
        freshness: z
          .enum(["any", "recent", "latest"])
          .default("any")
          .describe("鮮度"),
        source_preference: z
          .array(z.string())
          .default([])
          .describe("優先ソース種別"),
        max_sources: z
          .number()
          .min(1)
          .max(10)
          .default(5)
          .describe("最大ソース数"),
      },
    },
    async (input) => {
      try {
        const result = await executeResearch(input, ledger, cacheStore);
        return {
          content: [{ type: "text" as const, text: toJson(result) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────
  // Tool: browser.open_evidence
  // ────────────────────────────────────────
  server.registerTool(
    "browser.open_evidence",
    {
      title: "Open Evidence Detail",
      description: "Evidence IDの周辺文脈を取得。researchで得たevidence_idを渡す。",
      inputSchema: {
        evidence_id: z.string().describe("Evidence ID"),
        context_tokens: z
          .number()
          .min(100)
          .max(2000)
          .default(400)
          .describe("文脈の最大トークン数"),
      },
    },
    async (input) => {
      try {
        const result = executeOpenEvidence(input, ledger);
        return {
          content: [{ type: "text" as const, text: toJson(result) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    }
  );

  // ────────────────────────────────────────
  // Tool: browser.audit_answer
  // ────────────────────────────────────────
  server.registerTool(
    "browser.audit_answer",
    {
      title: "Audit Answer",
      description: "回答の正確性が重要な場合のみ使用（医療・法律・論争テーマ等）。通常の情報要約では不要。",
      inputSchema: {
        answer: z.string().describe("回答テキスト"),
        evidence_ids: z
          .array(z.string())
          .min(1)
          .describe("Evidence IDリスト"),
        strictness: z
          .enum(["normal", "strict"])
          .default("normal")
          .describe("strictで推測表現も警告"),
      },
    },
    async (input) => {
      try {
        const result = executeAuditAnswer(input, ledger);
        return {
          content: [{ type: "text" as const, text: toJson(result) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    }
  );

  return server;
}
