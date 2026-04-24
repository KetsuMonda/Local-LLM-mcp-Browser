// ============================================================
// Query Planner — マルチクエリ展開 + バイリンガル対応
// ============================================================

import { detectPiiInQuery } from "../../utils/pii-redactor.js";
import type { Freshness, PrivacyMode } from "../../types.js";

export interface PlanResult {
  rewritten_query: string;
  expanded_queries: string[];
  detected_freshness: Freshness;
  pii_warnings: string[];
  intent_hints: string[];
}

/** 時間表現パターン */
const FRESHNESS_PATTERNS = {
  latest: [
    /(?:latest|newest|most recent|今日|本日|最新|速報|breaking)/i,
    /\b202[4-9]\b/,
    /\b2030s?\b/,
  ],
  recent: [
    /(?:recent|recently|この前|最近|先日|先週|先月)/i,
    /(?:this (?:week|month|year))/i,
    /(?:last (?:week|month))/i,
    /(?:今週|今月|今年|去年|昨年)/i,
  ],
};

/** ストップワード（クエリ最適化用） */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you",
  "your", "yours", "yourself", "yourselves", "he", "him", "his",
  "himself", "she", "her", "hers", "herself", "it", "its", "itself",
  "they", "them", "their", "theirs", "themselves",
  // 日本語助詞
  "の", "に", "は", "を", "が", "で", "と", "も", "や", "な", "か",
  "って", "という", "について", "とは", "とか",
]);

/**
 * クエリの意図ヒントを検出
 */
function detectIntentHints(query: string): string[] {
  const hints: string[] = [];
  const lower = query.toLowerCase();

  if (/(?:compare|comparison|vs\.?|versus|比較|違い)/.test(lower)) {
    hints.push("comparison");
  }
  if (/(?:how to|tutorial|guide|方法|やり方|手順)/.test(lower)) {
    hints.push("how-to");
  }
  if (/(?:definition|define|what is|とは|意味|定義)/.test(lower)) {
    hints.push("definition");
  }
  if (/(?:review|opinion|評価|レビュー|感想)/.test(lower)) {
    hints.push("opinion");
  }
  if (/(?:official|公式|ドキュメント|documentation)/.test(lower)) {
    hints.push("official-docs");
  }
  if (/(?:price|cost|pricing|料金|価格|値段)/.test(lower)) {
    hints.push("pricing");
  }
  if (/(?:error|bug|fix|issue|エラー|バグ|修正)/.test(lower)) {
    hints.push("troubleshooting");
  }

  return hints;
}

/**
 * 鮮度要件を検出
 */
function detectFreshness(query: string, requestedFreshness: Freshness): Freshness {
  if (requestedFreshness !== "any") {
    return requestedFreshness;
  }

  for (const pattern of FRESHNESS_PATTERNS.latest) {
    if (pattern.test(query)) return "latest";
  }
  for (const pattern of FRESHNESS_PATTERNS.recent) {
    if (pattern.test(query)) return "recent";
  }

  return "any";
}

/**
 * クエリを簡易的にリライト（ストップワード除去＋正規化）
 */
function rewriteQuery(query: string): string {
  let cleaned = query.trim();

  // 引用符で囲まれた部分はそのまま保持
  const quoted: string[] = [];
  cleaned = cleaned.replace(/"([^"]+)"/g, (_match, group) => {
    quoted.push(group);
    return `__QUOTED_${quoted.length - 1}__`;
  });

  // ストップワード除去（英語のみ、短すぎるクエリには適用しない）
  const words = cleaned.split(/\s+/);
  if (words.length > 3) {
    const filtered = words.filter(
      (w) => !STOP_WORDS.has(w.toLowerCase()) || w.startsWith("__QUOTED_")
    );
    if (filtered.length >= 2) {
      cleaned = filtered.join(" ");
    }
  }

  // 引用符を復元
  for (let i = 0; i < quoted.length; i++) {
    cleaned = cleaned.replace(`__QUOTED_${i}__`, `"${quoted[i]}"`);
  }

  return cleaned;
}

// ============================================================
// マルチクエリ展開
// ============================================================

/** 日本語が含まれるか判定 */
function isJapanese(text: string): boolean {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(text);
}

/** 英語が含まれるか判定 */
function isEnglish(text: string): boolean {
  return /[a-zA-Z]{3,}/.test(text);
}

/**
 * クエリから技術キーワードを抽出
 */
