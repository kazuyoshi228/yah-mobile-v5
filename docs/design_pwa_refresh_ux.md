# 実装設計書：① Refreshボタンの体感改善 ＋ ② PWA自動更新

対象ブランチ: `dev` ／ 作成: 2026-07-06 ／ ステータス: **提案（要承認）**
契機: 2026-07インシデントの後日談。データ残量が「変わらない」体験の主因が **(a) 古いキャッシュ版を掴んでRefreshがサーバーに届かない** ＋ **(b) Refreshボタンが“同期依頼”で完了扱いになる** と判明。関連: [plan_v0.51.md](./plan_v0.51.md)（S4 PWAキャッシュ）

> フロントのみ。`functions`/`rules` 変更なし。反映は hosting（dev channel → 本番は別途指示）。

---

## 背景（確定した事実）
- eSIM/Bappy/データは正常（サーバー側同期で 731.8MB→587.1MB と実減少を確認）。
- 問題は2つ：
  1. **`registerType: "autoUpdate"` だが更新検知フックが無い**（`vite.config.ts` の `pwaPlugin`、`virtual:pwa-register` 未使用）→ **開いたままのページは新SWが有効化されても再読込されず、旧JSのまま**。旧 `handleSync` は書き込みがルールに弾かれ、**Refreshが発火しない＝値が凍結**。
  2. **Refreshボタンの "Syncing…" が“書き込みの0.2秒”しか続かない**（`OrderDetailPage.tsx:69` `handleSync`）。実データ更新はバックグラウンドのトリガー完了（数秒後・`onSnapshot`）なので、**押しても変わったように見えない**。

---

## ① Refreshボタンの体感改善（`client/src/pages/OrderDetailPage.tsx`）

**方針**：「同期依頼が書けた」ではなく「**実データが更新された**」までを "Syncing…" にする。

- `handleSync` 実行時に **直前の `esimLink.updatedAt` を記録**（`pendingSinceRef`）。
- 書き込み後も `isSyncing` を維持し、**`esimLink.updatedAt` が記録値より進む（＝`onSnapshot`で新データ到着）まで待つ**。進んだら `isSyncing=false`＋「Updated · just now」表示。
- **タイムアウト（例 15秒）**でフォールバック：`isSyncing=false`＋「反映に少し時間がかかっています。数分後に再度お試しください」。
- **書き込み失敗（`permission-denied` 等）を明示ハンドリング**：「アプリを最新に更新してください」導線（②実装後は基本発生しないが防御）。
- **「最終更新 HH:MM」表示**を DataUsageBar 付近に追加（いつのデータか可視化）。
- 対象ボタンは2箇所（`:209` と `:300`）とも `handleSync` 共有なので同時に改善。

**実装メモ**：`esimLink.updatedAt` は `onSnapshot` で更新される既存購読を利用。`useEffect([esimLink?.updatedAt])` で「待機中かつ updatedAt が進んだら解除」。`syncResult`（既存）を `{ state: "idle"|"syncing"|"updated"|"timeout"|"error" }` に拡張。

---

## ② PWA自動更新（`vite.config.ts` ＋ クライアント登録）

**目的**：デプロイ後、**ユーザーが手動キャッシュ削除しなくても最新版に更新**される。

**採用方針（推奨）：更新検知＋非侵襲バナー**
- `vite.config.ts`：`registerType` を **`"prompt"`** に変更（autoUpdateだと更新プロンプトが出ず、開いたままのページが取り残される）。
- クライアント（`client/src/main.tsx` 等エントリ）で **`virtual:pwa-register` の `registerSW`** を使用：
  ```ts
  import { registerSW } from "virtual:pwa-register";
  const updateSW = registerSW({
    onNeedRefresh() { /* 「新しいバージョンがあります [更新]」バナー表示 → タップで updateSW(true) */ },
    onOfflineReady() {},
  });
  // 定期チェック：フォーカス復帰時＋一定間隔で registration.update()
  ```
- **更新バナー**（小さなUI）：タップで `updateSW(true)`（skipWaiting→reload）。購入フロー中の突然リロードを避けられる。
- **定期更新チェック**：`visibilitychange`（タブ復帰）と `setInterval`（例 30〜60分）で `registration.update()` を呼び、新SWを早期検知。
- 型：`tsconfig` の `types` に `"vite-plugin-pwa/client"` を追加。

**代替（自動リロード）**：`autoUpdate` を維持しつつ `controllerchange` で1回だけ `location.reload()`（多重リロードガード）。全自動だが**操作中に強制リロードの恐れ**があるため、**購入・決済フロー中は抑止**する条件が必要。→ **バナー方式を推奨**（安全）。

**注意**
- iOS の**インストール済みPWA**は更新が特に鈍い。定期 `update()`＋バナーで確実に気づかせる。
- `manifest: false`（静的 `manifest.json`）は現状維持。

---

## 影響範囲・リスク
- フロントのみ（`OrderDetailPage.tsx` / `vite.config.ts` / エントリ / 小さな UpdateBanner コンポーネント / `tsconfig` types）。
- `functions`/`rules`/Storage 変更なし。
- リスク：更新バナーの多重表示・リロードループ → `updateSW` は1度だけ、ガードを入れる。決済フロー中のリロード抑止。

## 検証計画
1. `npx tsc --noEmit` ／ `npx vitest run --config vitest.client.config.ts`。
2. `npm run build` → **dev channel へデプロイ** → 実機で：
   - **①**：Refresh押下→"Syncing…"が**数値が変わるまで継続**→更新表示。データ使用後に押すと残量が減って止まる。タイムアウト時のフォールバック文言。
   - **②**：dev channel を再デプロイ→**バナーが出る**→タップで最新化（手動キャッシュ削除不要）。フォーカス復帰で更新チェックが走る。
3. `dev` コミット（本番hostingは別途指示）。

## plan_v0.51 との関係
- **② は S4（PWAキャッシュ）を実装で解消**。GA前の「静かに古いまま」を防ぐ。
- **① は運用時のサポート問い合わせ（「反映されない」）を減らす**＝solo運用の負荷軽減。
