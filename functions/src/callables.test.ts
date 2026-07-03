import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// onCall はハンドラをそのまま返す。HttpsError は code を持つ簡易クラス。
vi.mock("firebase-functions/v2/https", () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    onCall: (_opts: any, handler: any) => handler,
    HttpsError,
  };
});

vi.mock("firebase-functions/params", () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn(() => "") })),
}));

const mockRequireAuth = vi.fn();
vi.mock("./_helpers", () => ({
  requireAuth: (...args: any[]) => mockRequireAuth(...args),
  requireAdmin: vi.fn(),
  zodError: (msg: string) => Object.assign(new Error(msg), { code: "invalid-argument" }),
}));

// db / collections モック
const mockCheckoutPlanGet = vi.fn(); // db.collection("plans")....get()  (initial checkout)
const mockTopupPlanGet = vi.fn(); // collections.plans....get()          (topup)
const mockOrdersAdd = vi.fn();
const mockUserConsentsAdd = vi.fn();
const mockGetEsimLinkByUuid = vi.fn();
const mockUpdateOrder = vi.fn();

vi.mock("./db", () => {
  const checkoutPlanChain: any = { where: () => checkoutPlanChain, limit: () => checkoutPlanChain, get: (...a: any[]) => mockCheckoutPlanGet(...a) };
  const ordersChain: any = { add: (...a: any[]) => mockOrdersAdd(...a) };
  const topupPlanChain: any = { where: () => topupPlanChain, limit: () => topupPlanChain, get: (...a: any[]) => mockTopupPlanGet(...a) };
  return {
    db: {
      collection: (name: string) => (name === "orders" ? ordersChain : checkoutPlanChain),
      runTransaction: vi.fn(),
    },
    collections: {
      plans: topupPlanChain,
      userConsents: { add: (...a: any[]) => mockUserConsentsAdd(...a) },
    },
    getEsimLinkByUuid: (...a: any[]) => mockGetEsimLinkByUuid(...a),
    getOrderById: vi.fn(),
    updateOrder: (...a: any[]) => mockUpdateOrder(...a),
    getUserByUid: vi.fn(),
  };
});

vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./esimRetryService", () => ({ processPendingRetries: vi.fn() }));
// レート制限は本テストの対象外（rateLimit.test.ts で検証）。ここでは無効化する。
vi.mock("./rateLimit", () => ({ enforceRateLimit: vi.fn() }));

const mockCreateCheckoutSession = vi.fn();
vi.mock("./stripe", () => ({
  createCheckoutSession: (...a: any[]) => mockCreateCheckoutSession(...a),
  validateOrigin: (origin: string) => origin,
}));

// ─── Import (after mocks) ───────────────────────────────────────────────────────
import { ordersInitCheckout, ordersInitTopupCheckout } from "./callables";

// 例外の HttpsError code を取り出すヘルパー
async function rejectionCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e: any) {
    return e?.code;
  }
}

const baseRawRequest = { ip: "203.0.113.1", headers: { "user-agent": "vitest" } };

