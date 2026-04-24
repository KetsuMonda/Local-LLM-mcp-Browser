// ============================================================
// Rate Limiter — トークンバケットベースのレート制御
// ============================================================

/**
 * スライディングウィンドウ方式のレートリミッター
 * キーごとに独立したレート管理を行う
 */
export class RateLimiter {
  /** キー → リクエストタイムスタンプ配列 */
  private windows = new Map<string, number[]>();
  /** ウィンドウサイズ（ミリ秒） */
  private windowMs: number;
  /** ウィンドウ内の最大リクエスト数 */
  private maxRequests: number;
  /** リクエスト間の最小間隔（ミリ秒） */
  private minIntervalMs: number;

  constructor(opts: {
    windowMs?: number;
    maxRequests?: number;
    minIntervalMs?: number;
  } = {}) {
    this.windowMs = opts.windowMs ?? 60_000;       // デフォルト: 1分
    this.maxRequests = opts.maxRequests ?? 10;      // デフォルト: 10回/分
    this.minIntervalMs = opts.minIntervalMs ?? 1000; // デフォルト: 最低1秒間隔
  }

  /**
   * リクエスト可能になるまで待機する
   * @param key レート制御のキー（"global", ドメイン名, etc.）
   */
  async acquire(key: string = "global"): Promise<void> {
    const now = Date.now();
    const timestamps = this.windows.get(key) ?? [];

    // 古いタイムスタンプを除去
    const validTimestamps = timestamps.filter(t => now - t < this.windowMs);

    // ウィンドウ内のリクエスト数チェック
    if (validTimestamps.length >= this.maxRequests) {
      const oldest = validTimestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 100;
      console.error(`[rate-limiter] ${key}: limit reached (${this.maxRequests}/${this.windowMs}ms), waiting ${waitMs}ms`);
      await sleep(waitMs);
      return this.acquire(key); // 再チェック
    }

    // 最小間隔チェック
    if (validTimestamps.length > 0) {
      const lastRequest = validTimestamps[validTimestamps.length - 1];
      const elapsed = now - lastRequest;
      if (elapsed < this.minIntervalMs) {
        const waitMs = this.minIntervalMs - elapsed;
        await sleep(waitMs);
      }
    }

    // タイムスタンプを記録
    validTimestamps.push(Date.now());
    this.windows.set(key, validTimestamps);
  }

  /**
   * 現在のレート状況を取得（デバッグ用）
   */
  getStatus(key: string = "global"): { remaining: number; resetInMs: number } {
    const now = Date.now();
    const timestamps = (this.windows.get(key) ?? []).filter(t => now - t < this.windowMs);
    const remaining = Math.max(0, this.maxRequests - timestamps.length);
    const resetInMs = timestamps.length > 0 ? this.windowMs - (now - timestamps[0]) : 0;
    return { remaining, resetInMs };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// グローバルレートリミッターインスタンス
// ============================================================

/** 検索バックエンド用（全体レート） */
export const searchRateLimiter = new RateLimiter({
  windowMs: 60_000,
  maxRequests: 6,       // 1分間に6回まで（マルチクエリで3回×2検索）
  minIntervalMs: 5000,  // 検索は最低5秒間隔
});

/** ページフェッチ用（ドメイン別レート） */
export const fetchRateLimiter = new RateLimiter({
  windowMs: 60_000,
  maxRequests: 5,       // 同一ドメインへのfetchは5回/分
  minIntervalMs: 1000,
});
