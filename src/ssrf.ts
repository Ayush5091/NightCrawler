import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for the scanner.
 *
 * ## The threat
 *
 * The scanner navigates a URL a customer typed into an onboarding form. That
 * makes it a request-forgery primitive by construction: whatever it fetches, it
 * fetches from inside our network, with our egress identity. An unguarded
 * crawler is a proxy that anyone with a signup can point at
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
 *
 * ## Why hostname checks alone are not enough
 *
 * `https://example.com` looks public. What matters is what it *resolves to*, and
 * an attacker controls their own DNS. Two attacks follow:
 *
 *  - **Direct resolution.** A public name with an `A` record pointing at
 *    `127.0.0.1` or `10.0.0.5`. Defeated by resolving before navigating and
 *    checking every returned address.
 *  - **DNS rebinding.** The name resolves public when we check it and private
 *    when the browser fetches it, because the TTL expired in between. A
 *    pre-flight check cannot defeat this on its own — there is a genuine
 *    time-of-check/time-of-use gap.
 *
 * This module closes the first and *narrows* the second. It resolves all
 * addresses up front and rejects on any private answer, and `assertNavigable`
 * is re-run on every redirect hop and every new URL rather than once per scan.
 * The residual rebinding window is documented in `docs/crawler.md` and is a
 * known limitation: fully closing it needs egress-level control (a network
 * policy, a proxy that pins the resolved address, or a dedicated egress VPC),
 * which is infrastructure this repository does not yet have.
 *
 * Nothing here is a substitute for that network control. It is the application
 * half of a defence that properly has two halves.
 */

export type SsrfRejection =
  | "unsupported_scheme"
  | "url_too_long"
  | "malformed_url"
  | "credentials_in_url"
  | "blocked_port"
  | "blocked_hostname"
  | "private_address"
  | "dns_resolution_failed";

export interface SsrfVerdict {
  allowed: boolean;
  reason?: SsrfRejection;
  detail?: string;
  /** Addresses the hostname resolved to, when resolution happened. */
  addresses?: string[];
}

const allow = (addresses?: string[]): SsrfVerdict => ({ allowed: true, addresses });
const deny = (reason: SsrfRejection, detail: string): SsrfVerdict => ({
  allowed: false,
  reason,
  detail,
});

/** Only http(s). `file:`, `ftp:`, `gopher:`, `data:` and friends are all vectors. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * A URL longer than this is rejected before parsing.
 *
 * Chiefly a denial-of-service bound rather than an SSRF one: parsing and
 * normalising pathological URLs is work, and a page that emits thousands of
 * them should not be able to spend our CPU.
 */
export const MAX_URL_LENGTH = 2048;

/**
 * Ports the scanner will not connect to.
 *
 * The point is not that these are the only dangerous ports — a service can
 * listen anywhere. It is that the common internal services have well-known
 * ports, and blocking them removes the cheapest version of the attack. The
 * address checks below are the real defence.
 */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 445, 465, 587, 993, 995, // remote access and mail
  1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017, // databases and caches
  2375, 2376, // docker daemon
  5984, 8020, 9000, 9092, // couch, hadoop, minio, kafka
]);

/**
 * Hostnames refused without resolving them at all.
 *
 * `metadata.google.internal` is the one that matters most: it resolves to
 * 169.254.169.254 and hands out service-account tokens.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

/**
 * Hostname suffixes refused without resolution.
 *
 * `.internal`, `.local`, `.localdomain` and friends are conventions for names
 * that only mean something inside a network, so a public scanner has no
 * legitimate reason to follow one.
 */
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".lan",
  ".intranet",
  ".corp",
  ".private",
];

