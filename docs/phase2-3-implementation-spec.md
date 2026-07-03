# Phase 2-3 実装仕様書（運用・インフラ堅牢化）

**対象:** yah.mobile v5 / Firebase (project: `yah-mobile-v1-3ed24`, region: `asia-northeast1`)
**前提技術:** Cloud Functions v2 (`firebase-functions/v2`)、`defineSecret`、既存の `notifyOwner`（Forge/Slack）と `createIncidentLog`、`functions/src/bappy/*` クライアント
**作成日:** 2026-07-03

本書は ROADMAP の Phase 2-3 のうち以下4項目を実装可能なレベルまで具体化する。

1. Firestore バックアップ（PITR + 日次エクスポート）
2. Firebase App Check
3. レート制限（課金系 callable / analytics HTTP）
4. Bappy 残高・在庫の監視アラート

各項目は独立して導入可能。推奨順は **1 → 2 → 3 → 4**（1と2はコンソール/CLI中心で低リスク・即効性が高い）。

---

## 1. Firestore バックアップ（PITR + 日次エクスポート）

### 目的
オペミス・バグによる全データ消失/上書きに備え、(a) 直近7日を「分」単位で復元できる PITR、(b) GCS への日次エクスポートで長期保管する。

### 1-A. PITR（Point-in-Time Recovery）— gcloud 一発
```bash
# 直近7日間、任意の時点へ復元可能にする（(default) データベース）
gcloud firestore databases update --database='(default)' --enable-pitr --project=yah-mobile-v1-3ed24

# 確認
gcloud firestore databases describe --database='(default)' --project=yah-mobile-v1-3ed24 \
  --format="value(pointInTimeRecoveryEnablement)"   # => POINT_IN_TIME_RECOVERY_ENABLED
```
> 復元は `gcloud firestore databases restore --source-database='(default)' --source-snapshot-time=<RFC3339> --destination-database=restored-db` で新DBに復元し、確認後に切替える運用。

### 1-B. マネージド・バックアップ・スケジュール（推奨・サーバーレス）
Firestore ネイティブのバックアップスケジュール（Functions 不要・課金安価）。
```bash
# 日次バックアップ・14日保持
gcloud firestore backups schedules create \
  --database='(default)' --project=yah-mobile-v1-3ed24 \
  --recurrence=daily --retention=14d

# 週次バックアップ・14週保持（任意で併用）
gcloud firestore backups schedules create \
  --database='(default)' --project=yah-mobile-v1-3ed24 \
  --recurrence=weekly --day-of-week=SUN --retention=14w

# 一覧・確認
gcloud firestore backups schedules list --database='(default)' --project=yah-mobile-v1-3ed24
```

### 1-C. GCS への日次エクスポート（別リージョン保管したい場合）
マネージドバックアップに加え、GCS へ論理エクスポートしたい場合は Scheduled Function を追加する。

**前提:** GCS バケット作成 + Functions のサービスアカウントに権限付与
```bash
gsutil mb -l asia-northeast1 -p yah-mobile-v1-3ed24 gs://yah-mobile-firestore-backups
# Functions 実行SA（<projectNumber>-compute@developer.gserviceaccount.com）に権限
SA=904818392772-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding yah-mobile-v1-3ed24 \
  --member="serviceAccount:$SA" --role="roles/datastore.importExportAdmin"
gsutil iam ch serviceAccount:$SA:roles/storage.admin gs://yah-mobile-firestore-backups
```

**`functions/src/scheduled.ts` に追記:**
```ts
import { FirestoreAdminClient } from "@google-cloud/firestore/build/src/v1";

const BACKUP_BUCKET = "gs://yah-mobile-firestore-backups";

export const firestoreDailyExport = onSchedule(
  { schedule: "every day 17:00", timeZone: "Asia/Tokyo", region: "asia-northeast1", timeoutSeconds: 540 },
  async () => {
    const client = new FirestoreAdminClient();
    const projectId = process.env.GCLOUD_PROJECT || "yah-mobile-v1-3ed24";
    const databaseName = client.databasePath(projectId, "(default)");
    const stamp = new Date().toISOString().slice(0, 10); // 例: 2026-07-03（Date は Functions 実行時に利用可）
    const [op] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix: `${BACKUP_BUCKET}/${stamp}`,
      collectionIds: [], // 空=全コレクション
    });
    logger.info(`[firestoreDailyExport] started: ${op.name}`);
  },
);
```
`functions/package.json` に `@google-cloud/firestore` を追加（`firebase-admin` が内部依存で持つが、明示的に v1 admin を使うため直接依存に入れる）。

**GCS ライフサイクル**（古いエクスポートの自動削除・30日）:
```bash
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > /tmp/lifecycle.json
gsutil lifecycle set /tmp/lifecycle.json gs://yah-mobile-firestore-backups
```

