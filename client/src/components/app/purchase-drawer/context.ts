import { createContext, useContext } from "react";
import type { PlanOption } from "../types";
import type { FsUser } from "@shared/userTypes";

/** PurchaseDrawer の各ステップ部品が共有する状態・派生値・コールバック */
export interface PurchaseDrawerCtx {
  // ステップ制御
  step: number;
  setStep: (n: number) => void;

  // プラン選択
  drawerDays: number;
  setDrawerDays: (n: number) => void;
  drawerGb: string | null;
  setDrawerGb: (g: string | null) => void;
  planDays: number[];
  planOptions: Record<number, PlanOption[]>;
  currentOpt: PlanOption | null | undefined;
  lastPlanOpt: { days: number; opt: PlanOption } | null;

  // 通貨
  currency: string;
  setCurrency: (c: string) => void;
  AVAILABLE_CURRENCIES: string[];
  formatPrice: (jpy: number) => string;

  // 認証
  isAuthenticated: boolean;
  loading: boolean;
  user: FsUser | null;
  initialPlanId?: string;

  // eSIM（step 6）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  esimLink: any;
  esimLoading: boolean;

  // 同意・決済（step 4）
  termsConsented: boolean; setTermsConsented: (b: boolean) => void;
  termsConsentError: boolean; setTermsConsentError: (b: boolean) => void;
  privacyConsented: boolean; setPrivacyConsented: (b: boolean) => void;
  privacyConsentError: boolean; setPrivacyConsentError: (b: boolean) => void;
  marketingConsented: boolean; setMarketingConsented: (b: boolean) => void;
  refundConsented: boolean; setRefundConsented: (b: boolean) => void;
  refundConsentError: boolean; setRefundConsentError: (b: boolean) => void;
  purchaseError: string | null;
  isPurchasing: boolean;
  handlePurchase: () => void;
}

export const PurchaseDrawerContext = createContext<PurchaseDrawerCtx | null>(null);

export function usePurchaseDrawerCtx(): PurchaseDrawerCtx {
  const ctx = useContext(PurchaseDrawerContext);
  if (!ctx) throw new Error("usePurchaseDrawerCtx must be used within PurchaseDrawerContext.Provider");
  return ctx;
}
