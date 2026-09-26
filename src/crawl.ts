import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { detectTechnologies } from "./detectors";
import { classifyHost } from "./tracker-catalogue";
import { classifyField, fieldsFromBody, fieldsFromUrl } from "./analysis";
import { inspectInfrastructure } from "./infrastructure";
import { enrichGeo } from "./geoip";
import { detectStackTechnologies, fingerprintScript } from "./tech-intel";
import { assertNavigable, type Resolver } from "./ssrf";
import { acceptLink, isThirdParty, normaliseUrl } from "./url";
import { isAllowed, parseRobots, pathForRobots, permissivePolicy, type RobotsPolicy } from "./robots";
import {
  DEFAULT_LIMITS,
  type ConsentUiObservation,
  type ConsentUiSignal,
  type CookieObservation,
  type CrawlLimits,
  type PageObservation,
  type RequestObservation,
  type ScanMode,
  type ScanResult,
  type ScriptObservation,
  type StorageObservation,
} from "./types";

export const CRAWLER_VERSION = "1.1.0";

/**
 * The scanner identifies itself honestly and stably.
 *
 * A crawler that hides behind a browser user-agent cannot be blocked by a site
 * that does not want it, cannot be recognised in a customer's own access logs,
 * and cannot be matched by the `User-agent` group in their robots.txt. All
 * three are reasons to be identifiable rather than stealthy.
 */
export const USER_AGENT = `RiftCMP-Scanner/${CRAWLER_VERSION} (+https://rift-cmp.dev/scanner)`;

export interface CrawlOptions {
  startUrl: string;
  mode?: ScanMode;
  device?: "desktop" | "mobile";
  /** Playwright storageState JSON supplied for this scan; never persisted. */
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
  limits?: Partial<CrawlLimits>;
  /** Injected in tests so DNS behaviour can be exercised deterministically. */
  resolver?: Resolver;
  /**
   * Permit loopback and private targets. **Tests only.**
   *
   * The rendering half of the crawler cannot otherwise be exercised: the SSRF
   * guard refuses 127.0.0.1, so the alternative is pointing tests at the live
   * internet. Never set by the worker or reachable from the HTTP API - see the
   * note in `ssrf.ts`.
   */
  allowPrivateTargets?: boolean;
  /** Structured progress, without values or headers. See docs/crawler.md. */
  onEvent?: (event: CrawlEvent) => void;
  signal?: AbortSignal;
}

export interface CrawlEvent {
  event: string;
  url?: string;
  status?: number;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

/** Thrown only for failures that make the whole scan meaningless. */
export class ScanFatalError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ScanFatalError";
  }
}

/**
 * Cookie names that indicate a consent manager is present.
 *
 * Detecting a consent UI is *not* the same as judging it. This records that
 * something consent-shaped exists and why we think so; whether it is valid,
 * sufficient, or lawful is a question for the compliance layer and a human.
 */
/**
 * Cookie and storage key fragments that indicate a consent manager.
 *
 * Matched as substrings, case-insensitively, because CMPs suffix their keys
 * with account or property ids — Sourcepoint writes `_sp_user_consent_7417`,
 * and matching the exact string would find nobody.
 */
const CMP_STORAGE_NAMES = [
  "cookieconsent", "optanonconsent", "optanonalertboxclosed", "euconsent-v2",
  "cookielawinfo-checkbox-necessary", "borlabs-cookie", "cookie_notice_accepted",
  "cmplz_consent_status", "complianz_consent_status", "__cmpconsent",
  "consentuuid", "_sp_user_consent", "_sp_non_keyed", "usercentrics",
  "cookieyes", "didomi_token", "iub_", "osano_consentmanager", "trustarc",
];

const CMP_SCRIPT_PATTERNS = [
  "cookiebot.com", "cookielaw.org", "onetrust", "usercentrics", "cookieyes",
  "termly.io", "iubenda.com", "quantcast", "didomi.io", "trustarc.com",
  "osano.com", "complianz", "borlabs", "klaro", "cookiehub",
  // Added after a real crawl: the Guardian runs Sourcepoint and was reported as
  // having no consent interface at all.
  "sourcepoint", "sp-prod.net", "consensu.org", "privacymanager.io",
];

/** Button text that suggests a consent choice, in a few common languages. */
const CONSENT_BUTTON_TEXT = [
  "accept all", "accept cookies", "accept", "agree", "i agree", "allow all",
  "reject all", "reject", "decline", "deny",
  "manage preferences", "cookie settings", "privacy settings", "customise", "customize",
  "alle akzeptieren", "tout accepter", "aceptar todo",
];

interface Budget {
  requests: number;
  cookies: number;
  scripts: number;
  storage: number;
}

/**
 * Crawls a site and returns raw observations.
 *
 * This function performs **no persistence and no classification of legality**.
 * It returns what it saw; the worker persists it and the compliance layer, owned
 * by another person, decides what any of it means.
 */
