// ============================================================
// SSRF Guard — プライベートネットワーク到達防止
// ============================================================

import { lookup } from "dns/promises";

/** SSRF拒否対象のCIDR / IP パターン */
const BLOCKED_PATTERNS = [
  // IPv4 private
  { prefix: "127.", desc: "loopback" },
  { prefix: "10.", desc: "private-class-a" },
  { prefix: "0.", desc: "current-network" },

  // IPv4 link-local
  { prefix: "169.254.", desc: "link-local" },

  // IPv6
  { prefix: "::1", desc: "ipv6-loopback" },
  { prefix: "fe80:", desc: "ipv6-link-local" },
  { prefix: "fc00:", desc: "ipv6-ula" },
  { prefix: "fd", desc: "ipv6-ula" },
];

/** 172.16.0.0/12 チェック */
function isPrivate172(ip: string): boolean {
  if (!ip.startsWith("172.")) return false;
  const second = parseInt(ip.split(".")[1], 10);
  return second >= 16 && second <= 31;
}

/** 192.168.0.0/16 チェック */
function isPrivate192(ip: string): boolean {
  return ip.startsWith("192.168.");
}

/** クラウドメタデータIP */
const METADATA_IPS = [
  "169.254.169.254", // AWS / GCP / Azure
  "100.100.100.200", // Alibaba Cloud
  "fd00:ec2::254",   // AWS IPv6
];

/** 拒否対象ドメインパターン */
const BLOCKED_DOMAINS = [
  ".local",
  ".internal",
  ".localhost",
  ".intranet",
  ".corp",
  ".home",
  ".lan",
];

export interface SsrfCheckResult {
  allowed: boolean;
  reason?: string;
  resolved_ip?: string;
}

/**
 * IPアドレスがプライベート/危険かチェック
 */
export function isBlockedIp(ip: string): { blocked: boolean; reason: string } {
  // メタデータIP
  if (METADATA_IPS.includes(ip)) {
    return { blocked: true, reason: `metadata-ip: ${ip}` };
  }

  // パターンマッチ
  for (const pat of BLOCKED_PATTERNS) {
    if (ip.startsWith(pat.prefix)) {
      return { blocked: true, reason: `${pat.desc}: ${ip}` };
    }
  }

  // 172.16-31.x.x
  if (isPrivate172(ip)) {
    return { blocked: true, reason: `private-class-b: ${ip}` };
  }

  // 192.168.x.x
  if (isPrivate192(ip)) {
    return { blocked: true, reason: `private-class-c: ${ip}` };
  }

  return { blocked: false, reason: "" };
}

/**
 * ドメイン名が拒否対象かチェック
 */
export function isBlockedDomain(hostname: string): { blocked: boolean; reason: string } {
  const lower = hostname.toLowerCase();

  if (lower === "localhost") {
    return { blocked: true, reason: "localhost" };
  }

  for (const suffix of BLOCKED_DOMAINS) {
    if (lower.endsWith(suffix)) {
      return { blocked: true, reason: `blocked-domain-suffix: ${suffix}` };
    }
  }

  // 純粋なIPアドレス形式
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    const ipCheck = isBlockedIp(lower);
    if (ipCheck.blocked) {
      return ipCheck;
    }
  }

  return { blocked: false, reason: "" };
}

/**
 * URLに対してSSRFチェックを実行
 * DNS解決後のIPも検証する（DNS rebinding対策）
 */
export async function validateUrlSsrf(urlStr: string): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { allowed: false, reason: `invalid-url: ${urlStr}` };
  }

  // プロトコルチェック
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: `blocked-protocol: ${parsed.protocol}` };
  }

  // ドメインチェック
  const domainCheck = isBlockedDomain(parsed.hostname);
  if (domainCheck.blocked) {
    return { allowed: false, reason: domainCheck.reason };
  }

  // DNS解決してIPも検証
  try {
    const result = await lookup(parsed.hostname);
    const ipCheck = isBlockedIp(result.address);
    if (ipCheck.blocked) {
      return {
        allowed: false,
        reason: `dns-resolved-to-blocked-ip: ${parsed.hostname} -> ${result.address} (${ipCheck.reason})`,
      };
    }
    return { allowed: true, resolved_ip: result.address };
  } catch {
    // DNS解決失敗 — ドメインが存在しない可能性
    // ただしネットワーク未接続の可能性もあるので、ドメインチェックが通っていればallow
    return { allowed: true };
  }
}
