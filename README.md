# MCP AI Evidence Browser

> **⚠️ 本プロジェクトは個人実験用として公開しています。継続的なメンテナンスやサポートは予定していません。AS-ISでご利用ください。**

AIエージェントがWeb情報を検索・検証・引用するための **Evidence抽出ランタイム**。  
ローカルLLM（Qwen, Gemma等）向けに最適化された構造化出力を返します。

## 特徴

- 🔍 **1ツールで完結** — 質問 → 検索 → 取得 → Evidence Card化を一括実行
- 🛡️ **プライバシー重視** — SSRF防止、PII墨消し、トラッカー遮断
- 📊 **Evidence Card** — 主張 + 引用原文 + 信頼度で構造化
- ✅ **回答監査** — 回答を証拠と照合し未裏付け主張を検出
- 🐳 **Docker一体型** — `npm start` だけでSearXNGが自動起動

## 前提条件

- **Node.js** v20+
- **Docker Desktop** (必須) — SearXNG検索エンジンを自動起動します

## クイックスタート

```bash
# 1. クローン & インストール
git clone https://github.com/KetsuMonda/Local-LLM-mcp-Browser.git
cd Local-LLM-mcp-Browser
npm install

# 2. ビルド
npm run build

# 3. 完了！（Docker Desktopが起動していればSearXNGも自動起動）
```

## LM Studio で使う

`~/.lmstudio/mcp.json`:

```json
{
  "mcpServers": {
    "evidence-browser": {
      "command": "node",
      "args": ["/path/to/mcp-ai-evidence-browser/dist/index.js"]
    }
  }
}
```

## ツール一覧

### `browser.research`
質問からWeb検索→証拠抽出を一括実行。Evidence Card（主張+引用+信頼度）を返す。

```
入力: { question: "Node.js 22の新機能は?" }
出力: { sources: {...}, evidence: [{id, sid, claim, conf, ctx}], status: "answerable" }
```

### `browser.open_evidence`
Evidence IDの周辺文脈を取得。詳しく調べたい証拠がある場合に使用。

### `browser.audit_answer`
回答を証拠と照合し、未裏付け主張を検出。医療・法律など正確性が重要なテーマ向け。

## 検索バックエンド

起動時にDocker上のSearXNGを自動検出・起動します。

| ステップ | 動作 |
|---------|------|
| 1 | SearXNGが既に動作中か確認 |
| 2 | 停止中ならコンテナを自動起動 |
| 3 | 未インストールならdocker-composeで新規作成 |
| 4 | ヘルスチェック待機後、MCP Server起動 |

> Docker Desktopがインストールされていない場合はエラーメッセージで案内します。

## 設定（任意）

`config.json`:

```json
{
  "searxng_url": "http://localhost:8080",
  "fetch_timeout_ms": 10000,
  "max_concurrent_fetches": 3
}
```

> 設定ファイルがなくてもデフォルト値で動作します。

## アーキテクチャ

```
src/
├── index.ts                # エントリ (自動バックエンド検出)
├── server.ts               # MCP Server + ツール登録
├── config.ts               # 設定ロード
├── types.ts                # 型定義 (Evidence Card等)
├── tools/
│   ├── research.ts         # browser.research
│   ├── open-evidence.ts    # browser.open_evidence
│   └── audit-answer.ts     # browser.audit_answer
├── modules/
│   ├── evidence-ledger/    # SQLite永続化 (tasks/sources/evidence/audits)
│   ├── planner/            # クエリ展開 + 鮮度自動検出
│   ├── retrieval/          # SearXNG / DuckDuckGo / Brave
│   ├── fetch-policy/       # SSRF + プライバシー制御
│   ├── extractor/          # HTML / PDF 本文抽出
│   └── cache-store/        # 検索・ページキャッシュ
└── utils/
    ├── docker-manager.ts   # SearXNG 自動起動
    ├── ssrf-guard.ts       # SSRF防止
    ├── pii-redactor.ts     # PII墨消し
    └── trust-domains.ts    # ドメイン信頼度ティア
```

## テスト

```bash
npm test        # 全36テスト実行
npm run inspect # MCP Inspector でデバッグ
```

## ライセンス

MIT

---

*本プロジェクトは個人的な実験・学習目的で作成されました。IssueやPull Requestへの対応は保証しません。Forkして自由に改変してお使いください。*