export async function crawl(options: CrawlOptions): Promise<ScanResult> {
  const limits: CrawlLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const mode: ScanMode = options.mode ?? "baseline";
  const device = options.device ?? "desktop";
  const emit = options.onEvent ?? (() => {});
  const startedAt = new Date();
  const deadline = startedAt.getTime() + limits.maxDurationMs;

  // ── 1. Validate the entry point before starting a browser ──────────────────
  const entry = normaliseUrl(options.startUrl);
  if (!entry.ok) {
    throw new ScanFatalError(`Start URL rejected: ${entry.reason}`, "invalid_start_url");
  }

  const guard = await assertNavigable(entry.url, {
    resolver: options.resolver,
    allowPrivateTargets: options.allowPrivateTargets,
  });
  if (!guard.allowed) {
    // Deliberately fatal. A start URL pointing at private space is not a page
    // failure to be recorded and stepped over; it is a request we must refuse.
    throw new ScanFatalError(
      `Start URL rejected by the SSRF guard: ${guard.reason} (${guard.detail})`,
      "ssrf_blocked",
    );
  }

  const scopeOrigin = new URL(entry.url).origin;
  const infrastructurePromise = inspectInfrastructure(entry.url).catch(() => ({ dns: {}, tls: null }));

  // ── 2. robots.txt ──────────────────────────────────────────────────────────
  const robots = await fetchRobots(scopeOrigin, emit);
  let disallowedSkipped = 0;

  // ── 3. Browser ─────────────────────────────────────────────────────────────
  let browser: Browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (error) {
    throw new ScanFatalError(
      `Could not start the browser: ${(error as Error).message}`,
      "browser_launch_failed",
    );
  }

  // One context per scan. Never reused across scans: cookies and storage from
  // one customer's site must not be visible while scanning another's.
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      userAgent: USER_AGENT,
      ignoreHTTPSErrors: false,
      viewport: device === "mobile" ? { width: 390, height: 844 } : { width: 1366, height: 900 },
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
      serviceWorkers: "allow",
      storageState: options.storageState,
    });
  } catch {
    await browser.close().catch(() => {});
    throw new ScanFatalError("Could not load the browser session file", "invalid_session_state");
  }

  const pages: PageObservation[] = [];
  const requests: RequestObservation[] = [];
  const scripts: ScriptObservation[] = [];
  const storage: StorageObservation[] = [];
  const cookieFirstSeen = new Map<string, { page: string; phase: CookieObservation["phase"] }>();
  const consentSignals: ConsentUiSignal[] = [];
  let consentAction: ConsentUiObservation["action"] = null;
  const websockets: Array<{ url: string; observedOn: string }> = [];
  let consentSeenOn: string | null = null;

  const budget: Budget = { requests: 0, cookies: 0, scripts: 0, storage: 0 };
  let limitReached: string | null = null;
  const noteLimit = (name: string) => {
    if (!limitReached) limitReached = name;
  };

  const queue: Array<{ url: string; depth: number }> = [{ url: entry.url, depth: 0 }];
  const seen = new Set<string>([entry.url]);
  let discovered = 1;

  try {
    while (queue.length > 0) {
      if (options.signal?.aborted) {
        noteLimit("cancelled");
        break;
      }
      if (Date.now() > deadline) {
        noteLimit("maxDuration");
        emit({ event: "limit_reached", limit: "maxDuration" });
        break;
      }
      if (pages.length >= limits.maxPages) {
        noteLimit("maxPages");
        emit({ event: "limit_reached", limit: "maxPages" });
        break;
      }

      // Concurrency is a slice of the queue rather than a worker pool: the
      // queue is short-lived and bounded, and a pool would add failure modes
      // for no throughput that matters at these limits.
      //
      // The slice is also capped by what is left of the page budget. Taking a
      // full batch and checking the limit only at the top of the loop
      // overshoots `maxPages` by up to `concurrency - 1`: with a budget of 2 and
      // a concurrency of 2, the first pass visits the entry page and the second
      // takes two more, for three. A page limit that a caller can exceed is not
      // a limit, and this is the only bound between a hostile site and the
      // crawl budget it can consume.
      const remaining = limits.maxPages - pages.length;
      const batch = queue.splice(0, Math.max(1, Math.min(limits.concurrency, remaining)));

      const results = await Promise.all(
        batch.map((item) =>
          visitPage(context, item.url, item.depth, {
            limits,
            scopeOrigin,
            robots,
            resolver: options.resolver,
            allowPrivateTargets: options.allowPrivateTargets,
            budget,
            noteLimit,
            emit,
            mode,
          }),
        ),
      );

      for (const result of results) {
        pages.push(result.page);
        requests.push(...result.requests);
        scripts.push(...result.scripts);
        storage.push(...result.storage);
        for (const item of result.cookieSeen) if (!cookieFirstSeen.has(item.key)) cookieFirstSeen.set(item.key, { page: item.page, phase: item.phase });
        websockets.push(...result.websockets);
        if (result.consentSignals.length > 0 && !consentSeenOn) {
          consentSeenOn = result.page.url;
          consentSignals.push(...result.consentSignals);
        }
        if (result.consentAction?.succeeded) consentAction = result.consentAction;
        disallowedSkipped += result.disallowedSkipped;

        for (const link of result.links) {
          if (seen.has(link)) continue;
          if (result.page.depth + 1 > limits.maxDepth) continue;
          if (discovered >= limits.maxPages * 4) {
            // Bound the queue itself, not only what we visit: a link farm can
            // otherwise exhaust memory long before the page limit is reached.
            noteLimit("queueBound");
            break;
          }
          seen.add(link);
          discovered += 1;
          queue.push({ url: link, depth: result.page.depth + 1 });
        }
      }

      if (robots.crawlDelaySeconds && queue.length > 0) {
        await sleep(Math.min(robots.crawlDelaySeconds * 1000, 10_000));
      }
    }

    // ── 4. Cookies, read once from the context at the end ────────────────────
    const cookies = await collectCookies(context, scopeOrigin, limits, budget, noteLimit, cookieFirstSeen);
    const serviceWorkers = context.serviceWorkers().map((worker) => stripUrlValues(worker.url())).filter((value): value is string => !!value);

    const technologies = detectTechnologies(
      { requests, scripts, cookies, storage },
      { maxEvidencePerFinding: limits.maxEvidencePerFinding },
    );
    for (const finding of detectStackTechnologies({ pages, requests, scripts, cookies })) {
      const existing = technologies.find((item) => item.name === finding.name);
      if (existing) {
        existing.evidence.push(...finding.evidence.filter((item) => !existing.evidence.some((other) => other.value === item.value)).slice(0, Math.max(0, limits.maxEvidencePerFinding - existing.evidence.length)));
        if (finding.confidence === "high") existing.confidence = "high";
        if (finding.version) existing.version = finding.version;
      } else technologies.push(finding);
    }

    const thirdPartyDomains = new Set(
      requests.filter((request) => request.isThirdParty).map((request) => request.host),
    );

    // Cookies and storage are the most reliable consent-manager signal, and the
    // only one that survives a banner the crawler never saw: a returning visitor
    // is not shown the dialog, and a CMP loaded inside an iframe leaves nothing
    // matchable in the top document. Both are only known once the crawl is over,
    // which is why this runs here rather than per page.
    //
    // The first real crawl found this missing entirely: a site running
    // Sourcepoint reported `consent_ui_detected: false` while writing a
    // `consentUUID` cookie and three `_sp_*` storage keys.
    for (const cookie of cookies) {
      const name = cookie.name.toLowerCase();
      if (CMP_STORAGE_NAMES.some((pattern) => name.includes(pattern))) {
        consentSignals.push({ kind: "known_cmp_cookie", detail: cookie.name });
      }
    }
    for (const item of storage) {
      const name = item.name.toLowerCase();
      if (CMP_STORAGE_NAMES.some((pattern) => name.includes(pattern))) {
        consentSignals.push({ kind: "known_cmp_cookie", detail: `${item.kind}:${item.name}` });
      }
    }

    const completedAt = new Date();

    const deduplicatedSignals = consentSignals.filter(
      (signal, index) =>
        consentSignals.findIndex((s) => s.kind === signal.kind && s.detail === signal.detail) === index,
    );

    const consentUi: ConsentUiObservation = {
      detected: deduplicatedSignals.length > 0,
      signals: deduplicatedSignals.slice(0, 10),
      observedOn: stripUrlValues(consentSeenOn),
      action: consentAction ? { ...consentAction, attemptedOn: stripUrlValues(consentAction.attemptedOn) } : null,
    };

    // Navigation keeps query values internally so distinct routes still render.
    // The returned report only contains URL paths and parameter names.
    for (const observed of pages) {
      observed.url = stripUrlValues(observed.url) ?? observed.url;
      observed.finalUrl = stripUrlValues(observed.finalUrl);
      observed.redirectChain = observed.redirectChain.map((item) => stripUrlValues(item) ?? item);
      if (observed.error) observed.error = observed.error.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1?[redacted]");
    }
    for (const observed of requests) {
      observed.observedOn = stripUrlValues(observed.observedOn) ?? observed.observedOn;
    }
    for (const observed of scripts) observed.observedOn = stripUrlValues(observed.observedOn) ?? observed.observedOn;
    for (const observed of storage) observed.observedOn = stripUrlValues(observed.observedOn) ?? observed.observedOn;
    for (const observed of cookies) observed.firstSeenOn = stripUrlValues(observed.firstSeenOn) ?? observed.firstSeenOn;
    for (const observed of websockets) observed.observedOn = stripUrlValues(observed.observedOn) ?? observed.observedOn;

    const rootHost = new URL(entry.url).hostname;
    const subdomains = [...new Set([...requests.map((request) => request.host), ...pages.flatMap((page) => (page.frames ?? []).map((frame) => { try { return new URL(frame).hostname; } catch { return ""; } }))].filter((host) => host !== rootHost && host.endsWith(`.${rootHost}`)))].sort();

    const infrastructure: NonNullable<ScanResult["infrastructure"]> = await infrastructurePromise;
    infrastructure.geo = await enrichGeo(entry.url, requests).catch(() => ({ status: "lookup_failed" as const, ip: null, country: null, city: null, asn: null, networkOwner: null }));

    return {
      startUrl: stripUrlValues(entry.url) ?? entry.url,
      mode,
      authenticated: !!options.storageState,
      device,
      crawlerVersion: CRAWLER_VERSION,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      limits,
      robots: {
        source: robots.source,
        crawlDelaySeconds: robots.crawlDelaySeconds,
        disallowedSkipped,
      },
      pages,
      cookies,
      scripts,
      requests,
      storage,
      consentUi,
      technologies,
      summary: {
        pagesDiscovered: discovered,
        pagesScanned: pages.filter((page) => page.rendered).length,
        pagesFailed: pages.filter((page) => !page.rendered).length,
        cookiesFound: cookies.length,
        scriptsFound: scripts.length,
        requestsObserved: requests.length,
        storageItemsFound: storage.length,
        thirdPartyDomains: thirdPartyDomains.size,
        technologiesDetected: technologies.length,
        consentUiDetected: consentUi.detected,
        limitReached,
      },
      infrastructure,
      subdomains,
      serviceWorkers,
      websockets,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

interface VisitContext {
  limits: CrawlLimits;
  scopeOrigin: string;
  robots: RobotsPolicy;
  resolver?: Resolver;
  allowPrivateTargets?: boolean;
  budget: Budget;
  noteLimit: (name: string) => void;
  emit: (event: CrawlEvent) => void;
  mode: ScanMode;
}

interface VisitResult {
  page: PageObservation;
  requests: RequestObservation[];
  scripts: ScriptObservation[];
  storage: StorageObservation[];
  links: string[];
  consentSignals: ConsentUiSignal[];
  disallowedSkipped: number;
  websockets: Array<{ url: string; observedOn: string }>;
  consentAction: ConsentUiObservation["action"];
  cookieSeen: Array<{ key: string; page: string; phase: CookieObservation["phase"] }>;
}

/**
 * Renders one page and records what it did.
 *
 * A failure here is recorded and returned, never thrown: one page timing out
 * must not lose the other ninety-nine pages' observations.
 */
async function visitPage(
  context: BrowserContext,
  url: string,
  depth: number,
  ctx: VisitContext,
): Promise<VisitResult> {
  const startedAt = new Date();
  const requests: RequestObservation[] = [];
  const scripts: ScriptObservation[] = [];
  const storage: StorageObservation[] = [];
  const consentSignals: ConsentUiSignal[] = [];
  let consentAction: ConsentUiObservation["action"] = null;
  const cookieSeen: VisitResult["cookieSeen"] = [];
  let phase: RequestObservation["phase"] = "before_consent_action";
  const websockets: Array<{ url: string; observedOn: string }> = [];
  let links: string[] = [];
  let disallowedSkipped = 0;

  const base: PageObservation = {
    url,
    finalUrl: null,
    status: null,
    title: null,
    contentType: null,
    depth,
    redirectChain: [],
    rendered: false,
    error: null,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
  };

  const finish = (page: PageObservation): VisitResult => ({
    page: { ...page, durationMs: Date.now() - startedAt.getTime() },
    requests,
    scripts,
    storage,
    links,
    consentSignals,
    disallowedSkipped,
    websockets,
    consentAction,
    cookieSeen,
  });

  if (!isAllowed(ctx.robots, pathForRobots(url))) {
    disallowedSkipped += 1;
    ctx.emit({ event: "page_skipped_robots", url });
    return finish({ ...base, error: "disallowed_by_robots" });
  }

  // Re-checked per page, not once per scan: a link or redirect is an
  // attacker-controlled path from an allowed origin to a disallowed one.
  const guard = await assertNavigable(url, {
    resolver: ctx.resolver,
    allowPrivateTargets: ctx.allowPrivateTargets,
  });
  if (!guard.allowed) {
    ctx.emit({ event: "page_skipped_ssrf", url, error: guard.reason });
    return finish({ ...base, error: `ssrf_blocked:${guard.reason}` });
  }

  let page: Page;
  try {
    page = await context.newPage();
  } catch (error) {
    return finish({ ...base, error: `page_open_failed: ${(error as Error).message}` });
  }

  const pageOrigin = new URL(url).origin;
  const requestIndex = new WeakMap<import("playwright").Request, RequestObservation>();
  const scriptSignals = new Set<string>();
  const scriptTasks: Promise<void>[] = [];

  // ── Network observation ─────────────────────────────────────────────────
  // Metadata only. No headers are read, no bodies are touched, and the URL is
  // stripped of query and fragment *at capture* so an identifier is never held
  // in memory as part of an observation.
  page.on("request", (request) => {
    if (ctx.budget.requests >= ctx.limits.maxRequests) {
      ctx.noteLimit("maxRequests");
      return;
    }
    try {
      const parsed = new URL(request.url());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      ctx.budget.requests += 1;
      const vendor = classifyHost(parsed.hostname);
      const observation: RequestObservation = {
        url: `${parsed.origin}${parsed.pathname}`,
        host: parsed.hostname,
        method: request.method(),
        resourceType: request.resourceType(),
        status: null,
        isThirdParty: isThirdParty(parsed.hostname, pageOrigin),
        observedOn: url,
        failed: false,
        startedAt: new Date().toISOString(),
        queryFields: fieldsFromUrl(request.url()),
        bodyFields: fieldsFromBody(request.postData(), request.headers()["content-type"] ?? ""),
        frameUrl: (() => { try { const frame = request.frame().url(); const u = new URL(frame); return `${u.origin}${u.pathname}`; } catch { return null; } })(),
        initiator: (() => { try { const from = request.redirectedFrom(); return from ? new URL(from.url()).origin + new URL(from.url()).pathname : null; } catch { return null; } })(),
        vendor: vendor.vendor,
        vendorCategory: vendor.category,
        destinationCountry: vendor.destination_country,
        phase,
      };
      requests.push(observation);
      requestIndex.set(request, observation);

      if (request.resourceType() === "script") {
        if (ctx.budget.scripts < ctx.limits.maxScripts) {
          ctx.budget.scripts += 1;
          scripts.push({
            // Origin + path, matching how request URLs are captured above. A
            // script URL is normally harmless (`/gtag/js?id=G-X`), but a
            // first-party one can carry a session token in its query, and the
            // rule that query strings are never collected has to hold for every
            // captured URL or it is not a rule. Detection is unaffected: every
            // script signature matches on the path.
            url: `${parsed.origin}${parsed.pathname}`,
            host: parsed.hostname,
            inline: false,
            isThirdParty: isThirdParty(parsed.hostname, pageOrigin),
            observedOn: url,
          });
        } else {
          ctx.noteLimit("maxScripts");
        }
        if (CMP_SCRIPT_PATTERNS.some((pattern) => parsed.hostname.includes(pattern))) {
          consentSignals.push({ kind: "known_cmp_script", detail: parsed.hostname });
        }
      }
    } catch {
      // A malformed request URL is not worth failing a page over.
    }
  });

  page.on("response", (response) => {
    const target = requestIndex.get(response.request());
    if (target) {
      target.status = response.status();
      target.contentType = response.headers()["content-type"] ?? null;
    }
    if (response.request().resourceType() === "script" && scriptTasks.length < 4) {
      try {
        if (new URL(response.url()).origin === pageOrigin && Number(response.headers()["content-length"] ?? 0) < 750_000) {
          scriptTasks.push(response.text().then((source) => {
            if (source.length <= 750_000) for (const signal of fingerprintScript(source)) scriptSignals.add(signal);
          }).catch(() => {}));
        }
      } catch { /* malformed resource URL */ }
    }
  });

  page.on("requestfinished", async (request) => {
    const target = requestIndex.get(request);
    if (!target) return;
    try {
      const timing = request.timing();
      target.durationMs = timing.responseEnd >= 0 ? Math.round(timing.responseEnd) : null;
      const span = (start: number, end: number) => start >= 0 && end >= start ? Math.round(end - start) : null;
      target.timing = {
        startOffsetMs: timing.startTime > 0 ? Math.max(0, Math.round(timing.startTime - startedAt.getTime())) : null,
        dnsMs: span(timing.domainLookupStart, timing.domainLookupEnd),
        connectionMs: span(timing.connectStart, timing.connectEnd),
        tlsMs: span(timing.secureConnectionStart, timing.connectEnd),
        ttfbMs: span(timing.requestStart, timing.responseStart),
        downloadMs: span(timing.responseStart, timing.responseEnd),
      };
      const sizes = await request.sizes();
      target.transferBytes = sizes.responseBodySize + sizes.responseHeadersSize;
    } catch { /* a closed page can interrupt late requests */ }
  });

  page.on("requestfailed", (request) => {
    const target = requestIndex.get(request);
    if (target) target.failed = true;
  });
  page.on("websocket", (socket) => {
    const safe = stripUrlValues(socket.url().replace(/^wss?:/, (protocol) => protocol === "wss:" ? "https:" : "http:"));
    if (safe && websockets.length < 100) websockets.push({ url: safe.replace(/^https?:/, (protocol) => protocol === "https:" ? "wss:" : "ws:"), observedOn: url });
  });

  // ── Navigate ────────────────────────────────────────────────────────────
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: ctx.limits.navigationTimeoutMs,
    });

    const chain = redirectChain(response);
    if (chain.length > ctx.limits.maxRedirects) {
      await page.close().catch(() => {});
      return finish({ ...base, redirectChain: chain, error: "too_many_redirects" });
    }

    // Any redirect could have crossed into private space. Check where we
    // actually landed, not only where we intended to go.
    const landed = page.url();
    if (landed !== url) {
      const landedGuard = await assertNavigable(landed, {
        resolver: ctx.resolver,
        allowPrivateTargets: ctx.allowPrivateTargets,
      });
      if (!landedGuard.allowed) {
        await page.close().catch(() => {});
        return finish({
          ...base,
          finalUrl: landed,
          redirectChain: chain,
          error: `ssrf_blocked_after_redirect:${landedGuard.reason}`,
        });
      }
    }

    await stabilise(page, ctx.limits.stabilisationMs);
    cookieSeen.push(...await snapshotCookieKeys(context, url, "before_consent_action"));
    await Promise.race([Promise.allSettled(scriptTasks), sleep(2000)]);

    const contentType = response?.headers()["content-type"] ?? null;
    const title = await page.title().catch(() => null);
    const pageDetails = await readPageDetails(page, pageOrigin);
    pageDetails.frontendSignals = [...new Set([...(pageDetails.frontendSignals ?? []), ...scriptSignals])];
    const securityHeaders = Object.fromEntries([
      "strict-transport-security", "content-security-policy", "x-content-type-options",
      "referrer-policy", "permissions-policy", "cross-origin-opener-policy",
      "cross-origin-embedder-policy", "cross-origin-resource-policy", "access-control-allow-origin",
      "server", "x-powered-by",
    ].map((key) => [key, response?.headers()[key] ?? null]));

    // ── Storage: key names only ─────────────────────────────────────────
    const storageKeys = await readStorageKeys(page);
    for (const item of storageKeys) {
      if (ctx.budget.storage >= ctx.limits.maxStorageItems) {
        ctx.noteLimit("maxStorageItems");
        break;
      }
      ctx.budget.storage += 1;
      storage.push({ ...item, origin: pageOrigin, observedOn: url });
    }

    // ── Inline scripts and consent UI ───────────────────────────────────
    const domSignals = await readDomSignals(page);
    if (domSignals.inlineScripts > 0 && ctx.budget.scripts < ctx.limits.maxScripts) {
      ctx.budget.scripts += 1;
      scripts.push({
        url: null,
        host: null,
        inline: true,
        isThirdParty: false,
        observedOn: url,
      });
    }
    for (const text of domSignals.consentButtons) {
      consentSignals.push({ kind: "button_text", detail: text });
    }
    if (domSignals.consentDomPattern) {
      consentSignals.push({ kind: "dom_pattern", detail: domSignals.consentDomPattern });
    }

    if (ctx.mode === "all" || ctx.mode === "necessary_only") {
      const choice = ctx.mode === "all" ? "accept" : "reject";
      const names = choice === "accept" ? /^(accept all|accept cookies|allow all|alle akzeptieren|tout accepter|aceptar todo)$/i : /^(reject all|reject|decline|deny)$/i;
      consentAction = { choice, attemptedOn: url, succeeded: false };
      try {
        phase = "after_consent_action";
        await page.getByRole("button", { name: names }).first().click({ timeout: 1500 });
        consentAction.succeeded = true;
        await stabilise(page, Math.min(ctx.limits.stabilisationMs, 1500));
        cookieSeen.push(...await snapshotCookieKeys(context, url, "after_consent_action"));
      } catch { phase = "before_consent_action"; /* banner missing or button cannot be clicked */ }
    }

    links = await collectLinks(page, url, ctx.scopeOrigin);

    await page.close().catch(() => {});

    ctx.emit({
      event: "page_scanned",
      url,
      status: response?.status(),
      durationMs: Date.now() - startedAt.getTime(),
    });

    return finish({
      ...base,
      finalUrl: landed === url ? null : landed,
      status: response?.status() ?? null,
      title,
      contentType,
      redirectChain: chain,
      rendered: true,
      ...pageDetails,
      securityHeaders,
    });
  } catch (error) {
    await page.close().catch(() => {});
    const message = (error as Error).message.slice(0, 300);
    ctx.emit({ event: "page_failed", url, error: message });
    return finish({ ...base, error: message });
  }
}

