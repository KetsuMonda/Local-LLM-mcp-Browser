// ============================================================
// PDF Extractor — PDFファイルからテキスト抽出
// ============================================================

import type { ExtractionResult } from "./index.js";

/**
 * PDFバイナリからテキストを抽出する
 */
export async function extractPdf(buffer: Buffer, url: string): Promise<ExtractionResult> {
  try {
    // pdf-parse は CJS モジュールなので動的importで読み込む
    const pdfParse = (await import("pdf-parse")).default;

    const data = await pdfParse(buffer);

    const title = data.info?.Title || "";
    const text = cleanPdfText(data.text || "");

    // PDFのメタデータから日付を取得
    let publishedAt: string | null = null;
    if (data.info?.CreationDate) {
      publishedAt = parsePdfDate(data.info.CreationDate);
    }

    // セクションタイトルの推定（大文字行やナンバリング行）
    const sectionTitles = extractPdfSections(text);

    return {
      title,
      text,
      sectionTitles,
      published_at: publishedAt,
      author: data.info?.Author || null,
      content_type: "PDF",
      language: null,
    };
  } catch (error) {
    console.error(`[extractor-pdf] PDF extraction failed for ${url}:`, error);
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
 * PDFテキストのクリーンアップ
 */
function cleanPdfText(text: string): string {
  return text
    // ハイフネーション結合（行末ハイフン + 改行）
    .replace(/-\n(\S)/g, "$1")
    // 過剰な改行を整理
    .replace(/\n{3,}/g, "\n\n")
    // ヘッダー/フッターっぽい繰り返しパターンを除去
    .replace(/^Page \d+ of \d+$/gm, "")
    .replace(/^\d+\s*$/gm, "") // ページ番号のみの行
    // 先頭/末尾の空白
    .trim();
}

/**
 * PDFの日付文字列をISO形式に変換
 * PDF日付形式: D:20231215120000+09'00'
 */
function parsePdfDate(dateStr: string): string | null {
  try {
    const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      const iso = `${y}-${m}-${d}T${h || "00"}:${min || "00"}:${s || "00"}Z`;
      const date = new Date(iso);
      if (!isNaN(date.getTime())) return date.toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * PDFテキストからセクションタイトルを推定
 */
function extractPdfSections(text: string): string[] {
  const titles: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 150) continue;

    // 数字で始まるセクション見出し (1. Introduction, 2.1 Methods)
    if (/^\d+(\.\d+)?\s+[A-Z]/.test(trimmed) && trimmed.length < 80) {
      titles.push(trimmed);
    }
    // 全角数字 + セクション (１．はじめに)
    else if (/^[１-９]/.test(trimmed) && trimmed.length < 80) {
      titles.push(trimmed);
    }
    // 全大文字の短い行 (INTRODUCTION, METHODS)
    else if (/^[A-Z\s]{5,60}$/.test(trimmed) && !/^\d+$/.test(trimmed)) {
      titles.push(trimmed);
    }
  }

  return titles.slice(0, 20);
}
