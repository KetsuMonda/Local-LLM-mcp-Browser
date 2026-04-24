// ============================================================
// Tool: browser.research — Web調査統合ツール
// ============================================================
//
// 自然文の質問を受け取り、検索→取得→抽出→Evidence Card化を一括実行。
// 現行の search_retrieve + search_fetch_chunks を統合。

import { randomUUID } from "crypto";
import type {
  ResearchInput, ResearchOutput, EvidenceCard, Answerability,
  RawSearchResult, SourceType, PrivacyLevel, Freshness,
} from "../types.js";
import { planQuery } from "../modules/planner/index.js";
import { createSearchBackend } from "../modules/retrieval/index.js";
import { getTrustTier } from "../utils/trust-domains.js";
import { extractDomain } from "../utils/url-validator.js";
import {
  evaluateFetchPolicy, safeFetch, safeFetchBinary,
  isHtmlContent, isPlainTextContent, isPdfContent,
} from "../modules/fetch-policy/index.js";
import { extractHtml, extractPlaintext } from "../modules/extractor/index.js";
import { extractPdf } from "../modules/extractor/pdf.js";
import { redactPii } from "../utils/pii-redactor.js";
import { searchRateLimiter } from "../utils/rate-limiter.js";
import { estimateTokens } from "../utils/token-estimator.js";
import { getConfig } from "../config.js";
import type { EvidenceLedger } from "../modules/evidence-ledger/index.js";
import type { CacheStore } from "../modules/cache-store/index.js";

/** ソースタイプ推定 */
function inferSourceType(domain: string, url: string): SourceType {
  const lower = domain.toLowerCase();
  // 公式ドキュメント
  if (/\.(gov|go\.jp|edu|ac\.jp)$/.test(lower)) return "official";
  if (/docs?\.|documentation|developer\./.test(lower)) return "docs";
  if (/github\.com|gitlab\.com/.test(lower)) return "primary";
  // ニュース
  if (/news|press|nikkei|asahi|reuters|bbc/.test(lower)) return "news";
  // ブログ・メディア
  if (/blog|medium\.com|zenn\.dev|qiita\.com|dev\.to/.test(lower)) return "blog";
  // フォーラム
  if (/forum|stackoverflow|reddit|teratail/.test(lower)) return "forum";
  return "unknown";
}

