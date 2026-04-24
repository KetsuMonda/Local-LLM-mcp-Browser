// ============================================================
// 設定ロード
// ============================================================

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AppConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const DEFAULT_CONFIG: AppConfig = {
  search_backend: "searxng",
  searxng_url: "http://localhost:8080",
  cache_dir: join(PROJECT_ROOT, "data"),
  cache_ttl_hours: 24,
  max_concurrent_fetches: 3,
  fetch_timeout_ms: 10000,
  max_fetch_size_bytes: 5 * 1024 * 1024, // 5MB
  default_privacy_mode: "balanced",
  rate_limit: {
    requests_per_minute: 10,
    per_domain_rpm: 3,
  },
};

export function loadConfig(): AppConfig {
  const configPath = join(PROJECT_ROOT, "config.json");
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      console.error("[config] Failed to parse config.json, using defaults");
    }
  }
  return { ...DEFAULT_CONFIG };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** 起動時にdocker-managerが決定したバックエンドを反映 */
export function setRuntimeBackend(backend: string): void {
  const config = getConfig();
  config.search_backend = backend;
}
