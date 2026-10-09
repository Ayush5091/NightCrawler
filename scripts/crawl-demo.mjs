/**
 * Runs a real crawl and prints what it observed.
 *
 * Usage:
 *   npm run crawl -- https://example.com [maxPages] [maxDepth]
 */

import { crawl, CRAWLER_VERSION } from "../src/crawl.ts";

const startUrl = process.argv[2] ?? "https://example.com/";
const maxPages = Number(process.argv[3] ?? 3);
const maxDepth = Number(process.argv[4] ?? 1);

const line = (s = "") => console.log(s);

line(`TRAXELON scanner ${CRAWLER_VERSION}`);
line(`target ${startUrl}   maxPages ${maxPages}   maxDepth ${maxDepth}`);
line("─".repeat(70));

const started = Date.now();
let result;
try {
  result = await crawl({
    startUrl,
    limits: { maxPages, maxDepth, maxDurationMs: 180_000, navigationTimeoutMs: 30_000 },
    onEvent: (event) => {
      if (event.event === "page_scanned") line(`  ✓ ${event.status} ${event.url}  ${event.durationMs}ms`);
      else if (event.event === "page_failed") line(`  ✗ ${event.url} — ${event.error}`);
      else if (event.event === "page_skipped_robots") line(`  – robots disallows ${event.url}`);
      else if (event.event === "page_skipped_ssrf") line(`  ! SSRF refused ${event.url} (${event.error})`);
      else if (event.event.startsWith("robots")) line(`  robots.txt: ${event.event.replace("robots_", "")}`);
      else if (event.event === "limit_reached") line(`  limit reached: ${event.limit}`);
    },
  });
} catch (error) {
  line(`\nSCAN FAILED: ${error.code ?? "error"} — ${error.message}`);
  process.exit(1);
}

const s = result.summary;
line("─".repeat(70));
line(`finished in ${Math.round((Date.now() - started) / 1000)}s`);
line();
line(`pages discovered    ${s.pagesDiscovered}`);
line(`pages scanned       ${s.pagesScanned}`);
line(`pages failed        ${s.pagesFailed}`);
line(`cookies             ${s.cookiesFound}`);
line(`scripts             ${s.scriptsFound}`);
line(`requests observed   ${s.requestsObserved}`);
line(`storage items       ${s.storageItemsFound}`);
line(`third-party domains ${s.thirdPartyDomains}`);
line(`technologies        ${s.technologiesDetected}`);
line(`consent UI          ${s.consentUiDetected}`);
line(`limit reached       ${s.limitReached ?? "none — finished naturally"}`);

if (result.technologies.length) {
  line("\nTechnologies");
  for (const t of result.technologies.sort((a, b) => a.category.localeCompare(b.category))) {
    const where = t.destinationCountry ? ` → ${t.destinationCountry}${t.crossesBorder ? " (cross-border)" : ""}` : "";
    line(`  [${t.confidence.padEnd(6)}] ${t.name}  (${t.category})${where}`);
    for (const e of t.evidence.slice(0, 2)) line(`             ${e.type}: ${e.value}`);
  }
}

if (result.cookies.length) {
  line("\nCookies — names and flags only, values are never read");
  for (const c of result.cookies.slice(0, 15)) {
    line(`  ${c.name.padEnd(28)} ${c.domain.padEnd(28)} ${c.isThirdParty ? "third-party" : "first-party"}`);
  }
}

if (result.storage.length) {
  line("\nBrowser storage — key names only, values are never read");
  for (const item of result.storage.slice(0, 10)) line(`  ${item.kind.padEnd(16)} ${item.name}`);
}

const hosts = new Map();
for (const r of result.requests.filter((r) => r.isThirdParty)) {
  hosts.set(r.host, (hosts.get(r.host) ?? 0) + 1);
}
if (hosts.size) {
  line("\nThird-party destinations");
  for (const [host, count] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    line(`  ${String(count).padStart(4)}×  ${host}`);
  }
}

if (result.consentUi.detected) {
  line("\nConsent interface detected because:");
  for (const signal of result.consentUi.signals) line(`  ${signal.kind}: ${signal.detail}`);
}

// Privacy guarantees, asserted on real observations rather than fixtures.
line("\nPrivacy checks on live data");
const problems = [];
for (const c of result.cookies) if ("value" in c) problems.push(`cookie ${c.name} has a value`);
for (const item of result.storage) if ("value" in item) problems.push(`storage ${item.name} has a value`);
for (const r of result.requests) if (r.url.includes("?")) problems.push(`request url has a query: ${r.url}`);
for (const sc of result.scripts) if (sc.url?.includes("?")) problems.push(`script url has a query: ${sc.url}`);
if (problems.length) {
  for (const p of problems.slice(0, 5)) line(`  FAIL ${p}`);
  process.exit(1);
}
line("  ✓ no cookie values, no storage values, no query strings on resources");
