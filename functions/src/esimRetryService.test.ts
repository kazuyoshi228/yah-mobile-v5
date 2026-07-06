import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleProvisioningFailure, processPendingRetries, ProvisioningContext } from "./esimRetryService";
import * as db from "./db";
import * as notify from "./adapters/notify";
import * as bappy from "./bappy";
import * as mailer from "./mailer";

// Mock ./bappy（eSIM発行/トップアップAPI）
vi.mock("./bappy", () => ({
  createLink: vi.fn(),
  addTopupPlan: vi.fn(),
}));

// Mock ENV
vi.mock("./env", () => ({
  ENV: {
    ownerEmail: "owner@example.com",
    omaxTechEmail: "tech@example.com"
  }
}));

// Mock DB
vi.mock("./db", () => ({
  createRetryJob: vi.fn(),
  createIncidentLog: vi.fn(),
  updateOrder: vi.fn(),
  createEsimLink: vi.fn(),
  createEsimActivation: vi.fn(),
  getEsimLinkByOrderId: vi.fn(),
  createNotification: vi.fn(),
  getUserById: vi.fn(),
  getPendingRetryJobs: vi.fn(),
  updateRetryJob: vi.fn(),
  resolveIncident: vi.fn(),
  markIncidentNotified: vi.fn(),
  collections: {}
}));

// Mock notify
vi.mock("./adapters/notify", () => ({
  notifyOwner: vi.fn()
}));

// Mock mailer（ビルダーは {subject, html} を返す＝呼び出し側の分割代入が成立するように）
vi.mock("./mailer", () => ({
  sendEmail: vi.fn(),
  buildEsimDelayedEmail: vi.fn(() => ({ subject: "delayed", html: "<p>delayed</p>" })),
  buildEsimFailedEmail: vi.fn(() => ({ subject: "failed", html: "<p>failed</p>" })),
  buildEsimReadyEmail: vi.fn(() => ({ subject: "ready", html: "<p>ready</p>" })),
}));

describe("esimRetryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleProvisioningFailure", () => {
    it("should create a retry job, incident log, and send notifications", async () => {
      (db.createRetryJob as any).mockResolvedValue("job_123");
      (db.createIncidentLog as any).mockResolvedValue("incident_456");

      const ctx: ProvisioningContext = {
        orderId: "order_123",
        userId: "user_123",
        bappyPlanId: "plan_123",
        stripeSessionId: "cs_test_123",
        isTopup: false,
      };

      const error = new Error("Bappy API is down");

      await handleProvisioningFailure(ctx, error);

      expect(db.createRetryJob).toHaveBeenCalledWith({
        orderId: "order_123",
        userId: "user_123",
        bappyPlanId: "plan_123",
        stripeSessionId: "cs_test_123",
        isTopup: false,
        parentOrderId: null,
        esimLinkUuid: null,
        maxRetries: 3,
      });

      expect(db.createIncidentLog).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "esim_failure",
          severity: "critical",
          orderId: "order_123",
          userId: "user_123",
        })
      );

      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("order_123"),
          content: expect.stringContaining("Bappy API is down")
        })
      );
    });
  });

  describe("processPendingRetries", () => {
    // 新規eSIM発行のリトライジョブ（isTopup:false）の雛形
    const newEsimJob = (overrides: Record<string, any> = {}) => ({
      id: "job_1",
      orderId: "order_1",
      userId: "user_1",
      bappyPlanId: "plan_1",
      stripeSessionId: "cs_1",
      isTopup: false,
      parentOrderId: null,
      esimLinkUuid: null,
      retryCount: 0,
      maxRetries: 3,
      status: "pending",
      ...overrides,
    });

    it("最終試行(3回目)で失敗したらオーナー通知・失敗メール・失敗通知を出し注文をfailedにする", async () => {
      // retryCount:2 → attemptNum=3 = maxRetries（最終試行）
      (db.getPendingRetryJobs as any).mockResolvedValue([newEsimJob({ retryCount: 2 })]);
      (bappy.createLink as any).mockRejectedValue(new Error("Bappy still down"));
      (db.getUserById as any).mockResolvedValue({ id: "user_1", email: "user@example.com" });

      const result = await processPendingRetries();

      expect(result.failed).toBe(1);
      expect(db.updateOrder).toHaveBeenCalledWith("order_1", { status: "failed" });
      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("最終失敗") })
      );
      expect(db.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order_failed", userId: "user_1" })
      );
      expect(mailer.buildEsimFailedEmail).toHaveBeenCalledWith({ orderId: "order_1" });
      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" })
      );
    });

    it("2回目で回復したら注文をfulfilledにし成功メール・成功通知・回復通知を出す", async () => {
      // retryCount:1 → attemptNum=2（>1・最終前）で成功
      (db.getPendingRetryJobs as any).mockResolvedValue([newEsimJob({ retryCount: 1 })]);
      (bappy.createLink as any).mockResolvedValue({
        uuid: "link_uuid",
        iccid: "8900000000000000000",
        lpaProfile: "LPA:1$smdp$token",
        appleActivationUrl: null,
        androidActivationUrl: null,
      });
      (db.getUserById as any).mockResolvedValue({ id: "user_1", email: "user@example.com" });

      const result = await processPendingRetries();

      expect(result.succeeded).toBe(1);
      expect(db.updateOrder).toHaveBeenCalledWith("order_1", { status: "fulfilled" });
      expect(db.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: "order_fulfilled", userId: "user_1" })
      );
      expect(mailer.buildEsimReadyEmail).toHaveBeenCalledWith({ orderId: "order_1" });
      expect(mailer.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" })
      );
      // attemptNum(2) > 1 なのでオーナーへ回復通知
      expect(notify.notifyOwner).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("自動回復") })
      );
    });
  });
});
