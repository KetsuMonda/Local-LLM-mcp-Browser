// ============================================================
// Token Estimator — トークン数推定
// ============================================================

/**
 * テキストのトークン数を推定する
 * 正確にはトークナイザが必要だが、一般的な近似として：
 *   英語: ~4文字 = 1トークン
 *   日本語: ~1.5文字 = 1トークン（マルチバイト文字はトークンが多い）
 */
export function estimateTokens(text: string): number {
  let asciiChars = 0;
  let multibyteChars = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 127) {
      asciiChars++;
    } else {
      multibyteChars++;
    }
  }

  // 英語部分は4文字/トークン、マルチバイト部分は1.5文字/トークン
  const tokens = Math.ceil(asciiChars / 4) + Math.ceil(multibyteChars / 1.5);
  return Math.max(1, tokens);
}
