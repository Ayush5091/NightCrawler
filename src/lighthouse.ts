import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { chromium } from "playwright";
import type { ScanResult } from "./types";

type Audit = NonNullable<ScanResult["lighthouse"]>;

/** Runs one public-page Lighthouse audit and retains only actionable summaries. */
export async function runLighthouse(url: string, device: "desktop" | "mobile"): Promise<Audit> {
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | null = null;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    const runner = await lighthouse(url, {
      port: chrome.port,
      logLevel: "error",
      output: "json",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: device,
      screenEmulation: device === "desktop" ? { mobile: false, width: 1366, height: 900, deviceScaleFactor: 1, disabled: false } : undefined,
      throttlingMethod: "provided",
      maxWaitForLoad: 45000,
      maxWaitForFcp: 45000,
    });
    if (!runner) throw new Error("Lighthouse returned no report");
    const lhr = runner.lhr;
    if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
    const scores = Object.fromEntries(Object.entries(lhr.categories).map(([id, item]) => [id, item.score === null ? null : Math.round(item.score * 100)]));
    const metricIds = ["first-contentful-paint", "largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time", "speed-index", "interactive", "server-response-time"];
    const metrics = Object.fromEntries(metricIds.map((id) => {
      const item = lhr.audits[id];
      return [id, { value: item?.numericValue ?? null, displayValue: item?.displayValue ?? null }];
    }));
    const opportunities = Object.values(lhr.audits)
      .filter((item) => (item.scoreDisplayMode === "numeric" || item.scoreDisplayMode === "binary") && item.score !== null && item.score < 0.9 && !metricIds.includes(item.id))
      .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
      .slice(0, 25)
      .map((item) => ({ id: item.id, title: item.title, score: item.score, displayValue: item.displayValue ?? null }));
    return { status: "completed", device, scores, metrics, opportunities };
  } catch (error) {
    return { status: "failed", device, error: (error as Error).message.slice(0, 300), scores: {}, metrics: {}, opportunities: [] };
  } finally {
    try { chrome?.kill(); } catch { /* best-effort cleanup */ }
  }
}