/** 段落から主張(claim)と引用(quote)を抽出 */
function extractClaimsFromText(
  text: string,
  queryWords: Set<string>,
  maxClaims: number = 3,
): Array<{ claim: string; quote: string; confidence: number }> {
  // 文分割
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  // 各文のクエリ関連度スコア
  const scored = sentences.map((sentence) => {
    const words = sentence.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length > 1);
    let hits = 0;
    for (const qw of queryWords) {
      if (words.some((w) => w.includes(qw))) hits++;
    }
    const coverage = queryWords.size > 0 ? hits / queryWords.size : 0;
    return { sentence, score: coverage };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((s) => s.score > 0)
    .slice(0, maxClaims)
    .map((s) => ({
      claim: s.sentence.length > 200 ? s.sentence.substring(0, 200) + "…" : s.sentence,
      quote: s.sentence,
      confidence: Math.round(Math.min(s.score + 0.3, 1.0) * 100) / 100,
    }));
}

export async function executeResearch(
  input: ResearchInput,
  ledger: EvidenceLedger,
  cacheStore?: CacheStore,
): Promise<ResearchOutput> {
  const config = getConfig();
  const maxSources = input.max_sources || 5;
  const privacyLevel = input.privacy_level || "normal";
  const privacyMode = privacyLevel === "strict" ? "privacy_strict" as const : "balanced" as const;
  const freshness: Freshness = input.freshness || "any";

  // 1. タスク作成
  const taskId = ledger.createTask(input.question, privacyLevel);

  // 2. クエリプランニング（detected_freshnessが自動検出した鮮度を使用）
  const plan = planQuery(input.question, freshness, privacyMode);
  const effectiveFreshness = plan.detected_freshness;
  ledger.addQueryToTask(taskId, plan.rewritten_query);
  for (const eq of plan.expanded_queries) {
    ledger.addQueryToTask(taskId, eq);
  }

  const queryWords = new Set(
    input.question.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length > 1)
  );

  // 3. 検索実行
  const backend = createSearchBackend(config.search_backend, config);
  const allRawResults: RawSearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const query of plan.expanded_queries) {
    await searchRateLimiter.acquire("search-global");
    const rawResults = await backend.search(query, maxSources);
    for (const r of rawResults) {
      if (!seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        allRawResults.push(r);
      }
    }
  }

  if (allRawResults.length === 0) {
    ledger.updateTaskStatus(taskId, "completed");
    return {
      task_id: taskId,
      answerability: "no_results",
      summary: "検索結果が見つかりませんでした。",
      top_evidence: [],
      conflicts: [],
      recommended_next_action: "rephrase_query",
    };
  }

  // 4. ソース優先度でソート
  const sourcePref = input.source_preference || [];
  const rankedResults = allRawResults.map((r) => {
    const domain = extractDomain(r.url) || "unknown";
    const trustTier = getTrustTier(domain);
    const sourceType = inferSourceType(domain, r.url);
    const trustScore = { official: 1, primary: 0.85, reputable_secondary: 0.65, secondary: 0.45, ugc: 0.25, unknown: 0.15 }[trustTier] || 0.15;
    const prefBonus = sourcePref.includes(sourceType) ? 0.2 : 0;
    return { raw: r, domain, trustTier, sourceType, score: trustScore + prefBonus };
  });
  rankedResults.sort((a, b) => b.score - a.score);
  const topResults = rankedResults.slice(0, maxSources);

  // 5. 並列フェッチ＆証拠抽出
  const allEvidence: EvidenceCard[] = [];
  const sourceMap = new Map<string, Record<string, string>>();
  const concurrency = Math.min(topResults.length, config.max_concurrent_fetches);
  const batches: typeof topResults[] = [];
  for (let i = 0; i < topResults.length; i += concurrency) {
    batches.push(topResults.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const promises = batch.map(async (item) => {
      const { raw, domain, trustTier, sourceType } = item;

      // URL重複チェック
      if (ledger.hasUrl(taskId, raw.url)) return;

      // フェッチポリシー
      const policy = await evaluateFetchPolicy(raw.url, privacyMode);
      if (!policy.allowed) return;

      // ソースをLedgerに登録
      const sourceId = ledger.addSource(
        taskId, raw.url, raw.title, sourceType, trustTier, raw.published_at || null,
      );

      // フェッチ
      let extractedText = "";
      let extractedTitle = raw.title;

      // キャッシュチェック
      if (cacheStore) {
        const cached = cacheStore.getPageCache(raw.url);
        if (cached?.extractedText) {
          extractedText = cached.extractedText;
          extractedTitle = cached.title || raw.title;
        }
      }

      if (!extractedText) {
        try {
          const urlLower = raw.url.toLowerCase();
          const isPdf = urlLower.endsWith(".pdf") || urlLower.includes("/pdf/");

          if (isPdf) {
            const result = await safeFetchBinary(raw.url, policy.headers);
            if (result.ok) {
              const pdf = await extractPdf(result.buffer, raw.url);
              extractedText = pdf.text;
              extractedTitle = pdf.title || raw.title;
              if (cacheStore && extractedText) {
                cacheStore.setPageCache(raw.url, "application/pdf", "", extractedTitle, extractedText, config.cache_ttl_hours);
              }
            }
          } else {
            const result = await safeFetch(raw.url, policy.headers);
            if (result.ok) {
              if (isHtmlContent(result.contentType)) {
                const ex = extractHtml(result.text, result.finalUrl);
                extractedText = ex.text;
                extractedTitle = ex.title || raw.title;
              } else if (isPlainTextContent(result.contentType)) {
                const ex = extractPlaintext(result.text);
                extractedText = ex.text;
              }
              if (cacheStore && extractedText) {
                cacheStore.setPageCache(raw.url, result.contentType, result.text, extractedTitle, extractedText, config.cache_ttl_hours);
              }
            }
          }
        } catch {
          // フェッチ失敗: スキップ
          return;
        }
      }

      if (!extractedText || extractedText.length < 50) return;

      // PII墨消し
      const isStrict = privacyMode === "privacy_strict";
      const redacted = redactPii(extractedText, isStrict);
      const cleanText = redacted.text;

      // Evidence Card抽出 (主張+引用) — 1ソースあたり最大2件
      const claims = extractClaimsFromText(cleanText, queryWords, 2);
      if (claims.length === 0) return;

      // ソース参照テーブルに登録 (sidで重複排除)
      if (!sourceMap.has(sourceId)) {
        const sref: Record<string, string> = {
          url: raw.url,
          title: extractedTitle,
          domain,
        };
        if (sourceType !== "unknown") sref.type = sourceType;
        if (raw.published_at) sref.pub = raw.published_at;
        sourceMap.set(sourceId, sref);
      }

      // 短い文脈をカードに埋め込み (open_evidence不要化)
      const briefContext = cleanText.substring(0, 600).replace(/\n{2,}/g, "\n");

      for (const c of claims) {
        const evidenceId = ledger.addEvidence(
          taskId, sourceId, c.claim, c.quote, cleanText.substring(0, 1000),
          null, c.confidence, [],
        );

        const card: Record<string, unknown> = {
          id: evidenceId,
          sid: sourceId,
          claim: c.claim,
          conf: c.confidence,
          ctx: briefContext,
        };
        if (c.quote !== c.claim) card.quote = c.quote;

        allEvidence.push(card as any);
      }
    });

    await Promise.all(promises);
  }

  // 6. 結果構成
  allEvidence.sort((a, b) => (b as any).conf - (a as any).conf);

  // Context Budget: Evidence Cardsを制限 (削減: 4000→2500)
  const budgetTokens = 2500;
  const budgetEvidence: EvidenceCard[] = [];
  let usedTokens = 0;
  for (const ev of allEvidence) {
    const evTokens = estimateTokens(JSON.stringify(ev));
    if (usedTokens + evTokens > budgetTokens && budgetEvidence.length > 0) break;
    budgetEvidence.push(ev);
    usedTokens += evTokens;
  }

  // 矛盾検出（簡易）
  const conflicts: string[] = [];
  const negation = /\b(not|no|never|false|incorrect|wrong|doesn't|isn't|ない|違う|誤り)\b/i;
  for (let i = 0; i < budgetEvidence.length; i++) {
    for (let j = i + 1; j < budgetEvidence.length; j++) {
      const aNeg = negation.test((budgetEvidence[i] as any).claim);
      const bNeg = negation.test((budgetEvidence[j] as any).claim);
      if (aNeg !== bNeg && (budgetEvidence[i] as any).sid !== (budgetEvidence[j] as any).sid) {
        conflicts.push(
          `${(budgetEvidence[i] as any).sid} と ${(budgetEvidence[j] as any).sid} で矛盾の可能性`
        );
      }
    }
  }

  // 回答可能性判定
  let status: string;
  if (budgetEvidence.length >= 3) status = "answerable";
  else if (budgetEvidence.length >= 1) status = "partial";
  else status = "none";

  // 使用されたsourceのみ参照テーブルに含める
  const usedSids = new Set(budgetEvidence.map((e: any) => e.sid));
  const filteredSources: Record<string, Record<string, string>> = {};
  for (const [sid, sref] of sourceMap) {
    if (usedSids.has(sid)) filteredSources[sid] = sref;
  }

  const summary = `${budgetEvidence.length}件/${topResults.length}ソース` +
    (conflicts.length > 0 ? ` 矛盾${conflicts.length}` : "");

  ledger.updateTaskStatus(taskId, "completed");

  return {
    task_id: taskId,
    status,
    summary,
    sources: filteredSources,
    evidence: budgetEvidence,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  } as any;
}
