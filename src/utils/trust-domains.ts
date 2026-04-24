// ============================================================
// ドメイン信頼度マスター
// ============================================================

import type { TrustTier } from "../types.js";

/**
 * ドメインパターン → 信頼度ティアのマッピング
 * ワイルドカード(*.)はサブドメインを含む
 */
const TRUST_MAP: Record<string, TrustTier> = {
  // === official: 政府・公的機関 ===
  "go.jp": "official",
  "gov": "official",
  "gov.uk": "official",
  "edu": "official",
  "ac.jp": "official",
  "ac.uk": "official",
  "mil": "official",
  "who.int": "official",
  "un.org": "official",
  "europa.eu": "official",
  "or.jp": "official",

  // 主要テック企業公式
  "microsoft.com": "official",
  "apple.com": "official",
  "google.com": "official",
  "developer.android.com": "official",
  "developer.apple.com": "official",
  "docs.microsoft.com": "official",
  "learn.microsoft.com": "official",
  "cloud.google.com": "official",
  "aws.amazon.com": "official",
  "docs.aws.amazon.com": "official",
  "nodejs.org": "official",
  "python.org": "official",
  "rust-lang.org": "official",
  "typescriptlang.org": "official",
  "mozilla.org": "official",
  "w3.org": "official",
  "go.dev": "official",
  "kotlinlang.org": "official",
  "swift.org": "official",
  "vuejs.org": "official",
  "react.dev": "official",
  "angular.dev": "official",
  "nextjs.org": "official",
  "docker.com": "official",
  "kubernetes.io": "official",
  "postgresql.org": "official",
  "redis.io": "official",

  // === primary: 一次情報源 ===
  "arxiv.org": "primary",
  "nature.com": "primary",
  "science.org": "primary",
  "ieee.org": "primary",
  "acm.org": "primary",
  "springer.com": "primary",
  "pubmed.ncbi.nlm.nih.gov": "primary",
  "scholar.google.com": "primary",
  "jst.go.jp": "primary",
  "ci.nii.ac.jp": "primary",
  "ipa.go.jp": "primary",

  // === reputable_secondary: 信頼性の高い二次情報源 ===
  "wikipedia.org": "reputable_secondary",
  "reuters.com": "reputable_secondary",
  "apnews.com": "reputable_secondary",
  "bbc.com": "reputable_secondary",
  "bbc.co.uk": "reputable_secondary",
  "nhk.or.jp": "reputable_secondary",
  "nikkei.com": "reputable_secondary",
  "nytimes.com": "reputable_secondary",
  "theguardian.com": "reputable_secondary",
  "washingtonpost.com": "reputable_secondary",
  "techcrunch.com": "reputable_secondary",
  "arstechnica.com": "reputable_secondary",
  "wired.com": "reputable_secondary",
  "theregister.com": "reputable_secondary",
  "theverge.com": "reputable_secondary",
  "asahi.com": "reputable_secondary",
  "mainichi.jp": "reputable_secondary",
  "yomiuri.co.jp": "reputable_secondary",
  "itmedia.co.jp": "reputable_secondary",
  "impress.co.jp": "reputable_secondary",
  "gihyo.jp": "reputable_secondary",
  "publickey1.jp": "reputable_secondary",

  // === secondary: 二次情報源 ===
  "github.com": "secondary",
  "stackoverflow.com": "secondary",
  "dev.to": "secondary",
  "medium.com": "secondary",
  "zenn.dev": "secondary",
  "qiita.com": "secondary",
  "hackernews.com": "secondary",
  "news.ycombinator.com": "secondary",
  "note.com": "secondary",
  "hatena.ne.jp": "secondary",
  "hatenablog.com": "secondary",
  "srad.jp": "secondary",
  "gigazine.net": "secondary",

  // === ugc: ユーザー生成コンテンツ ===
  "reddit.com": "ugc",
  "twitter.com": "ugc",
  "x.com": "ugc",
  "facebook.com": "ugc",
  "quora.com": "ugc",
  "yahoo.co.jp": "ugc",
  "chiebukuro.yahoo.co.jp": "ugc",
  "5ch.net": "ugc",
  "2ch.sc": "ugc",
  "togetter.com": "ugc",
  "anond.hatelabo.jp": "ugc",
};

/**
 * ドメインからTrustTierを判定する
 */
export function getTrustTier(domain: string): TrustTier {
  const normalized = domain.toLowerCase().replace(/^www\./, "");

  // 完全一致
  if (TRUST_MAP[normalized]) {
    return TRUST_MAP[normalized];
  }

  // サブドメインマッチ (e.g., "docs.python.org" → "python.org")
  const parts = normalized.split(".");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(i).join(".");
    if (TRUST_MAP[parent]) {
      return TRUST_MAP[parent];
    }
  }

  // TLDマッチ (e.g., "example.go.jp" → "go.jp")
  if (parts.length >= 3) {
    const tld2 = parts.slice(-2).join(".");
    if (TRUST_MAP[tld2]) {
      return TRUST_MAP[tld2];
    }
  }

  return "unknown";
}
