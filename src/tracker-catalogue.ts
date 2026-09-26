/**
 * Host → vendor classification for discovered components.
 *
 * ## Why this lives on the server
 *
 * The SDK reports raw hostnames and nothing else. Classification happens here
 * because the catalogue changes far more often than the tag does, and shipping
 * it to the browser would mean every customer had to redeploy their website
 * whenever a vendor was added. It also keeps the bundle small, which matters for
 * a script that loads on every page of someone else's site.
 *
 * ## Why `country` is a first-class field
 *
 * Most cookie tools answer "what is this?". Under DPDP the more consequential
 * question is "where does this data end up?", because transfer outside India is
 * treated separately from processing within it. So the catalogue records a
 * destination country and the read model derives `crosses_border` from it.
 *
 * `country` is the jurisdiction the receiving organisation is understood to
 * operate under, not a GeoIP result for a particular anycast POP. A CDN edge in
 * Mumbai serving a US company's tag does not make the recipient Indian, and
 * pretending otherwise would produce a comforting and wrong answer.
 *
 * ## Honest limits
 *
 * This is a starter catalogue, hand-written and small. It is not a substitute
 * for a maintained tracker database - the open ones (DuckDuckGo Tracker Radar,
 * EasyPrivacy, Disconnect) are far more complete and are the obvious upgrade
 * path. Unmatched hosts are reported as `vendor: null` and surfaced as
 * "unclassified" rather than silently treated as safe: an unknown third party is
 * the thing an operator most needs to look at.
 */

export interface CatalogueEntry {
  vendor: string;
  /** What the vendor is normally used for. Free text, matched to purposes by the operator. */
  category: string;
  /** ISO 3166-1 alpha-2 of the receiving organisation's jurisdiction. */
  country: string;
}

/**
 * Suffix-matched host patterns. A host matches when it equals the pattern or
 * ends with `.` + the pattern, so `ssl.google-analytics.com` matches
 * `google-analytics.com` without `notgoogle-analytics.com` doing so.
 */
const CATALOGUE: Record<string, CatalogueEntry> = {
  // ─── Analytics ─────────────────────────────────────────────────────────
  "google-analytics.com": { vendor: "Google Analytics", category: "analytics", country: "US" },
  "analytics.google.com": { vendor: "Google Analytics", category: "analytics", country: "US" },
  "googletagmanager.com": { vendor: "Google Tag Manager", category: "tag_management", country: "US" },
  "hotjar.com": { vendor: "Hotjar", category: "session_replay", country: "MT" },
  "hotjar.io": { vendor: "Hotjar", category: "session_replay", country: "MT" },
  "clarity.ms": { vendor: "Microsoft Clarity", category: "session_replay", country: "US" },
  "mixpanel.com": { vendor: "Mixpanel", category: "analytics", country: "US" },
  "amplitude.com": { vendor: "Amplitude", category: "analytics", country: "US" },
  "segment.com": { vendor: "Segment", category: "customer_data_platform", country: "US" },
  "segment.io": { vendor: "Segment", category: "customer_data_platform", country: "US" },
  "matomo.cloud": { vendor: "Matomo", category: "analytics", country: "DE" },
  "plausible.io": { vendor: "Plausible", category: "analytics", country: "EE" },
  "posthog.com": { vendor: "PostHog", category: "analytics", country: "US" },

  // ─── Advertising and social ────────────────────────────────────────────
  "doubleclick.net": { vendor: "Google Marketing Platform", category: "advertising", country: "US" },
  "googlesyndication.com": { vendor: "Google AdSense", category: "advertising", country: "US" },
  "googleadservices.com": { vendor: "Google Ads", category: "advertising", country: "US" },
  "facebook.com": { vendor: "Meta", category: "advertising", country: "US" },
  "facebook.net": { vendor: "Meta Pixel", category: "advertising", country: "US" },
  "connect.facebook.net": { vendor: "Meta Pixel", category: "advertising", country: "US" },
  "linkedin.com": { vendor: "LinkedIn", category: "advertising", country: "US" },
  "licdn.com": { vendor: "LinkedIn", category: "advertising", country: "US" },
  "tiktok.com": { vendor: "TikTok", category: "advertising", country: "SG" },
  "ttwstatic.com": { vendor: "TikTok", category: "advertising", country: "SG" },
  "twitter.com": { vendor: "X (Twitter)", category: "advertising", country: "US" },
  "ads-twitter.com": { vendor: "X (Twitter)", category: "advertising", country: "US" },
  "snapchat.com": { vendor: "Snap", category: "advertising", country: "US" },
  "criteo.com": { vendor: "Criteo", category: "advertising", country: "FR" },
  "taboola.com": { vendor: "Taboola", category: "advertising", country: "IL" },
  "outbrain.com": { vendor: "Outbrain", category: "advertising", country: "US" },

  // ─── Support, messaging, marketing ─────────────────────────────────────
  "intercom.io": { vendor: "Intercom", category: "support", country: "US" },
  "intercomcdn.com": { vendor: "Intercom", category: "support", country: "US" },
  "zendesk.com": { vendor: "Zendesk", category: "support", country: "US" },
  "crisp.chat": { vendor: "Crisp", category: "support", country: "FR" },
  "hs-scripts.com": { vendor: "HubSpot", category: "marketing", country: "US" },
  "hubspot.com": { vendor: "HubSpot", category: "marketing", country: "US" },
  "mailchimp.com": { vendor: "Mailchimp", category: "marketing", country: "US" },
  "klaviyo.com": { vendor: "Klaviyo", category: "marketing", country: "US" },
  "freshchat.com": { vendor: "Freshworks", category: "support", country: "IN" },
  "freshworks.com": { vendor: "Freshworks", category: "support", country: "IN" },

  // ─── Payments ──────────────────────────────────────────────────────────
  "stripe.com": { vendor: "Stripe", category: "payments", country: "US" },
  "stripe.network": { vendor: "Stripe", category: "payments", country: "US" },
  "razorpay.com": { vendor: "Razorpay", category: "payments", country: "IN" },
  "payu.in": { vendor: "PayU", category: "payments", country: "IN" },
  "cashfree.com": { vendor: "Cashfree", category: "payments", country: "IN" },
  "paypal.com": { vendor: "PayPal", category: "payments", country: "US" },

  // ─── Infrastructure and CDN ────────────────────────────────────────────
  "cloudflare.com": { vendor: "Cloudflare", category: "infrastructure", country: "US" },
  "cloudflareinsights.com": { vendor: "Cloudflare Analytics", category: "analytics", country: "US" },
  "jsdelivr.net": { vendor: "jsDelivr", category: "cdn", country: "US" },
  "cdnjs.cloudflare.com": { vendor: "cdnjs", category: "cdn", country: "US" },
  "unpkg.com": { vendor: "unpkg", category: "cdn", country: "US" },
  "gstatic.com": { vendor: "Google", category: "cdn", country: "US" },
  "googleapis.com": { vendor: "Google APIs", category: "cdn", country: "US" },
  "fonts.googleapis.com": { vendor: "Google Fonts", category: "fonts", country: "US" },
  "fonts.gstatic.com": { vendor: "Google Fonts", category: "fonts", country: "US" },
  "bootstrapcdn.com": { vendor: "BootstrapCDN", category: "cdn", country: "US" },

  // ─── Media ─────────────────────────────────────────────────────────────
  "youtube.com": { vendor: "YouTube", category: "media", country: "US" },
  "youtube-nocookie.com": { vendor: "YouTube (no-cookie)", category: "media", country: "US" },
  "ytimg.com": { vendor: "YouTube", category: "media", country: "US" },
  "vimeo.com": { vendor: "Vimeo", category: "media", country: "US" },

  // ─── Error and performance monitoring ──────────────────────────────────
  "sentry.io": { vendor: "Sentry", category: "monitoring", country: "US" },
  "bugsnag.com": { vendor: "Bugsnag", category: "monitoring", country: "US" },
  "newrelic.com": { vendor: "New Relic", category: "monitoring", country: "US" },
  "datadoghq.com": { vendor: "Datadog", category: "monitoring", country: "US" },
};