### 確認
- `gcloud firestore backups list --database='(default)'` にバックアップが増える
- `firestoreDailyExport` のログに `started` が出る／GCS に日付フォルダが生成される

---

## 2. Firebase App Check

### 目的
ターミナル/Postman 等からの Firestore・Functions・Storage への直接アクセスを、正規のフロントエンド由来トークンでない限り拒否する。

### 2-A. プロバイダ登録（コンソール）
1. Google Cloud Console で **reCAPTCHA Enterprise** を有効化し、Webサイト用キーを作成（`yah.mobi` / `*.web.app` を許可ドメインに）。
2. Firebase Console → **App Check** → Web アプリを登録 → プロバイダに **reCAPTCHA Enterprise**、上記サイトキーを設定。

### 2-B. クライアント初期化（`client/src/lib/firebase.ts`）
Firebase 初期化直後、`getAuth` などより前に:
```ts
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// 開発時のデバッグトークン（本番ビルドでは付けない）
if (import.meta.env.DEV) {
  // @ts-expect-error debug flag
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
```
`.env` に `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` を追加。**CSP** の `script-src`/`frame-src` に `https://www.google.com https://www.recaptcha.net https://www.gstatic.com` を許可（`firebase.json`）。

### 2-C. サーバー側の必須化
- **Callable（v2）**: クライアント専用の各 `onCall` に `enforceAppCheck: true` を付与。
  ```ts
  export const ordersInitCheckout = onCall(
    { region: REGION, enforceAppCheck: true, secrets: [...] },
    async (request) => { /* request.app が存在（検証済み） */ },
  );
  ```
  対象: `ordersInitCheckout` / `ordersInitTopupCheckout` / `orderRetryPayment` / `submitContactInquiry` / `analyticsGetAiInsights` / `incidentRunRetryNow`。
- **Firestore / Storage**: Console → App Check → 各サービスを「Enforced」に（まず数日「Monitor」で正規トラフィックが100%通ることを確認してから Enforce）。
- **除外（重要）**: `stripeWebhook` / `bappyWebhook` は**サーバー間通信なので App Check を付けない**（付けると正規の Stripe/Bappy が弾かれる）。これらは各自の署名/トークン検証で守る。`analyticsEvents`（HTTP）は App Check ヘッダ検証を任意で追加可（下記3と併用）。

### 確認
- Console の App Check メトリクスで「検証済み/未検証」比率を監視。Enforce 後、通常操作が成功し、`curl` 直叩きが `403 App Check` で失敗すること。

---

## 3. レート制限（課金系 callable / analytics HTTP）

### 目的
アカウント乗っ取り時のクラウド破産・クレカマスター・analytics スパムを、ユーザー/IP 単位の呼び出し回数で抑制する。App Check（項目2）と多層で機能する。

### 3-A. 共通ヘルパー `functions/src/rateLimit.ts`（新規）
Firestore の固定ウィンドウ・カウンタをトランザクションで更新する軽量実装。
```ts
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./db";

/**
 * key 単位で windowSec 内に max 回まで許可。超過で resource-exhausted を throw。
 * ドキュメント: rate_limits/{key} に { count, windowStart }。
 */
export async function enforceRateLimit(key: string, max: number, windowSec: number): Promise<void> {
  const ref = db.collection("rate_limits").doc(key);
  const now = Date.now();
  const windowMs = windowSec * 1000;
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const data = snap.data();
    if (!data || now - (data.windowStart ?? 0) >= windowMs) {
      t.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if ((data.count ?? 0) >= max) {
      throw new HttpsError("resource-exhausted", "rate-limited");
    }
    t.update(ref, { count: (data.count ?? 0) + 1 });
  });
}
```
**Firestore Rules** に追記（クライアントからは読み書き禁止・Functions専用）:
```
match /rate_limits/{key} { allow read, write: if false; }
```

### 3-B. 適用
```ts
// callables.ts（例: 課金入口）
const { uid } = await requireAuth(request);
await enforceRateLimit(`checkout:${uid}`, 10, 60 * 60);   // 1時間に10回まで
// analyticsGetAiInsights（LLM課金・管理者のみだが保険）
await enforceRateLimit(`aiinsights:${uid}`, 20, 60 * 60);
```
```ts
// analytics.ts（HTTP・IPベース）
import { enforceRateLimit } from "./rateLimit";
const ip = (req.headers["x-forwarded-for"] as string || req.ip || "unknown").split(",")[0].trim();
try { await enforceRateLimit(`analytics:${ip}`, 120, 60); } // 1分120イベントバッチまで
catch { res.status(429).json({ ok: false }); return; }
```
> `submitContactInquiry` は既に honeypot + 送信間隔 + IP 3件/時のレート制限があるため対象外で可。

