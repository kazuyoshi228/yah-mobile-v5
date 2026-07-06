# 設計図：eSIM QR をクライアント生成に切り替える（Storage画像を廃止）

作成日: 2026-07-06 / 対象ブランチ: `dev` / 種別: バグ修正＋不要コード整理

---

## 1. 背景・問題

My Orders / 購入完了画面の QR コードが壊れる。原因は QR を **Firebase Storage の PNG 画像**として持ち、その URL（`qrCodeUrl`）を `<img>` 表示しているため（画像が未生成/ACL不備/削除/null だと壊れる）。

一方、QR の中身である **LPA プロファイル文字列（`LPA:1$smdp...$activation`）は `esim_link.lpaProfile` として Firestore に既に存在**する。QR は単なるその文字列の視覚エンコードなので、**画像をサーバ生成・Storage保存する必然性がない**。

## 2. 実コード確認の結果

| 箇所 | 現状 |
|---|---|
| 表示 | `Step6Esim.tsx:29` / `OrderDetailPage.tsx:232` … `<img src={safeUrl(esimLink.qrCodeUrl)}>` |
| 生成 | `functions/src/webhooks.ts:242` `generateAndStoreQrCode(orderId, lpaProfile)`（`functions/src/qrStorage.ts`）→ `qrcode` で PNG 生成 → Storage `qrcodes/{orderId}.png` に保存 → `qrCodeUrl` を書き戻し |
| データ | `esim_link.lpaProfile`（LPA文字列）は常に保存済み（`webhooks.ts:227`）。`appleActivationUrl`/`androidActivationUrl`/`iccid` も有り |
| メール | `mailer.ts` は **QR を一切使用していない**（grep 該当なし）→ Storage QR を廃止してもメールに影響なし |
| クライアントQRライブラリ | 現状 **無し**（サーバ側は `qrcode` を使用中＝実績あり） |

## 3. 提案（最小・最短：Firestore の `lpaProfile` から直接クライアント生成）

QR を **クライアントで `lpaProfile` から SVG 生成**する。Storage も `qrCodeUrl` も不要になり、壊れようがない（ネットワーク要求ゼロ・常に Firestore データと一致）。

### Phase 1（フロント＝今回の主目的・これで表示は直る）
1. QR ライブラリ **`qrcode.react`** を追加（React 用・SVG出力・軽量）。
2. 共通コンポーネント **`client/src/components/EsimQr.tsx`** を新設：
   ```tsx
   import { QRCodeSVG } from "qrcode.react";
   export function EsimQr({ value, size = 220 }: { value: string; size?: number }) {
     return <QRCodeSVG value={value} size={size} level="M" marginSize={2} />;
   }
   ```
3. `Step6Esim.tsx` / `OrderDetailPage.tsx` の `<img src={qrCodeUrl}>` を
   `esimLink.lpaProfile ? <EsimQr value={esimLink.lpaProfile} .../> : <スピナー>` に置換。
   → `qrCodeUrl` への依存を廃止。

### Phase 2（バックエンド／Storage の不要コード整理・**functions のため要・別承認**）
- `webhooks.ts:242-245` の `generateAndStoreQrCode(...)` 呼び出しと `qrCodeUrl: null` 書き込みを削除。
- `functions/src/qrStorage.ts` / `qrStorage.test.ts` を削除、functions の `qrcode` 依存を除去。
- 既存 Storage の `qrcodes/*.png` は孤児になるが害はない（任意で後日クリーンアップ）。
- `shared/types.ts` の `qrCodeUrl` は当面残置可（読まなくなるだけ）。将来削除。

> CLAUDE.md に従い、**Phase 2（`functions/` の変更）は本設計の承認とは別に、実施前に改めて承認を得る**。Phase 1 だけでも「壊れたQR」は解消する。

## 4. 影響範囲・リスク

- **影響**：Web の QR 表示（購入完了ドロワー／注文詳細）。メール・課金・Rules に影響なし。
- **リスク**：小。`lpaProfile` が null のケース（本来 fulfilled では有るはず）はスピナー/フォールバック表示。
- **互換**：`qrCodeUrl` を読まなくなるだけで、既存データは壊さない。
- **セキュリティ**：`lpaProfile` は元々ユーザーに表示される有効化情報（新たな露出増なし）。
- **依存追加**：`qrcode.react`（数KB）。サーバ側 `qrcode` は Phase 2 で除去でき、差し引き軽量化。

## 5. テスト／検証計画

1. `npx tsc --noEmit`（型チェック）
2. `EsimQr` の軽い描画テスト（`value` から `<svg>` が出る／`role`）を追加（任意）
3. プレビュー / dev チャンネルで確認：
   - 購入完了（Step6）・注文詳細で **QR が SVG で表示**され、実機カメラで eSIM 追加画面が起動する（`lpaProfile` を正しくエンコード）
   - `qrCodeUrl` が null/壊れでも QR が出る
4. `dev` にコミット → 本番は別途ユーザー指示。

---

## 承認のお願い
**Phase 1（クライアント生成へ切替。ライブラリ `qrcode.react`）** で実装してよろしいでしょうか？
Phase 2（`functions`/`qrStorage.ts` 等の不要コード削除）は、Phase 1 後に別途承認をいただいてから実施します。

---

## BaaS-first 適合性
- 現状の Storage QR は **Cloud Function が画像生成＋Storage書込＋Firestore書戻し**という“独自バックエンド処理”を挟んでおり、`plansList` callable 廃止→Firestore直読、`orders` の `addDoc` 直書き、という**ピュアBaaS直線モデル**に逆行していた。
- 本提案は **client → Firestore(`lpaProfile`) 直結**でQRを描画し、中間の Function と冗長な Storage 成果物を除去。**よりBaaSファースト・ミニマル・堅牢**（画像URL依存を排除）。QR描画は「持っているデータの見た目変換」＝純粋なクライアント表示責務。

## 実装記録（Phase 1・2026-07-06 完了）
- 依存追加：`qrcode.react@4.2.0`（**pnpm** で追加。※本プロジェクトは pnpm 管理。npm install は node_modules と衝突するため不可）。
- 新規 `client/src/components/EsimQr.tsx`（`<QRCodeSVG value size level marginSize>`）＋ `EsimQr.test.tsx`（SVG生成・value依存の2ケース）。
- `Step6Esim.tsx` / `OrderDetailPage.tsx`：`<img src={qrCodeUrl}>` → `EsimQr value={esimLink.lpaProfile}` に置換。フロントの `qrCodeUrl` 依存を完全撤去。
- 検証：型チェック・EsimQrテスト・build 通過。※実際のQR表示は lpaProfile を持つ注文が必要（ロジックは単体テストで担保）。

## 実装記録（Phase 2・2026-07-06 完了・ユーザー承認済み）
- `functions/src/webhooks.ts`：`generateAndStoreQrCode` の import・呼び出しブロック・`qrCodeUrl: null` 書き込みを削除。未使用になった `updateEsimLink` import も除去。
- `functions/src/qrStorage.ts` / `qrStorage.test.ts` を削除。`functions/src/webhooks.test.ts` の `qrStorage` mock も除去。
- `functions/package.json` から `qrcode` / `@types/qrcode` を除去（`npm uninstall`、functions は npm 管理）。
- 検証：functions `npm run build`（tsc）通過・`npm test` 34件通過。
- ⚠️ **functions は共有デプロイ（本番）でチャンネルが無いため、本番反映は別途ユーザー指示で `firebase deploy --only functions`**。未デプロイでも害なし（フロントは既に qrCodeUrl 非依存）。既存 Storage `qrcodes/*.png` は孤児化するが無害。
