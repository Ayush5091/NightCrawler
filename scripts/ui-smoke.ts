import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
  const latest = process.argv.includes("--latest");
  if (latest) {
    await page.locator("#history-list [data-open]").first().click();
  } else {
    await page.getByRole("button", { name: "View demo report" }).click();
  }
  await page.locator("#report:not([hidden])").waitFor();
  if (latest) {
    assert.match(await page.locator("#lighthouse-scores").innerText(), /Performance/);
    assert.match(await page.locator("#technology-list").innerText(), /Next\.js|React|Vercel/);
  } else {
    assert.match(await page.locator("#report-title").innerText(), /Demo report/);
    assert.match(await page.locator("#request-list").innerText(), /google-analytics/);
    assert.equal(await page.locator("#pdf-link").getAttribute("href"), "/api/scans/demo/pdf");
  }
  assert.deepEqual(errors, []);
  if (process.argv.includes("--screenshot")) await page.screenshot({ path: "dashboard-demo.png", fullPage: true });
  console.log(`UI smoke test passed: ${latest ? "live Lighthouse report" : "demo report, request timeline, and exports"}`);
} finally { await browser.close(); }