/**
 * Waits for the page to settle, with a hard ceiling.
 *
 * `networkidle` alone is not usable: a site with a poll, a websocket or an ad
 * refresh never reaches it, and the crawl would spend its entire duration
 * budget on one page. So this races idleness against a fixed timeout and
 * accepts whichever comes first — a page that never settles is simply observed
 * as it was after the ceiling.
 */
async function stabilise(page: Page, stabilisationMs: number): Promise<void> {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: stabilisationMs }).catch(() => {}),
    sleep(stabilisationMs),
  ]);
}

/** Reads storage **key names**. Values are never read into this process. */
async function readStorageKeys(
  page: Page,
): Promise<Array<{ kind: StorageObservation["kind"]; name: string }>> {
  try {
    return await page.evaluate(async () => {
      const found: Array<{ kind: "local_storage" | "session_storage" | "indexed_db"; name: string }> = [];
      const cap = 200;
      try {
        for (let i = 0; i < Math.min(localStorage.length, cap); i += 1) {
          const key = localStorage.key(i);
          if (key) found.push({ kind: "local_storage", name: key });
        }
      } catch {
        /* storage can be blocked; observing less is fine */
      }
      try {
        for (let i = 0; i < Math.min(sessionStorage.length, cap); i += 1) {
          const key = sessionStorage.key(i);
          if (key) found.push({ kind: "session_storage", name: key });
        }
      } catch {
        /* ignored */
      }
      try {
        const databases = await indexedDB.databases();
        for (const database of databases.slice(0, cap)) if (database.name) found.push({ kind: "indexed_db", name: database.name });
      } catch {
        /* IndexedDB listing may be unavailable */
      }
      return found;
    });
  } catch {
    return [];
  }
}

