import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-functions/v2/https", () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { HttpsError };
});

const mockTxnGet = vi.fn();
const mockTxnSet = vi.fn();
const mockTxnUpdate = vi.fn();
const mockDocRef = { __ref: true };

vi.mock("./db", () => ({
  db: {
    collection: () => ({ doc: () => mockDocRef }),
    runTransaction: async (fn: any) => fn({ get: mockTxnGet, set: mockTxnSet, update: mockTxnUpdate }),
  },
}));

import { enforceRateLimit } from "./rateLimit";

async function rejectionCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e: any) {
    return e?.code;
  }
}

describe("enforceRateLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("初回（カウンタ未作成）はウィンドウを開始し throw しない", async () => {
    mockTxnGet.mockResolvedValue({ data: () => undefined });
    await enforceRateLimit("checkout:user1", 5, 60);
    expect(mockTxnSet).toHaveBeenCalledWith(mockDocRef, expect.objectContaining({ count: 1 }));
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it("上限未満ならカウントを+1する", async () => {
    mockTxnGet.mockResolvedValue({ data: () => ({ windowStart: Date.now() - 1000, count: 2 }) });
    await enforceRateLimit("checkout:user1", 5, 60);
    expect(mockTxnUpdate).toHaveBeenCalledWith(mockDocRef, { count: 3 });
    expect(mockTxnSet).not.toHaveBeenCalled();
  });

  it("上限到達で resource-exhausted を throw し、更新しない", async () => {
    mockTxnGet.mockResolvedValue({ data: () => ({ windowStart: Date.now() - 1000, count: 5 }) });
    const code = await rejectionCode(enforceRateLimit("checkout:user1", 5, 60));
    expect(code).toBe("resource-exhausted");
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });

  it("ウィンドウ経過後はリセットされ throw しない", async () => {
    mockTxnGet.mockResolvedValue({ data: () => ({ windowStart: Date.now() - 120_000, count: 100 }) });
    await enforceRateLimit("checkout:user1", 5, 60);
    expect(mockTxnSet).toHaveBeenCalledWith(mockDocRef, expect.objectContaining({ count: 1 }));
    expect(mockTxnUpdate).not.toHaveBeenCalled();
  });
});
