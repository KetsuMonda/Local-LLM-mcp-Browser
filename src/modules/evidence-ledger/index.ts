// ============================================================
// Evidence Ledger — タスク・ソース・証拠・監査の永続化
// ============================================================

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import type {
  EvidenceCard, TaskRecord, SourceRecord, EvidenceAuditRecord,
  TaskStatus, PrivacyLevel, SourceType, TrustTier,
} from "../../types.js";

export class EvidenceLedger {
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
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        privacy_level TEXT NOT NULL DEFAULT 'normal',
        queries_used_json TEXT NOT NULL DEFAULT '[]',
        urls_visited_json TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        url TEXT NOT NULL,
        canonical_url TEXT,
        title TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'unknown',
        trust_tier TEXT NOT NULL DEFAULT 'unknown',
        retrieved_at TEXT NOT NULL,
        published_at TEXT,
        http_status INTEGER,
        content_hash TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        claim TEXT NOT NULL,
        quote TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        section_title TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (source_id) REFERENCES sources(id)
      );

      CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        answer TEXT NOT NULL,
        status TEXT NOT NULL,
        unsupported_claims_json TEXT NOT NULL DEFAULT '[]',
        stale_claims_json TEXT NOT NULL DEFAULT '[]',
        citation_mismatch_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sources_task ON sources(task_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_task ON evidence(task_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence(source_id);
      CREATE INDEX IF NOT EXISTS idx_audits_task ON audits(task_id);
    `);
  }

  // ── Task CRUD ──

  createTask(question: string, privacyLevel: PrivacyLevel = "normal"): string {
    const id = `task_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO tasks (id, question, created_at, updated_at, status, privacy_level)
       VALUES (?, ?, ?, ?, 'active', ?)`
    ).run(id, question, now, now, privacyLevel);
    return id;
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as any;
    if (!row) return null;
    return {
      id: row.id,
      question: row.question,
      created_at: row.created_at,
      updated_at: row.updated_at,
      status: row.status as TaskStatus,
      privacy_level: row.privacy_level as PrivacyLevel,
      queries_used: JSON.parse(row.queries_used_json),
      urls_visited: JSON.parse(row.urls_visited_json),
    };
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.db.prepare(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`
    ).run(status, new Date().toISOString(), taskId);
  }

  addQueryToTask(taskId: string, query: string): void {
    const task = this.getTask(taskId);
    if (!task) return;
    const queries = task.queries_used;
    if (!queries.includes(query)) {
      queries.push(query);
      this.db.prepare(
        `UPDATE tasks SET queries_used_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(queries), new Date().toISOString(), taskId);
    }
  }

  addUrlToTask(taskId: string, url: string): void {
    const task = this.getTask(taskId);
    if (!task) return;
    const urls = task.urls_visited;
    if (!urls.includes(url)) {
      urls.push(url);
      this.db.prepare(
        `UPDATE tasks SET urls_visited_json = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(urls), new Date().toISOString(), taskId);
    }
  }

  // ── Source CRUD ──

  addSource(
    taskId: string,
    url: string,
    title: string,
    sourceType: SourceType,
    trustTier: TrustTier,
    publishedAt: string | null = null,
  ): string {
    const id = `src_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO sources (id, task_id, url, title, source_type, trust_tier, retrieved_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, taskId, url, title, sourceType, trustTier, now, publishedAt);
    this.addUrlToTask(taskId, url);
    return id;
  }

  getSourcesByTask(taskId: string): SourceRecord[] {
    const rows = this.db.prepare(`SELECT * FROM sources WHERE task_id = ?`).all(taskId) as any[];
    return rows.map((r) => ({
      id: r.id,
      task_id: r.task_id,
      url: r.url,
      canonical_url: r.canonical_url,
      title: r.title,
      source_type: r.source_type as SourceType,
      trust_tier: r.trust_tier as TrustTier,
      retrieved_at: r.retrieved_at,
      published_at: r.published_at,
      http_status: r.http_status,
      content_hash: r.content_hash,
    }));
  }

  /** タスク内で既にこのURLが登録済みかチェック */
  hasUrl(taskId: string, url: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM sources WHERE task_id = ? AND url = ?`
    ).get(taskId, url);
    return !!row;
  }

  // ── Evidence CRUD ──

  addEvidence(
    taskId: string,
    sourceId: string,
    claim: string,
    quote: string,
    context: string = "",
    sectionTitle: string | null = null,
    confidence: number = 0,
    riskFlags: string[] = [],
  ): string {
    const id = `ev_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO evidence (id, task_id, source_id, claim, quote, context, section_title, confidence, risk_flags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, taskId, sourceId, claim, quote, context, sectionTitle, confidence, JSON.stringify(riskFlags), now);
    return id;
  }

  getEvidenceByTask(taskId: string): Array<EvidenceCard & { source_id: string; context: string; section_title: string | null }> {
    const rows = this.db.prepare(`
      SELECT e.*, s.url, s.title, s.source_type, s.trust_tier, s.published_at, s.domain
      FROM evidence e
      JOIN sources s ON e.source_id = s.id
      WHERE e.task_id = ?
      ORDER BY e.confidence DESC
    `).all(taskId) as any[];

    return rows.map((r) => ({
      evidence_id: r.id,
      source_id: r.source_id,
      source_type: r.source_type as SourceType,
      title: r.title,
      url: r.url,
      domain: r.domain || new URL(r.url).hostname,
      retrieved_at: r.created_at,
      published_at: r.published_at,
      claim: r.claim,
      quote: r.quote,
      context: r.context,
      section_title: r.section_title,
      confidence: r.confidence,
      risk_flags: JSON.parse(r.risk_flags_json),
    }));
  }

  getEvidenceById(evidenceId: string): (EvidenceCard & { source_id: string; context: string; section_title: string | null }) | null {
    const row = this.db.prepare(`
      SELECT e.*, s.url, s.title, s.source_type, s.trust_tier, s.published_at
      FROM evidence e
      JOIN sources s ON e.source_id = s.id
      WHERE e.id = ?
    `).get(evidenceId) as any;

    if (!row) return null;

    let domain: string;
    try { domain = new URL(row.url).hostname; } catch { domain = "unknown"; }

    return {
      evidence_id: row.id,
      source_id: row.source_id,
      source_type: row.source_type as SourceType,
      title: row.title,
      url: row.url,
      domain,
      retrieved_at: row.created_at,
      published_at: row.published_at,
      claim: row.claim,
      quote: row.quote,
      context: row.context,
      section_title: row.section_title,
      confidence: row.confidence,
      risk_flags: JSON.parse(row.risk_flags_json),
    };
  }

  // ── Audit CRUD ──

  addAudit(
    taskId: string,
    answer: string,
    status: "pass" | "needs_revision" | "fail",
    unsupportedClaims: string[] = [],
    staleClaims: string[] = [],
    citationMismatch: string[] = [],
  ): string {
    const id = `aud_${randomUUID().replace(/-/g, "").substring(0, 12)}`;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO audits (id, task_id, answer, status, unsupported_claims_json, stale_claims_json, citation_mismatch_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, taskId, answer, status, JSON.stringify(unsupportedClaims), JSON.stringify(staleClaims), JSON.stringify(citationMismatch), now);
    return id;
  }

  // ── Utilities ──

  close(): void {
    this.db.close();
  }
}
