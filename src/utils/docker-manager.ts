// ============================================================
// Docker SearXNG Manager — 自動起動 / ヘルスチェック
// ============================================================
// Docker + SearXNG 必須。Docker未検出時はエラー終了。

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

/** Docker CLIが使えるか */
function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** SearXNGコンテナの状態を確認 */
function getContainerStatus(): { running: boolean; exists: boolean } {
  try {
    const output = execSync(
      'docker ps -a --filter "name=searxng" --format "{{.Status}}"',
      { stdio: "pipe", timeout: 5000 }
    ).toString().trim();

    if (!output) return { running: false, exists: false };
    return {
      running: output.toLowerCase().startsWith("up"),
      exists: true,
    };
  } catch {
    return { running: false, exists: false };
  }
}

/** SearXNGが応答するかチェック */
async function healthCheck(url: string, timeoutMs: number = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${url}/search?q=test&format=json`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

/** ヘルスチェックをリトライ付きで待機 */
async function waitForHealth(url: string, maxWaitMs: number = 20000): Promise<boolean> {
  const start = Date.now();
  const interval = 2000;

  while (Date.now() - start < maxWaitMs) {
    if (await healthCheck(url)) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/**
 * SearXNG の自動起動を確認。Docker必須。
 *
 * 1. SearXNGが既に動いている → OK
 * 2. Dockerがある → コンテナ起動
 * 3. Dockerがない → エラー終了
 */
export async function ensureSearchBackend(
  searxngUrl: string = "http://localhost:8080"
): Promise<void> {
  const log = (msg: string) => console.error(`[search-manager] ${msg}`);

  // 1. SearXNGが既に応答するか確認
  if (await healthCheck(searxngUrl)) {
    log("SearXNG is already running ✓");
    return;
  }

  // 2. Docker の確認
  if (!isDockerAvailable()) {
    log("ERROR: Docker is required but not found.");
    log("Please install Docker Desktop: https://www.docker.com/products/docker-desktop/");
    log("After installing, restart this server.");
    throw new Error(
      "Docker is required to run MCP AI Evidence Browser. " +
      "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    );
  }

  log("Docker available, checking SearXNG container...");

  const containerStatus = getContainerStatus();

  if (containerStatus.running) {
    // コンテナは動いているがヘルスチェック失敗 → もう少し待つ
    log("Container is running but not responding yet, waiting...");
    if (await waitForHealth(searxngUrl)) {
      log("SearXNG is now responding ✓");
      return;
    }
    throw new Error("SearXNG container is running but not responding. Check Docker logs: docker logs searxng");
  }

  // 3. コンテナ起動
  const composeFile = join(PROJECT_ROOT, "docker-compose.yml");

  if (containerStatus.exists) {
    log("Starting existing SearXNG container...");
    try {
      execSync("docker start searxng", { stdio: "pipe", timeout: 10000 });
    } catch (e) {
      throw new Error(`Failed to start SearXNG container: ${e}`);
    }
  } else if (existsSync(composeFile)) {
    log("Starting SearXNG via docker-compose...");
    try {
      execSync("docker compose up -d", {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
        timeout: 60000,
      });
    } catch {
      try {
        execSync("docker-compose up -d", {
          cwd: PROJECT_ROOT,
          stdio: "pipe",
          timeout: 60000,
        });
      } catch (e) {
        throw new Error(`Failed to start SearXNG via docker-compose: ${e}`);
      }
    }
  } else {
    log("No docker-compose.yml found, pulling SearXNG image...");
    try {
      execSync(
        'docker run -d --name searxng -p 127.0.0.1:8080:8080 -e SEARXNG_BASE_URL=http://localhost:8080/ --restart unless-stopped searxng/searxng:latest',
        { stdio: "pipe", timeout: 60000 }
      );
    } catch (e) {
      throw new Error(`Failed to start SearXNG container: ${e}`);
    }
  }

  // 4. ヘルスチェック待機
  log("Waiting for SearXNG to be ready...");
  if (await waitForHealth(searxngUrl)) {
    log("SearXNG started successfully ✓");
    return;
  }

  throw new Error("SearXNG failed to start in time. Check Docker logs: docker logs searxng");
}
