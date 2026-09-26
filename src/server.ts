import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { crawl } from "./crawl";
import { buildInsights, diffScans } from "./analysis";
import { renderPdf } from "./pdf";
import { demoScan } from "./demo";
import { runLighthouse } from "./lighthouse";
import { fetchCruxHistory } from "./crux";
import type { ScanResult } from "./types";

const localEnv = join(process.cwd(), ".env.local");
if (existsSync(localEnv)) loadEnvFile(localEnv);
const port = Number(process.env.PORT ?? 4173);
const dataDir = join(process.cwd(), ".scan-data");
const publicDir = join(process.cwd(), "web");
const jobs = new Map<string, { status: "running" | "completed" | "failed"; stage?: string; error?: string; result?: ScanResult }>();

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<unknown> {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request body too large");
  }
  return JSON.parse(value);
}

async function stored(id: string): Promise<ScanResult | null> {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  try { return JSON.parse(await readFile(join(dataDir, `${id}.json`), "utf8")) as ScanResult; }
  catch { return null; }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const route = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && route.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'", "x-content-type-options": "nosniff" });
    res.end(await readFile(join(publicDir, "index.html")));
    return;
  }
  if (req.method === "GET" && ["/app.js", "/style.css"].includes(route.pathname)) {
    res.writeHead(200, { "content-type": route.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end(await readFile(join(publicDir, route.pathname.slice(1))));
    return;
  }
  if (req.method === "POST" && route.pathname === "/api/scans") {
    const input = await body(req) as Record<string, unknown>;
    if (typeof input.url !== "string" || !/^https?:\/\//i.test(input.url)) return json(res, 400, { error: "Enter an http or https URL" });
    const requestedPages = Number(input.maxPages);
    const requestedDepth = Number(input.maxDepth);
    const maxPages = Number.isFinite(requestedPages) ? Math.max(1, Math.min(100, Math.floor(requestedPages))) : 10;
    const maxDepth = Number.isFinite(requestedDepth) ? Math.max(0, Math.min(5, Math.floor(requestedDepth))) : 2;
    const state = input.storageState;
    if (state !== undefined && (!state || typeof state !== "object" || Array.isArray(state) || !Array.isArray((state as Record<string, unknown>).cookies) || !Array.isArray((state as Record<string, unknown>).origins))) return json(res, 400, { error: "Session file must be a Playwright storageState JSON object" });
    const id = randomUUID();
    jobs.set(id, { status: "running", stage: "Crawling pages" });
    json(res, 202, { id, status: "running", stage: "Crawling pages" });
    const mode = input.mode === "all" || input.mode === "necessary_only" ? input.mode : "baseline";
    void crawl({ startUrl: input.url, mode, device: input.device === "mobile" ? "mobile" : "desktop", storageState: state as Parameters<typeof crawl>[0]["storageState"], limits: { maxPages, maxDepth } }).then(async (result) => {
      if (result.summary.pagesScanned === 0) {
        const reason = result.pages.find((page) => page.error)?.error ?? "The target page did not render";
        jobs.set(id, { status: "failed", error: `Could not load the website: ${reason}`, result });
        return;
      }
      jobs.set(id, { status: "running", stage: "Running Lighthouse audits" });
      result.lighthouse = result.authenticated
        ? { status: "failed", device: result.device ?? "desktop", error: "Lighthouse audit is not available for uploaded sessions", scores: {}, metrics: {}, opportunities: [] }
        : await runLighthouse(result.pages[0].finalUrl ?? result.startUrl, result.device ?? "desktop");
      jobs.set(id, { status: "running", stage: "Checking real-user history" });
      result.cruxHistory = await fetchCruxHistory(result.startUrl, result.device ?? "desktop");
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, `${id}.json`), JSON.stringify(result));
      jobs.set(id, { status: "completed", result });
    }).catch((error: Error) => jobs.set(id, { status: "failed", error: error.message }));
    return;
  }
  if (req.method === "GET" && route.pathname === "/api/scans") {
    await mkdir(dataDir, { recursive: true });
    const files = (await readdir(dataDir)).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name));
    const scans = await Promise.all(files.map(async (name) => {
      const scan = await stored(name.slice(0, -5));
      return scan ? { id: name.slice(0, -5), url: scan.startUrl, startedAt: scan.startedAt, summary: scan.summary, status: scan.summary.pagesScanned > 0 ? "completed" : "failed", error: scan.pages.find((page) => page.error)?.error ?? null } : null;
    }));
    return json(res, 200, scans.filter(Boolean).sort((a, b) => String(b?.startedAt).localeCompare(String(a?.startedAt))));
  }
  const match = /^\/api\/scans\/(demo|[a-f0-9-]{36})(?:\/(json|csv|pdf|compare))?$/.exec(route.pathname);
  if (req.method === "GET" && match) {
    const [, id, format] = match;
    const running = jobs.get(id);
    if (running?.status === "running") return json(res, 200, { id, status: "running", stage: running.stage });
    if (running?.status === "failed") return json(res, 200, { id, status: "failed", error: running.error, scan: running.result });
    const scan = id === "demo" ? demoScan() : running?.result ?? await stored(id);
    if (!scan) return json(res, 404, { error: "Scan not found" });
    if (!format && scan.summary.pagesScanned === 0) return json(res, 200, { id, status: "failed", error: `Could not load the website: ${scan.pages.find((page) => page.error)?.error ?? "No page rendered"}` });
    if (format === "json") {
      res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename="scan-${id}.json"` });
      return res.end(JSON.stringify(scan, null, 2));
    }
    if (format === "csv") {
      const cell = (value: unknown) => {
        const safe = String(value ?? "");
        return `"${(/^[\s]*[=+\-@]/.test(safe) ? `'${safe}` : safe).replaceAll('"', '""')}"`;
      };
      const csv = ["page,method,url,host,status,type,third_party,vendor,transfer_bytes,query_fields,body_fields", ...scan.requests.map((r) => [r.observedOn,r.method,r.url,r.host,r.status,r.resourceType,r.isThirdParty,r.vendor,r.transferBytes,r.queryFields?.map((f) => f.name).join("|"),r.bodyFields?.map((f) => f.name).join("|")].map(cell).join(","))].join("\r\n");
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="scan-${id}.csv"` });
      return res.end(csv);
    }
    if (format === "pdf") {
      const pdf = await renderPdf(scan);
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="scan-${id}.pdf"` });
      return res.end(pdf);
    }
    if (format === "compare") {
      const other = await stored(route.searchParams.get("with") ?? "");
      return other ? json(res, 200, diffScans(other, scan)) : json(res, 404, { error: "Comparison scan not found" });
    }
    return json(res, 200, { id, status: "completed", scan, insights: buildInsights(scan) });
  }
  return json(res, 404, { error: "Not found" });
}

createServer((req, res) => { void handle(req, res).catch((error: Error) => json(res, 500, { error: error.message })); }).listen(port, "127.0.0.1", () => {
  console.log(`Crawler dashboard: http://127.0.0.1:${port}`);
});
