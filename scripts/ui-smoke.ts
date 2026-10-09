import assert from "node:assert/strict";
import { chromium } from "playwright";
import { buildInsights } from "../src/analysis";
import { demoScan } from "../src/demo";

// Checks both dashboards against a running server (`npm start`). The scan API
// is stubbed with the synthetic demo scan, so no real crawl runs.
const sites = [
  { name: "TRAXELON Built", port: Number(process.env.BUILT_PORT ?? 4173), section: "#technologies" },
  { name: "TRAXELON Data", port: Number(process.env.DATA_PORT ?? 4174), section: "#flows" },
];
const id = "00000000-0000-4000-8000-000000000000";
const scan = demoScan();

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  for (const site of sites) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/scans", (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id, status: "running" }) }));
    await page.route(`**/api/scans/${id}`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id, status: "completed", scan, insights: buildInsights(scan) }) }));

    await page.goto(`http://127.0.0.1:${site.port}/`, { waitUntil: "domcontentloaded" });
    assert.match(await page.title(), new RegExp(site.name));
    assert.equal(await page.locator("#history, #demo-button").count(), 0, "history and demo controls are removed");

    await page.fill("#url", "https://demo.sitescope.test/");
    await page.click("#scan-button");
    await page.locator("#report").waitFor();
    assert.match(await page.locator("#report-title").innerText(), /Demo report/);
    assert.match(await page.locator("#request-list").innerText(), /google-analytics/);
    assert.equal(await page.locator(site.section).count(), 1);
    assert.equal(await page.locator("#pdf-link").getAttribute("href"), `/api/scans/${id}/pdf`);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`UI smoke test passed: ${site.name} scan form, report, and exports`);
  }
} finally { await browser.close(); }
