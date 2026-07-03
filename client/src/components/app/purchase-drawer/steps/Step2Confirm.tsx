import { useTranslation } from "react-i18next";
import { usePurchaseDrawerCtx } from "../context";

export function Step2Confirm() {
  const { t } = useTranslation();
  const {
    currentOpt, drawerDays, AVAILABLE_CURRENCIES, currency, setCurrency, formatPrice,
    setStep, isAuthenticated,
  } = usePurchaseDrawerCtx();

  if (!currentOpt) return null;

  return (
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
  );
}
