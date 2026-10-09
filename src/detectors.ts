import { classifyHost } from "./tracker-catalogue";
import type {
  Confidence,
  Evidence,
  TechnologyFinding,
  CookieObservation,
  RequestObservation,
  ScriptObservation,
  StorageObservation,
} from "./types";

/**
 * Technology detection.
 *
 * ## What a detector may and may not say
 *
 * A detector reports **what a thing is** and **why we think so**. It never
 * reports what the law requires. "Google Analytics, category analytics,
 * because we saw this script URL and this network host" is a detector's job;
 * "therefore consent is required" is a legal judgement for a human reviewer.
 *
 * ## Why the host catalogue is reused rather than reimplemented
 *
 * The bundled tracker catalogue maps hosts to vendor, category and country.
 * The detectors below add signals from script URLs, cookies and storage keys.
 */

export interface DetectionInput {
  requests: RequestObservation[];
  scripts: ScriptObservation[];
  cookies: CookieObservation[];
  storage: StorageObservation[];
}

export interface DetectionResult {
  name: string;
  category: string;
  confidence: Confidence;
  evidence: Evidence[];
}

export interface TrackerDetector {
  id: string;
  name: string;
  category: string;
  matches(input: DetectionInput): DetectionResult | null;
}

/** Host suffix match, so `ssl.google-analytics.com` matches `google-analytics.com`. */
const hostMatches = (host: string, pattern: string): boolean => {
  const candidate = host.toLowerCase().replace(/\.$/, "");
  return candidate === pattern || candidate.endsWith(`.${pattern}`);
};

interface SignatureSpec {
  id: string;
  name: string;
  category: string;
  /** Script URL substrings — the strongest signal, since it names the product. */
  scriptPatterns?: string[];
  /** Cookie names, exact or prefix with a trailing `*`. */
  cookieNames?: string[];
  storageKeys?: string[];
  hosts?: string[];
}

const nameMatches = (actual: string, pattern: string): boolean =>
  pattern.endsWith("*")
    ? actual.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
    : actual.toLowerCase() === pattern.toLowerCase();

/**
 * Builds a detector from a declarative signature.
 *
 * Confidence is derived from how many *independent kinds* of signal agreed, not
 * from how many total matches were found: ten network requests to one host is
 * one fact observed ten times, whereas a script URL plus a cookie name is two
 * different things pointing the same way.
 */
