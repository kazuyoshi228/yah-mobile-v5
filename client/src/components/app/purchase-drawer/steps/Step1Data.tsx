import { useTranslation } from "react-i18next";
import type { PlanOption } from "../../types";
import { usePurchaseDrawerCtx } from "../context";

export function Step1Data() {
  const { t } = useTranslation();
  const { drawerDays, planOptions, setDrawerGb, setStep } = usePurchaseDrawerCtx();

  return (
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
  );
}
