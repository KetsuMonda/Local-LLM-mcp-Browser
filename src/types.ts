// ============================================================
// Privacy-First Research MCP — 共通型定義
// ============================================================

/** 信頼度ティア */
export type TrustTier =
  | "official"
  | "primary"
  | "reputable_secondary"
  | "secondary"
  | "ugc"
  | "unknown";

/** プライバシーモード */
export type PrivacyMode = "privacy_strict" | "balanced" | "max_recall";

/** 鮮度指定 */
export type Freshness = "any" | "recent" | "latest";

/** 取得モード */
export type RetrievalMode = "live" | "cache_only" | "internal_only" | "hybrid";

/** キャッシュ状態 */
export type CacheStatus = "hit" | "miss" | "partial";

/** 回答スタイル */
export type AnswerStyle = "concise" | "standard" | "detailed";

/** 信頼度レベル */
export type Confidence = "low" | "medium" | "high";

// ============================================================
// 検索結果
// ============================================================

export interface SearchResult {
  source_id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published_at: string | null;
  retrieved_at: string;
  trust_tier: TrustTier;
  rank_score: number;
  cache_status: CacheStatus;
}

export interface RetrieveOutput {
  query_used: string;
  results: SearchResult[];
  audit_ref: string;
}

// ============================================================
// チャンク
// ============================================================

export interface Chunk {
  chunk_id: string;
  source_id: string;
  url: string;
  title: string;
  domain: string;
  published_at: string | null;
  retrieved_at: string;
  section_title: string | null;
  trust_tier: TrustTier;
  salience_score: number;
  token_estimate: number;
  text: string;
  redactions_applied: string[];
}

export interface RejectedSource {
  source_id: string;
  reason: string;
}

export interface FetchChunksOutput {
  chunks: Chunk[];
  rejected_sources: RejectedSource[];
  audit_ref: string;
}

/** 参照テーブル方式 — ソースメタデータ */
export interface SourceRef {
  url: string;
  title: string;
  domain: string;
  trust_tier: TrustTier;
  published_at: string | null;
}

/** 参照テーブル方式 — コンパクトチャンク（ソースはsidで参照） */
export interface CompactChunk {
  id: string;
  sid: string;
  section: string | null;
  score: number;
  tokens: number;
  text: string;
}

/** 参照テーブル方式 — コンパクト出力 */
export interface CompactFetchChunksOutput {
  sources: Record<string, SourceRef>;
  chunks: CompactChunk[];
  rejected_sources: RejectedSource[];
  audit_ref: string;
}

// ============================================================
// 回答
// ============================================================

export interface Claim {
  claim_id: string;
  text: string;
  citation_chunk_ids: string[];
  confidence: Confidence;
}

export interface AnswerOutput {
  answer: string;
  claims: Claim[];
  conflicts: string[];
  open_questions: string[];
  insufficient_evidence: boolean;
}

// ============================================================
// 監査
// ============================================================

export interface LatencyBreakdown {
  retrieve: number;
  fetch: number;
  chunk: number;
  answer: number;
}

export interface AuditOutput {
  queries_executed: string[];
  domains_visited: string[];
  sources_used: string[];
  sources_rejected: RejectedSource[];
  policy_actions: string[];
  redactions_applied: string[];
  latency_breakdown_ms: LatencyBreakdown;
}

// ============================================================
// 監査ストアのエントリ
// ============================================================

export interface AuditEntry {
  audit_ref: string;
  timestamp: string;
  queries_executed: string[];
  domains_visited: string[];
  sources_used: string[];
  sources_rejected: RejectedSource[];
  policy_actions: string[];
  redactions_applied: string[];
  latency_breakdown_ms: LatencyBreakdown;
}

// ============================================================
// 検索バックエンド抽象
// ============================================================

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  published_at?: string | null;
}

export interface SearchBackend {
  search(query: string, maxResults: number): Promise<RawSearchResult[]>;
}

// ============================================================
// 設定
// ============================================================

export interface AppConfig {
  search_backend: string;
  searxng_url: string;
  cache_dir: string;
  cache_ttl_hours: number;
  max_concurrent_fetches: number;
  fetch_timeout_ms: number;
  max_fetch_size_bytes: number;
  default_privacy_mode: PrivacyMode;
  rate_limit: {
    requests_per_minute: number;
    per_domain_rpm: number;
  };
}

// ============================================================
// 内部ソースレジストリ (source_id → URL マッピング)
// ============================================================

export interface SourceEntry {
  source_id: string;
  url: string;
  title: string;
  domain: string;
  trust_tier: TrustTier;
  snippet: string;
  published_at: string | null;
}

// ============================================================
// Evidence Browser — 新型定義
// ============================================================

/** ソースタイプ */
export type SourceType = "official" | "primary" | "docs" | "news" | "blog" | "forum" | "ugc" | "unknown";

/** プライバシーレベル */
export type PrivacyLevel = "normal" | "strict" | "compatibility";

/** タスクステータス */
export type TaskStatus = "active" | "completed" | "failed";

/** 回答可能性 */
export type Answerability = "likely_answerable" | "partially_answerable" | "unlikely_answerable" | "no_results";

/** Evidence Card — AI に渡す証拠の基本単位 */
export interface EvidenceCard {
  evidence_id: string;
  source_type: SourceType;
  title: string;
  url: string;
  domain: string;
  retrieved_at: string;
  published_at: string | null;
  claim: string;
  quote: string;
  confidence: number;
  risk_flags: string[];
}

/** Task レコード */
export interface TaskRecord {
  id: string;
  question: string;
  created_at: string;
  updated_at: string;
  status: TaskStatus;
  privacy_level: PrivacyLevel;
  queries_used: string[];
  urls_visited: string[];
}

/** Source レコード */
export interface SourceRecord {
  id: string;
  task_id: string;
  url: string;
  canonical_url: string | null;
  title: string;
  source_type: SourceType;
  trust_tier: TrustTier;
  retrieved_at: string;
  published_at: string | null;
  http_status: number | null;
  content_hash: string | null;
}

/** Audit レコード (Evidence Browser版) */
export interface EvidenceAuditRecord {
  id: string;
  task_id: string;
  answer: string;
  status: "pass" | "needs_revision" | "fail";
  unsupported_claims: string[];
  stale_claims: string[];
  citation_mismatch: string[];
  created_at: string;
}

// ── browser.research 入出力 ──

export interface ResearchInput {
  question: string;
  freshness?: Freshness;
  source_preference?: string[];
  max_sources?: number;
  privacy_level?: PrivacyLevel;
}

export interface ResearchOutput {
  task_id: string;
  answerability: Answerability;
  summary: string;
  top_evidence: EvidenceCard[];
  conflicts: string[];
  recommended_next_action: string;
}

// ── browser.open_evidence 入出力 ──

export interface OpenEvidenceInput {
  evidence_id: string;
  context_tokens?: number;
}

export interface OpenEvidenceOutput {
  evidence_id: string;
  quote: string;
  surrounding_context: string;
  url: string;
  title: string;
  published_at: string | null;
  source_type: SourceType;
  page_or_section: string | null;
}

// ── browser.audit_answer 入出力 ──

export interface AuditAnswerInput {
  answer: string;
  evidence_ids: string[];
  strictness?: "normal" | "strict";
}

export interface AuditAnswerOutput {
  status: "pass" | "needs_revision" | "fail";
  unsupported_claims: string[];
  stale_claims: string[];
  citation_mismatch: string[];
  suggested_fix: string;
}

// ── Context Budget ──

export interface ContextBudget {
  max_tool_response_tokens: number;
  max_evidence_cards: number;
}

