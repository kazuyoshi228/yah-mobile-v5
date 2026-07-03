import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./db";

/**
 * 固定ウィンドウのレート制限。key 単位で windowSec 内に max 回まで許可し、
 * 超過したら HttpsError("resource-exhausted") を throw する。
 * カウンタは Firestore の rate_limits/{key} にトランザクションで保持する
 * （クライアントからの読み書きは Firestore Rules で禁止済み）。
 *
 * @param key       制限キー（例: `checkout:<uid>` / `analytics:<ip>`）
 * @param max       ウィンドウ内の最大許可回数
 * @param windowSec ウィンドウ長（秒）
 */
export async function enforceRateLimit(key: string, max: number, windowSec: number): Promise<void> {
  // Firestore ドキュメントIDとして安全な文字に正規化
  const safeKey = key.replace(/[^\w.:-]/g, "_").slice(0, 400) || "unknown";
  const ref = db.collection("rate_limits").doc(safeKey);
  const now = Date.now();
  const windowMs = windowSec * 1000;

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const data = snap.data();
    // 未作成、またはウィンドウを跨いだらリセット
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
