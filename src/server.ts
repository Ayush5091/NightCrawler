import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { crawl } from "./crawl";
import { buildInsights, diffScans } from "./analysis";
import { renderPdf } from "./pdf";
import { runLighthouse } from "./lighthouse";
import { fetchCruxHistory } from "./crux";
import type { ScanResult } from "./types";

const localEnv = join(process.cwd(), ".env.local");
if (existsSync(localEnv)) loadEnvFile(localEnv);
const dataDir = join(process.cwd(), ".scan-data");

// Two TRAXELON sites share this API and its scan jobs; each listener
// serves its own frontend build. `--site=built` or `--site=data` starts one.
const sites = {
  built: { name: "TRAXELON Built", port: Number(process.env.BUILT_PORT ?? process.env.PORT ?? 4173) },
  data: { name: "TRAXELON Data", port: Number(process.env.DATA_PORT ?? 4174) },
} as const;
type SiteId = keyof typeof sites;
const only = process.argv.find((arg) => arg.startsWith("--site="))?.slice("--site=".length);
if (only && !(only in sites)) throw new Error(`Unknown site "${only}". Use --site=built or --site=data.`);
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

async function handle(siteId: SiteId, req: IncomingMessage, res: ServerResponse) {
  const publicDir = resolve(process.cwd(), "web-dist", siteId);
  const route = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && route.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'", "x-content-type-options": "nosniff" });
    res.end(await readFile(join(publicDir, "index.html")));
    return;
  }
  if (req.method === "GET" && !route.pathname.startsWith("/api/")) {
    const assetPath = resolve(publicDir, `.${route.pathname}`);
    const relativeAssetPath = relative(publicDir, assetPath);
    if (!relativeAssetPath.startsWith("..") && !isAbsolute(relativeAssetPath)) {
      try {
        const file = await readFile(assetPath);
        const type = new Map([
          [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"],
          [".woff2", "font/woff2"], [".woff", "font/woff"], [".svg", "image/svg+xml"],
          [".png", "image/png"], [".webp", "image/webp"], [".ico", "image/x-icon"],
        ]).get(extname(assetPath)) ?? "application/octet-stream";
        const cacheControl = route.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
        res.writeHead(200, { "content-type": type, "cache-control": cacheControl, "x-content-type-options": "nosniff" });
        res.end(file);
        return;
      } catch { /* Fall through to the API/404 handler. */ }
    }
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
  const match = /^\/api\/scans\/([a-f0-9-]{36})(?:\/(json|csv|pdf|compare))?$/.exec(route.pathname);
  if (req.method === "GET" && match) {
    const [, id, format] = match;
    const running = jobs.get(id);
    if (running?.status === "running") return json(res, 200, { id, status: "running", stage: running.stage });
    if (running?.status === "failed") return json(res, 200, { id, status: "failed", error: running.error, scan: running.result });
    const scan = running?.result ?? await stored(id);
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
      const pdf = await renderPdf(scan, sites[siteId].name);
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

for (const siteId of (only ? [only] : Object.keys(sites)) as SiteId[]) {
  const { name, port } = sites[siteId];
  createServer((req, res) => { void handle(siteId, req, res).catch((error: Error) => res.headersSent ? res.end() : json(res, 500, { error: error.message })); }).listen(port, "127.0.0.1", () => {
    console.log(`${name}: http://127.0.0.1:${port}`);
  });
}
