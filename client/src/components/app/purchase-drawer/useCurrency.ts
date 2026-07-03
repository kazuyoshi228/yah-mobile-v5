import { getFirebaseDb } from "@/lib/firebase";
import { useFirestoreCollection } from "@/hooks/useFirestoreCollection";
import { collection, query, orderBy, limit } from "firebase/firestore";
import { useMemo, useState } from "react";

const AVAILABLE_CURRENCIES = ["JPY", "USD", "EUR", "TWD", "KRW", "THB", "SGD", "GBP", "CNY"];

/**
 * 表示通貨の選択と、JPY→選択通貨への価格フォーマットを提供する。
 * レートは currency_rates コレクションの最新1件を購読する。
 */
export function useCurrency() {
  const [currency, setCurrency] = useState<string>("JPY");

  const ratesQuery = useMemo(
    () => query(collection(getFirebaseDb(), "currency_rates"), orderBy("updatedAt", "desc"), limit(1)),
    [],
  );
  const { data: ratesData } = useFirestoreCollection<{ id: string; rates: Record<string, number>; updatedAt: number }>(
    () => ratesQuery,
    [ratesQuery],
    { realtime: false },
  );
  const rates = ratesData[0]?.rates ?? null;

  const formatPrice = (priceJpy: number) => {
    if (currency === "JPY" || !rates || !rates[currency]) {
      return `¥${priceJpy.toLocaleString()}`;
    }
    const rate = rates[currency];
    const converted = priceJpy * rate;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency,
      maximumFractionDigits: ["KRW", "TWD"].includes(currency) ? 0 : 2,
    }).format(converted);
  };

  return { currency, setCurrency, AVAILABLE_CURRENCIES, formatPrice };
}
