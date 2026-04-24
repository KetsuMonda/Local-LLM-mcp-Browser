// ============================================================
// Tool: browser.open_evidence — 証拠詳細表示
// ============================================================

import type { OpenEvidenceInput, OpenEvidenceOutput } from "../types.js";
import { estimateTokens } from "../utils/token-estimator.js";
import type { EvidenceLedger } from "../modules/evidence-ledger/index.js";

export function executeOpenEvidence(
  input: OpenEvidenceInput,
  ledger: EvidenceLedger,
): Record<string, unknown> | { error: string } {
  const evidence = ledger.getEvidenceById(input.evidence_id);
  if (!evidence) {
    return { error: `Evidence not found: ${input.evidence_id}` };
  }

  const maxTokens = input.context_tokens || 400;

  // 周辺文脈をトークン制限内にトリム
  let context = evidence.context || "";
  while (estimateTokens(context) > maxTokens && context.length > 100) {
    const lastBreak = context.lastIndexOf("\n\n");
    if (lastBreak > 100) {
      context = context.substring(0, lastBreak);
    } else {
      context = context.substring(0, Math.floor(context.length * 0.75));
    }
  }

  const result: Record<string, unknown> = {
    id: evidence.evidence_id,
    quote: evidence.quote,
    context,
    url: evidence.url,
    title: evidence.title,
    type: evidence.source_type,
  };
  if (evidence.published_at) result.pub = evidence.published_at;
  if (evidence.section_title) result.section = evidence.section_title;

  return result;
}
