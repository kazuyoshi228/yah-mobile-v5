import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---
vi.mock("firebase-functions/v2/https", () => ({
  // Make onRequest return the handler directly so we can call it
  onRequest: vi.fn((opts, handler) => handler)
}));
vi.mock("firebase-functions/params", () => ({
  defineSecret: vi.fn(() => ({ value: vi.fn() }))
}));

const mockConstructWebhookEvent = vi.fn();
vi.mock("./stripe", () => ({
  constructWebhookEvent: (...args: any[]) => mockConstructWebhookEvent(...args)
}));

const mockGetOrderByStripeSessionId = vi.fn();
const mockUpdateOrder = vi.fn();
const mockEventRefGet = vi.fn();
const mockEventRefSet = vi.fn();
const mockEventRefUpdate = vi.fn();

vi.mock("./db", () => {
  return {
    getOrderByStripeSessionId: (...args: any[]) => mockGetOrderByStripeSessionId(...args),
    updateOrder: (...args: any[]) => mockUpdateOrder(...args),
    getEsimLinkByOrderId: vi.fn().mockResolvedValue(null),
    updateEsimLink: vi.fn(),
    getUserByUid: vi.fn().mockResolvedValue(null),
    incrementSystemStats: vi.fn().mockResolvedValue(undefined),
    // Idempotency now uses db.runTransaction; the txn get/set delegate to the same mocks.
    db: {
      runTransaction: async (fn: any) =>
        fn({
          get: (...args: any[]) => mockEventRefGet(...args),
          set: (_ref: any, data: any) => mockEventRefSet(data),
        }),
    },
    collections: {
      stripeEvents: {
        doc: vi.fn(() => ({
          get: mockEventRefGet,
          set: mockEventRefSet,
          update: mockEventRefUpdate
        }))
      }
    }
  };
});

vi.mock("./bappy", () => ({ createLink: vi.fn(), addTopupPlan: vi.fn() }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn(), buildEsimReadyEmail: vi.fn() }));
vi.mock("./esimRetryService", () => ({ handleProvisioningFailure: vi.fn() }));

// --- Import ---
import { stripeWebhook } from "./webhooks";

describe("stripeWebhook robustness tests", () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn()
    };

    req = {
      method: "POST",
      headers: { "stripe-signature": "dummy-sig" },
      rawBody: Buffer.from("{}")
    };
  });

  const setupMockEvent = (type: string, id: string, sessionData: any) => {
    mockConstructWebhookEvent.mockReturnValue({
      type,
      id,
      data: { object: sessionData }
    });
  };

  it("1. eSIM発行前で失敗 → Stripe再送 → 正しく再処理される (Idempotency fix)", async () => {
    const eventId = "evt_failed_retry";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event exists but processed is false (failed previously)
    mockEventRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: false })
    });

    // DB mock: The order is not yet fulfilled
    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "pending"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // It should NOT skip. It should claim the event as processed: false,
    // then process it, then update to processed: true.
    expect(mockEventRefSet).toHaveBeenCalledWith(expect.objectContaining({ processed: false }));
    expect(mockGetOrderByStripeSessionId).toHaveBeenCalledWith("cs_test_123");
    expect(res.status).not.toHaveBeenCalledWith(500); // Should succeed (or fail later depending on bappy mock, but not skip)
  });

  it("2. 二重発行が起きない (Already processed check)", async () => {
    const eventId = "evt_already_processed";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event exists and processed is true
    mockEventRefGet.mockResolvedValue({
      exists: true,
      data: () => ({ processed: true })
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // Should skip immediately
    expect(res.json).toHaveBeenCalledWith({ received: true, skipped: true });
    expect(mockGetOrderByStripeSessionId).not.toHaveBeenCalled();
  });

  it("2-b. 二重発行が起きない (Order fulfilled check)", async () => {
    const eventId = "evt_fulfilled_order";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 1000,
      metadata: { order_id: "order_123" }
    });

    // DB mock: The event is somehow not marked processed, but order is fulfilled
    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });

    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "fulfilled"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // It should check the order, see it's fulfilled, and not proceed to update it
    expect(mockGetOrderByStripeSessionId).toHaveBeenCalled();
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("3. amount_total と注文金額の不一致を検知・拒否する", async () => {
    const eventId = "evt_amount_mismatch";
    setupMockEvent("checkout.session.completed", eventId, {
      id: "cs_test_123",
      amount_total: 999, // Mismatched!
      metadata: { order_id: "order_123" }
    });

    mockEventRefGet.mockResolvedValue({ exists: false, data: () => undefined });

    // Order has 1000 JPY
    mockGetOrderByStripeSessionId.mockResolvedValue({
      id: "order_123",
      amountJpy: 1000,
      status: "pending"
    });

    // Execute
    await (stripeWebhook as any)(req, res);

    // Should throw error and return 500, skipping order update
    expect(mockUpdateOrder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Internal server error");
  });
});
