/**
 * robots.txt parsing and evaluation.
 *
 * The scanner obeys robots.txt. That is a policy choice worth stating, because
 * it is not the only defensible one: the customer owns the site being scanned
 * and has asked us to scan it, so an argument exists that their own robots.txt
 * should not constrain a tool they invoked.
 *
 * We obey it anyway, for three reasons:
 *
 *  - We cannot verify at scan time that the person who typed the URL speaks for
 *    the site. Tenant ownership is checked against *our* records, not against
 *    the domain, so a scan of `competitor.com` is a request we must assume might
 *    be unauthorised.
 *  - `Disallow` frequently marks expensive or destructive endpoints — search,
 *    export, logout, cart mutation. Ignoring it is how a crawler logs a customer
 *    out of their own admin panel or triggers a thousand report generations.
 *  - It is the norm a well-behaved crawler follows, and being on the wrong side
 *    of that is a reputational and legal risk that buys very little coverage.
 *
 * A later scan mode may offer verified-ownership override. That needs domain
 * verification, which does not exist yet.
 */

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

export interface RobotsPolicy {
  /** Rules for the group that best matches our user-agent. */
  rules: RobotsRule[];
  /** Seconds requested between fetches, when stated. */
  crawlDelaySeconds: number | null;
  sitemaps: string[];
  /**
   * How the policy was arrived at, so a scan can report why it crawled the way
   * it did rather than leaving an operator to guess.
   */
  source: "fetched" | "absent" | "unreachable" | "malformed";
}

/** The permissive default used when robots.txt cannot be read. */
export function permissivePolicy(source: RobotsPolicy["source"]): RobotsPolicy {
  return { rules: [], crawlDelaySeconds: null, sitemaps: [], source };
}

/**
 * Parses robots.txt for one user-agent.
 *
 * Group selection follows the usual convention: the most specific matching
 * `User-agent` wins, `*` is the fallback, and an unmatched file leaves us with
 * no rules — which means allowed.
 */
export function parseRobots(body: string, userAgent: string): RobotsPolicy {
  const agent = userAgent.toLowerCase();

  const groups: Array<{ agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastLineWasAgent = false;
  const sitemaps: string[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;

    if (field === "disallow") {
      // An empty Disallow means "allow everything" and carries no path.
      if (value !== "") current.rules.push({ type: "disallow", path: value });
    } else if (field === "allow") {
      if (value !== "") current.rules.push({ type: "allow", path: value });
    } else if (field === "crawl-delay") {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
    } else if (field === "sitemap") {
      sitemaps.push(value);
    }
  }

  // Most specific match wins: an exact agent name beats `*`.
  const exact = groups.find((group) =>
    group.agents.some((candidate) => candidate !== "*" && agent.includes(candidate)),
  );
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const chosen = exact ?? wildcard;

  return {
    rules: chosen?.rules ?? [],
    crawlDelaySeconds: chosen?.crawlDelay ?? null,
    sitemaps,
    source: "fetched",
  };
}

/** Translates a robots path pattern (`*` and `$` only) into a regex. */
function patternToRegex(pattern: string): RegExp {
  let source = "";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "$") source += "$";
    else source += character.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}`);
}

/**
 * Whether a path may be fetched.
 *
 * Longest matching rule wins, and `Allow` beats `Disallow` at equal length —
 * the behaviour Google documents, and the one that makes
 * `Disallow: /` + `Allow: /public/` mean what its author intended.
 */
export function isAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  let bestLength = -1;
  let bestAllows = true;

  for (const rule of policy.rules) {
    if (!patternToRegex(rule.path).test(pathWithQuery)) continue;
    const length = rule.path.length;
    if (length > bestLength || (length === bestLength && rule.type === "allow")) {
      bestLength = length;
      bestAllows = rule.type === "allow";
    }
  }

  return bestAllows;
}

/** Path plus query, which is what robots patterns are matched against. */
export function pathForRobots(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}
