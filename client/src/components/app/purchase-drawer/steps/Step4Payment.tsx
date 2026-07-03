import { useTranslation } from "react-i18next";
import { usePurchaseDrawerCtx } from "../context";

export function Step4Payment() {
  const { t } = useTranslation();
  const {
    currentOpt, drawerDays, AVAILABLE_CURRENCIES, currency, setCurrency, formatPrice,
    termsConsented, setTermsConsented, termsConsentError, setTermsConsentError,
    privacyConsented, setPrivacyConsented, privacyConsentError, setPrivacyConsentError,
    marketingConsented, setMarketingConsented,
    refundConsented, setRefundConsented, refundConsentError, setRefundConsentError,
    purchaseError, isPurchasing, handlePurchase, setStep,
  } = usePurchaseDrawerCtx();

  return (
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
  );
}
