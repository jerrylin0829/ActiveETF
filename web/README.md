# ActiveETF Web

Next.js App Router 前端，部署根目錄為 `web/`。前端只透過 Supabase anon key + RLS 讀取衍生表，不做指標計算。

## 本機開發

```bash
npm install
npm run dev
```

必備環境變數見 `.env.local.example`：

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## 驗證

```bash
npm run test
npm run lint
npm run build
```

## Vercel

- Project Root Directory：`web`
- Framework Preset：Next.js
- Build Command：`npm run build`
- Environment Variables：設定 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`