describe("ordersInitCheckout — 課金入口の防御", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ uid: "user_1", user: { email: "u@example.com", name: "U", stripeCustomerId: null } });
    mockCreateCheckoutSession.mockResolvedValue({ sessionId: "cs_1", checkoutUrl: "https://checkout.stripe/x" });
    mockOrdersAdd.mockResolvedValue({ id: "order_1" });
    mockUserConsentsAdd.mockResolvedValue(undefined);
    mockUpdateOrder.mockResolvedValue(undefined);
  });

  const validInput = {
    bappyPlanId: "JP_3D_1GB",
    origin: "https://yah.mobi",
    termsConsented: true,
    privacyConsented: true,
    marketingConsented: false,
    timezone: "Asia/Tokyo",
  };

  it("価格はクライアントではなくサーバー（plans）の priceJpy を使う（価格改ざん不可）", async () => {
    // プランは 990円。クライアントが安い額を送っても入力スキーマに price フィールドは無い。
    mockCheckoutPlanGet.mockResolvedValue({
      empty: false,
      docs: [{ id: "plan_doc_1", data: () => ({ bappyPlanId: "JP_3D_1GB", priceJpy: 990, name: "Japan 3D 1GB" }) }],
    });

    // 悪意あるクライアントが amountJpy: 1 を混入させても無視されるべき
    const req: any = { data: { ...validInput, amountJpy: 1, priceJpy: 1 }, rawRequest: baseRawRequest };
    const res = await (ordersInitCheckout as any)(req);

    expect(res.checkoutUrl).toBe("https://checkout.stripe/x");
    // 注文は必ずサーバー側の 990 で作成される
    expect(mockOrdersAdd).toHaveBeenCalledWith(expect.objectContaining({ amountJpy: 990, userId: "user_1" }));
    // Stripe セッションもサーバー価格で作られる
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amountJpy: 990 }));
  });

  it("存在しない/無効なプランは not-found を返し、注文を作らない", async () => {
    mockCheckoutPlanGet.mockResolvedValue({ empty: true, docs: [] });
    const req: any = { data: validInput, rawRequest: baseRawRequest };
    const code = await rejectionCode((ordersInitCheckout as any)(req));
    expect(code).toBe("not-found");
    expect(mockOrdersAdd).not.toHaveBeenCalled();
  });

  it("未認証は拒否される（requireAuth が弾く）", async () => {
    mockRequireAuth.mockRejectedValue(Object.assign(new Error("login required"), { code: "unauthenticated" }));
    const req: any = { data: validInput, rawRequest: baseRawRequest };
    const code = await rejectionCode((ordersInitCheckout as any)(req));
    expect(code).toBe("unauthenticated");
    expect(mockOrdersAdd).not.toHaveBeenCalled();
  });
});

describe("ordersInitTopupCheckout — 所有権(IDOR)の防御", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ uid: "user_1", user: { email: "u@example.com", name: "U", stripeCustomerId: null } });
    mockCreateCheckoutSession.mockResolvedValue({ sessionId: "cs_1", checkoutUrl: "https://checkout.stripe/topup" });
    mockOrdersAdd.mockResolvedValue({ id: "order_topup_1" });
    mockUpdateOrder.mockResolvedValue(undefined);
    mockTopupPlanGet.mockResolvedValue({
      empty: false,
      docs: [{ id: "plan_topup_1", data: () => ({ bappyPlanId: "JP_TOPUP_1GB", priceJpy: 500, name: "Topup 1GB", planType: "topup" }) }],
    });
  });

  const validTopup = {
    esimLinkUuid: "esim-uuid-owned-by-someone",
    bappyPlanId: "JP_TOPUP_1GB",
    origin: "https://yah.mobi",
    timezone: "Asia/Tokyo",
  };

  it("他人の eSIM を指定したトップアップは permission-denied（注文を作らない）", async () => {
    // 対象 eSIM は別ユーザー所有
    mockGetEsimLinkByUuid.mockResolvedValue({ id: "esim_1", userId: "other_user", bappyLinkUuid: "esim-uuid-owned-by-someone" });
    const req: any = { data: validTopup, rawRequest: baseRawRequest };
    const code = await rejectionCode((ordersInitTopupCheckout as any)(req));
    expect(code).toBe("permission-denied");
    expect(mockOrdersAdd).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("存在しない eSIM を指定したトップアップも permission-denied", async () => {
    mockGetEsimLinkByUuid.mockResolvedValue(null);
    const req: any = { data: validTopup, rawRequest: baseRawRequest };
    const code = await rejectionCode((ordersInitTopupCheckout as any)(req));
    expect(code).toBe("permission-denied");
    expect(mockOrdersAdd).not.toHaveBeenCalled();
  });

  it("本人所有の eSIM なら正常にトップアップ注文が作成される", async () => {
    mockGetEsimLinkByUuid.mockResolvedValue({ id: "esim_1", userId: "user_1", bappyLinkUuid: "esim-uuid-owned-by-someone" });
    const req: any = { data: validTopup, rawRequest: baseRawRequest };
    const res = await (ordersInitTopupCheckout as any)(req);
    expect(res.checkoutUrl).toBe("https://checkout.stripe/topup");
    expect(mockOrdersAdd).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", orderType: "topup", amountJpy: 500 }));
  });
});