async function readDomSignals(page: Page): Promise<{
  inlineScripts: number;
  consentButtons: string[];
  consentDomPattern: string | null;
}> {
  try {
    return await page.evaluate((phrases: string[]) => {
      const inlineScripts = document.querySelectorAll("script:not([src])").length;

      const buttons = Array.from(
        document.querySelectorAll('button, a[role="button"], [type="button"], [role="button"]'),
      ).slice(0, 300);

      const consentButtons: string[] = [];
      for (const element of buttons) {
        const text = (element.textContent ?? "").trim().toLowerCase().slice(0, 60);
        if (!text) continue;
        if (phrases.some((phrase) => text === phrase || text.includes(phrase))) {
          if (!consentButtons.includes(text)) consentButtons.push(text);
        }
        if (consentButtons.length >= 5) break;
      }

      const selectors = [
        "#onetrust-banner-sdk", "#CybotCookiebotDialog", "#usercentrics-root",
        "[id*='cookie-banner']", "[class*='cookie-banner']", "[id*='cookie-consent']",
        "[class*='cookie-consent']", "[aria-label*='cookie' i]", "#cookiescript_injected",
      ];
      let consentDomPattern: string | null = null;
      for (const selector of selectors) {
        try {
          if (document.querySelector(selector)) {
            consentDomPattern = selector;
            break;
          }
        } catch {
          /* invalid selector in an old engine */
        }
      }

      return { inlineScripts, consentButtons, consentDomPattern };
    }, CONSENT_BUTTON_TEXT);
  } catch {
    return { inlineScripts: 0, consentButtons: [], consentDomPattern: null };
  }
}

