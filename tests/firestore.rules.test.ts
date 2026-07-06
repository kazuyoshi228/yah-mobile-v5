/**
 * firestore.rules の防御を検証するエミュレータテスト。
 *
 * 実行方法（Firestore エミュレータ + Java が必要）:
 *   pnpm run test:rules
 * 内部的に `firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.ts"` を実行する。
 */
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-yah-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** ルールを無効化してテストデータを投入するヘルパー */
async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const alice = () => testEnv.authenticatedContext("alice", { email: "alice@example.com" }).firestore();
const bob = () => testEnv.authenticatedContext("bob", { email: "bob@example.com" }).firestore();
const admin = () => testEnv.authenticatedContext("admin_user", { email: "owner@example.com", admin: true }).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

// ─── users ──────────────────────────────────────────────────────────────────
describe("users", () => {
  it("本人は自分のユーザードキュメントを読める", async () => {
    await seed("users/alice", { uid: "alice", role: "user", email: "alice@example.com" });
    await assertSucceeds(getDoc(doc(alice(), "users/alice")));
  });

  it("他人のユーザードキュメントは読めない（IDOR）", async () => {
    await seed("users/alice", { uid: "alice", role: "user", email: "alice@example.com" });
    await assertFails(getDoc(doc(bob(), "users/alice")));
  });

  it("本人はスキーマ準拠の初期ドキュメントを作成できる", async () => {
    await assertSucceeds(
      setDoc(doc(alice(), "users/alice"), {
        uid: "alice",
        name: "Alice",
        email: "alice@example.com",
        loginMethod: "google",
        role: "user",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("作成時に role=admin へ昇格しようとすると拒否される", async () => {
    await assertFails(
      setDoc(doc(alice(), "users/alice"), {
        uid: "alice",
        name: "Alice",
        email: "alice@example.com",
        loginMethod: "google",
        role: "admin", // ← 不正
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("既存ドキュメントの role 昇格（更新）は拒否される", async () => {
    await seed("users/alice", { uid: "alice", role: "user", email: "alice@example.com", status: "active" });
    await assertFails(updateDoc(doc(alice(), "users/alice"), { role: "admin" }));
  });

  it("status の書き換えは拒否される", async () => {
    await seed("users/alice", { uid: "alice", role: "user", email: "alice@example.com", status: "active" });
    await assertFails(updateDoc(doc(alice(), "users/alice"), { status: "suspended" }));
  });

  it("本人による通常フィールドの更新は許可される", async () => {
    await seed("users/alice", { uid: "alice", role: "user", email: "alice@example.com", status: "active" });
    await assertSucceeds(updateDoc(doc(alice(), "users/alice"), { name: "Alice2", updatedAt: serverTimestamp() }));
  });
});

// ─── plans ──────────────────────────────────────────────────────────────────
describe("plans", () => {
  // 妥当なプラン（PlansTab が書く形：priceJpy/validityDays は int, isActive は bool）
  const validPlan = (overrides: Record<string, unknown> = {}) => ({
    bappyPlanId: "JP_7D_1GB",
    name: "Japan / 1GB / 7days",
    priceJpy: 990,
    validityDays: 7,
    isActive: true,
    ...overrides,
  });

  it("誰でも（未認証でも）読める", async () => {
    await seed("plans/p1", { bappyPlanId: "JP_3D_1GB", priceJpy: 990, isActive: true });
    await assertSucceeds(getDoc(doc(anon(), "plans/p1")));
  });

  it("一般ユーザーは書き込めない", async () => {
    await assertFails(setDoc(doc(alice(), "plans/p2"), validPlan()));
  });

  it("管理者は妥当なプランを書き込める", async () => {
    await assertSucceeds(setDoc(doc(admin(), "plans/p2"), validPlan()));
  });

  it("priceJpy が負値/0/範囲外だと拒否", async () => {
    await assertFails(setDoc(doc(admin(), "plans/p3"), validPlan({ priceJpy: -1 })));
    await assertFails(setDoc(doc(admin(), "plans/p3"), validPlan({ priceJpy: 0 })));
    await assertFails(setDoc(doc(admin(), "plans/p3"), validPlan({ priceJpy: 100000 })));
  });

  it("priceJpy/validityDays が文字列（型不正）だと拒否", async () => {
    await assertFails(setDoc(doc(admin(), "plans/p4"), validPlan({ priceJpy: "990" as unknown as number })));
    await assertFails(setDoc(doc(admin(), "plans/p4"), validPlan({ validityDays: "7" as unknown as number })));
  });

  it("validityDays が0/負/過大だと拒否", async () => {
    await assertFails(setDoc(doc(admin(), "plans/p5"), validPlan({ validityDays: 0 })));
    await assertFails(setDoc(doc(admin(), "plans/p5"), validPlan({ validityDays: 4000 })));
  });

  it("isActive が非boolean / name欠落だと拒否", async () => {
    await assertFails(setDoc(doc(admin(), "plans/p6"), validPlan({ isActive: "true" as unknown as boolean })));
    const { name: _omit, ...noName } = validPlan();
    await assertFails(setDoc(doc(admin(), "plans/p6"), noName));
  });

  it("管理者は削除できる", async () => {
    await seed("plans/pdel", validPlan());
    await assertSucceeds(deleteDoc(doc(admin(), "plans/pdel")));
  });
});

// ─── orders ─────────────────────────────────────────────────────────────────
describe("orders", () => {
  it("本人は自分の注文を読める / 他人の注文は読めない", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertSucceeds(getDoc(doc(alice(), "orders/o1")));
    await assertFails(getDoc(doc(bob(), "orders/o1")));
  });

  it("クライアントから注文を直接作成できない（Cloud Functions 専用）", async () => {
    await assertFails(setDoc(doc(alice(), "orders/o2"), { userId: "alice", amountJpy: 990, status: "pending" }));
  });

  it("本人は hiddenByUser のみ更新できる", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertSucceeds(updateDoc(doc(alice(), "orders/o1"), { hiddenByUser: true, updatedAt: serverTimestamp() }));
  });

  it("本人でも status など他フィールドは更新できない（価格・状態の改ざん防止）", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertFails(updateDoc(doc(alice(), "orders/o1"), { status: "fulfilled" }));
    await assertFails(updateDoc(doc(alice(), "orders/o1"), { amountJpy: 1, updatedAt: serverTimestamp() }));
  });

  it("他人は他ユーザーの注文を更新できない（IDOR・hiddenByUser でも不可）", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertFails(updateDoc(doc(bob(), "orders/o1"), { hiddenByUser: true, updatedAt: serverTimestamp() }));
  });

  it("他人名義の注文を自分が作成できない（なりすまし作成の防止）", async () => {
    await assertFails(setDoc(doc(bob(), "orders/o3"), { userId: "alice", amountJpy: 990, status: "pending", hiddenByUser: false }));
  });

  it("他人は他ユーザーの注文を削除できない", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertFails(deleteDoc(doc(bob(), "orders/o1")));
  });

  it("本人でも注文を削除できない（Cloud Functions 専用）", async () => {
    await seed("orders/o1", { userId: "alice", amountJpy: 990, status: "paid", hiddenByUser: false });
    await assertFails(deleteDoc(doc(alice(), "orders/o1")));
  });
});

// ─── esim_links ───────────────────────────────────────────────────────────────
describe("esim_links", () => {
  it("本人は自分の eSIM を読める / 他人のは読めない", async () => {
    await seed("esim_links/e1", { userId: "alice", bappyLinkUuid: "uuid-1", status: "active" });
    await assertSucceeds(getDoc(doc(alice(), "esim_links/e1")));
    await assertFails(getDoc(doc(bob(), "esim_links/e1")));
  });

  it("クライアントから eSIM を作成できない", async () => {
    await assertFails(setDoc(doc(alice(), "esim_links/e2"), { userId: "alice", bappyLinkUuid: "uuid-2", status: "active" }));
  });
});

// ─── rate_limits ──────────────────────────────────────────────────────────────
describe("rate_limits", () => {
  it("クライアントからは読み書きできない（Cloud Functions 専用）", async () => {
    await assertFails(getDoc(doc(alice(), "rate_limits/checkout:alice")));
    await assertFails(setDoc(doc(alice(), "rate_limits/checkout:alice"), { count: 0 }));
  });
});

// ─── default deny ─────────────────────────────────────────────────────────────
describe("default deny", () => {
  it("ルール未定義のコレクションは読み書きできない", async () => {
    await assertFails(getDoc(doc(alice(), "secret_stuff/x")));
    await assertFails(setDoc(doc(alice(), "secret_stuff/x"), { foo: "bar" }));
  });
});
