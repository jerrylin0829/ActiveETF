# ActiveETF

追蹤台股全部主動式**股票型** ETF（代號結尾 `A`，約 27 檔）的每日持股異動 Dashboard：增減持/新進/出清事件、當前持股比例、績效與勝率指標。公開網站，營運成本 $0/月。

設計文件與實作計畫：[`docs/superpowers/`](docs/superpowers/)。任何實作決策與 spec 衝突時，以 spec 為準。

## 架構

```
GitHub Actions（每日 18:30 主場 + 21:30 補抓）
  → Python 爬蟲（scraper/，15 家投信 adapter）
  → Supabase Postgres（快照 + 事件 + 指標快取）
  → Next.js on Vercel（唯讀呈現，尚未開工）
```

## 開發

```bash
cd scraper
uv sync
cp .env.local.example .env.local   # 填入 SUPABASE_DB_URL、FINMIND_TOKEN
uv run pytest
```

需要 `SUPABASE_DB_URL` 的測試在沒有該環境變數時會自動 skip。

## 專案指引

給 AI 協作者（Claude Code / Codex）的完整指引見 [`CLAUDE.md`](CLAUDE.md)（`AGENTS.md` 為其 symlink）。