async function readPageDetails(page: Page, pageOrigin: string): Promise<Partial<PageObservation>> {
  try {
    const details = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByName("first-contentful-paint")[0];
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const fields = Array.from(document.querySelectorAll("form")).slice(0, 50).map((form) => ({
        action: (form as HTMLFormElement).action,
        method: ((form as HTMLFormElement).method || "GET").toUpperCase(),
        fields: Array.from(form.querySelectorAll("input,select,textarea")).slice(0, 60).map((el) => ({
          name: (el as HTMLInputElement).name || el.id || "unnamed",
          type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
        })),
      }));
      const headings: Record<string, number> = {};
      for (let i = 1; i <= 6; i++) headings[`h${i}`] = document.querySelectorAll(`h${i}`).length;
      return {
        description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null,
        canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
        headings,
        seo: {
          robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null,
          viewport: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? null,
          openGraph: !!document.querySelector('meta[property^="og:"]'),
          structuredData: document.querySelectorAll('script[type="application/ld+json"]').length,
          imagesMissingAlt: document.querySelectorAll("img:not([alt])").length,
          inputsMissingLabel: Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea")).filter((el) => !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !(el as HTMLInputElement).labels?.length).length,
          internalLinks: document.querySelectorAll("a[href]").length,
        },
        performance: {
          domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          loadMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
          fcpMs: paint ? Math.round(paint.startTime) : null,
          lcpMs: null, cls: null,
          resourceCount: resources.length,
          transferBytes: resources.reduce((sum, item) => sum + item.transferSize, 0),
        },
        frames: Array.from(document.querySelectorAll("iframe[src]")).slice(0, 50).map((el) => (el as HTMLIFrameElement).src),
        forms: fields,
        frontendSignals: [
          document.querySelector("#__next,script#__NEXT_DATA__") && "next",
          document.querySelector("#__nuxt,[data-nuxt]") && "nuxt",
          document.querySelector("[data-reactroot],[data-reactid]") && "react",
          document.querySelector("[data-v-app]") && "vue",
          document.querySelector("[ng-version],[ng-app]") && "angular",
          document.querySelector("[data-sveltekit-preload-data]") && "svelte",
          document.querySelector("astro-island") && "astro",
          document.querySelector('meta[name="generator"][content*="WordPress" i]') && "wordpress",
          document.querySelector('link[href*="cdn.shopify.com"]') && "shopify",
          document.querySelector('html[data-wf-site]') && "webflow",
          document.querySelector('script[type="module"][src*="/assets/"]') && "vite",
          (window as unknown as { jQuery?: unknown }).jQuery && "jquery",
          (window as unknown as { bootstrap?: unknown }).bootstrap && "bootstrap",
          document.querySelector('meta[name="generator"][content*="Drupal" i]') && "drupal",
        ].filter((signal): signal is string => typeof signal === "string"),
      };
    });
    return {
      ...details,
      canonical: stripUrlValues(details.canonical),
      frames: details.frames.map(stripUrlValues).filter((v): v is string => !!v),
      forms: details.forms.map((form) => ({
        action: stripUrlValues(form.action) ?? "",
        method: form.method,
        external: (() => { try { return new URL(form.action).origin !== pageOrigin; } catch { return false; } })(),
        fields: form.fields.map((field) => ({ ...field, name: field.name.slice(0, 100), dataCategory: classifyField(field.name) })),
      })),
    };
  } catch { return {}; }
}

