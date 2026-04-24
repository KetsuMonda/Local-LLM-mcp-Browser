// ============================================================
// PII Redactor — 個人情報の検出・墨消し
// ============================================================

export interface RedactionResult {
  text: string;
  redactions: string[];
}

/** PII検出パターン — 順序重要: IPアドレスをphone_internationalの前に配置 */
const PII_PATTERNS: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]",
  },
  {
    name: "credit_card",
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: "[CC_REDACTED]",
  },
  {
    name: "ssn_us",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  {
    name: "my_number_jp",
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    replacement: "[MYNUMBER_REDACTED]",
  },
  {
    name: "ip_address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[IP_REDACTED]",
  },
  {
    name: "phone_jp",
    pattern: /0\d{1,4}-\d{1,4}-\d{3,4}/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    name: "phone_international",
    pattern: /\+\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    replacement: "[PHONE_REDACTED]",
  },
];

/**
 * テキスト中のPIIを検出し墨消しする
 */
export function redactPii(text: string, strict: boolean = false): RedactionResult {
  const redactions: string[] = [];
  let result = text;

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    // strict モードでは全パターン適用
    // balanced モードではemail, CC, SSN, マイナンバーのみ
    if (!strict && !["email", "credit_card", "ssn_us", "my_number_jp"].includes(name)) {
      continue;
    }

    // パターンをリセット（グローバルフラグ対策）
    const re = new RegExp(pattern.source, pattern.flags);
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      redactions.push(`${name}: ${matches.length} occurrence(s)`);
      result = result.replace(re, replacement);
    }
  }

  return { text: result, redactions };
}

/**
 * クエリ送信前のPII検出（墨消しではなく検出のみ）
 */
export function detectPiiInQuery(query: string): string[] {
  const detected: string[] = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(query)) {
      detected.push(name);
    }
  }
  return detected;
}
