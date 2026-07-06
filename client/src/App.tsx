import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect } from "react";
import { Router as WouterRouter, Route, Switch, Redirect, useLocation } from "wouter";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppPage from "./pages/AppPage";
import CookieBanner from "./components/CookieBanner";
import { PwaUpdatePrompt } from "./components/PwaUpdatePrompt";
import LoginPage from "./pages/LoginPage";

// 遅延ロード：初期表示に不要なページ（ログイン後・管理者・法的ページ）
const MyPage = lazy(() => import("./pages/MyPage"));
const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage"));
const TopupPage = lazy(() => import("./pages/TopupPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const Unauthorized = lazy(() => import("./pages/Unauthorized"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Terms = lazy(() => import("./pages/Terms"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));
const NotFound = lazy(() => import("./pages/NotFound"));

// ページ切り替え中のフォールバック
function PageFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
    </div>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  return null;
}

function I18nRouter() {
  const path = window.location.pathname;
  // Check if path starts with a supported language
  const langMatch = SUPPORTED_LANGUAGES.find(l => path.startsWith(`/${l.code}/`) || path === `/${l.code}`);
  const base = langMatch ? `/${langMatch.code}` : "";

  return (
    <WouterRouter base={base}>
      <ScrollToTop />
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/"><Redirect to="/app" /></Route>
          <Route path="/login" component={LoginPage} />
          <Route path="/app"><AppPage /></Route>
          <Route path="/mypage" component={MyPage} />
          <Route path="/mypage/orders/:orderId" component={OrderDetailPage} />
          <Route path="/mypage/topup/:esimLinkId" component={TopupPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/admin/:tab" component={AdminPage} />
          <Route path="/privacy" component={PrivacyPolicy} />
          <Route path="/terms" component={Terms} />
          <Route path="/cookie-policy" component={CookiePolicy} />
          <Route path="/unauthorized" component={Unauthorized} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </WouterRouter>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <I18nRouter />
          <CookieBanner />
          <PwaUpdatePrompt />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