function stripUrlValues(raw: string | null): string | null {
  if (!raw) return null;
  try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return null; }
}

async function collectLinks(page: Page, base: string, scopeOrigin: string): Promise<string[]> {
  let hrefs: string[] = [];
  try {
    hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 500)
        .map((anchor) => (anchor as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter(Boolean),
    );
  } catch {
    return [];
  }

  const accepted = new Set<string>();
  for (const href of hrefs) {
    const result = acceptLink(href, base, scopeOrigin);
    if (result.ok) accepted.add(result.url);
  }
  return [...accepted];
}

/**
 * Reads cookies from the context.
 *
 * **Values are dropped here and never leave this function.** Playwright returns
 * them whether we want them or not, so the discard is explicit and happens at
 * the boundary rather than at the database.
 */
async function collectCookies(
  context: BrowserContext,
  scopeOrigin: string,
  limits: CrawlLimits,
  budget: Budget,
  noteLimit: (name: string) => void,
  firstSeen: Map<string, { page: string; phase: CookieObservation["phase"] }>,
): Promise<CookieObservation[]> {
  let raw: Awaited<ReturnType<BrowserContext["cookies"]>>;
  try {
    raw = await context.cookies();
  } catch {
    return [];
  }

  const observations: CookieObservation[] = [];
  for (const cookie of raw) {
    if (budget.cookies >= limits.maxCookies) {
      noteLimit("maxCookies");
      break;
    }
    budget.cookies += 1;
    const recorded = firstSeen.get(`${cookie.domain}|${cookie.path}|${cookie.name}`);
    const host = cookie.domain.replace(/^\./, "");
    const catalogue = classifyHost(host);
    const name = cookie.name.toLowerCase();
    const namedVendor = /^_ga(?:_|$)|^_gid$/.test(name) ? "Google Analytics" : /^_fb[pc]$/.test(name) ? "Meta Pixel" : /^__stripe_/.test(name) ? "Stripe" : null;
    const category = namedVendor === "Google Analytics" ? "analytics" : namedVendor === "Meta Pixel" ? "advertising" : namedVendor === "Stripe" ? "payments" : CMP_STORAGE_NAMES.some((pattern) => name.includes(pattern)) ? "consent_management" : /session|auth|token/.test(name) ? "functional" : catalogue.category;
    observations.push({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      expires:
        cookie.expires && cookie.expires > 0
          ? new Date(cookie.expires * 1000).toISOString()
          : null,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite ?? null,
      isThirdParty: isThirdParty(host, scopeOrigin),
      firstSeenOn: recorded?.page ?? scopeOrigin,
      phase: recorded?.phase ?? "before_consent_action",
      vendor: namedVendor ?? catalogue.vendor,
      category,
    });
  }
  return observations;
}

