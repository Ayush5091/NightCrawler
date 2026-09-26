# Standalone webcrawler

This folder runs a Playwright website crawl and a local dashboard. It observes
pages, requests, request field names, cookies, scripts, storage keys, forms,
security headers, SEO signals, basic browser timing, vendors, and technologies.
Desktop and mobile profiles are supported. The crawler also inventories
same-site subdomains observed in traffic, iframe URLs, WebSocket connections,
and service-worker registrations. Scan results are saved in `.scan-data/` for
history and comparison. Cookie, storage, URL parameter, and request body values
are not saved. Successful live scans run Lighthouse for performance,
accessibility, SEO, and best-practice scores, Web Vitals, and optimization
opportunities. Technology findings combine network, DOM, script, cookie, and
response-header evidence with a confidence level.
The dashboard can run baseline, accept-all, and reject-all scans. It records
whether a matching consent button was clicked and tags requests observed after
the action. Consent buttons inside closed shadow roots or cross-origin frames
may not be reachable.
The dashboard accepts an optional Playwright `storageState` JSON file for a
session you saved from a browser you control. The file is sent to the local
scanner for that scan only and is never written to scan history. Authenticated
reports omit Lighthouse because the separate audit browser cannot reuse the
uploaded session. Keep session files private.

For offline IP location and ASN lookups, download the GeoLite2 City and ASN
`.mmdb` files from MaxMind using your own account and set `GEOLITE2_CITY_DB`
and `GEOLITE2_ASN_DB` to their absolute paths before starting the server.
Without these files the report still shows resolved IPs and explicitly marks
country/ASN as unavailable. Vendor country is catalogue metadata about the
organisation; IP country is the current resolved server location.

For optional historical real-user Web Vitals, set `CRUX_API_KEY` to a Google
Chrome UX Report API key. The key is used only for CrUX history queries and is
not included in saved reports. Sites without enough CrUX traffic have no
history data.

### GeoLite2 and CrUX setup on Windows

1. Create a [MaxMind account](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/), generate a download license key, and download the **GeoLite2 City** and **GeoLite2 ASN** databases in `.mmdb` format. Extract both files to a private folder outside the repository and keep them updated under MaxMind's terms.
2. In the PowerShell window that will run the scanner, set the database paths:

   ```powershell
   $env:GEOLITE2_CITY_DB = 'C:\path\to\GeoLite2-City.mmdb'
   $env:GEOLITE2_ASN_DB = 'C:\path\to\GeoLite2-ASN.mmdb'
   ```

3. For real-user history, [enable the Chrome UX Report API and create a key](https://developer.chrome.com/docs/crux/history-api). Restrict the key to this API. Set `$env:CRUX_API_KEY` in the same PowerShell window using your private key, then run `npm start`. Do not commit the key or paste it into the dashboard.

The scanner never calls MaxMind web APIs. CrUX is queried only if its key is
configured. A missing database or insufficient CrUX traffic is displayed as
unavailable data, not as a zero measurement.

## Setup

Requires Node.js 22 or newer.

```powershell
npm install
npx playwright install chromium
npm start
```

Open http://127.0.0.1:4173 to start scans and explore the report. The server
binds to localhost. The API supports `POST /api/scans`, `GET /api/scans`,
`GET /api/scans/:id`, `GET /api/scans/:id/compare?with=:previousId`, and
`GET /api/scans/:id/json`, `/csv`, or `/pdf`.
Select **View demo report** to explore clearly labelled synthetic sample data
without running a crawl. The same sample is available at `GET /api/scans/demo`.

## Terminal run

```powershell
npm run crawl -- https://example.com 3 1
```

The arguments are URL, maximum pages, and maximum depth. Defaults are
`https://example.com`, `3`, and `1`.

Run `npm run typecheck` to check the TypeScript source.
Run `npm run smoke` to verify browser capture and value redaction against a
local fixture.
With the dashboard running, run `npm run ui-smoke` to verify the demo report in
Chromium.

## Measurement limits

Lighthouse metrics are lab measurements from this machine and connection.
Full DNS/TLS waterfall, certificate transparency, preference-level consent scans,
and scheduled scans are not implemented. Technology coverage is smaller than
commercial profilers. Third-party classification uses a small bundled catalogue
and should be reviewed before relying on it. Same-origin crawling obeys
robots.txt and bounded scan limits.
