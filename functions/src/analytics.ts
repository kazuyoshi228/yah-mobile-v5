import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { collections } from "./db";
import { ENV } from "./env";
import { enforceRateLimit } from "./rateLimit";

function stripPii(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  try {
    const isAbsolute = urlStr.startsWith("http://") || urlStr.startsWith("https://");
    const parsed = new URL(urlStr, isAbsolute ? undefined : "https://dummy.local");
    const piiParams = ["email", "token", "password", "secret", "uid", "session", "id"];
    piiParams.forEach(p => parsed.searchParams.delete(p));
    
    if (isAbsolute) {
      return parsed.toString();
    } else {
      return parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    return String(urlStr);
  }
}


export const analyticsEvents = onRequest(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    cors: ENV.allowedOrigins as unknown as string[],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    // IPベースのレート制限（無認証エンドポイントのスパム/課金攻撃対策）
    const rawIp = (req.headers["x-forwarded-for"] as string | undefined) || req.ip || "unknown";
    const ip = rawIp.split(",")[0].trim();
    try {
      await enforceRateLimit(`analytics:${ip}`, 120, 60); // 1分あたり120バッチまで
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "resource-exhausted") {
        res.status(429).json({ ok: false, error: "rate-limited" });
        return;
      }
      // レート制限器自体のエラーでは analytics を止めない（fail-open）
      logger.warn("[analyticsEvents] rate limiter error, allowing request:", e);
    }

    try {
      const body = req.body as { events?: unknown[] };
      const events = Array.isArray(body?.events) ? body.events : [];

      if (events.length === 0) {
        res.json({ ok: true });
        return;
      }

      // Hard limit to 20 events per request to prevent abuse
      const limitedEvents = events.slice(0, 20);

      await Promise.all(
        limitedEvents.map((ev: unknown) => {
          const e = ev as Record<string, unknown>;
          
          // Strict size limit on properties to prevent Firestore bloat / DoS
          let properties = {};
          if (e.properties && typeof e.properties === "object") {
            const stringified = JSON.stringify(e.properties);
            if (stringified.length <= 4096) {
              properties = e.properties;
            } else {
              logger.warn("[analyticsEvents] properties payload too large, stripping.");
            }
          }

          return collections.analyticsEvents.add({
            eventName: String(e.eventName ?? "").slice(0, 64),
            properties,
            sessionId: String(e.sessionId ?? "").slice(0, 36),
            userId: null,
            page: e.page ? stripPii(String(e.page))?.slice(0, 255) : null,
            referrer: e.referrer ? stripPii(String(e.referrer))?.slice(0, 2048) : null,
            userAgent: e.userAgent ? String(e.userAgent).slice(0, 512) : null,
            language: e.language ? String(e.language).slice(0, 16) : null,
            createdAt: Date.now(),
          });
        })
      );

      res.json({ ok: true });
    } catch (err) {
      logger.error("[analyticsEvents] Error processing events:", err);
      res.status(500).json({ ok: false });
    }
  }
);