/** Reserved IPv4 ranges, as [network, prefix length]. */
const BLOCKED_IPV4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // RFC6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Reject "01", "1e2", "" and anything else that is not a plain 0-255.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
};

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable: refuse rather than guess
  for (const [network, prefix] of BLOCKED_IPV4) {
    const base = ipv4ToInt(network);
    if (base === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) >>> 0 === (base & mask) >>> 0) return true;
  }
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const address = ip.toLowerCase().split("%")[0]; // strip any zone index

  if (address === "::" || address === "::1") return true; // unspecified, loopback

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms carry an embedded
  // v4 address, which must be judged by the v4 rules — otherwise ::ffff:10.0.0.1
  // walks straight past every check above.
  const embedded = /(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/i.exec(address);
  if (embedded) return isBlockedIpv4(embedded[1]);

  if (address.startsWith("fe80") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (/^f[cd]/.test(address)) return true; // unique local fc00::/7
  if (address.startsWith("ff")) return true; // multicast
  if (address.startsWith("2001:db8")) return true; // documentation
  if (address.startsWith("64:ff9b")) return true; // NAT64, can reach v4 space

  return false;
}

/** True when an IP literal is in a range the scanner must never contact. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // not an IP we understand
}

/** True when a hostname is refused before any DNS lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, ""); // trailing dot is the same name
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A bare single-label name ("intranet", "router") is only meaningful inside a
  // network; a public site always has a dot.
  if (!host.includes(".") && !net.isIP(host)) return true;
  return false;
}

/**
 * Checks a URL's shape without touching the network.
 *
 * Separated from resolution so it can be unit tested exhaustively and so the
 * cheap checks run first.
 */
export function checkUrlShape(raw: string): SsrfVerdict {
  if (raw.length > MAX_URL_LENGTH) {
    return deny("url_too_long", `URL exceeds ${MAX_URL_LENGTH} characters`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return deny("malformed_url", "not a parseable absolute URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return deny("unsupported_scheme", `scheme ${url.protocol} is not http or https`);
  }

  // `http://user:pass@internal/` both leaks a credential into our logs and is a
  // common way to confuse naive URL parsers about the real host.
  if (url.username || url.password) {
    return deny("credentials_in_url", "URL contains embedded credentials");
  }

  if (url.port && BLOCKED_PORTS.has(Number(url.port))) {
    return deny("blocked_port", `port ${url.port} is not permitted`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // unwrap IPv6 literal

  if (isBlockedHostname(hostname)) {
    return deny("blocked_hostname", `hostname ${hostname} is not publicly routable`);
  }

  // An IP literal needs no DNS, so judge it here and be done.
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    return deny("private_address", `${hostname} is in a reserved range`);
  }

  return allow();
}

export type Resolver = (hostname: string) => Promise<string[]>;

/** Default resolver: every A/AAAA record, so one bad answer is enough to refuse. */
const defaultResolver: Resolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Full check: shape, then DNS.
 *
 * Called before the initial navigation **and again for every redirect hop and
 * every discovered URL**, because a redirect is an attacker-controlled way to
 * turn an allowed first request into a disallowed second one.
 */
export async function assertNavigable(
  raw: string,
  options: { resolver?: Resolver; allowPrivateTargets?: boolean } = {},
): Promise<SsrfVerdict> {
  // `allowPrivateTargets` exists so the crawl can be exercised against a
  // loopback fixture server, and for no other reason.
  //
  // Without it the rendering half of the crawler is untestable: the guard
  // refuses 127.0.0.1 - correctly - so the only alternative is to point tests
  // at the live internet, which makes them non-hermetic, slow and dependent on
  // a third party's markup not changing. That trade produced a scanner whose
  // Playwright half had never been executed by a test at all.
  //
  // It is deliberately a direct argument to `crawl()`, never a scan option and
  // never anything the HTTP API can set: `POST /scans` validates the URL shape
  // before a row exists, and the worker calls `crawl()` without this flag. A
  // request cannot reach it. `crawler-ssrf.test.ts` asserts that the guard
  // still refuses private space when it is absent, which is every production
  // path.
  if (options.allowPrivateTargets) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw);
    } catch {
      parsed = null;
    }
    // Still only http(s): the flag relaxes *where* a crawl may point, never
    // which schemes it will speak.
    if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return allow([parsed.hostname.replace(/^\[|\]$/g, "")]);
    }
  }

  const shape = checkUrlShape(raw);
  if (!shape.allowed) return shape;

  const hostname = new URL(raw).hostname.replace(/^\[|\]$/g, "");

  // Already judged as a literal in checkUrlShape; no name to resolve.
  if (net.isIP(hostname)) return allow([hostname]);

  const resolve = options.resolver ?? defaultResolver;

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch (error) {
    return deny("dns_resolution_failed", `could not resolve ${hostname}: ${(error as Error).message}`);
  }

  if (addresses.length === 0) {
    return deny("dns_resolution_failed", `${hostname} resolved to no addresses`);
  }

  // Every address must be acceptable. A name with one public and one private
  // answer is refused: which one the browser picks is not ours to control.
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      return deny("private_address", `${hostname} resolves to ${address}, which is in a reserved range`);
    }
  }

  return allow(addresses);
}
