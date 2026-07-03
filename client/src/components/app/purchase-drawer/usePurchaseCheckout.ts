import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCallableMutation, CALLABLE } from "@/lib/callable";
import { getFirebaseDb } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import type { PlanOption } from "../types";

type CheckoutUser = { uid: string; email?: string | null } | null;

/**
 * 購入フローの同意状態と決済処理（ordersInitCheckout 呼び出し→checkoutUrl リダイレクト）を集約する。
 * step4 の同意UIと購入ボタンから利用する。
 */
export function usePurchaseCheckout(currentOpt: PlanOption | null, user: CheckoutUser) {
  const { t } = useTranslation();

  const [refundConsented, setRefundConsented] = useState(false);
  const [refundConsentError, setRefundConsentError] = useState(false);
  const [termsConsented, setTermsConsented] = useState(false);
  const [privacyConsented, setPrivacyConsented] = useState(false);
  const [marketingConsented, setMarketingConsented] = useState(false);
  const [termsConsentError, setTermsConsentError] = useState(false);
  const [privacyConsentError, setPrivacyConsentError] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);

  const initCheckout = useCallableMutation<{
    bappyPlanId: string;
    origin: string;
    termsConsented: boolean;
    privacyConsented: boolean;
    marketingConsented: boolean;
    timezone?: string;
  }, { checkoutUrl: string; orderId: string }>(CALLABLE.ordersInitCheckout);

  const handlePurchase = useCallback(async () => {
    if (!currentOpt || !user) return;
    let hasError = false;
    if (!termsConsented) { setTermsConsentError(true); hasError = true; }
    if (!privacyConsented) { setPrivacyConsentError(true); hasError = true; }
    if (!refundConsented) { setRefundConsentError(true); hasError = true; }
    if (hasError) return;

    setPurchaseError(null);
    setIsPurchasing(true);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await initCheckout.mutateAsync({
        bappyPlanId: currentOpt.bappyPlanId || currentOpt.planId,
        origin: window.location.origin,
        termsConsented,
        privacyConsented,
        marketingConsented,
        timezone,
      });

      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        setPurchaseError(t("drawer.paymentError", "Payment initialization failed. Please try again."));
        setIsPurchasing(false);
      }
    } catch (err: any) {
      if (err?.code === "permission-denied" || err?.message?.includes("permission-denied")) {
        // Verify if the email is actually allowed
        try {
          if (user?.email) {
            const emailDoc = await getDoc(doc(getFirebaseDb(), "allowed_emails", user.email.toLowerCase()));
            if (emailDoc.exists()) {
              // Email is registered, so the permission denied must be a different system rule failure
              setPurchaseError(t("drawer.systemError", "A system error occurred. Please try again or contact support."));
            } else {
              // Email is actually not registered
              setPurchaseError(t("drawer.emailNotAllowed", "Pre-registration is required to purchase. Please contact us via contact form or chat."));
            }
          } else {
            setPurchaseError(t("drawer.emailNotAllowed", "Pre-registration is required to purchase. Please contact us via contact form or chat."));
          }
        } catch (checkErr) {
          setPurchaseError(t("drawer.systemError", "A system error occurred. Please try again or contact support."));
        }
      } else {
        setPurchaseError(t("drawer.systemError", "A system error occurred. Please try again or contact support."));
      }
      setIsPurchasing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOpt, user, termsConsented, privacyConsented, refundConsented, marketingConsented, t]);

  return {
    termsConsented, setTermsConsented,
    privacyConsented, setPrivacyConsented,
    marketingConsented, setMarketingConsented,
    refundConsented, setRefundConsented,
    termsConsentError, setTermsConsentError,
    privacyConsentError, setPrivacyConsentError,
    refundConsentError, setRefundConsentError,
    purchaseError, isPurchasing, handlePurchase,
  };
}
