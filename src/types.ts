/**
 * Observation types produced by the crawler.
 *
 * These are deliberately *observations*, not conclusions. Every field answers
 * "what did we see", never "what does the law require".
 */

/**
 * The consent state a scan was performed under: `baseline` clicks nothing,
 * `all` clicks an accept-all button, `necessary_only` clicks a reject button.
 */
export type ScanMode = "baseline" | "necessary_only" | "all";

export interface CrawlLimits {
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  concurrency: number;
  navigationTimeoutMs: number;
  stabilisationMs: number;
  maxRedirects: number;
  /** Per-scan ceilings, so one hostile page cannot grow a report without bound. */
  maxRequests: number;
  maxCookies: number;
  maxScripts: number;
  maxStorageItems: number;
  maxEvidencePerFinding: number;
}

export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 100,
  maxDepth: 3,
  maxDurationMs: 10 * 60 * 1000,
  concurrency: 2,
  navigationTimeoutMs: 30_000,
  stabilisationMs: 2_500,
  maxRedirects: 5,
  maxRequests: 5_000,
  maxCookies: 500,
  maxScripts: 1_000,
  maxStorageItems: 500,
  maxEvidencePerFinding: 5,
};

export interface PageObservation {
  url: string;
  /** The URL finally landed on, when redirects moved us. */
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  contentType: string | null;
  depth: number;
  redirectChain: string[];
  rendered: boolean;
  /** Populated when the page failed; the scan continues regardless. */
  error: string | null;
  startedAt: string;
  durationMs: number;
  description?: string | null;
  canonical?: string | null;
  headings?: Record<string, number>;
  seo?: { robots: string | null; viewport: string | null; openGraph: boolean; structuredData: number; imagesMissingAlt: number; inputsMissingLabel: number; internalLinks: number };
  securityHeaders?: Record<string, string | null>;
  performance?: { domContentLoadedMs: number | null; loadMs: number | null; fcpMs: number | null; lcpMs: number | null; cls: number | null; resourceCount: number; transferBytes: number };
  forms?: Array<{ action: string; method: string; fields: Array<{ name: string; type: string; dataCategory: string | null }>; external: boolean }>;
  frames?: string[];
  frontendSignals?: string[];
}

export interface CookieObservation {
  name: string;
  domain: string;
  path: string;
  /** ISO timestamp, or null for a session cookie. Values are never recorded. */
  expires: string | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  isThirdParty: boolean;
  /** Page whose render the cookie was first observed after. */
  firstSeenOn: string;
  phase?: "before_consent_action" | "after_consent_action";
  category?: string | null;
  vendor?: string | null;
}

export interface ScriptObservation {
  /** Absolute URL for an external script; null for inline. */
  url: string | null;
  host: string | null;
  inline: boolean;
  isThirdParty: boolean;
  observedOn: string;
}

export interface RequestObservation {
  /** Origin + path only. Query and fragment are stripped at capture. */
  url: string;
  host: string;
  method: string;
  resourceType: string;
  status: number | null;
  isThirdParty: boolean;
  observedOn: string;
  failed: boolean;
  startedAt?: string;
  durationMs?: number | null;
  timing?: { startOffsetMs: number | null; dnsMs: number | null; connectionMs: number | null; tlsMs: number | null; ttfbMs: number | null; downloadMs: number | null };
  transferBytes?: number | null;
  contentType?: string | null;
  initiator?: string | null;
  frameUrl?: string | null;
  queryFields?: Array<{ name: string; category: string | null }>;
  bodyFields?: Array<{ name: string; category: string | null }>;
  vendor?: string | null;
  vendorCategory?: string | null;
  destinationCountry?: string | null;
  destinationIp?: string | null;
  ipCountry?: string | null;
  asn?: number | null;
  networkOwner?: string | null;
  phase?: "before_consent_action" | "after_consent_action";
}

export interface StorageObservation {
  kind: "local_storage" | "session_storage" | "indexed_db";
  /** Key or database name. Values are never read. */
  name: string;
  origin: string;
  observedOn: string;
}

export interface ConsentUiSignal {
  kind: "button_text" | "dom_pattern" | "known_cmp_script" | "known_cmp_cookie";
  detail: string;
}

export interface ConsentUiObservation {
  detected: boolean;
  signals: ConsentUiSignal[];
  observedOn: string | null;
  action?: { choice: "accept" | "reject"; attemptedOn: string | null; succeeded: boolean } | null;
}

export type Confidence = "high" | "medium" | "low";

export interface Evidence {
  type: "script" | "network_host" | "cookie" | "storage_key" | "dom" | "response_header";
  value: string;
}

export interface TechnologyFinding {
  detectorId: string;
  name: string;
  category: string;
  confidence: Confidence;
  evidence: Evidence[];
  /** Jurisdiction of the receiving organisation, from the shared catalogue. */
  destinationCountry: string | null;
  crossesBorder: boolean;
  version?: string | null;
}

export interface ScanSummary {
  pagesDiscovered: number;
  pagesScanned: number;
  pagesFailed: number;
  cookiesFound: number;
  scriptsFound: number;
  requestsObserved: number;
  storageItemsFound: number;
  thirdPartyDomains: number;
  technologiesDetected: number;
  consentUiDetected: boolean;
  /** True when a limit stopped the crawl early, so counts are not "the whole site". */
  limitReached: string | null;
}

export interface ScanResult {
  /** Synthetic sample for checking the UI; never a real crawl. */
  demo?: boolean;
  authenticated?: boolean;
  startUrl: string;
  mode: ScanMode;
  crawlerVersion: string;
  startedAt: string;
  completedAt: string;
  limits: CrawlLimits;
  robots: { source: string; crawlDelaySeconds: number | null; disallowedSkipped: number };
  pages: PageObservation[];
  cookies: CookieObservation[];
  scripts: ScriptObservation[];
  requests: RequestObservation[];
  storage: StorageObservation[];
  consentUi: ConsentUiObservation;
  technologies: TechnologyFinding[];
  summary: ScanSummary;
  infrastructure?: {
    dns: Record<string, string[]>;
    tls: { protocol: string | null; issuer: string | null; subject: string | null; validTo: string | null; subjectAltNames: string[] } | null;
    geo?: { status: "available" | "database_missing" | "lookup_failed"; ip: string | null; country: string | null; city: string | null; asn: number | null; networkOwner: string | null };
  };
  cruxHistory?: { status: "available" | "not_configured" | "insufficient_data" | "failed"; formFactor: "DESKTOP" | "PHONE"; periods: Array<{ start: string; end: string; lcpP75: number | null; clsP75: number | null; inpP75: number | null; ttfbP75: number | null }>; error?: string };
  device?: "desktop" | "mobile";
  subdomains?: string[];
  serviceWorkers?: string[];
  websockets?: Array<{ url: string; observedOn: string }>;
  lighthouse?: {
    status: "completed" | "failed";
    error?: string;
    device: "desktop" | "mobile";
    scores: Record<string, number | null>;
    metrics: Record<string, { value: number | null; displayValue: string | null }>;
    opportunities: Array<{ id: string; title: string; score: number | null; displayValue: string | null }>;
  };
}
