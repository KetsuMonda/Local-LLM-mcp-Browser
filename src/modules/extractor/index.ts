// ============================================================
// Extractor — HTML / テキスト抽出
// ============================================================

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ExtractionResult {
  title: string;
  text: string;
  sectionTitles: string[];
  published_at: string | null;
  /** Schema.org構造化データから抽出 */
  author: string | null;
  content_type: string | null;
  language: string | null;
}

/**
 * HTMLからReadabilityで本文を抽出
 */
export function extractHtml(html: string, url: string): ExtractionResult {
  try {
    // Tracker / analytics scriptを事前除去
    const cleanedHtml = removeTrackingScripts(html);

    const dom = new JSDOM(cleanedHtml, { url });
    const doc = dom.window.document;

    // Schema.org JSON-LD 抽出
    const schemaData = extractSchemaOrg(doc);

    // 日付の取得を試みる
    const publishedAt = schemaData.datePublished || extractPublishDate(doc);

    // セクションタイトルを抽出
    const sectionTitles = extractSectionTitles(doc);

    // 言語検出
    const language = doc.documentElement?.getAttribute("lang") || schemaData.language || null;

    // Readability で本文抽出
    const reader = new Readability(doc);
    const article = reader.parse();

    if (article && article.textContent) {
      return {
        title: schemaData.headline || article.title || "",
        text: cleanText(article.textContent),
        sectionTitles,
        published_at: publishedAt,
        author: schemaData.author,
        content_type: schemaData.type,
        language,
      };
    }

    // Readability が失敗した場合、フォールバック
    return fallbackExtract(doc, sectionTitles, publishedAt, schemaData, language);
  } catch (error) {
    console.error(`[extractor] HTML extraction failed:`, error);
    return {
      title: "",
      text: "",
      sectionTitles: [],
      published_at: null,
      author: null,
      content_type: null,
      language: null,
    };
  }
}

/**
 * プレーンテキストの処理
 */
export function extractPlaintext(text: string): ExtractionResult {
  return {
    title: "",
    text: cleanText(text),
    sectionTitles: [],
    published_at: null,
    author: null,
    content_type: null,
    language: null,
  };
}

// ============================================================
// Schema.org JSON-LD 抽出
// ============================================================

interface SchemaData {
  headline: string | null;
  author: string | null;
  datePublished: string | null;
  type: string | null;
  language: string | null;
}

/**
 * ページ内のJSON-LDスクリプトからSchema.orgメタデータを抽出
 */
function extractSchemaOrg(doc: Document): SchemaData {
  const result: SchemaData = {
    headline: null,
    author: null,
    datePublished: null,
    type: null,
    language: null,
  };

  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // @type
        if (item["@type"] && !result.type) {
          const t = Array.isArray(item["@type"]) ? item["@type"][0] : item["@type"];
          result.type = String(t);
        }

        // headline
        if (item.headline && !result.headline) {
          result.headline = String(item.headline);
        }
        if (item.name && !result.headline) {
          result.headline = String(item.name);
        }

        // author
        if (item.author && !result.author) {
          if (typeof item.author === "string") {
            result.author = item.author;
          } else if (item.author.name) {
            result.author = String(item.author.name);
          } else if (Array.isArray(item.author) && item.author[0]?.name) {
            result.author = String(item.author[0].name);
          }
        }

        // datePublished
        if (item.datePublished && !result.datePublished) {
          try {
            const d = new Date(item.datePublished);
            if (!isNaN(d.getTime())) {
              result.datePublished = d.toISOString();
            }
          } catch { /* ignore */ }
        }

        // inLanguage
        if (item.inLanguage && !result.language) {
          result.language = String(item.inLanguage);
        }
      }
    } catch {
      // JSONパース失敗は無視
    }
  }

  return result;
}

/**
 * トラッキングスクリプトを除去
 */
function removeTrackingScripts(html: string): string {
  // script タグの除去
  let cleaned = html.replace(
    /<script\b[^>]*(?:google-analytics|googletagmanager|facebook|analytics|tracking|beacon|pixel|hotjar|mixpanel|segment|amplitude|newrelic|sentry|clarity)[^>]*>[\s\S]*?<\/script>/gi,
    ""
  );

  // noscript 内のトラッキングピクセル除去
  cleaned = cleaned.replace(
    /<noscript\b[^>]*>[\s\S]*?<img[^>]*(?:facebook|analytics|tracking|pixel|beacon)[^>]*>[\s\S]*?<\/noscript>/gi,
    ""
  );

  // iframe トラッカー除去
  cleaned = cleaned.replace(
    /<iframe\b[^>]*(?:facebook|analytics|tracking|doubleclick|google-analytics)[^>]*>[\s\S]*?<\/iframe>/gi,
    ""
  );

  return cleaned;
}

/**
 * 発行日を抽出
 */
function extractPublishDate(doc: Document): string | null {
  // meta タグから探す
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish_date"]',
    'meta[name="DC.date"]',
    'meta[property="og:published_time"]',
    'meta[name="article:published_time"]',
  ];

  for (const selector of metaSelectors) {
    const meta = doc.querySelector(selector);
    if (meta) {
      const content = meta.getAttribute("content");
      if (content) {
        try {
          const date = new Date(content);
          if (!isNaN(date.getTime())) {
            return date.toISOString();
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // time タグから探す
  const timeEl = doc.querySelector("time[datetime]");
  if (timeEl) {
    const dt = timeEl.getAttribute("datetime");
    if (dt) {
      try {
        const date = new Date(dt);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

/**
 * セクションタイトル(h1-h3)を抽出
 */
function extractSectionTitles(doc: Document): string[] {
  const titles: string[] = [];
  const headings = doc.querySelectorAll("h1, h2, h3");
  headings.forEach((h) => {
    const text = h.textContent?.trim();
    if (text && text.length > 0 && text.length < 200) {
      titles.push(text);
    }
  });
  return titles.slice(0, 20); // 最大20セクション
}

/**
 * フォールバック抽出（Readability失敗時）
 */
function fallbackExtract(
  doc: Document,
  sectionTitles: string[],
  publishedAt: string | null,
  schemaData?: SchemaData,
  language?: string | null,
): ExtractionResult {
  const body = doc.body;
  if (!body) {
    return {
      title: "", text: "", sectionTitles, published_at: publishedAt,
      author: schemaData?.author || null,
      content_type: schemaData?.type || null,
      language: language || null,
    };
  }

  const removeTags = ["nav", "footer", "header", "aside", "script", "style", "noscript"];
  for (const tag of removeTags) {
    body.querySelectorAll(tag).forEach((el) => el.remove());
  }

  const title = schemaData?.headline || doc.title || "";
  const text = cleanText(body.textContent || "");

  return {
    title, text, sectionTitles, published_at: publishedAt,
    author: schemaData?.author || null,
    content_type: schemaData?.type || null,
    language: language || null,
  };
}

/**
 * テキストのクリーンアップ
 */
function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
