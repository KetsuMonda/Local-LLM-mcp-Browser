// ============================================================
// Tool: browser.audit_answer — 回答vs証拠の監査
// ============================================================

import type { AuditAnswerInput, AuditAnswerOutput } from "../types.js";
import type { EvidenceLedger } from "../modules/evidence-ledger/index.js";

/** 文を分割 */
function splitClaims(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/** 2つのテキスト間の単語重複度 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length > 1));
  const wordsB = new Set(b.toLowerCase().split(/[\s\p{P}]+/u).filter((w) => w.length > 1));
  if (wordsA.size === 0) return 0;
  let hits = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) hits++;
  }
  return hits / wordsA.size;
}

/** 推測表現パターン */
const SPECULATION_PATTERNS = [
  /(?:probably|likely|might|perhaps|maybe|possibly|I think|I believe)/i,
  /(?:おそらく|かもしれ|思われ|と考えられ|可能性が|推測|予想)/,
];

/** 古い情報パターン */
const STALE_PATTERNS = [
  /\b(2019|2020|2021|2022|2023)\b/,
  /(?:以前は|旧バージョン|deprecated|legacy|old)/i,
];

export function executeAuditAnswer(
  input: AuditAnswerInput,
  ledger: EvidenceLedger,
): AuditAnswerOutput {
  const strictness = input.strictness || "normal";
  const overlapThreshold = strictness === "strict" ? 0.25 : 0.15;

  // 指定された証拠を取得
  const evidenceTexts: string[] = [];
  for (const evId of input.evidence_ids) {
    const ev = ledger.getEvidenceById(evId);
    if (ev) {
      evidenceTexts.push(ev.claim);
      evidenceTexts.push(ev.quote);
      if (ev.context) evidenceTexts.push(ev.context);
    }
  }

  const allEvidenceText = evidenceTexts.join(" ");

  // 回答を主張単位に分割
  const answerClaims = splitClaims(input.answer);
  const unsupportedClaims: string[] = [];
  const staleClaims: string[] = [];
  const citationMismatch: string[] = [];

  for (const claim of answerClaims) {
    // 証拠との重複度チェック
    const overlap = wordOverlap(claim, allEvidenceText);

    if (overlap < overlapThreshold) {
      unsupportedClaims.push(claim);
    }

    // 古い情報の検出
    for (const pattern of STALE_PATTERNS) {
      if (pattern.test(claim)) {
        staleClaims.push(claim);
        break;
      }
    }

    // strictモードでは推測表現を警告
    if (strictness === "strict") {
      for (const pattern of SPECULATION_PATTERNS) {
        if (pattern.test(claim)) {
          citationMismatch.push(`推測表現: ${claim.substring(0, 80)}…`);
          break;
        }
      }
    }
  }

  // 総合判定
  let status: "pass" | "needs_revision" | "fail";
  const unsupportedRatio = answerClaims.length > 0
    ? unsupportedClaims.length / answerClaims.length
    : 0;

  if (unsupportedRatio === 0 && staleClaims.length === 0) {
    status = "pass";
  } else if (unsupportedRatio > 0.5 || (strictness === "strict" && unsupportedClaims.length > 0)) {
    status = "fail";
  } else {
    status = "needs_revision";
  }

  // 修正提案
  let suggestedFix = "";
  if (unsupportedClaims.length > 0) {
    suggestedFix += `${unsupportedClaims.length}件の主張が証拠に裏付けられていません。証拠の範囲に基づいて表現を修正してください。`;
  }
  if (staleClaims.length > 0) {
    suggestedFix += `${staleClaims.length}件の主張が古い情報を含む可能性があります。最新の証拠を確認してください。`;
  }
  if (!suggestedFix) {
    suggestedFix = "すべての主張が証拠に裏付けられています。";
  }

  return {
    status,
    unsupported_claims: unsupportedClaims,
    stale_claims: staleClaims,
    citation_mismatch: citationMismatch,
    suggested_fix: suggestedFix,
  };
}
