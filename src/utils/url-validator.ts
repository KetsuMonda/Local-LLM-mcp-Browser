// ============================================================
// URL Validator — URL検証ユーティリティ
// ============================================================

/**
 * URLからドメインを抽出
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * ドメインがリストにマッチするかチェック
 */
export function domainMatches(domain: string, patterns: string[]): boolean {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  for (const pattern of patterns) {
    const p = pattern.toLowerCase().replace(/^www\./, "");
    if (normalized === p) return true;
    if (normalized.endsWith(`.${p}`)) return true;
  }
  return false;
}

/**
 * ドメイン制御を適用
 */
export function applyDomainControls(
  url: string,
  allowed: string[],
  blocked: string[],
): { allowed: boolean; reason?: string } {
  const domain = extractDomain(url);
  if (!domain) {
    return { allowed: false, reason: "invalid-url" };
  }

  // allowed_domains が指定されている場合、そのリストのみ許可
  if (allowed.length > 0 && !domainMatches(domain, allowed)) {
    return { allowed: false, reason: `domain-not-in-allowlist: ${domain}` };
  }

  // blocked_domains にマッチする場合は拒否
  if (blocked.length > 0 && domainMatches(domain, blocked)) {
    return { allowed: false, reason: `domain-blocked: ${domain}` };
  }

  return { allowed: true };
}

/**
 * URL正規化
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // フラグメントを除去
    parsed.hash = "";
    // 末尾スラッシュの統一
    if (parsed.pathname === "/") {
      parsed.pathname = "/";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