function extractTechKeywords(query: string): string[] {
  const keywords: string[] = [];

  // バージョン番号付きの技術名 (TypeScript 6.0, Python 3.12, etc.)
  const versionMatches = query.matchAll(/([A-Za-z][A-Za-z0-9.#+]*)\s*(\d+(?:\.\d+)*)/g);
  for (const m of versionMatches) {
    keywords.push(`${m[1]} ${m[2]}`);
  }

  // 一般的な技術名パターン
  const techPattern = /\b(TypeScript|JavaScript|Python|Rust|Go|Kotlin|Swift|React|Vue|Angular|Next\.?js|Node\.?js|Docker|Kubernetes|AWS|Azure|GCP|PostgreSQL|Redis|MongoDB|GraphQL|gRPC|WebAssembly|WASM)\b/gi;
  const techMatches = query.matchAll(techPattern);
  for (const m of techMatches) {
    if (!keywords.some(k => k.toLowerCase().includes(m[1].toLowerCase()))) {
      keywords.push(m[1]);
    }
  }

  return keywords;
}

/**
 * マルチクエリ展開
 * 1つのクエリを2〜3個の異なる検索クエリに分解
 */
function expandQueries(
  primaryQuery: string,
  intentHints: string[],
  freshness: Freshness,
): string[] {
  const queries: string[] = [primaryQuery];
  const hasJapanese = isJapanese(primaryQuery);
  const hasEnglish = isEnglish(primaryQuery);
  const techKeywords = extractTechKeywords(primaryQuery);

  // ── バイリンガル展開 ──
  // 日本語クエリに英語キーワードが含まれる → 英語版クエリを追加
  if (hasJapanese && techKeywords.length > 0) {
    // 意図に応じた英語サフィックス
    let suffix = "";
    if (intentHints.includes("how-to")) suffix = "tutorial guide";
    else if (intentHints.includes("comparison")) suffix = "comparison benchmark";
    else if (intentHints.includes("troubleshooting")) suffix = "fix solution";
    else if (intentHints.includes("definition")) suffix = "what is explained";
    else suffix = "overview";

    const englishQuery = `${techKeywords.join(" ")} ${suffix}`.trim();
    if (englishQuery !== primaryQuery) {
      queries.push(englishQuery);
    }
  }

  // 英語クエリで日本語ユーザーっぽい場合 → 日本語版追加
  if (!hasJapanese && hasEnglish && techKeywords.length > 0) {
    let suffix = "";
    if (intentHints.includes("how-to")) suffix = "使い方 入門";
    else if (intentHints.includes("comparison")) suffix = "比較";
    else if (intentHints.includes("troubleshooting")) suffix = "エラー 解決";
    else suffix = "まとめ";

    const japaneseQuery = `${techKeywords.join(" ")} ${suffix}`.trim();
    queries.push(japaneseQuery);
  }

  // ── 意図ベース展開 ──
  if (intentHints.includes("comparison") && techKeywords.length >= 2) {
    queries.push(`${techKeywords[0]} vs ${techKeywords[1]} performance benchmark`);
  }

  // ── 鮮度ベース展開 ──
  if (freshness === "latest" || freshness === "recent") {
    const year = new Date().getFullYear();
    // 年号が含まれていない場合のみ追加
    if (!primaryQuery.includes(String(year))) {
      queries.push(`${primaryQuery} ${year}`);
    }
  }

  // 重複排除、最大3クエリに制限
  const unique = [...new Set(queries)];
  return unique.slice(0, 3);
}

/**
 * クエリを計画する
 */
export function planQuery(
  query: string,
  requestedFreshness: Freshness,
  privacyMode: PrivacyMode
): PlanResult {
  const piiWarnings = detectPiiInQuery(query);
  const intentHints = detectIntentHints(query);
  const detectedFreshness = detectFreshness(query, requestedFreshness);

  let rewrittenQuery = rewriteQuery(query);

  // privacy_strict モードではPIIが含まれるクエリを墨消し
  if (privacyMode === "privacy_strict" && piiWarnings.length > 0) {
    rewrittenQuery = `[PII_DETECTED] ${rewrittenQuery}`;
  }

  // マルチクエリ展開
  const expandedQueries = expandQueries(rewrittenQuery, intentHints, detectedFreshness);

  return {
    rewritten_query: rewrittenQuery,
    expanded_queries: expandedQueries,
    detected_freshness: detectedFreshness,
    pii_warnings: piiWarnings,
    intent_hints: intentHints,
  };
}
