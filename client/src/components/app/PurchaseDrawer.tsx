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
import { X } from "lucide-react";
import { Drawer, DrawerContent, DrawerClose, DrawerTitle } from "@/components/ui/drawer";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  type PlanOption,
  getPlanDays,
  groupPlansByDays,
  parsePlanId,
} from "./types";
import { useCurrency } from "./purchase-drawer/useCurrency";
import { usePurchaseCheckout } from "./purchase-drawer/usePurchaseCheckout";
import { PurchaseDrawerContext, type PurchaseDrawerCtx } from "./purchase-drawer/context";
import { Step0Duration } from "./purchase-drawer/steps/Step0Duration";
import { Step1Data } from "./purchase-drawer/steps/Step1Data";
import { Step2Confirm } from "./purchase-drawer/steps/Step2Confirm";
import { Step3Login } from "./purchase-drawer/steps/Step3Login";
import { Step4Payment } from "./purchase-drawer/steps/Step4Payment";
import { Step5Complete } from "./purchase-drawer/steps/Step5Complete";
import { Step6Esim } from "./purchase-drawer/steps/Step6Esim";
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

  // 各ステップ部品へ渡す共有コンテキスト
  const ctxValue: PurchaseDrawerCtx = {
    step, setStep,
    drawerDays, setDrawerDays, drawerGb, setDrawerGb, planDays, planOptions, currentOpt, lastPlanOpt,
    currency, setCurrency, AVAILABLE_CURRENCIES, formatPrice,
    isAuthenticated, loading, user, initialPlanId,
    esimLink, esimLoading,
    termsConsented, setTermsConsented, termsConsentError, setTermsConsentError,
    privacyConsented, setPrivacyConsented, privacyConsentError, setPrivacyConsentError,
    marketingConsented, setMarketingConsented,
    refundConsented, setRefundConsented, refundConsentError, setRefundConsentError,
    purchaseError, isPurchasing, handlePurchase,
  };

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
              <PurchaseDrawerContext.Provider value={ctxValue}>
                {step === 0 && <Step0Duration />}
                {step === 1 && <Step1Data />}
                {step === 2 && <Step2Confirm />}
                {step === 3 && <Step3Login />}
                {step === 4 && <Step4Payment />}
                {step === 5 && <Step5Complete />}
                {step === 6 && <Step6Esim />}
              </PurchaseDrawerContext.Provider>
            </motion.div>
          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
