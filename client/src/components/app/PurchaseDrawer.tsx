/**
 * PurchaseDrawer.tsx — ピュアBaaS直線モデル（設計書準拠）
 *
 * 購入フロー:
 *   フロント → Firestore /orders に addDoc (status: "pending")
 *   → onOrderCreated トリガーが Stripe Checkout Session を生成して checkoutUrl を書き戻す
 *   → onSnapshot が checkoutUrl を検知 → window.location.href でリダイレクト
 *
 * プロフィール更新:
 *   フロント → Firestore /users/{uid} を updateDoc で直接更新
 *
 * Callable Functions: ordersInitCheckout / userUpdateProfile / EmbeddedCheckout を廃止
 */
import { useState, useEffect, useMemo } from "react";

import { motion, AnimatePresence } from "framer-motion";
import { X, LogIn, CheckCircle2 } from "lucide-react";
import { Drawer, DrawerContent, DrawerClose, DrawerTitle } from "@/components/ui/drawer";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { safeUrl } from "@/lib/utils";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { NATIONALITIES } from "@shared/const";
import {
  type PlanOption,
  getPlanDays,
  groupPlansByDays,
  parsePlanId,
  labelStyle,
  bodyStyle,
} from "./types";
import { useCurrency } from "./purchase-drawer/useCurrency";
import { usePurchaseCheckout } from "./purchase-drawer/usePurchaseCheckout";
import type { FsPlan } from "../../../../shared/types";

interface PurchaseDrawerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPlanId?: string;
  initialStep?: number;
  initialOrderId?: string;
}

