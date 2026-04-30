# shift-create-app

皆川病院１病棟のシフト自動作成アプリ。

## 技術スタック

- Next.js (App Router) / TypeScript / Tailwind CSS
- Supabase（認証・DB）
- Vercel（デプロイ）

## ローカル起動

```bash
npm install
cp .env.example .env.local
# .env.local に実際の値を記入（下記「環境変数」参照）
npm run dev
```

## 環境変数

| 変数名 | 説明 | 取得先 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトのURL | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase匿名キー | Supabase → Project Settings → API |

## Vercelデプロイ手順

1. [Vercel ダッシュボード](https://vercel.com/) → プロジェクト選択
2. **Settings → Environment Variables** を開く
3. 上記2つのキーを **Production / Preview / Development** の全環境に追加
4. **Deployments** タブから最新コミットを **Redeploy**

または Vercel CLI で登録:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```
