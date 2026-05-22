# shift-create-app

## プロジェクト概要
皆川病院（妻の勤務先）１病棟のシフト作成アプリ
目的：スタッフのシフトを条件をもとに自動で作成するアプリ
ターゲット：看護師・師長（妻）

## 技術スタック
- フロントエンド: Next.js 14 (App Router), TypeScript, Tailwind CSS
- バックエンド: PostgreSQL
- デプロイ: Vercel 
- テスト: Vitest (ユニット), Playwright (E2E)

## 重要ドキュメント

| ファイル | 内容 |
|---------|------|
| `docs/CONSTRAINTS.md` | **制約定義書**（業務ルール・優先度・シフトパターン） |
| `docs/shift-rules.md` | アルゴリズム仕様書（実装詳細・既知バグ） |
| `docs/アルゴリズム仕様書.md` | アルゴリズム設計書 |
| `docs/要件定義書.md` | 要件定義 |

> コード修正時は必ず `docs/CONSTRAINTS.md` を参照し、制約を破らないこと。

##　作業ルール
- 