// ============================================================
// Fetch Policy Engine — フェッチ判定 + プライバシーフィルタ
// ============================================================

import { validateUrlSsrf } from "../../utils/ssrf-guard.js";
import { applyDomainControls, extractDomain } from "../../utils/url-validator.js";
import type { PrivacyMode } from "../../types.js";
import { getConfig } from "../../config.js";
import { fetchRateLimiter } from "../../utils/rate-limiter.js";

/** 既知のトラッカードメイン */
const TRACKER_DOMAINS = new Set([
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com/tr",
  "analytics.google.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.com",
  "amplitude.com",
  "newrelic.com",
  "sentry.io",
  "cloudflareinsights.com",
  "clarity.ms",
  "plausible.io",
  "matomo.org",
]);

export interface FetchDecision {
  allowed: boolean;
  reason?: string;
  headers: Record<string, string>;
}

/**
 * URLに対するフェッチ判定を行う
 */
export async function evaluateFetchPolicy(
  url: string,
  privacyMode: PrivacyMode,
  allowedDomains: string[] = [],
  blockedDomains: string[] = [],
): Promise<FetchDecision> {
  // 1. SSRF チェック
  const ssrfResult = await validateUrlSsrf(url);
  if (!ssrfResult.allowed) {
    return { allowed: false, reason: `ssrf: ${ssrfResult.reason}`, headers: {} };
  }

  // 2. ドメイン制御チェック
  const domainResult = applyDomainControls(url, allowedDomains, blockedDomains);
  if (!domainResult.allowed) {
    return { allowed: false, reason: domainResult.reason, headers: {} };
  }

  // 3. プロトコルチェック (HTTPSを優先)
  const parsed = new URL(url);
  if (parsed.protocol === "http:" && privacyMode === "privacy_strict") {
    return {
      allowed: false,
      reason: "http-not-allowed-in-strict-mode",
      headers: {},
    };
  }

  // 4. ヘッダー構成
  const headers = buildFetchHeaders(privacyMode);

  return { allowed: true, headers };
}

/**
 * プライバシーモードに応じたHTTPヘッダーを構築
 */
function buildFetchHeaders(privacyMode: PrivacyMode): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,text/plain",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    "Cache-Control": "no-cache",
    Connection: "close",
    // DNT (Do Not Track)
    DNT: "1",
    // GPC (Global Privacy Control)
    "Sec-GPC": "1",
  };

  switch (privacyMode) {
    case "privacy_strict":
      base["User-Agent"] = "Mozilla/5.0 (compatible; ResearchBot/1.0)";
      // Referer なし
      base["Referer"] = "";
      break;
    case "balanced":
      base["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      // 最小限のReferer
      base["Referer"] = "";
      break;
    case "max_recall":
      base["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      break;
  }

  return base;
}

/**
 * 安全なフェッチを実行
 * - リダイレクト先のURL再検証
 * - タイムアウト制御
 * - Cookie非永続
 */
export async function safeFetch(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; text: string; finalUrl: string; contentType: string; error?: string }> {
  const config = getConfig();

  // レート制御: ドメイン別に待機
  const domain = extractDomain(url);
  if (domain) {
    await fetchRateLimiter.acquire(domain);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.fetch_timeout_ms
  );

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // リダイレクト後のURLを検証
    const finalUrl = response.url;
    if (finalUrl !== url) {
      const redirectCheck = await validateUrlSsrf(finalUrl);
      if (!redirectCheck.allowed) {
        return {
          ok: false,
          text: "",
          finalUrl,
          contentType: "",
          error: `redirect-to-blocked: ${redirectCheck.reason}`,
        };
      }
    }

    // サイズ制限チェック
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > config.max_fetch_size_bytes) {
      return {
        ok: false,
        text: "",
        finalUrl,
        contentType: "",
        error: `content-too-large: ${contentLength} bytes (limit: ${config.max_fetch_size_bytes})`,
      };
    }

    const contentType = response.headers.get("content-type") || "text/plain";
    const text = await response.text();

    // 実際のサイズチェック（Content-Lengthがない場合のフォールバック）
    if (Buffer.byteLength(text) > config.max_fetch_size_bytes) {
      return {
        ok: false,
        text: "",
        finalUrl,
        contentType,
        error: `content-too-large: ${Buffer.byteLength(text)} bytes (limit: ${config.max_fetch_size_bytes})`,
      };
    }

    return {
      ok: response.ok,
      text,
      finalUrl,
      contentType,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      text: "",
      finalUrl: url,
      contentType: "",
      error: error instanceof Error ? error.message : "unknown-fetch-error",
    };
  }
}

/**
 * Content-TypeからHTMLかどうかを判定
 */
export function isHtmlContent(contentType: string): boolean {
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

/**
 * Content-Typeからプレーンテキストかどうかを判定
 */
export function isPlainTextContent(contentType: string): boolean {
  return (
    contentType.includes("text/plain") ||
    contentType.includes("text/markdown") ||
    contentType.includes("text/csv")
  );
}

/**
 * Content-TypeからPDFかどうかを判定
 */
export function isPdfContent(contentType: string): boolean {
  return contentType.includes("application/pdf");
}

/**
 * PDFなどバイナリコンテンツの安全なフェッチ
 */
export async function safeFetchBinary(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; buffer: Buffer; finalUrl: string; contentType: string; error?: string }> {
  const config = getConfig();

  const domain = extractDomain(url);
  if (domain) {
    await fetchRateLimiter.acquire(domain);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetch_timeout_ms);

  try {
    const response = await fetch(url, {
      headers: { ...headers, Accept: "application/pdf,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const finalUrl = response.url;
    if (finalUrl !== url) {
      const check = await validateUrlSsrf(finalUrl);
      if (!check.allowed) {
        return { ok: false, buffer: Buffer.alloc(0), finalUrl, contentType: "", error: `redirect-to-blocked: ${check.reason}` };
      }
    }

    // サイズ制限チェック
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > config.max_fetch_size_bytes) {
      return {
        ok: false, buffer: Buffer.alloc(0), finalUrl, contentType: "",
        error: `content-too-large: ${contentLength} bytes (limit: ${config.max_fetch_size_bytes})`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // 実際のサイズチェック
    if (buffer.length > config.max_fetch_size_bytes) {
      return {
        ok: false, buffer: Buffer.alloc(0), finalUrl, contentType,
        error: `content-too-large: ${buffer.length} bytes (limit: ${config.max_fetch_size_bytes})`,
      };
    }

    return { ok: response.ok, buffer, finalUrl, contentType };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false, buffer: Buffer.alloc(0), finalUrl: url, contentType: "",
      error: error instanceof Error ? error.message : "unknown-fetch-error",
    };
  }
}
