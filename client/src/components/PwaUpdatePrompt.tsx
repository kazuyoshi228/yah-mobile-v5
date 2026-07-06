import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * PWA 更新バナー。
 * 新しいバージョンを検知したら小さなバナーを出し、タップで最新版へ更新（skipWaiting → reload）。
 * autoUpdate だと開いたままのページが取り残されるため prompt 方式にし、
 * フォーカス復帰時と一定間隔で更新チェック（registration.update）を行う。
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      if (!r) return;
      const check = () => { r.update().catch(() => {}); };
      // 1時間ごと＋タブ復帰時に更新をチェック
      const id = setInterval(check, 60 * 60 * 1000);
      const onVisible = () => { if (document.visibilityState === "visible") check(); };
      document.addEventListener("visibilitychange", onVisible);
      // クリーンアップは行わない（アプリ全体の寿命と一致）
      void id;
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 z-[100] mx-auto max-w-md bg-black text-white shadow-lg rounded-md px-4 py-3 flex items-center justify-between gap-3">
      <span className="font-sans text-sm">A new version is available.</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="text-label text-[0.7rem] bg-white text-black px-4 py-2 rounded-sm hover:bg-white/80 transition-colors duration-200 shrink-0"
      >
        Reload
      </button>
    </div>
  );
}