/** The jurisdiction the platform treats as domestic. */
export const HOME_COUNTRY = "IN";

export interface Classification {
  vendor: string | null;
  category: string | null;
  destination_country: string | null;
  crosses_border: boolean;
}

const UNCLASSIFIED: Classification = {
  vendor: null,
  category: null,
  destination_country: null,
  crosses_border: false,
};

/**
 * Classifies a hostname.
 *
 * Matching walks the host from most to least specific, so a precise entry such
 * as `fonts.googleapis.com` wins over the broader `googleapis.com`.
 */
export function classifyHost(host: string): Classification {
  const normalised = host.trim().toLowerCase().replace(/\.$/, "");
  if (!normalised) return UNCLASSIFIED;

  const labels = normalised.split(".");
  for (let i = 0; i < labels.length - 1; i += 1) {
    const candidate = labels.slice(i).join(".");
    const entry = CATALOGUE[candidate];
    if (entry) {
      return {
        vendor: entry.vendor,
        category: entry.category,
        destination_country: entry.country,
        // Unknown country is not treated as a crossing: asserting a transfer we
        // cannot evidence would be worse than reporting it as unknown.
        crosses_border: entry.country !== HOME_COUNTRY,
      };
    }
  }

  return UNCLASSIFIED;
}

/** Exposed for the catalogue-coverage test and for an operator-facing count. */
export function catalogueSize(): number {
  return Object.keys(CATALOGUE).length;
}

/**
 * The host patterns a vendor is known by.
 *
 * The reverse of {@link classifyHost}, and it exists for enforcement: the
 * browser has to decide about a *host*, while an operator approves a policy
 * about a *vendor*. Resolving one to the other happens here, on the server,
 * so the catalogue never ships to a page.
 *
 * Returns suffix patterns, not exact hosts. `google-analytics.com` matches
 * `www.google-analytics.com` and `region1.google-analytics.com`, which is the
 * same matching rule `classifyHost` applies and has to be, or a vendor would be
 * classified one way and enforced another.
 */
export function hostsForVendor(vendor: string): string[] {
  const wanted = vendor.trim().toLowerCase();
  if (!wanted) return [];
  return Object.entries(CATALOGUE)
    .filter(([, entry]) => entry.vendor.toLowerCase() === wanted)
    .map(([host]) => host)
    .sort();
}

/** Every vendor the catalogue knows, for an operator-facing list. */
export function catalogueVendors(): string[] {
  return [...new Set(Object.values(CATALOGUE).map((e) => e.vendor))].sort();
}