async function snapshotCookieKeys(context: BrowserContext, page: string, phase: CookieObservation["phase"]): Promise<VisitResult["cookieSeen"]> {
  try {
    return (await context.cookies()).map((cookie) => ({ key: `${cookie.domain}|${cookie.path}|${cookie.name}`, page, phase }));
  } catch { return []; }
}

/** Fetches robots.txt with a short timeout; unreachable means permissive. */
async function fetchRobots(
  origin: string,
  emit: (event: CrawlEvent) => void,
): Promise<RobotsPolicy> {
  const url = `${origin}/robots.txt`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });

    if (response.status === 404) {
      emit({ event: "robots_absent", url });
      return permissivePolicy("absent");
    }
    if (!response.ok) {
      emit({ event: "robots_unreachable", url, status: response.status });
      return permissivePolicy("unreachable");
    }

    const body = await response.text();
    // A robots.txt larger than this is not a robots.txt.
    if (body.length > 512_000) return permissivePolicy("malformed");

    const policy = parseRobots(body, USER_AGENT);
    emit({ event: "robots_fetched", url, rules: policy.rules.length });
    return policy;
  } catch (error) {
    emit({ event: "robots_unreachable", url, error: (error as Error).message });
    return permissivePolicy("unreachable");
  }
}

function redirectChain(response: Awaited<ReturnType<Page["goto"]>>): string[] {
  const chain: string[] = [];
  let current = response?.request().redirectedFrom();
  while (current) {
    chain.unshift(current.url());
    current = current.redirectedFrom();
  }
  return chain;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