function fromSignature(spec: SignatureSpec): TrackerDetector {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    matches(input) {
      const evidence: Evidence[] = [];
      const signalKinds = new Set<string>();

      for (const script of input.scripts) {
        if (!script.url) continue;
        const url = script.url.toLowerCase();
        if (spec.scriptPatterns?.some((pattern) => url.includes(pattern))) {
          evidence.push({ type: "script", value: script.url });
          signalKinds.add("script");
        }
      }

      for (const request of input.requests) {
        if (spec.hosts?.some((pattern) => hostMatches(request.host, pattern))) {
          evidence.push({ type: "network_host", value: request.host });
          signalKinds.add("network");
        }
      }

      for (const cookie of input.cookies) {
        if (spec.cookieNames?.some((pattern) => nameMatches(cookie.name, pattern))) {
          evidence.push({ type: "cookie", value: cookie.name });
          signalKinds.add("cookie");
        }
      }

      for (const item of input.storage) {
        if (spec.storageKeys?.some((pattern) => nameMatches(item.name, pattern))) {
          evidence.push({ type: "storage_key", value: item.name });
          signalKinds.add("storage");
        }
      }

      if (evidence.length === 0) return null;

      const confidence: Confidence =
        signalKinds.size >= 2 ? "high" : signalKinds.has("script") ? "high" : "medium";

      // Deduplicate: the same host seen 400 times is one piece of evidence.
      const seen = new Set<string>();
      const unique = evidence.filter((item) => {
        const key = `${item.type}:${item.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { name: spec.name, category: spec.category, confidence, evidence: unique };
    },
  };
}

/**
 * Signatures for technologies a crawler can identify by more than hostname.
 *
 * Kept small on purpose. The host catalogue already covers breadth; these add
 * depth for the vendors a report most needs to name precisely, and
 * every one of them is checkable by reading the strings.
 */
const SIGNATURES: SignatureSpec[] = [
  {
    id: "google-analytics",
    name: "Google Analytics",
    category: "analytics",
    scriptPatterns: ["google-analytics.com/analytics.js", "gtag/js", "googletagmanager.com/gtag"],
    cookieNames: ["_ga", "_ga_*", "_gid", "_gat", "_gat_*"],
    hosts: ["google-analytics.com", "analytics.google.com"],
  },
  {
    id: "google-tag-manager",
    name: "Google Tag Manager",
    category: "tag_management",
    scriptPatterns: ["googletagmanager.com/gtm.js"],
    hosts: ["googletagmanager.com"],
  },
  {
    id: "meta-pixel",
    name: "Meta Pixel",
    category: "advertising",
    scriptPatterns: ["connect.facebook.net", "fbevents.js"],
    cookieNames: ["_fbp", "_fbc", "fr"],
    hosts: ["facebook.net", "facebook.com"],
  },
  {
    id: "hotjar",
    name: "Hotjar",
    category: "session_replay",
    scriptPatterns: ["static.hotjar.com", "hotjar-"],
    cookieNames: ["_hj*"],
    hosts: ["hotjar.com", "hotjar.io"],
  },
  {
    id: "microsoft-clarity",
    name: "Microsoft Clarity",
    category: "session_replay",
    scriptPatterns: ["clarity.ms/tag"],
    cookieNames: ["_clck", "_clsk"],
    hosts: ["clarity.ms"],
  },
  {
    id: "linkedin-insight",
    name: "LinkedIn Insight Tag",
    category: "advertising",
    scriptPatterns: ["snap.licdn.com"],
    cookieNames: ["li_sugr", "bcookie", "lidc"],
    hosts: ["licdn.com", "linkedin.com"],
  },
  {
    id: "tiktok-pixel",
    name: "TikTok Pixel",
    category: "advertising",
    scriptPatterns: ["analytics.tiktok.com"],
    cookieNames: ["_ttp"],
    hosts: ["tiktok.com", "ttwstatic.com"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "marketing_automation",
    scriptPatterns: ["js.hs-scripts.com", "js.hsadspixel.net"],
    cookieNames: ["hubspotutk", "__hstc", "__hssrc", "__hssc"],
    hosts: ["hubspot.com", "hs-scripts.com", "hsadspixel.net"],
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "chat_support",
    scriptPatterns: ["widget.intercom.io", "js.intercomcdn.com"],
    cookieNames: ["intercom-*"],
    hosts: ["intercom.io", "intercomcdn.com"],
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    scriptPatterns: ["js.stripe.com"],
    cookieNames: ["__stripe_mid", "__stripe_sid"],
    hosts: ["stripe.com", "stripe.network"],
  },
  {
    id: "onetrust",
    name: "OneTrust",
    category: "consent_management",
    scriptPatterns: ["cdn.cookielaw.org", "otSDKStub.js", "onetrust"],
    cookieNames: ["OptanonConsent", "OptanonAlertBoxClosed"],
    hosts: ["cookielaw.org", "onetrust.com"],
  },
  {
    id: "cookiebot",
    name: "Cookiebot",
    category: "consent_management",
    scriptPatterns: ["consent.cookiebot.com"],
    cookieNames: ["CookieConsent"],
    hosts: ["cookiebot.com"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cdn",
    cookieNames: ["__cf_bm", "cf_clearance", "__cflb"],
    hosts: ["cloudflare.com", "cloudflareinsights.com"],
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "error_monitoring",
    scriptPatterns: ["browser.sentry-cdn.com", "js.sentry-cdn.com"],
    hosts: ["sentry.io", "sentry-cdn.com"],
  },
];

const DETECTORS: TrackerDetector[] = SIGNATURES.map(fromSignature);

/** Adds a host as evidence once, respecting the per-finding cap. */
function addHostEvidence(finding: TechnologyFinding, host: string, cap: number): void {
  if (finding.evidence.length >= cap) return;
  if (finding.evidence.some((item) => item.type === "network_host" && item.value === host)) return;
  finding.evidence.push({ type: "network_host", value: host });
}

/**
 * Runs every detector, then falls back to the shared host catalogue for third
 * parties no signature named.
 *
 * The fallback matters more than the signatures: an unmatched third-party host
 * is exactly the entry a reader most needs to see, so it is surfaced as a
 * low-confidence finding with the host as its evidence rather than dropped.
 */
export function detectTechnologies(
  input: DetectionInput,
  options: { maxEvidencePerFinding: number },
): TechnologyFinding[] {
  const findings = new Map<string, TechnologyFinding>();

  for (const detector of DETECTORS) {
    const result = detector.matches(input);
    if (!result) continue;
    const catalogue = classifyHost(pickHostFor(result) ?? "");
    findings.set(detector.id, {
      detectorId: detector.id,
      name: result.name,
      category: result.category,
      confidence: result.confidence,
      evidence: result.evidence.slice(0, options.maxEvidencePerFinding),
      destinationCountry: catalogue.destination_country,
      crossesBorder: catalogue.crosses_border,
    });
  }

  // Anything third-party the signatures missed, classified by host alone.
  const claimedHosts = new Set(
    [...findings.values()].flatMap((finding) =>
      finding.evidence.filter((e) => e.type === "network_host").map((e) => e.value),
    ),
  );

  /**
   * Vendors a signature already named, so the fallback does not report the same
   * company again under each of its hostnames.
   *
   * Without this, a real crawl of one marketing site reported "HubSpot" four
   * times — once from the script signature and once each for `app.hubspot.com`,
   * `sgtm-amer.hubspot.com` and `cta-service-cms2.hubspot.com`. A reader
   * reading that cannot tell whether they have one HubSpot or four.
   */
  const claimedVendors = new Set([...findings.values()].map((finding) => finding.name));

  for (const request of input.requests) {
    if (!request.isThirdParty) continue;
    if (claimedHosts.has(request.host)) continue;

    const catalogue = classifyHost(request.host);

    // A known vendor already reported by a signature gains this host as extra
    // evidence rather than becoming a second, weaker entry for the same thing.
    if (catalogue.vendor && claimedVendors.has(catalogue.vendor)) {
      const existing = [...findings.values()].find((finding) => finding.name === catalogue.vendor);
      if (existing) addHostEvidence(existing, request.host, options.maxEvidencePerFinding);
      claimedHosts.add(request.host);
      continue;
    }

    const id = catalogue.vendor ? `vendor:${catalogue.vendor}` : `host:${request.host}`;
    if (findings.has(id)) {
      // Same vendor, another hostname: strengthen the existing finding. Repeat
      // requests to a host already cited add nothing — one host contacted 40
      // times is one fact, not 40.
      addHostEvidence(findings.get(id)!, request.host, options.maxEvidencePerFinding);
      continue;
    }
    if (catalogue.vendor) claimedVendors.add(catalogue.vendor);

    findings.set(id, {
      detectorId: id,
      // An unmatched host is reported by its own name rather than as "unknown",
      // so the reader sees what to go and look up.
      name: catalogue.vendor ?? request.host,
      category: catalogue.category ?? "unclassified",
      // Host alone is weaker evidence than a named signature, and saying so is
      // the difference between an inventory and a guess.
      confidence: catalogue.vendor ? "medium" : "low",
      evidence: [{ type: "network_host", value: request.host }],
      destinationCountry: catalogue.destination_country,
      crossesBorder: catalogue.crosses_border,
    });
  }

  return [...findings.values()];
}

/** The host a finding's evidence points at, for catalogue lookup. */
function pickHostFor(result: DetectionResult): string | null {
  const host = result.evidence.find((item) => item.type === "network_host")?.value;
  if (host) return host;
  const script = result.evidence.find((item) => item.type === "script")?.value;
  if (script) {
    try {
      return new URL(script).hostname;
    } catch {
      return null;
    }
  }
  return null;
}
