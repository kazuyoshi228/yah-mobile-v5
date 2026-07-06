# CLAUDE.md — yah.mobile 開発ガイド（AI/開発者向け）

yah.mobile（日本旅行者向け eSIM 販売サイト）。フロント React 19 + Vite 7、バックエンド Firebase（Cloud Functions v2 / Firestore / Auth / Storage / Hosting）。GitHub: `kazuyoshi228/yah-mobile-v5`。

---

## ブランチ運用（重要）

- **開発は `dev` ブランチにコミットする。** `main` へ直接コミットしない。
- **本番リリース時のみ** `dev` → `main` にマージする。

## デプロイ運用（重要 — 取り違え厳禁）

| 対象 | ブランチ | コマンド | 反映先URL |
|---|---|---|---|
| **確認用（dev）** | `dev` | `firebase hosting:channel:deploy dev --expires 30d` | https://yah-mobile-v1-3ed24--dev-tvnc2fob.web.app |
| **本番** | `main` | `firebase deploy --only hosting` | https://yah.mobi （= https://yah-mobile-v1-3ed24.web.app） |

- 🚨 **本番リリース（`firebase deploy --only hosting` / `main`）は、必ずユーザーの明示的な指示があるときのみ実行する。AI は自発的に本番へデプロイしてはならない。** 変更が完成しても、デプロイは提案にとどめ、ユーザーの「デプロイして」等の指示を待つ。
- **dev の内容は dev チャンネルURLにのみデプロイする。本番（`firebase deploy`）は `main` をリリースするときだけ。**
- dev チャンネルURLのハッシュ `tvnc2fob` はチャンネル固定（再デプロイしてもURLは不変）。プレビューチャンネルは失効するため `--expires 30d` を付け、必要に応じ再デプロイで延長。

### dev チャンネルの注意点
1. **バックエンドは本番と共有**：dev チャンネルも Firestore / Functions / Auth は本番プロジェクト（`yah-mobile-v1-3ed24`）の同一データを使う。dev での購入等は本番データに書き込まれる。
2. **App Check / reCAPTCHA のドメイン許可**：dev チャンネルURL（`...--dev-tvnc2fob.web.app`）を reCAPTCHA Enterprise の許可ドメインに入れないと、App Check がブロックされ購入・問い合わせが失敗する。

---

## 実装フロー（設計図の承認が必須）

🚨 **コード実装に入る前に、必ず「実装に向けた実施設計図（設計書）」を Markdown で作成し、ユーザーの承認を得てから実装に進む。承認前にコードは変更しない。**

1. **設計図を Markdown で作成する**（保存先：`docs/design_<トピック>.md`）。最低限、次を含める：
   - **背景・目的**（何を・なぜ）
   - **対象ファイルと変更方針**（実コードを確認したうえでの、実際のファイル／該当箇所）
   - **影響範囲・リスク・代替案**
   - **テスト／検証計画**（型チェック・テスト・プレビュー確認の内容）
   - 作業指示書がある場合は、**実コードとの差異**を明記する
2. **設計図を提示し、ユーザーの承認（「これで進めて」等の明示的な合意）を得る。** 承認を得るまでコードには着手しない。
3. 承認後に実装 → 検証（型チェック＋テスト＋プレビュー）→ `dev` にコミット、という順で進める。
4. 設計図の粒度は変更規模に比例させてよい（小さな修正は簡潔で可）。ただし **「作成 → 提示 → 承認」の手順は省略しない**。
5. 本番デプロイは、実装・検証・dev確認のあと、別途ユーザーの明示指示で行う（上記デプロイ運用参照）。

---

## ビルド / 環境

- **Node 22 必須**（Vitest 4 / Vite 7）。ローカルは `~/node22/bin` を PATH に追加済み（`~/.zshrc` に恒久化）。
- Firestore エミュレータ用に Java（`~/jdk21`）を使用。
- ビルド：`npm run build`（出力 `dist/public`）。Hosting の public は `dist/public`。
- 型チェック：`npx tsc --noEmit -p tsconfig.json`
- テスト：`npx vitest run --config vitest.client.config.ts`（クライアント）/ `vitest.rules.config.ts`（Rules）

## 運用ルール（AI が守ること）

1. **本番デプロイはユーザー指示が必須**（上記デプロイ節参照）。dev チャンネルへのデプロイも、明示指示または合意のうえで行う。
2. **本番データを変更する前に、必ず読み取り専用で現状を確認する。** 移行スクリプトは実行前にドライラン相当の確認をし、対象0件なら実行しない（例：`plans` の正規化は確認の結果すでに完了済みで不要だった）。
3. **作業指示書／仕様書は古いスナップショット前提のことがある。** パスやファイル構成（例：分割前の `PurchaseDrawer.tsx` を前提、`yah-mobile-v2` パス等）が実コードと異なる場合は、**実コードを確認してから**実装し、差異はユーザーに報告する。
4. **UI 変更はプレビュー（Node22 dev server / 右ビューア）で確認してからコミットする。**
5. **コミット前に型チェック＋関連テストを通す**（`tsc --noEmit`／vitest）。
6. firebase CLI の認証切れ（`invalid_rapt` / reauth 要求）は AI 側で解決できない。ユーザーに `firebase login --reauth` を依頼する。
7. **Storage への新規アセットは公開ACL（`allUsers:READER`）を付与**し、`Cache-Control` 1年で配信されるため差し替え時はキャッシュ汚染を避けて**新ファイル名**にする。
8. **シークレットは扱わない・貼らない・コミットしない**（reCAPTCHA シークレット鍵、GitHub PAT `ghp_...` 等）。reCAPTCHA サイトキーは公開値なので可。
9. コミットメッセージは日本語＋種別プレフィックス（`feat`/`fix`/`perf` 等）。末尾に `Co-Authored-By: Claude ...` を付与。

## 変更してはいけない / 前提

- 🚨 **セキュリティルール（`firestore.rules`）／ Cloud Functions（`functions/src/*`）／ Storage ルール（`storage.rules`）は、ユーザーの許可なく変更しない。** セキュリティ・課金・データ整合に直結するため、変更が必要な場合はまず内容を提案し、承認を得てから実施する（デプロイも同様にユーザー指示が必須）。
- **Bappy Webhook 認証は OMAX 側が担当**。こちらでは扱わない・変更しない。
- `plans` コレクションは `planType`（`"initial"` / `"topup"`）と boolean の `isActive` で正規化済み。初期購入UIのクエリは `where("isActive","==",true)` かつ `where("planType","==","initial")`。
- `.env`（`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` 等）は gitignore。reCAPTCHA サイトキーは公開値だが、**シークレットキーは扱わない**。

## リポジトリ構成メモ

- フロント：`client/src/`（pages / components / hooks / lib）。購入フローは `components/app/PurchaseDrawer.tsx` ＋ `purchase-drawer/steps/*`。
- バックエンド：`functions/src/`（callables / webhooks / rateLimit など）。
- 共有：`shared/`（types / schemas。Firebase Callable は undefined→null 変換のため任意項目は zod `.nullish()`）。
