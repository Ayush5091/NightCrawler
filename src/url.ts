import { MAX_URL_LENGTH } from "./ssrf";

/**
 * URL normalisation, scoping and de-duplication.
 *
 * Two jobs, and they fail in opposite directions:
 *
 *  - **Normalise too little** and the crawler visits `/`, `/?`, `/#top` and
 *    `/index.html?utm_source=x` as four pages, burning the page budget on one
 *    page and reporting a page count that means nothing.
 *  - **Normalise too much** and it silently merges genuinely different pages —
 *    `/product?id=1` and `/product?id=2` — and reports an inventory that is
 *    missing whatever only loaded on one of them.
 *
 * Every rule below is therefore written down rather than inferred, because the
 * second failure is invisible: nothing in the output says "we decided these were
 * the same page".
 */

/**
 * Query parameters dropped during normalisation.
 *
 * These are campaign and click-tracking parameters: they are attached *to* a
 * URL by an ad platform and never select different content. Dropping them
 * collapses the same page arriving from twelve campaigns into one crawl.
 *
 * This list is deliberately conservative and only contains parameters whose
 * sole purpose is attribution. Anything that might select content — `id`, `q`,
 * `page`, `lang` — is kept, even though keeping them costs budget.
 */
export const TRACKING_PARAMETERS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "gclid", "gclsrc", "dclid", "wbraid", "gbraid", // Google
  "fbclid", // Meta
  "msclkid", // Microsoft
  "twclid", // X
  "ttclid", // TikTok
  "igshid", // Instagram
  "mc_cid", "mc_eid", // Mailchimp
  "_hsenc", "_hsmi", "hsCtaTracking", // HubSpot
  "yclid", // Yandex
  "ref", "referrer", "source", // common hand-rolled attribution
]);

/** Schemes a link may use that are not navigations. Rejected without comment. */
const NON_NAVIGABLE_SCHEMES = new Set([
  "javascript:", "mailto:", "tel:", "sms:", "data:", "blob:", "file:",
  "ftp:", "ws:", "wss:", "about:", "chrome:", "view-source:", "intent:",
]);

/**
 * File extensions that are not HTML pages.
 *
 * Fetching a 200 MB video to discover it has no links wastes the whole budget.
 * Note this only affects **which URLs are queued as pages** — resources loaded
 * *by* a page are still observed as network requests, so a tracking pixel is
 * not missed by this.
 */
const NON_PAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp", ".tiff",
  ".mp4", ".webm", ".avi", ".mov", ".wmv", ".flv", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac",
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".bz2", ".xz",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods",
  ".css", ".js", ".mjs", ".map", ".json", ".xml", ".rss", ".atom",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dmg", ".apk", ".deb", ".rpm", ".msi", ".iso",
]);

export type UrlRejection =
  | "malformed"
  | "non_navigable_scheme"
  | "not_http"
  | "off_origin"
  | "non_page_extension"
  | "too_long"
  | "too_many_parameters";

export type NormalisedUrl =
  | { ok: true; url: string; origin: string }
  | { ok: false; reason: UrlRejection; detail?: string };

/**
 * A URL with more parameters than this is refused.
 *
 * A faceted-search page can generate a combinatorial explosion of URLs that are
 * all technically distinct. Refusing the deep end of that space is cruder than
 * modelling facets properly, but it is predictable and it is documented, which
 * an emergent crawl explosion is not.
 */
export const MAX_QUERY_PARAMETERS = 8;

/**
 * Canonicalises a URL for comparison and queuing.
 *
 * Applied in order:
 *  1. resolve against the page it was found on
 *  2. reject non-http(s) and non-navigable schemes
 *  3. lower-case scheme and host (case-insensitive by RFC 3986; the path is not)
 *  4. drop the fragment — never sent to a server, so it cannot change the response
 *  5. drop the default port (`:80` on http, `:443` on https)
 *  6. drop tracking parameters, then sort the rest so order does not create duplicates
 *  7. collapse `/index.html` and a bare trailing `/` to one form
 */
export function normaliseUrl(raw: string, base?: string): NormalisedUrl {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  const trimmed = raw.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed)?.[0]?.toLowerCase();
  if (scheme && NON_NAVIGABLE_SCHEMES.has(scheme)) {
    return { ok: false, reason: "non_navigable_scheme", detail: scheme };
  }

  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "not_http", detail: url.protocol };
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    if (TRACKING_PARAMETERS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  if (kept.length > MAX_QUERY_PARAMETERS) {
    return { ok: false, reason: "too_many_parameters", detail: String(kept.length) };
  }
  // Sorted so `?b=2&a=1` and `?a=1&b=2` are one URL rather than two.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = kept.length
    ? `?${kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : "";

  let path = url.pathname;
  // `/index.html` and `/` are the same page on essentially every server.
  path = path.replace(/\/index\.(html?|php|aspx?|jsp)$/i, "/");
  // Collapse duplicate slashes, which routers treat as equivalent.
  path = path.replace(/\/{2,}/g, "/");
  if (path === "") path = "/";
  url.pathname = path;

  const extension = /\.[a-z0-9]{1,8}$/i.exec(url.pathname)?.[0]?.toLowerCase();
  if (extension && NON_PAGE_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "non_page_extension", detail: extension };
  }

  const normalised = url.toString();
  if (normalised.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  return { ok: true, url: normalised, origin: url.origin };
}

/**
 * Same-origin test: scheme, host and port must all match.
 *
 * Deliberately origin and not registrable domain. `blog.example.com` is a
 * different origin from `www.example.com` and may be a different application
 * owned by a different team; crawling into it because the domain looks related
 * would be scanning something the customer did not ask us to scan.
 */
export function isSameOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** True when `host` is the origin's host or a subdomain of its registrable-ish suffix. */
export function isThirdParty(host: string, pageOrigin: string): boolean {
  let pageHost: string;
  try {
    pageHost = new URL(pageOrigin).hostname.toLowerCase();
  } catch {
    return true;
  }
  const candidate = host.toLowerCase().replace(/\.$/, "");
  if (candidate === pageHost) return false;
  // `cdn.example.com` is first-party to `example.com`, and vice versa. This is
  // a suffix test rather than a public-suffix-list lookup, which means it is
  // wrong for hosts under a multi-party suffix such as `github.io`. Documented
  // in docs/crawler.md; the PSL is the upgrade.
  return !(candidate.endsWith(`.${pageHost}`) || pageHost.endsWith(`.${candidate}`));
}

/** Applies normalisation and scope in one step, for the link queue. */
export function acceptLink(
  raw: string,
  base: string,
  scopeOrigin: string,
): NormalisedUrl {
  const normalised = normaliseUrl(raw, base);
  if (!normalised.ok) return normalised;
  if (!isSameOrigin(normalised.url, scopeOrigin)) {
    return { ok: false, reason: "off_origin", detail: normalised.origin };
  }
  return normalised;
}
