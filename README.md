# TRAXELON Built and TRAXELON Data

Two website-analysis tools from [TRAXELON Tools](https://traxelon.com/tools),
built on one scanner:

| Tool | Domain | Answers |
| --- | --- | --- |
| **TRAXELON Built** | `built.traxelon.com` | How is this website built? Technologies, hosting and infrastructure, TLS, Lighthouse performance, SEO, and page inventory. |
| **TRAXELON Data** | `data.traxelon.com` | What data does this website collect, and where does it go? Data flows, data fields sent to third parties, cookies, browser storage, consent signals, and findings. |

You give a tool a URL and a device (desktop or mobile). The scanner opens the
site in a real Chromium browser, crawls a bounded number of same-site pages,
records what the browser observed, and shows an evidence-backed report. Both
tools run the same scan; each shows the part of the report it is about.

**Privacy rule:** the scanner records *names*, never *values*. URL query values,
cookie values, storage values, and request body values are stripped at capture
and never saved. Only field names (for example `email` or `client_id`) are kept.

---

## Quick start

Requires **Node.js 20.19+ or 22.12+** (Vite 8 needs it).

```powershell
npm install
npx playwright install chromium
npm start
```

`npm start` builds both frontends and starts one server with two listeners:

- TRAXELON Built: http://127.0.0.1:4173
- TRAXELON Data: http://127.0.0.1:4174

## How it works

```
Browser (Built or Data UI)
   │  POST /api/scans { url, device }
   ▼
server.ts ──► crawl.ts ──► Chromium (Playwright) visits pages
   │              │
   │              ├─ ssrf.ts / url.ts / robots.ts   decide what may be visited
   │              ├─ analysis.ts                    field names from requests and forms
   │              ├─ tracker-catalogue.ts           host → vendor, category, country
   │              ├─ detectors.ts + tech-intel.ts   technologies, with evidence and confidence
   │              └─ infrastructure.ts + geoip.ts   DNS, TLS, IP location
   │
   ├─ lighthouse.ts   Lighthouse audit of the first page
   ├─ crux.ts         optional real-user history (Chrome UX Report)
   └─ saves .scan-data/<id>.json
   ▲
   │  GET /api/scans/<id>  (the UI polls until complete)
Browser renders the report (scan + insights from analysis.ts)
```

### 1. Starting a scan

The scan form (`web/src/components/Shell.tsx`) sends the URL and device to
`POST /api/scans`. The server (`src/server.ts`) replies at once with a scan id
and runs the scan in the background. The UI polls `GET /api/scans/<id>` and
shows the current stage: crawling, Lighthouse, then real-user history.

Defaults the UI does not expose: **10 pages**, **depth 2**, and **baseline**
consent mode (no consent button is clicked). API callers can send `maxPages`
(1–100), `maxDepth` (0–5), and `mode` (`baseline`, `all` to click accept-all, or
`necessary_only` to click reject-all).

### 2. Deciding what may be visited

Before any page loads, and again for every link and redirect:

- **`ssrf.ts`** refuses private, loopback, link-local, and cloud-metadata
  addresses. It resolves DNS first so a public name that points at an internal
  IP is refused too. Known internal ports and hostnames are blocked.
- **`url.ts`** normalises URLs (drops fragments and tracking parameters, sorts
  query keys, collapses `/index.html`), keeps the crawl on the start URL's
  origin, and skips non-page files such as images and PDFs.
- **`robots.ts`** fetches and obeys `robots.txt`, including `Crawl-delay`.

The crawler identifies itself as
`TraxelonScanner/<version> (+https://traxelon.com/tools)` rather than pretending
to be a normal browser, so site owners can recognise or block it.

### 3. Crawling (`src/crawl.ts`)

One fresh browser context per scan (never shared between scans), with a desktop
or mobile viewport. Pages are visited breadth-first, two at a time. On each page
the crawler records:

- **Network requests:** method, host, path (no query), status, content type,
  timing breakdown, transfer size, first- or third-party, frame, the names of
  query and body fields, and vendor from the catalogue.
- **Scripts:** external script URLs and whether inline scripts exist. A few
  same-origin bundles are read to fingerprint frameworks.
- **Page details:** title, description, canonical, headings, robots and
  viewport meta, Open Graph, structured data, missing alt text and form labels,
  forms and their field names, iframes, browser timings, security headers.
- **Browser storage:** localStorage and sessionStorage key names, IndexedDB
  database names.
- **Consent signals:** consent-banner buttons, known consent-manager DOM
  elements, scripts, and cookies. In `all` or `necessary_only` mode it clicks the
  matching button, and later requests and cookies are tagged "after consent".
- **WebSockets and service workers.**

At the end it reads cookies once (metadata only; values are discarded), runs
technology detection, lists same-site subdomains seen in traffic, and adds DNS,
TLS, and optional IP location data.

Hard limits (`DEFAULT_LIMITS` in `src/types.ts`) bound duration, pages,
redirects, requests, cookies, scripts, and storage items. When one is reached,
the report says which one.

### 4. Detecting technologies

- **`detectors.ts`:** signatures for trackers, analytics, consent managers, and
  CDNs by script URL, network host, cookie name, and storage key. Any third-party
  host no signature matched is still reported, by vendor (medium confidence) or
  by its own hostname (low confidence).
- **`tech-intel.ts`:** framework, CMS, build-tool, and hosting signatures from
  DOM markers, script paths, bundle contents, cookies, and response headers,
  with a version when one is exposed.

Every finding carries its evidence and a confidence level.

### 5. Enrichment

- **`lighthouse.ts`** runs a Lighthouse audit (performance, accessibility, best
  practices, SEO) of the first page in a separate headless Chrome. It is skipped
  for scans that use an uploaded session.
- **`crux.ts`** fetches Chrome UX Report history (LCP, CLS, INP, TTFB at p75)
  when `CRUX_API_KEY` is set.
- **`infrastructure.ts`** reads DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA,
  SOA) and the TLS certificate.
