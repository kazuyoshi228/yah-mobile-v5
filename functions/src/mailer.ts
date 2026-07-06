import * as logger from "firebase-functions/logger";
/**
 * mailer.ts — Gmail MCP メール送信ヘルパー
 *
 * Gmail MCP（BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY）を使用して
 * メールを送信する共通ユーティリティ。
 *
 * 使用方法:
 *   import { sendEmail } from "./mailer";
 *   await sendEmail({ to: "user@example.com", subject: "件名", html: "<p>本文</p>" });
 */

import * as nodemailer from "nodemailer";
import { ENV } from "./env";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * nodemailer を使用して Gmail 経由でメールを送信する。
 * 送信失敗時は例外をスローする。
 */
export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<void> {
  const user = ENV.gmailUser;
  const pass = ENV.gmailPass;

  if (!user || !pass) {
    logger.warn("[Mailer] GMAIL_USER or GMAIL_PASS not set — skipping email");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  try {
    await transporter.sendMail({
      from: ENV.mailFrom || user,
      to,
      subject,
      html,
    });
    logger.info(`[Mailer] Email successfully sent to ${to}`);
  } catch (error: any) {
    logger.error(`[Mailer] Failed to send email to ${to}:`, error);
    throw new Error(`Gmail (nodemailer) failed: ${error.message}`);
  }
}

// ─── ユーザー向けメールテンプレート ──────────────────────────────────────────

/**
 * eSIM準備開始メール（購入直後）
 */
export function buildEsimPreparedEmail(opts: { orderId: string; planName?: string }): { subject: string; html: string } {
  const subject = "【yah.mobile】eSIMの準備を開始しました";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f8f8; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
    <div style="background: #000; padding: 24px 32px;">
      <h1 style="color: #fff; font-size: 20px; margin: 0; letter-spacing: 0.05em;">yah.mobile</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">eSIMの準備を開始しました</h2>
      <p style="color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
        ご購入ありがとうございます。eSIMの発行処理を開始しました。<br>
        通常<strong>数分以内</strong>にマイページでQRコードをご確認いただけます。
      </p>
      <div style="background: #f8f8f8; border-radius: 6px; padding: 16px; margin: 0 0 24px;">
        <p style="color: #888; font-size: 12px; margin: 0 0 4px;">注文番号</p>
        <p style="color: #111; font-size: 14px; font-weight: 600; margin: 0;">#${opts.orderId}</p>
        ${opts.planName ? `<p style="color: #888; font-size: 12px; margin: 8px 0 4px;">プラン</p><p style="color: #111; font-size: 14px; margin: 0;">${opts.planName}</p>` : ""}
      </div>
      <a href="https://yah.mobi/mypage" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 500;">
        マイページを確認する
      </a>
      <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        このメールはyah.mobileからの自動送信です。<br>
        ご不明な点は <a href="https://yah.mobi/app#contact" style="color: #555;">サポートページ</a> よりお問い合わせください。
      </p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * eSIM発行遅延メール（リトライ中）
 */
export function buildEsimDelayedEmail(opts: { orderId: string }): { subject: string; html: string } {
  const subject = "【yah.mobile】eSIMの発行に少し時間がかかっています";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f8f8; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
    <div style="background: #000; padding: 24px 32px;">
      <h1 style="color: #fff; font-size: 20px; margin: 0; letter-spacing: 0.05em;">yah.mobile</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">eSIMの発行に少し時間がかかっています</h2>
      <p style="color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
        eSIMの発行処理に通常より時間がかかっています。<br>
        引き続き自動で処理中です。<strong>完了次第メールでお知らせします</strong>。<br>
        しばらくお待ちください。
      </p>
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 16px; margin: 0 0 24px;">
        <p style="color: #92400e; font-size: 13px; margin: 0;">
          ⏳ 注文番号 #${opts.orderId} の処理中です。通常15分以内に完了します。
        </p>
      </div>
      <a href="https://yah.mobi/mypage" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 500;">
        マイページを確認する
      </a>
      <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        このメールはyah.mobileからの自動送信です。<br>
        ご不明な点は <a href="https://yah.mobi/app#contact" style="color: #555;">サポートページ</a> よりお問い合わせください。
      </p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * eSIM発行失敗メール（最終失敗）
 */
export function buildEsimFailedEmail(opts: { orderId: string }): { subject: string; html: string } {
  const subject = "【yah.mobile】eSIM発行に問題が発生しました";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f8f8; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
    <div style="background: #000; padding: 24px 32px;">
      <h1 style="color: #fff; font-size: 20px; margin: 0; letter-spacing: 0.05em;">yah.mobile</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">eSIM発行に問題が発生しました</h2>
      <p style="color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
        誠に申し訳ございません。eSIMの発行に問題が発生しました。<br>
        サポートチームが確認中です。<strong>解決次第ご連絡いたします</strong>。
      </p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 16px; margin: 0 0 24px;">
        <p style="color: #991b1b; font-size: 13px; margin: 0 0 8px; font-weight: 600;">注文番号 #${opts.orderId}</p>
        <p style="color: #991b1b; font-size: 13px; margin: 0;">
          返金対応も可能です。サポートページよりお問い合わせください。
        </p>
      </div>
      <a href="https://yah.mobi/app#contact" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 500;">
        サポートに連絡する
      </a>
      <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        このメールはyah.mobileからの自動送信です。
      </p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * 購入受付メール（決済完了直後・eSIM発行前に送信）。
 * eSIMの発行完了は別途 buildEsimReadyEmail で通知する（2通体制）。
 */
export function buildPurchaseReceivedEmail(opts: { orderId: string }): { subject: string; html: string } {
  const subject = "【yah.mobile】ご注文を受け付けました";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f8f8; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
    <div style="background: #000; padding: 24px 32px;">
      <h1 style="color: #fff; font-size: 20px; margin: 0; letter-spacing: 0.05em;">yah.mobile</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">ご注文を受け付けました ✓</h2>
      <p style="color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
        ご購入ありがとうございます。お支払いを確認しました。<br>
        現在eSIMを準備しています。発行が完了しましたら、あらためてご案内メールをお送りします。
      </p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin: 0 0 24px;">
        <p style="color: #334155; font-size: 13px; margin: 0;">
          🧾 注文番号 #${opts.orderId} を受け付けました。
        </p>
      </div>
      <a href="https://yah.mobi/mypage" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 500;">
        マイページで状況を確認する
      </a>
      <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        このメールはyah.mobileからの自動送信です。<br>
        ご不明な点は <a href="https://yah.mobi/app#contact" style="color: #555;">サポートページ</a> よりお問い合わせください。
      </p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

/**
 * eSIM発行完了メール（復旧成功）
 */
export function buildEsimReadyEmail(opts: { orderId: string }): { subject: string; html: string } {
  const subject = "【yah.mobile】eSIMの発行が完了しました";
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f8f8; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
    <div style="background: #000; padding: 24px 32px;">
      <h1 style="color: #fff; font-size: 20px; margin: 0; letter-spacing: 0.05em;">yah.mobile</h1>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 18px; color: #111; margin: 0 0 16px;">eSIMの発行が完了しました ✓</h2>
      <p style="color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 16px;">
        お待たせしました。eSIMの発行が完了しました。<br>
        マイページからQRコードをご確認いただき、設定を行ってください。
      </p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 16px; margin: 0 0 24px;">
        <p style="color: #166534; font-size: 13px; margin: 0;">
          ✅ 注文番号 #${opts.orderId} のeSIMが発行されました。
        </p>
      </div>
      <a href="https://yah.mobi/mypage" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 4px; font-size: 14px; font-weight: 500;">
        マイページでQRコードを確認する
      </a>
      <p style="color: #aaa; font-size: 12px; margin: 24px 0 0; line-height: 1.6;">
        このメールはyah.mobileからの自動送信です。<br>
        ご不明な点は <a href="https://yah.mobi/app#contact" style="color: #555;">サポートページ</a> よりお問い合わせください。
      </p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}
