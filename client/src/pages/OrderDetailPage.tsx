import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { onSnapshot, doc, getDoc, collection, query, where, updateDoc, serverTimestamp, QuerySnapshot, DocumentData } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { safeUrl } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { deriveEsimStatus } from "@/components/mypage/esimStatus";
import { EsimQr } from "@/components/EsimQr";

import { DataUsageBar } from "@/components/DataUsageBar";
import type { FsOrder, FsEsimLink } from "../../../shared/types";

function detectDevice(): "ios" | "android" | "other" {
  if (typeof window === "undefined") return "other";
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(userAgent)) return "ios";
  if (/android/.test(userAgent)) return "android";
  return "other";
}

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  const { orderId } = params;
  const { user, isAuthenticated, loading } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<null | "timeout" | "error">(null);
  const syncBaselineRef = useRef<number | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const device = detectDevice();

  const [order, setOrder] = useState<FsOrder | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = onSnapshot(doc(getFirebaseDb(), "orders", orderId), (snap) => {
      setOrder(snap.exists() ? ({ id: snap.id, ...snap.data() } as FsOrder) : null);
      setOrderLoading(false);
    });
    return unsub;
  }, [orderId, isAuthenticated]);

  const [esimLink, setEsimLink] = useState<FsEsimLink | null>(null);
  const [esimLoading, setEsimLoading] = useState(true);

  useEffect(() => {
    if (!order) return;
    const q = query(collection(getFirebaseDb(), "esim_links"), where("orderId", "==", orderId));
    const unsub = onSnapshot(q, (snap: QuerySnapshot<DocumentData>) => {
      setEsimLink(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as FsEsimLink));
      setEsimLoading(false);
    });
    return unsub;
  }, [orderId, order]);

  // 期限「常に表示」用：未有効化時は plan.validityDays を表示するため注文の planId から取得
  const [validityDays, setValidityDays] = useState<number | null>(null);
  useEffect(() => {
    const planId = order?.planId;
    if (!planId) { setValidityDays(null); return; }
    getDoc(doc(getFirebaseDb(), "plans", planId))
      .then((snap) => setValidityDays(snap.exists() ? ((snap.data() as { validityDays?: number }).validityDays ?? null) : null))
      .catch(() => setValidityDays(null));
  }, [order]);

  const handleSync = useCallback(async () => {
    if (!esimLink?.id || isSyncing) return;
    // 同期完了の判定基準：現在の updatedAt。トリガーが Bappy から取得して updatedAt を進めるまで待つ。
    syncBaselineRef.current = esimLink.updatedAt ?? 0;
    setSyncMsg(null);
    setIsSyncing(true);
    if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
    hardTimeoutRef.current = setTimeout(() => {
      if (settleRef.current) clearTimeout(settleRef.current);
      setIsSyncing(false);
      setSyncMsg("timeout");
    }, 15000);
    try {
      // Rules は syncRequestedAt / updatedAt == request.time（Timestamp）を要求するため
      // クライアント時刻ではなく serverTimestamp() を使う（両方必須）
      await updateDoc(doc(getFirebaseDb(), "esim_links", esimLink.id), {
        syncRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("[handleSync] Failed to request eSIM sync:", err);
      if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
      setIsSyncing(false);
      setSyncMsg("error");
    }
  }, [esimLink?.id, esimLink?.updatedAt, isSyncing]);

  // updatedAt が基準を越えたら（＝onSnapshot で新データ到着）、少し待って（完了書き込みを拾って）Syncing を解除
  useEffect(() => {
    if (!isSyncing) return;
    const cur = esimLink?.updatedAt ?? null;
    const base = syncBaselineRef.current;
    if (cur == null || base == null || cur <= base) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
      setIsSyncing(false);
    }, 2500);
  }, [esimLink?.updatedAt, isSyncing]);

  useEffect(() => () => {
    if (settleRef.current) clearTimeout(settleRef.current);
    if (hardTimeoutRef.current) clearTimeout(hardTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (order?.status === "fulfilled") {
      handleSync();
    }
  }, [order?.status]);

  useEffect(() => {
    if (order?.status !== "provisioning") return;
    let elapsed = 0;
    pollingRef.current = setInterval(async () => {
      elapsed += 5;
      if (elapsed >= 60 && pollingRef.current) {
        clearInterval(pollingRef.current);
        await handleSync();
      }
    }, 5000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [order?.status, handleSync]);

  if (loading || orderLoading || esimLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Nav />
        <main className="flex-1 flex justify-center items-center">
          <Spinner />
        </main>
        <Footer />
      </div>
    );
  }

  if (!isAuthenticated || !order) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <Nav />
        <main className="flex-1 flex justify-center items-center">
          <div className="text-center py-24">
            <p className="font-sans text-black/20 mb-4 text-[4rem] font-light leading-none">?</p>
            <p className="font-sans text-black/40 mb-8 text-base">Order not found.</p>
            <Link href="/mypage">
              <span className="text-label inline-block bg-black text-white px-8 py-3.5 text-[0.75rem] hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] cursor-pointer">
                Back to My Page
              </span>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const date = new Date(order.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const expiryDisplay = esimLink?.expiryDate
    ? new Date(esimLink.expiryDate).toLocaleString("en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;
  const activatedDisplay = esimLink?.lastActiveAt
    ? new Date(esimLink.lastActiveAt).toLocaleString("en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;
  const esimStatus = esimLink ? deriveEsimStatus(esimLink) : null;

  const rows = [
    { label: "Plan",       value: order.planName ?? "Japan eSIM" },
    { label: "Amount",     value: `¥${order.amountJpy?.toLocaleString()}` },
    { label: "Status",     value: <StatusBadge status={order.status} /> },
    { label: "Order Date", value: date },
    ...(esimStatus ? [{ label: "eSIM Status", value: esimStatus.label }] : []),
    ...(activatedDisplay ? [{ label: "Activated", value: activatedDisplay }] : []),
    // 期限は常に表示：有効化済み→実期限日時、未有効化→有効期間（validityDays）
    ...(expiryDisplay
      ? [{ label: "Expires", value: expiryDisplay }]
      : validityDays
        ? [{ label: "Validity", value: `${validityDays} days · from activation` }]
        : []),
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Nav />

      <main className="flex-1 pt-24 pb-24">
        <div className="container max-w-3xl">
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            <Link href="/mypage">
              <span className="cursor-pointer font-sans flex items-center gap-2 text-black/40 hover:text-black transition-colors duration-200 mb-8 text-[0.8125rem]">
                ← Back to orders
              </span>
            </Link>

            <h2 className="font-sans font-light text-black mb-1 text-[clamp(1.5rem,3vw,2rem)] tracking-[-0.02em]">
              Order #{order.id}
            </h2>
            <p className="font-sans text-black/40 mb-8 text-sm">eSIM Details</p>

            <div className="border-t border-black/10 mb-8">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between py-4 border-b border-black/8 gap-4">
                  <span className="font-sans text-black/40 text-sm shrink-0">{row.label}</span>
                  <span className="font-sans text-black text-sm font-medium text-right">{row.value}</span>
                </div>
              ))}
            </div>

            {esimLink ? (
              <div className="mb-8 space-y-8">
                {esimLink.dataTotalMb != null && esimLink.dataRemainingMb != null && (
                  <div className="p-5 border border-black/10">
                    <DataUsageBar
                      remainingMb={esimLink.dataRemainingMb ?? 0}
                      totalMb={esimLink.dataTotalMb ?? 1}
                    />
                    <button
                      onClick={handleSync}
                      disabled={isSyncing}
                      className="font-sans mt-4 text-xs text-black/40 hover:text-black transition-colors duration-200 flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {isSyncing ? <Spinner className="size-3" /> : "↻"}
                      {isSyncing ? "Syncing…" : "Refresh data usage"}
                    </button>
                    <p className="font-sans text-black/30 text-[0.65rem] mt-1">
                      {syncMsg === "timeout"
                        ? "Still syncing — usage can take a few minutes to update."
                        : syncMsg === "error"
                          ? "Couldn't refresh. Please reload the app and try again."
                          : esimLink.updatedAt
                            ? `Last updated ${new Date(esimLink.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-label text-[0.6875rem] text-black/40 mb-4">Activate eSIM</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {esimLink.appleActivationUrl && (device === "ios" || device === "other") && (
                      <a
                        href={safeUrl(esimLink.appleActivationUrl)}
                        className="text-label text-[0.75rem] inline-flex items-center justify-center gap-2 bg-black text-white px-6 py-3.5 hover:bg-black/80 transition-colors duration-200 active:scale-[0.97]"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                        </svg>
                        Activate on iPhone
                      </a>
                    )}
                    {esimLink.androidActivationUrl && (device === "android" || device === "other") && (
                      <a
                        href={safeUrl(esimLink.androidActivationUrl)}
                        className="text-label text-[0.75rem] inline-flex items-center justify-center gap-2 border border-black text-black px-6 py-3.5 hover:bg-black hover:text-white transition-colors duration-200 active:scale-[0.97]"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                          <path d="M17.523 15.341a.75.75 0 0 1-.75.75H7.227a.75.75 0 0 1-.75-.75V8.659a.75.75 0 0 1 .75-.75h9.546a.75.75 0 0 1 .75.75v6.682zM6 6.5l-1.5-2.6M18 6.5l1.5-2.6M8.5 3.9l.5.866M15.5 3.9l-.5.866"/>
                        </svg>
                        Activate on Android
                      </a>
                    )}
                  </div>
                </div>

                {esimLink.lpaProfile && (
                  <div>
                    <p className="text-label text-[0.6875rem] text-black/40 mb-4">QR Code (Manual Scan)</p>
                    <div className="flex flex-col sm:flex-row gap-6 items-start">
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-48 h-48 sm:w-60 sm:h-60 rounded-[1.2rem] shadow-sm bg-white shrink-0 p-3 flex items-center justify-center"
                      >
                        <EsimQr value={esimLink.lpaProfile} size={240} className="w-full h-full" />
                      </motion.div>
                      <div className="flex-1">
                        <p className="font-sans text-black/40 text-xs mb-3 leading-[1.7]">
                          Open <strong>Settings → Mobile Data → Add eSIM</strong> and scan this QR code, or tap the activation button above.
                        </p>
                        <div className="p-3 bg-black/3 font-mono text-xs text-black/50 break-all">
                          <p className="text-label text-[0.55rem] text-black/30 mb-1">LPA Profile</p>
                          {esimLink.lpaProfile}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* 独立したTopupPageへのリンク */}
                {esimLink?.bappyLinkUuid && (
                  <div className="mt-6 border-t border-black/8 pt-6 flex justify-between items-center">
                    <div>
                      <p className="text-label text-[0.6875rem] text-black mb-1">Top-up Data</p>
                      <p className="font-sans text-black/40 text-xs">Need more data? Add a top-up plan.</p>
                    </div>
                    <Link href={`/mypage/topup/${esimLink.id}`}>
                      <span className="text-label text-[0.7rem] bg-black text-white px-5 py-2 hover:bg-black/80 transition-colors duration-200 cursor-pointer">
                        + Add Data
                      </span>
                    </Link>
                  </div>
                )}
              </div>
            ) : order.status === "provisioning" ? (
              <div className="p-6 bg-amber-50 mb-8 flex items-start gap-3">
                <div className="w-4 h-4 border-2 border-amber-400 border-t-amber-700 rounded-full animate-spin shrink-0 mt-0.5" />
                <div>
                  <p className="font-sans text-amber-700 text-sm font-medium mb-1">Provisioning your eSIM…</p>
                  <p className="font-sans text-amber-600 text-xs">This usually takes less than a minute. This page will update automatically.</p>
                </div>
              </div>
            ) : order.status === "failed" ? (
              <div className="p-6 bg-red-50 mb-8">
                <p className="font-sans text-red-700 text-sm font-medium mb-1">eSIM provisioning failed.</p>
                <p className="font-sans text-red-600 text-xs mb-4">A refund has been initiated automatically. Please contact support if you have questions.</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="text-label text-[0.6rem] inline-flex items-center gap-1.5 border border-red-300 text-red-600 px-4 py-2 hover:bg-red-100 transition-colors duration-200 disabled:opacity-40"
                  >
                    {isSyncing ? <Spinner className="size-3" /> : "↻"}
                    Retry sync
                  </button>
                  <a
                    href="/app#contact"
                    className="text-label text-[0.6rem] inline-block border border-red-300 text-red-600 px-4 py-2 hover:bg-red-100 transition-colors duration-200"
                  >
                    Contact support →
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-black/3 mb-8">
                <p className="font-sans text-black/50 text-sm">eSIM details will appear here once your payment is confirmed.</p>
              </div>
            )}

          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
