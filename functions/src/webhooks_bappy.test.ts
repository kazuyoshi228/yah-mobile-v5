import { describe, it, expect, vi, beforeEach } from "vitest";
import { bappyWebhook } from "./webhooks_bappy";
import * as db from "./db";
import * as notify from "./adapters/notify";

// Mock ./adapters/notify（障害時のオーナー通知を検証するため）
vi.mock("./adapters/notify", () => ({
  notifyOwner: vi.fn(),
}));

// Mock ./db
vi.mock("./db", () => {
  const mockUsageLogsAdd = vi.fn();
  return {
    updateEsimLink: vi.fn(),
    collections: {
      esimLinks: {
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            add: mockUsageLogsAdd
          }))
        }))
      }
    },
    mockUsageLogsAdd // Exporting to assert in tests
  };
});

describe("bappyWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockReq = (method: string, body: any) => ({
    method,
    body,
  } as any);

  const mockRes = () => {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.send = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  it("should return 405 for non-POST requests", async () => {
    const req = mockReq("GET", {});
    const res = mockRes();
    
    // bappyWebhook is a wrapped function, we need to call it with req, res
    await bappyWebhook(req, res);
    
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.send).toHaveBeenCalledWith("Method Not Allowed");
  });

  it("should return 400 if bappyLinkUuid is missing", async () => {
    const req = mockReq("POST", { eventType: "esim_installed" });
    const res = mockRes();
    
    await bappyWebhook(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith("Missing bappyLinkUuid");
  });

  it("should update esim_links and return 200 on valid request", async () => {
    const req = mockReq("POST", {
      bappyLinkUuid: "link_123",
      eventType: "esim_installed",
      dataRemainingMb: 1000,
      installedDeviceModel: "iPhone 15",
    });
    const res = mockRes();
    
    await bappyWebhook(req, res);
    
    expect(db.updateEsimLink).toHaveBeenCalledWith(
      "link_123",
      expect.objectContaining({
        status: "active",
        dataRemainingMb: 1000,
        installedDeviceModel: "iPhone 15",
      })
    );
    
    // Usage logs should be appended for esim_installed
    const { mockUsageLogsAdd } = await import("./db") as any;
    expect(mockUsageLogsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "esim_installed",
        dataRemainingMb: 1000,
      })
    );
    
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("should return 500 if DB update fails", async () => {
    (db.updateEsimLink as any).mockRejectedValue(new Error("DB Error"));
    const req = mockReq("POST", { bappyLinkUuid: "link_123" });
    const res = mockRes();

    await bappyWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith("Internal server error");
  });

  it("should notify the owner when processing fails (24222b2)", async () => {
    (db.updateEsimLink as any).mockRejectedValue(new Error("DB Error"));
    const req = mockReq("POST", { bappyLinkUuid: "link_123" });
    const res = mockRes();

    await bappyWebhook(req, res);

    expect(notify.notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Bappy Webhook"),
      })
    );
  });
});
