import { useTranslation } from "react-i18next";
import { DrawerClose } from "@/components/ui/drawer";
import { safeUrl } from "@/lib/utils";
import { usePurchaseDrawerCtx } from "../context";

export function Step6Esim() {
  const { t } = useTranslation();
  const { esimLoading, esimLink } = usePurchaseDrawerCtx();

  return (
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
  );
}