### 確認
- ループで同一UID/IPから連続呼び出し → 上限超過で `resource-exhausted` / `429`。
- 単体テスト: `enforceRateLimit` を webhooks.test.ts と同様に `db.runTransaction` をモックして境界（max到達で throw）を検証。

---

## 4. Bappy 残高・在庫の監視アラート

### 目的
eSIM 仕入れ元（Bappy）の事前チャージ残高/在庫が枯渇し、決済完了後に発券できない障害（機会損失・クレーム）を未然に検知する。

### 4-A. Bappy クライアントに残高取得を追加（`functions/src/bappy/`）
`functions/src/bappy/client.ts` に、Bappy の残高/在庫エンドポイントを叩く関数を追加（実エンドポイントは Bappy 仕様書に合わせる。以下はプレースホルダ）:
```ts
// bappy/balance.ts（新規）
import { bappyFetch } from "./client"; // 既存の認証付き fetch ラッパを利用
export interface BappyBalance { balance: number; currency: string; }
export async function getBappyBalance(): Promise<BappyBalance> {
  const res = await bappyFetch("/v1/account/balance", { method: "GET" });
  return { balance: Number(res.balance ?? 0), currency: String(res.currency ?? "USD") };
}
```
`functions/src/bappy/index.ts` から re-export。

### 4-B. 監視スケジュール関数（`functions/src/scheduled.ts` に追記）
```ts
import { getBappyBalance } from "./bappy";
import { notifyOwner } from "./adapters/notify";
import { createIncidentLog } from "./db";

const BAPPY_BALANCE_THRESHOLD = 50; // 通貨単位。閾値は運用に合わせて調整

export const bappyBalanceMonitor = onSchedule(
  {
    schedule: "every 6 hours",
    region: "asia-northeast1",
    timeoutSeconds: 120,
    secrets: [omaxClientId, omaxClientSecret, forgeApiKey, slackWebhookUrl],
  },
  async () => {
    try {
      const { balance, currency } = await getBappyBalance();
      logger.info(`[bappyBalanceMonitor] balance=${balance} ${currency}`);
      if (balance < BAPPY_BALANCE_THRESHOLD) {
        await notifyOwner({
          title: `⚠️ Bappy残高が閾値以下: ${balance} ${currency}`,
          content: `Bappyの事前チャージ残高が ${balance} ${currency}（閾値 ${BAPPY_BALANCE_THRESHOLD}）です。\n決済完了後にeSIMが発券できない障害を防ぐため、至急チャージしてください。`,
        });
        await createIncidentLog({
          type: "bappy_low_balance",
          severity: "warning",
          title: `Bappy残高低下: ${balance} ${currency}`,
          detail: `threshold=${BAPPY_BALANCE_THRESHOLD}`,
        }).catch(() => {});
      }
    } catch (err) {
      logger.error("[bappyBalanceMonitor] failed to fetch balance", err);
      // 取得失敗自体も異常なので通知
      await notifyOwner({
        title: "🚨 Bappy残高の取得に失敗",
        content: `残高監視の取得に失敗しました。Bappy API の障害またはトークン失効の可能性があります。\n${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {});
    }
  },
);
```
> `secrets` は既存の `defineSecret` 参照（`omaxClientId` 等）を流用。Forge/Slack は既に scheduled.ts で定義済み。

### 確認
- 閾値を一時的に高くして手動デプロイ → 通知（Forge/Slack）とインシデントログが出ることを確認 → 閾値を戻す。
- Bappy API のトークン失効時にも「取得失敗」通知が来ること。

---

## 導入チェックリスト

| 項目 | 主作業 | リスク | 目安 |
|---|---|---|---|
| 1. バックアップ | gcloud（PITR + backup schedule）／任意でExport関数 | 低 | 0.5日 |
| 2. App Check | reCAPTCHA Enterprise登録 + client初期化 + callable enforce + Monitor→Enforce | 中（正規トラフィック確認要） | 1日 |
| 3. レート制限 | `rateLimit.ts` + 各endpoint適用 + Rules追記 + 単体テスト | 低〜中 | 0.5日 |
| 4. Bappy監視 | balance取得 + scheduled関数 + 閾値調整 | 低（Bappy仕様確認要） | 0.5日 |

## デプロイ時の注意
- App Check は**必ず「Monitor」で数日**運用し、正規トラフィックが検証済み100%になってから「Enforce」にする（いきなり Enforce にすると正規ユーザーが弾かれる）。
- 追加する `secrets`/env（reCAPTCHAキー等）は既存同様に Secret Manager / `.env` に登録してからデプロイ。
- `stripeWebhook` / `bappyWebhook` に App Check を付けない（サーバー間通信のため）。