- **`geoip.ts`** looks up IP country, city, and ASN in local MaxMind GeoLite2
  files when present. No web API is called.

### 6. Analysis and reports

`analysis.ts` turns the raw scan into insights: vendors, unknown third-party
destinations, data fields mapped to where they were sent, a page → destination
graph, and findings: sensitive-looking fields sent to third parties, forms
posting to another origin, cookies missing `Secure` or `HttpOnly`, missing HSTS,
and images or inputs without accessible labels. It can also compare two scans
and list what is new.

The finished scan is saved as `.scan-data/<id>.json` and can be exported as
JSON, CSV (one row per request), or PDF (`pdf.ts`, rendered by Chromium).

**There is no scan history.** The API has no endpoint that lists scans, and the
dashboard only shows the report for the scan the visitor just ran. A saved scan
can be fetched only by its id, a random UUID returned to the visitor who started
it.

### 7. The two frontends

`web/` is one React + Vite app. The Vite mode picks the site:

- `web/src/site.ts` holds each site's name, hero text, and report sections.
- `vite.config.ts` sets the page title and description per site and writes each
  build to `web-dist/built` or `web-dist/data`.
- `src/server.ts` serves `web-dist/built` on the Built port and `web-dist/data`
  on the Data port. Both share the same API and scan jobs.

| Report section | Built | Data |
| --- | :---: | :---: |
| Overview metrics | ✓ (with Technologies) | ✓ (with Cookies) |
| Lighthouse scores, resource mix, performance, DNS, TLS | ✓ | |
| Optimisation opportunities | ✓ | |
| Data flows, data fields, unknown destinations | | ✓ |
| Browser state: cookies, storage, consent | | ✓ |
| Network timeline | ✓ | ✓ |
| Technologies and vendors | ✓ | |
| Page inventory | ✓ | |
| Findings | | ✓ |

To move a section between sites, edit its `sections` list in `web/src/site.ts`.

## Project layout

