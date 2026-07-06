import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pwaPlugin = VitePWA({
  // prompt: 新バージョンを検知したら更新バナーで促す（開いたままのページが古いまま取り残されない）
  registerType: "prompt",
  injectRegister: 'auto',
  includeAssets: [],
  manifest: false, // manifest.jsonはスタティックファイルとして提供
  workbox: {
    // HTMLはプリキャッシュしない（古いindex.html→古いJSバンドル参照を防ぐ）。
    globPatterns: ["**/*.{js,css,ico,png,svg,woff2}"],
    // 新SW即時有効化＆古いキャッシュ削除（デプロイ後に古いバンドルが残らないように）。
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    // Critical: never let the SPA navigation fallback hijack server routes.
    // OAuth callbacks and all /api/* requests must reach the backend, not index.html.
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        // ナビゲーション（HTML）は常にネットワーク優先。古いHTMLをキャッシュ配信しない。
        urlPattern: ({ request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "html-cache",
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 },
          networkTimeoutSeconds: 5,
        },
      },
      {
        // Firebase Storage 配信の静的アセット（フォント/画像/動画/アイコン）。
        urlPattern: /^https:\/\/storage\.googleapis\.com\/.*/,
        handler: "CacheFirst",
        options: {
          cacheName: "firebase-storage-cache",
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
        },
      },
    ],
  },
  devOptions: { enabled: false },
});

const plugins = [react(), tailwindcss(), pwaPlugin];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 循環依存を起こさないパッケージのみ分割。
        // React/Radix/sonner等は相互依存するため分割しない。
        manualChunks: (id) => {
          // Firebase SDK (完全独立)
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) return "vendor-firebase";
          // Stripe (完全独立)
          if (id.includes("node_modules/@stripe")) return "vendor-stripe";
          // framer-motion (完全独立)
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";
          // i18n (完全独立)
          if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "vendor-i18n";
          // 上記以外の node_modules は分割しない（循環依存防止）
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
