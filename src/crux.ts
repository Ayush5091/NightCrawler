import type { ScanResult } from "./types";

type History = NonNullable<ScanResult["cruxHistory"]>;
type CruxRecord = {
  record?: {
    collectionPeriods?: Array<{ firstDate: { year: number; month: number; day: number }; lastDate: { year: number; month: number; day: number } }>;
    metrics?: Record<string, { percentilesTimeseries?: { p75s?: Array<number | string | null> } }>;
  };
};

const iso = (date: { year: number; month: number; day: number }) => `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

/** Historical field data is fetched only when a user supplies a CrUX API key. */
export async function fetchCruxHistory(rawUrl: string, device: "desktop" | "mobile"): Promise<History> {
  const formFactor = device === "mobile" ? "PHONE" : "DESKTOP";
  const key = process.env.CRUX_API_KEY;
  if (!key) return { status: "not_configured", formFactor, periods: [] };
  const origin = new URL(rawUrl).origin;
  try {
    const response = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor, collectionPeriodCount: 40, metrics: ["largest_contentful_paint", "cumulative_layout_shift", "interaction_to_next_paint", "experimental_time_to_first_byte"] }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return { status: "insufficient_data", formFactor, periods: [] };
    if (!response.ok) return { status: "failed", formFactor, periods: [], error: `CrUX returned HTTP ${response.status}` };
    const data = await response.json() as CruxRecord;
    const record = data.record;
    if (!record?.collectionPeriods?.length) return { status: "insufficient_data", formFactor, periods: [] };
    const p75 = (metric: string, index: number): number | null => {
      const raw = record.metrics?.[metric]?.percentilesTimeseries?.p75s?.[index];
      if (raw == null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    return {
      status: "available", formFactor,
      periods: record.collectionPeriods.map((period, index) => ({
        start: iso(period.firstDate), end: iso(period.lastDate),
        lcpP75: p75("largest_contentful_paint", index),
        clsP75: p75("cumulative_layout_shift", index),
        inpP75: p75("interaction_to_next_paint", index),
        ttfbP75: p75("experimental_time_to_first_byte", index),
      })),
    };
  } catch { return { status: "failed", formFactor, periods: [], error: "CrUX history request failed" }; }
}