```
src/
  server.ts             HTTP server: static frontends + scan API, two listeners
  crawl.ts              Playwright crawler; produces the ScanResult
  types.ts              ScanResult and observation types, default limits
  ssrf.ts               blocks private and internal targets
  url.ts                URL normalisation and same-origin scope
  robots.ts             robots.txt parsing and matching
  analysis.ts           field classification, insights, scan comparison
  detectors.ts          tracker and vendor signatures
  tech-intel.ts         framework, CMS, and hosting signatures
  tracker-catalogue.ts  host → vendor, category, country
  infrastructure.ts     DNS records and TLS certificate
  geoip.ts              offline GeoLite2 IP lookup
  lighthouse.ts         Lighthouse audit
  crux.ts               Chrome UX Report history
  pdf.ts                PDF export
  demo.ts               synthetic scan used by the UI smoke test
web/
  index.html            page shell (title and description filled per site)
  src/main.tsx          React entry
  src/App.tsx           scan flow and status
  src/Report.tsx        report sections
  src/site.ts           per-site branding and sections
  src/components/       Shell (sidebar, hero, scan form) and UI primitives
  src/styles.css        design tokens and styles
scripts/
  crawl-demo.mjs        terminal crawl that prints observations
  smoke.ts              crawler smoke test against a local fixture
  ui-smoke.ts           dashboard smoke test in Chromium
  update-geoip.mjs      downloads GeoLite2 databases
FEATURE_MATRIX.md       what is and is not covered, area by area
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Build both frontends and serve Built (4173) and Data (4174). |
| `npm run start:built` | Build and serve only TRAXELON Built. |
| `npm run start:data` | Build and serve only TRAXELON Data. |
| `npm run build:web` | Build both frontends into `web-dist/`. |
| `npm run dev:web` | Vite dev server for Built on port 5173 (needs the API server running). |
| `npm run dev:web:data` | Vite dev server for Data on port 5174 (needs the API server running). |
| `npm run typecheck` | Type-check the server and the frontend. |
| `npm run smoke` | Crawl a local fixture and check capture and value redaction. |
| `npm run ui-smoke` | With the server running, check both dashboards in Chromium (scan API stubbed with the synthetic scan). |
| `npm run crawl -- <url> [pages] [depth]` | Run a crawl in the terminal and print what it saw. |
| `npm run geoip:update` | Download the GeoLite2 City and ASN databases. |

Ports can be changed with `BUILT_PORT` and `DATA_PORT`.

## HTTP API

All routes are served on both ports.

| Route | Description |
| --- | --- |
| `POST /api/scans` | Start a scan. Body: `url` (required), `device`, and optional `maxPages`, `maxDepth`, `mode`, `storageState`. Returns `{ id, status }`. |
| `GET /api/scans/:id` | Scan status, or the finished scan with its insights. |
| `GET /api/scans/:id/json` · `/csv` · `/pdf` | Exports. |
| `GET /api/scans/:id/compare?with=:otherId` | What is new in this scan compared with another (both ids required). |

## Optional configuration

Create an ignored `.env.local` in the project folder. The server loads it on
start.

```text
MAXMIND_ACCOUNT_ID=your_numeric_account_id
MAXMIND_LICENSE_KEY=your_license_key
CRUX_API_KEY=your_crux_api_key
```

- **IP location and ASN:** create a free
  [MaxMind account](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/),
  add the two MaxMind values, and run `npm run geoip:update`. The databases go
  to the ignored `data/geoip/` folder. Re-run it periodically, because MaxMind
  requires current databases, and restart the server afterwards. Override the
  paths with `GEOLITE2_CITY_DB` and `GEOLITE2_ASN_DB`.
- **Real-user history:** enable the
  [Chrome UX Report API](https://developer.chrome.com/docs/crux/history-api),
  restrict a key to it, and set `CRUX_API_KEY`. The key is never included in
  saved reports. Sites without enough traffic have no history.
- **Authenticated scans:** the scan form's *Attach saved browser session* accepts
  a Playwright `storageState` JSON file for a session you saved yourself. It is
  used for that scan only and never saved. Keep session files private.

Without these, the report marks the data as unavailable rather than showing
zeros.

## Deployment notes

- The server binds to `127.0.0.1` and has **no user authentication**. To host
  it on `built.traxelon.com` and `data.traxelon.com`, put it behind a reverse
  proxy that terminates TLS, routes each domain to its port, and adds
  authentication or rate limiting.
- The SSRF guard is the application half of the defence. DNS rebinding can
  still slip through between the check and the browser fetch, so production
  hosts should also restrict outbound traffic to the public internet.
- Running scans are tracked in memory. A restart loses in-progress scans;
  finished scans in `.scan-data/` are kept. Nothing deletes old scans, so add a
  retention job (for example, remove files older than 30 days) when hosting.
- Each scan launches Chromium (plus a second one for Lighthouse), so plan
  memory for concurrent scans.

## Measurement limits

Lighthouse results are lab measurements from the host machine and its
connection. Technology and vendor coverage comes from hand-written signatures
and a small catalogue, so it is narrower than commercial profilers. The scanner
cannot see server-side calls or interactions it does not perform. See
`FEATURE_MATRIX.md` for detail, area by area.
