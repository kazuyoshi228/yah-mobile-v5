import { useTranslation } from "react-i18next";
import { DrawerClose } from "@/components/ui/drawer";
import { usePurchaseDrawerCtx } from "../context";

export function Step0Duration() {
  const { t } = useTranslation();
  const { lastPlanOpt, planDays, setDrawerDays, setDrawerGb, setStep } = usePurchaseDrawerCtx();

  return (
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
  );
}