export default function PurchaseDrawer({ open, onOpenChange, initialPlanId, initialStep, initialOrderId }: PurchaseDrawerProps) {
  const { t } = useTranslation();

  // BaaSネイティブ: plansList Callable を廃止し Firestore 直接参照
  const plansQuery = useMemo(
    () => query(collection(getFirebaseDb(), "plans"), where("isActive", "==", true)),
    []
  );
  const { data: dbPlans = [] } = useFirestoreCollection<any>(() => plansQuery, [plansQuery], { realtime: false });
  const sortedPlans = useMemo(() => {
    return [...dbPlans].sort((a: any, b: any) => {
      const aVal = a.sortOrder !== undefined ? a.sortOrder : (a.createdAt || 0);
      const bVal = b.sortOrder !== undefined ? b.sortOrder : (b.createdAt || 0);
      return aVal - bVal;
    });
  }, [dbPlans]);
  const planOptions = useMemo(() => groupPlansByDays(sortedPlans as FsPlan[]), [sortedPlans]);

  // 日数リスト (7, 15, 30) を生成
  const planDays = useMemo(() => getPlanDays(sortedPlans as FsPlan[]), [sortedPlans]);
  const parsed = parsePlanId(initialPlanId, planOptions);

  const [step, setStep] = useState(0);
  const defaultDay = planDays[0] ?? 7;
  const [drawerDays, setDrawerDays] = useState<number>(parsed.days ?? defaultDay);
  const [drawerGb, setDrawerGb] = useState<string | null>(parsed.gb ?? null);
  const [esimOrderId, setEsimOrderId] = useState<string | undefined>(initialOrderId);

  // 通貨選択・価格フォーマット（レート購読を含む）
  const { currency, setCurrency, AVAILABLE_CURRENCIES, formatPrice } = useCurrency();

  // initialOrderIdが変わったら同期
  useEffect(() => {
    if (initialOrderId !== undefined) setEsimOrderId(initialOrderId);
  }, [initialOrderId]);

  // initialStepが変わったら同期
  useEffect(() => {
    if (initialStep !== undefined && open) setStep(initialStep);
  }, [initialStep, open]);

  const { user, isAuthenticated, loading } = useAuth();

  // eSIMデータ取得（Step 7用）— BaaSネイティブ: Firestore 直接購読
  const esimQuery = useMemo(
    () => esimOrderId
      ? query(collection(getFirebaseDb(), "esim_links"), where("orderId", "==", esimOrderId), limit(1))
      : null,
    [esimOrderId]
  );
  const { data: esimLinks, isLoading: esimLoading } = useFirestoreCollection<any>(
    () => esimQuery!,
    [esimQuery],
    { realtime: true, enabled: isAuthenticated && step === 6 && esimOrderId !== undefined && esimQuery !== null }
  );
  const esimLink = esimLinks[0] ?? null;

  // 過去の注文を取得（リピーター用）
  const lastOrderQuery = useMemo(
    () => user ? query(collection(getFirebaseDb(), "orders"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(1)) : null,
    [user]
  );
  const { data: lastOrders } = useFirestoreCollection<any>(
    () => lastOrderQuery!,
    [lastOrderQuery],
    { realtime: false, enabled: isAuthenticated && lastOrderQuery !== null }
  );
  const lastOrder = lastOrders?.[0] ?? null;

  // 過去の注文からプラン情報を復元
  const lastPlanOpt = useMemo(() => {
    if (!lastOrder || !lastOrder.planId) return null;
    for (const d of Object.keys(planOptions).map(Number)) {
      const opt = planOptions[d].find((o: PlanOption) => o.planId === lastOrder.planId || o.bappyPlanId === lastOrder.bappyPlanId);
      if (opt) return { days: d, opt };
    }
    return null;
  }, [lastOrder, planOptions]);



  // Profile logic removed

  const drawerStepLabels: string[] = (t("drawer.stepLabels", { returnObjects: true }) as string[]);

  useEffect(() => {
    const p = parsePlanId(initialPlanId, planOptions);
    setDrawerDays(p.days ?? 7);
    setDrawerGb(p.gb ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlanId, sortedPlans]);

  const handleOpenChange = (v: boolean) => {
    if (v) {
      if (initialStep !== undefined) {
        setStep(initialStep);
        onOpenChange(v);
        return;
      }
      const p = parsePlanId(initialPlanId, planOptions);
      if (p.days && p.gb) setStep(2);
      else if (p.days) setStep(1);
      else setStep(0);
    }
    onOpenChange(v);
  };

  // handleProfileContinue removed

  const currentOpt = drawerGb
    ? (planOptions[drawerDays] ?? []).find((o: PlanOption) => o.gb === drawerGb)
    : null;

  // 同意状態＋決済処理（ordersInitCheckout→リダイレクト）を集約
  const {
    termsConsented, setTermsConsented,
    privacyConsented, setPrivacyConsented,
    marketingConsented, setMarketingConsented,
    refundConsented, setRefundConsented,
    termsConsentError, setTermsConsentError,
    privacyConsentError, setPrivacyConsentError,
    refundConsentError, setRefundConsentError,
    purchaseError, isPurchasing, handlePurchase,
  } = usePurchaseCheckout(currentOpt ?? null, user);

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
      <DrawerContent className="bg-white max-h-[92vh] flex flex-col">
        <DrawerTitle className="sr-only">{t("drawer.title")}</DrawerTitle>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#D7D7D7] shrink-0">
          <div>
            <p className="text-label text-black/35 mb-1">{t("drawer.title")}</p>
            <p className="font-sans font-light text-black text-[1.25rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.subtitle")}</p>
          </div>
          <DrawerClose asChild>
            <button
              className="w-9 h-9 flex items-center justify-center border border-[#D7D7D7] hover:border-black transition-colors"
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.5} className="text-black" />
            </button>
          </DrawerClose>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-6 py-4 border-b border-[#D7D7D7] shrink-0">
          {drawerStepLabels.map((s, i) => (
            <div key={i} className="flex items-center">
              <div className="flex items-center gap-1.5">
                <span
                  className={`font-sans font-medium w-5 h-5 flex items-center justify-center text-[9px] border transition-colors ${
                    i === step
                      ? "border-black bg-black text-white"
                      : i < step
                        ? "border-[#D7D7D7] bg-[#D7D7D7] text-black"
                        : "border-[#D7D7D7] text-black/25"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span
                  className={`hidden sm:block text-label text-[10px] transition-colors ${
                    i === step ? "text-black" : i < step ? "text-black/40" : "text-black/20"
                  }`}
                >
                  {s}
                </span>
              </div>
              {i < drawerStepLabels.length - 1 && (
                <div className={`w-4 sm:w-6 h-px mx-1 ${i < step ? "bg-[#D7D7D7]" : "bg-[#EBEBEB]"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            >
              {/* Step 0: Duration */}
              {step === 0 && (
                <div>
                  <p className="text-label text-black/35 mb-2">{t("drawer.stepOf", { current: 1, total: 3 })}</p>
                  <h2 className="font-sans font-light text-black mb-2 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.durationTitle")}</h2>
                  <p className="font-sans text-black/50 mb-8 text-[0.875rem] leading-[1.7]">{t("drawer.durationDesc")}</p>

                  {lastPlanOpt && (
                    <div className="mb-8 p-5 border border-black bg-black text-white">
                      <p className="text-label text-white/50 mb-3" style={{ fontSize: "0.6875rem", letterSpacing: "0.15em" }}>
                        ★ {t("drawer.previousPlan", "前回と同じプランを再購入")}
                      </p>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-sans font-medium text-[1.25rem]">
                            {lastPlanOpt.days} {t("drawer.days")} / {lastPlanOpt.opt.gb}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setDrawerDays(lastPlanOpt.days);
                            setDrawerGb(lastPlanOpt.opt.gb);
                            setStep(2);
                          }}
                          className="text-label px-5 py-2.5 bg-white text-black hover:bg-[#F7F7F7] transition-colors"
                        >
                          {t("drawer.buyAgain", "再購入")}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-px bg-[#D7D7D7] mb-8">
                    {planDays.map((d) => (
                      <button
                        key={d}
                        onClick={() => { setDrawerDays(d); setDrawerGb(null); setStep(1); }}
                        className="relative text-left bg-white p-5 transition-colors duration-150 hover:bg-[#F7F7F7] active:scale-[0.98]"
                      >
                        <p className="font-sans font-light text-black text-[1.5rem] tracking-[-0.02em]">{d}</p>
                        <p className="font-sans text-black/40 mt-0.5 text-[0.8125rem]">{t("drawer.days")}</p>
                      </button>
                    ))}
                  </div>
                  <DrawerClose asChild><button className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.back")}</button></DrawerClose>
                </div>
              )}

              {/* Step 1: Data (GB) */}
              {step === 1 && (
                <div>
                  <p className="text-label text-black/35 mb-2">{t("drawer.stepOf", { current: 2, total: 3 })}</p>
                  <h2 className="font-sans font-light text-black mb-1 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.dataTitle")}</h2>
                  <p className="font-sans text-black/50 mb-8 text-[0.875rem] leading-[1.7]">{t("drawer.dataDesc", { days: drawerDays })}</p>
                  <div className="grid grid-cols-2 gap-px bg-[#D7D7D7] mb-8">
                    {(planOptions[drawerDays] ?? []).map((opt: PlanOption) => (
                      <button
                        key={opt.gb}
                        onClick={() => { setDrawerGb(opt.gb); setStep(2); }}
                        className="relative text-left bg-white p-5 transition-colors duration-150 hover:bg-[#F7F7F7] active:scale-[0.98]"
                      >
                        {opt.popular && (
                          <p className="font-sans font-medium text-black mb-1 text-[0.55rem] tracking-[0.22em] uppercase">{t("drawer.popular")}</p>
                        )}
                        <p className="font-sans font-light text-black text-[1.5rem] tracking-[-0.02em]">{opt.gb}</p>
                        <p className="font-sans text-black/40 mt-0.5 text-[0.8125rem]">{t("drawer.dataUnit")}</p>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setStep(0)} className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.back")}</button>
                </div>
              )}

              {/* Step 2: Price confirmation */}
              {step === 2 && currentOpt && (
                <div>
                  <p className="text-label text-black/35 mb-2">{t("drawer.stepOf", { current: 3, total: 3 })}</p>
                  <h2 className="font-sans font-light text-black mb-8 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.confirmTitle")}</h2>
                  <div className="border border-black p-6 mb-8">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <p className="text-label text-black/35 mb-1">{t("drawer.duration")}</p>
                        <p className="font-sans font-light text-black text-[1.25rem]">{drawerDays} {t("drawer.days")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-label text-black/35 mb-1">{t("drawer.data")}</p>
                        <p className="font-sans font-light text-black text-[1.25rem]">{currentOpt.gb}</p>
                      </div>
                    </div>
                    <div className="border-t border-[#D7D7D7] pt-5">
                      <p className="text-label text-black/35 mb-1">{t("drawer.price")}</p>
                      <p className="font-sans font-light text-black text-[2.5rem] tracking-[-0.03em]">¥{currentOpt.priceJpy.toLocaleString()}</p>
                      <p className="font-sans text-black/35 mt-1 text-[0.75rem]">{t("drawer.taxIncluded")}</p>
                      <div className="flex gap-2 mt-4 flex-wrap">
                        {AVAILABLE_CURRENCIES.map((c) => (
                          <button
                            key={c}
                            onClick={() => setCurrency(c)}
                            className={`font-sans font-medium text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors duration-150 ${
                              currency === c ? "bg-black text-white border-black" : "bg-white text-black/50 border-[#D7D7D7] hover:border-black/50"
                            }`}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      {currency !== "JPY" && (
                        <p className="font-sans mt-2 text-black/50 text-[0.8125rem]">
                          {t("plans.approxRate")} {formatPrice(currentOpt.priceJpy)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(1)} className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.back")}</button>
                    <button
                      onClick={() => isAuthenticated ? setStep(4) : setStep(3)}
                      className="text-label flex-1 py-3.5 bg-black text-white hover:bg-black/80 transition-colors duration-200 active:scale-[0.97]"
                    >
                      {t("drawer.continueToPayment")}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Login */}
              {step === 3 && (
                <div>
                  <h2 className="font-sans font-light text-black mb-2 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.signInTitle")}</h2>
                  <p className="font-sans text-black/50 mb-8 text-[0.875rem] leading-[1.7]">
                    {t("drawer.signInDesc")}
                  </p>
                  {loading ? (
                    <div className="flex items-center gap-3 py-8">
                      <div className="w-4 h-4 border border-black/30 border-t-black rounded-full animate-spin" />
                      <p className="font-sans text-black/40 text-[0.875rem]">{t("drawer.checkingLogin")}</p>
                    </div>
                  ) : isAuthenticated && user ? (
                    <div>
                      <div className="border border-[#D7D7D7] p-5 mb-6 flex items-center gap-4">
                        <div className="font-sans font-semibold w-10 h-10 rounded-full bg-black flex items-center justify-center text-white text-[0.8125rem] shrink-0">
                          {(user.name ?? user.email ?? "?").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-sans font-medium text-black text-[0.9rem] truncate">{user.name ?? "—"}</p>
                          <p className="font-sans text-black/40 text-[0.8125rem] truncate">{user.email ?? "—"}</p>
                        </div>
                        <CheckCircle2 size={20} className="text-black shrink-0" strokeWidth={1.5} />
                      </div>
                      <div className="flex gap-3"><button onClick={() => setStep(2)} className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.back")}</button><button
                        onClick={() => setStep(4)}
                        className="text-label flex-1 py-3.5 bg-black text-white hover:bg-black/80 transition-colors duration-200 active:scale-[0.97]"
                      >
                        {t("drawer.continueBtn")}
                      </button></div>
                    </div>
                  ) : (
                    <div>
                      <div className="border border-[#D7D7D7] p-7 mb-6 text-center">
                        <div className="flex justify-center mb-4">
                          <div className="w-12 h-12 border border-[#D7D7D7] rounded-full flex items-center justify-center">
                            <LogIn size={22} strokeWidth={1.25} className="text-black/60" />
                          </div>
                        </div>
                        <p className="font-sans font-medium text-black text-[0.9375rem] mb-1">{t("drawer.signInWithAccount")}</p>
                        <p className="font-sans text-black/45 text-[0.875rem] leading-[1.7] mb-6">{t("drawer.secureLogin")}</p>
                        <a
                          href={`/login?redirect=${encodeURIComponent(initialPlanId ? `/app?open=true&plan=${encodeURIComponent(initialPlanId)}` : "/app?open=true")}`}
                          className="flex items-center justify-center gap-3 w-full py-3.5 bg-black text-white hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] text-center"
                        >
                          <span className="font-sans text-[0.875rem] font-medium tracking-[0.1em]">{t("drawer.signInBtn")}</span>
                        </a>
                        <p className="font-sans text-black/35 text-[0.6875rem] leading-[1.6] mt-3 text-center">
                          {t("drawer.loginConsent")}{" "}
                          <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black/60 transition-colors">{t("footer.terms")}</a>
                          {" "}{t("drawer.loginConsentAnd")}{" "}
                          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-black/60 transition-colors">{t("footer.privacy")}</a>
                          {t("drawer.loginConsentSuffix")}
                        </p>
                      </div>
                      <div className="border-t border-[#D7D7D7] pt-5">
                        {[t("drawer.benefit1"), t("drawer.benefit2"), t("drawer.benefit3")].map((b, i) => (
                          <div key={i} className="flex items-start gap-3 py-3 border-b border-[#D7D7D7]">
                            <span className="font-sans text-black/25 text-[0.6875rem] tracking-[0.1em] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                            <p className="font-sans text-black/60 text-[0.875rem] leading-[1.7]">{b}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Payment (Consent + Firestore addDoc → onOrderCreated trigger → redirect) */}
              {step === 4 && (
                <div>
                  <h2 className="font-sans font-light text-black mb-2 text-[1.375rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.paymentTitle")}</h2>
                  <p className="font-sans text-black/50 mb-6 text-[0.875rem] leading-[1.7]">{t("drawer.paymentDesc")}</p>
                  <div className="border border-[#D7D7D7] p-5 mb-5">
                    <p className="text-label text-black/35 mb-3">{t("drawer.orderSummary")}</p>
                    {currentOpt && (
                      <>
                        <div className="flex justify-between items-end">
                          <div>
                            <p className="font-sans font-medium text-black text-[0.9rem]">{currentOpt.gb} / {drawerDays} {t("drawer.days")}</p>
                            <p className="font-sans text-black/40 text-[0.8125rem]">{t("drawer.japanEsim")}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-sans font-light text-black text-[1.5rem] leading-[1.15] tracking-[-0.02em]">¥{currentOpt.priceJpy.toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-5 flex-wrap border-t border-[#D7D7D7] pt-4">
                          {AVAILABLE_CURRENCIES.map((c) => (
                            <button
                              key={c}
                              onClick={() => setCurrency(c)}
                              className={`font-sans font-medium text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors duration-150 ${
                                currency === c ? "bg-black text-white border-black" : "bg-white text-black/50 border-[#D7D7D7] hover:border-black/50"
                              }`}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                        {currency !== "JPY" && (
                          <p className="font-sans mt-2 text-black/50 text-[0.8125rem]">
                            {t("plans.approxRate")} {formatPrice(currentOpt.priceJpy)}
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* 利用規約同意 */}
                  <label className={`flex items-start gap-3 p-4 border cursor-pointer mb-3 transition-colors ${termsConsentError ? "border-red-400 bg-red-50" : "border-[#D7D7D7] hover:border-black/40"}`}>
                    <div className="relative shrink-0 mt-0.5">
                      <input type="checkbox" checked={termsConsented} onChange={(e) => { setTermsConsented(e.target.checked); if (e.target.checked) setTermsConsentError(false); }} className="sr-only" />
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${termsConsented ? "bg-black border-black" : "bg-white border-[#D7D7D7]"}`}>
                        {termsConsented && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                    <p className="font-sans text-black/70 text-[0.8125rem] leading-[1.65]">
                      {t("drawer.termsConsentLabel")}{" "}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-black transition-colors" onClick={(e) => e.stopPropagation()}>{t("footer.terms")}</a>
                    </p>
                  </label>
                  {termsConsentError && <p className="font-sans text-red-600 text-[0.75rem] mb-3 -mt-1">{t("drawer.termsConsentRequired")}</p>}

                  {/* プライバシーポリシー同意 */}
                  <label className={`flex items-start gap-3 p-4 border cursor-pointer mb-3 transition-colors ${privacyConsentError ? "border-red-400 bg-red-50" : "border-[#D7D7D7] hover:border-black/40"}`}>
                    <div className="relative shrink-0 mt-0.5">
                      <input type="checkbox" checked={privacyConsented} onChange={(e) => { setPrivacyConsented(e.target.checked); if (e.target.checked) setPrivacyConsentError(false); }} className="sr-only" />
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${privacyConsented ? "bg-black border-black" : "bg-white border-[#D7D7D7]"}`}>
                        {privacyConsented && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                    <p className="font-sans text-black/70 text-[0.8125rem] leading-[1.65]">
                      {t("drawer.privacyConsentLabel")}{" "}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-black transition-colors" onClick={(e) => e.stopPropagation()}>{t("footer.privacy")}</a>
                    </p>
                  </label>
                  {privacyConsentError && <p className="font-sans text-red-600 text-[0.75rem] mb-3 -mt-1">{t("drawer.privacyConsentRequired")}</p>}

                  {/* マーケティングメール同意（任意）*/}
                  <label className="flex items-start gap-3 p-4 border border-[#D7D7D7] cursor-pointer mb-4 hover:border-black/40 transition-colors">
                    <div className="relative shrink-0 mt-0.5">
                      <input type="checkbox" checked={marketingConsented} onChange={(e) => setMarketingConsented(e.target.checked)} className="sr-only" />
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${marketingConsented ? "bg-black border-black" : "bg-white border-[#D7D7D7]"}`}>
                        {marketingConsented && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                    <p className="font-sans text-black/50 text-[0.8125rem] leading-[1.65]">
                      {t("drawer.marketingConsentLabel")}{" "}
                      <span className="text-black/30 text-[0.75rem]">({t("drawer.optional")})</span>
                    </p>
                  </label>

                  {/* 返金不可同意 */}
                  <label className={`flex items-start gap-3 p-4 border cursor-pointer mb-4 transition-colors ${refundConsentError ? "border-red-400 bg-red-50" : "border-[#D7D7D7] hover:border-black/40"}`}>
                    <div className="relative shrink-0 mt-0.5">
                      <input type="checkbox" checked={refundConsented} onChange={(e) => { setRefundConsented(e.target.checked); if (e.target.checked) setRefundConsentError(false); }} className="sr-only" />
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${refundConsented ? "bg-black border-black" : "bg-white border-[#D7D7D7]"}`}>
                        {refundConsented && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                    <p className="font-sans text-black/70 text-[0.8125rem] leading-[1.65]">
                      {t("drawer.refundConsentLabel")}
                    </p>
                  </label>
                  {refundConsentError && <p className="font-sans text-red-600 text-[0.75rem] mb-3 -mt-2">{t("drawer.refundConsentRequired")}</p>}

                  {purchaseError && (
                    <div className="border border-red-200 bg-red-50 p-4 mb-4">
                      <p className="font-sans text-red-700 text-[0.8125rem]">{purchaseError}</p>
                    </div>
                  )}

                  {/* isPurchasing 中は Stripe へのリダイレクト待機を表示 */}
                  {isPurchasing ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-4">
                      <div className="w-10 h-10 border border-[#D7D7D7] rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-black/60 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                      </div>
                      <p className="font-sans font-medium text-black text-[0.9rem]">{t("drawer.securingPayment", "安全な決済ページを準備しています")}</p>
                      <p className="font-sans text-black/40 text-[0.75rem]">{t("drawer.securingPaymentSub", "このまま少々お待ちください…")}</p>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setStep(2)}
                        className="text-label px-5 py-3.5 border border-[#D7D7D7] text-black hover:border-black transition-colors"
                      >
                        {t("drawer.back")}
                      </button>
                      <button
                        onClick={handlePurchase}
                        className="text-label flex-1 py-3.5 bg-black text-white hover:bg-black/80 transition-colors duration-200 active:scale-[0.97] flex items-center justify-center gap-2"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                          <line x1="1" y1="10" x2="23" y2="10" />
                        </svg>
                        {t("drawer.proceedToPayment")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Complete */}
              {step === 5 && (
                <div>
                  <div className="w-9 h-9 bg-black flex items-center justify-center mb-7">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <h2 className="font-sans font-light text-black mb-2 text-[1.5rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.completeTitle")}</h2>
                  <p className="font-sans text-black/50 mb-8 text-[0.9rem] leading-[1.7]">
                    {t("drawer.completeDesc")}
                  </p>
                  <div className="border-t border-[#D7D7D7] mb-6">
                    {[
                      t("drawer.completeStep1"),
                      t("drawer.completeStep2"),
                      t("drawer.completeStep3"),
                      t("drawer.completeStep4"),
                    ].map((ins, i) => (
                      <div key={i} className="flex gap-4 py-4 border-b border-[#D7D7D7]">
                        <span className="font-sans text-black/25 text-[0.6875rem] tracking-[0.1em] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                        <p className="font-sans text-black/70 text-[0.875rem] leading-[1.7]">{ins}</p>
                      </div>
                    ))}
                  </div>
                  <DrawerClose asChild>
                    <button className="text-label px-6 py-3 border border-[#D7D7D7] text-black hover:border-black transition-colors">{t("drawer.close")}</button>
                  </DrawerClose>
                </div>
              )}

              {/* Step 6: eSIM QR Code */}
              {step === 6 && (
                <div>
                  {(esimLoading || !esimLink) ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-4">
                      <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <p className="font-sans text-black/40 text-[0.875rem]">{t("drawer.preparingEsim", "Preparing your eSIM...")}</p>
                    </div>
                  ) : (
                    <div>
                      <div className="w-9 h-9 bg-black flex items-center justify-center mb-7">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <h2 className="font-sans font-light text-black mb-1 text-[1.5rem] leading-[1.15] tracking-[-0.02em]">{t("drawer.esimReadyTitle", "Your eSIM is ready.")}</h2>
                      <p className="font-sans text-black/50 mb-8 text-[0.875rem] leading-[1.7]">{t("drawer.esimReadyDesc", "Scan the QR code with your phone to activate.")}</p>
                      <div className="flex justify-center mb-6">
                        <div className="border border-[#D7D7D7] p-4 inline-block">
                          {esimLink.qrCodeUrl ? (
                            <img src={safeUrl(esimLink.qrCodeUrl)} alt="QR Code" className="w-[220px] h-[220px]" />
                          ) : (
                            <div className="w-[220px] h-[220px] flex items-center justify-center bg-black/5">
                              <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3 mb-6">
                        {esimLink.appleActivationUrl && (
                          <a href={safeUrl(esimLink.appleActivationUrl)} className="flex-1 text-center text-label py-3 border border-[#D7D7D7] text-black hover:border-black transition-colors text-[0.75rem]">
                            {t("drawer.esimActivateIos")}
                          </a>
                        )}
                        {esimLink.androidActivationUrl && (
                          <a href={safeUrl(esimLink.androidActivationUrl)} className="flex-1 text-center text-label py-3 border border-[#D7D7D7] text-black hover:border-black transition-colors text-[0.75rem]">
                            {t("drawer.esimActivateAndroid")}
                          </a>
                        )}
                      </div>
                      <div className="border border-[#D7D7D7] p-4 mb-6">
                        <p className="text-label text-black/35 mb-1">{t("drawer.esimIccid")}</p>
                        <p className="font-mono text-black text-[0.8125rem] tracking-wider break-all">{esimLink.iccid}</p>
                      </div>
                      <DrawerClose asChild>
                        <button className="text-label px-6 py-3 border border-[#D7D7D7] text-black hover:border-black transition-colors w-full">{t("drawer.close")}</button>
                      </DrawerClose>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
