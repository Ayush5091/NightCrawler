import { DEFAULT_LIMITS, type RequestObservation, type ScanResult } from "./types";
import { detectTechnologies } from "./detectors";

/** A clearly labelled, deterministic synthetic scan used by the UI smoke test. */
export function demoScan(): ScanResult {
  const home = "https://demo.sitescope.test/";
  const checkout = "https://demo.sitescope.test/checkout";
  const requests: RequestObservation[] = [
    { url: home, host: "demo.sitescope.test", method: "GET", resourceType: "document", status: 200, isThirdParty: false, observedOn: home, failed: false, durationMs: 124, transferBytes: 8120, contentType: "text/html", phase: "before_consent_action", queryFields: [], bodyFields: [] },
    { url: "https://www.googletagmanager.com/gtm.js", host: "www.googletagmanager.com", method: "GET", resourceType: "script", status: 200, isThirdParty: true, observedOn: home, failed: false, durationMs: 91, transferBytes: 38210, contentType: "application/javascript", phase: "before_consent_action", queryFields: [], bodyFields: [], vendor: "Google Tag Manager", vendorCategory: "tag_management", destinationCountry: "US" },
    { url: "https://www.google-analytics.com/g/collect", host: "www.google-analytics.com", method: "POST", resourceType: "fetch", status: 204, isThirdParty: true, observedOn: home, failed: false, durationMs: 78, transferBytes: 520, contentType: "text/plain", phase: "before_consent_action", queryFields: [{ name: "event", category: "behavior" }], bodyFields: [{ name: "client_id", category: "device_id" }], vendor: "Google Analytics", vendorCategory: "analytics", destinationCountry: "US" },
    { url: checkout, host: "demo.sitescope.test", method: "GET", resourceType: "document", status: 200, isThirdParty: false, observedOn: checkout, failed: false, durationMs: 210, transferBytes: 11640, contentType: "text/html", phase: "before_consent_action", queryFields: [], bodyFields: [] },
    { url: "https://js.stripe.com/v3/", host: "js.stripe.com", method: "GET", resourceType: "script", status: 200, isThirdParty: true, observedOn: checkout, failed: false, durationMs: 156, transferBytes: 65000, contentType: "application/javascript", phase: "before_consent_action", queryFields: [], bodyFields: [], vendor: "Stripe", vendorCategory: "payments", destinationCountry: "US" },
    { url: "https://metrics.unknown.invalid/collect", host: "metrics.unknown.invalid", method: "POST", resourceType: "fetch", status: 200, isThirdParty: true, observedOn: checkout, failed: false, durationMs: 184, transferBytes: 390, contentType: "application/json", phase: "before_consent_action", queryFields: [], bodyFields: [{ name: "email", category: "email" }, { name: "order_id", category: "payment" }] },
  ];
  const scripts = [
    { url: "https://www.googletagmanager.com/gtm.js", host: "www.googletagmanager.com", inline: false, isThirdParty: true, observedOn: home },
    { url: "https://js.stripe.com/v3/", host: "js.stripe.com", inline: false, isThirdParty: true, observedOn: checkout },
  ];
  const cookies = [
    { name: "_ga", domain: ".sitescope.test", path: "/", expires: null, secure: true, httpOnly: false, sameSite: "Lax", isThirdParty: false, firstSeenOn: home },
    { name: "session_id", domain: "demo.sitescope.test", path: "/", expires: null, secure: false, httpOnly: false, sameSite: "Lax", isThirdParty: false, firstSeenOn: checkout },
  ];
  const storage = [{ kind: "local_storage" as const, name: "cart_id", origin: "https://demo.sitescope.test", observedOn: checkout }];
  const technologies = detectTechnologies({ requests, scripts, cookies, storage }, { maxEvidencePerFinding: 5 });
  technologies.push({ detectorId: "dom:react", name: "React", category: "frontend_library", confidence: "medium", evidence: [{ type: "dom", value: "react" }], destinationCountry: null, crossesBorder: false });
  const now = new Date().toISOString();
  return {
    demo: true, startUrl: home, mode: "baseline", device: "desktop", crawlerVersion: "demo", startedAt: now, completedAt: now, limits: { ...DEFAULT_LIMITS, maxPages: 2, maxDepth: 1 },
    robots: { source: "demo", crawlDelaySeconds: null, disallowedSkipped: 0 },
    pages: [
      { url: home, finalUrl: null, status: 200, title: "Demo Store", description: "Sample storefront", canonical: home, contentType: "text/html", depth: 0, redirectChain: [], rendered: true, error: null, startedAt: now, durationMs: 820, headings: { h1: 1, h2: 3 }, seo: { robots: null, viewport: "width=device-width,initial-scale=1", openGraph: true, structuredData: 1, imagesMissingAlt: 1, inputsMissingLabel: 0, internalLinks: 8 }, securityHeaders: { "strict-transport-security": "max-age=31536000", "content-security-policy": null }, performance: { domContentLoadedMs: 420, loadMs: 790, fcpMs: 510, lcpMs: null, cls: null, resourceCount: 19, transferBytes: 468000 }, forms: [{ action: "https://forms.example.invalid/lead", method: "POST", external: true, fields: [{ name: "email", type: "email", dataCategory: "email" }] }], frames: [], frontendSignals: ["react"] },
      { url: checkout, finalUrl: null, status: 200, title: "Checkout | Demo Store", description: "Sample checkout", canonical: checkout, contentType: "text/html", depth: 1, redirectChain: [], rendered: true, error: null, startedAt: now, durationMs: 1130, headings: { h1: 1, h2: 1 }, seo: { robots: "noindex", viewport: "width=device-width,initial-scale=1", openGraph: false, structuredData: 0, imagesMissingAlt: 0, inputsMissingLabel: 1, internalLinks: 4 }, securityHeaders: { "strict-transport-security": null, "content-security-policy": null }, performance: { domContentLoadedMs: 580, loadMs: 1080, fcpMs: 690, lcpMs: null, cls: null, resourceCount: 24, transferBytes: 720000 }, forms: [{ action: "https://demo.sitescope.test/order", method: "POST", external: false, fields: [{ name: "email", type: "email", dataCategory: "email" }, { name: "card_token", type: "hidden", dataCategory: "payment" }] }], frames: ["https://js.stripe.com/v3/"], frontendSignals: ["react"] },
    ],
    requests, scripts, cookies, storage,
    consentUi: { detected: true, signals: [{ kind: "button_text", detail: "accept all" }], observedOn: home, action: null },
    technologies,
    summary: { pagesDiscovered: 2, pagesScanned: 2, pagesFailed: 0, cookiesFound: cookies.length, scriptsFound: scripts.length, requestsObserved: requests.length, storageItemsFound: storage.length, thirdPartyDomains: 4, technologiesDetected: technologies.length, consentUiDetected: true, limitReached: null },
    infrastructure: { dns: { A: ["203.0.113.10"], MX: ["mail.sitescope.test"], NS: ["ns1.sitescope.test"] }, tls: { protocol: "TLSv1.3", issuer: "Demo CA", subject: "demo.sitescope.test", validTo: "2030-01-01", subjectAltNames: ["demo.sitescope.test"] } },
    lighthouse: { status: "completed", device: "desktop", scores: { performance: 62, accessibility: 86, "best-practices": 92, seo: 83 }, metrics: { "largest-contentful-paint": { value: 3400, displayValue: "3.4 s" }, "cumulative-layout-shift": { value: 0.04, displayValue: "0.04" }, "total-blocking-time": { value: 230, displayValue: "230 ms" }, "speed-index": { value: 4100, displayValue: "4.1 s" } }, opportunities: [{ id: "render-blocking-resources", title: "Eliminate render-blocking resources", score: 0.2, displayValue: "Potential savings of 900 ms" }, { id: "unused-javascript", title: "Reduce unused JavaScript", score: 0.35, displayValue: "Potential savings of 180 KB" }] },
    subdomains: [], serviceWorkers: [], websockets: [],
  };
}
