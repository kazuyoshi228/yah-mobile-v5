import { useTranslation } from "react-i18next";
import { DrawerClose } from "@/components/ui/drawer";

export function Step5Complete() {
  const { t } = useTranslation();

  return (
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
  );
}
