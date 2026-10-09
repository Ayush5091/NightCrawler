import type { ScanResult } from "./types";

const FIELD_RULES: Array<[RegExp, string]> = [
  [/e.?mail/i, "email"], [/phone|mobile|tel(ephone)?/i, "phone"],
  [/first.?name|last.?name|full.?name|\bname\b/i, "name"],
  [/user.?id|account.?id|customer.?id|uid/i, "account_id"],
  [/session|sid/i, "session_id"], [/device|fingerprint|client.?id/i, "device_id"],
  [/ip.?address|latitude|longitude|location|postal|zip/i, "location"],
  [/card|cvv|iban|payment|transaction|amount|order.?id/i, "payment"],
  [/password|passwd|auth|token|bearer|secret|api.?key/i, "authentication"],
  [/event|action|click|page.?view|screen|referrer/i, "behavior"],
];

export function classifyField(name: string): string | null {
  return FIELD_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function fieldsFromUrl(raw: string): Array<{ name: string; category: string | null }> {
  try {
    return [...new Set(new URL(raw).searchParams.keys())].slice(0, 40).map((name) => ({ name: name.slice(0, 100), category: classifyField(name) }));
  } catch { return []; }
}

export function fieldsFromBody(body: string | null, contentType = ""): Array<{ name: string; category: string | null }> {
  if (!body || body.length > 100_000) return [];
  let names: string[] = [];
  try {
    if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(body)) {
      const walk = (value: unknown, prefix: string, depth: number): void => {
        if (depth > 3 || names.length >= 40 || !value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          const name = prefix ? `${prefix}.${key}` : key;
          names.push(name);
          walk(child, name, depth + 1);
        }
      };
      walk(JSON.parse(body), "", 0);
    } else if (/urlencoded/i.test(contentType)) {
      names = [...new URLSearchParams(body).keys()];
    } else if (/multipart/i.test(contentType)) {
      names = [...body.matchAll(/content-disposition:[^\r\n]*name="([^"]{1,100})"/gi)].map((match) => match[1]);
    }
  } catch { return []; }
  return [...new Set(names)].slice(0, 40).map((name) => ({ name: name.slice(0, 100), category: classifyField(name) }));
}

export interface ScanInsights {
  vendors: Array<{ name: string; category: string; country: string | null; requests: number; hosts: string[] }>;
  unknownDestinations: string[];
  dataFields: Array<{ category: string; field: string; destinations: string[] }>;
  graph: Array<{ source: string; destination: string; requests: number; categories: string[] }>;
  findings: Array<{ kind: string; severity: "info" | "warning"; page: string; evidence: string; confidence: "high" | "medium" }>;
}

export function buildInsights(scan: ScanResult): ScanInsights {
  const vendors = new Map<string, ScanInsights["vendors"][number]>();
  const unknown = new Set<string>();
  const fields = new Map<string, { category: string; field: string; destinations: Set<string> }>();
  const edges = new Map<string, { source: string; destination: string; requests: number; categories: Set<string> }>();
  const findings: ScanInsights["findings"] = [];
  for (const request of scan.requests) {
    const destination = request.vendor ?? request.host;
    if (request.isThirdParty && !request.vendor) unknown.add(request.host);
    if (request.isThirdParty && request.vendor) {
      const row = vendors.get(request.vendor) ?? { name: request.vendor, category: request.vendorCategory ?? "unknown", country: request.destinationCountry ?? null, requests: 0, hosts: [] };
      row.requests++;
      if (!row.hosts.includes(request.host)) row.hosts.push(request.host);
      vendors.set(request.vendor, row);
    }
    const edgeKey = `${request.observedOn}|${destination}`;
    const edge = edges.get(edgeKey) ?? { source: request.observedOn, destination, requests: 0, categories: new Set<string>() };
    edge.requests++;
    for (const field of [...(request.queryFields ?? []), ...(request.bodyFields ?? [])]) {
      if (field.category) edge.categories.add(field.category);
      const key = `${field.name}|${field.category ?? "unknown"}`;
      const item = fields.get(key) ?? { category: field.category ?? "unknown", field: field.name, destinations: new Set<string>() };
      item.destinations.add(destination);
      fields.set(key, item);
      if (request.isThirdParty && field.category && ["email", "phone", "payment", "authentication"].includes(field.category)) {
        findings.push({ kind: "sensitive_field_to_third_party", severity: "warning", page: request.observedOn, evidence: `${field.name} → ${request.host}${new URL(request.url).pathname}`, confidence: "medium" });
      }
    }
    edges.set(edgeKey, edge);
  }
  for (const page of scan.pages) {
    if (page.seo?.imagesMissingAlt) findings.push({ kind: "images_missing_alt", severity: "info", page: page.url, evidence: `${page.seo.imagesMissingAlt} images`, confidence: "high" });
    if (page.seo?.inputsMissingLabel) findings.push({ kind: "inputs_missing_label", severity: "info", page: page.url, evidence: `${page.seo.inputsMissingLabel} inputs`, confidence: "medium" });
    if (page.url.startsWith("https:") && !page.securityHeaders?.["strict-transport-security"]) findings.push({ kind: "missing_hsts", severity: "info", page: page.url, evidence: "Strict-Transport-Security header absent", confidence: "high" });
    for (const form of page.forms ?? []) if (form.external) findings.push({ kind: "external_form", severity: "warning", page: page.url, evidence: `${form.method} ${form.action}`, confidence: "high" });
  }
  for (const cookie of scan.cookies) {
    if (!cookie.secure && scan.startUrl.startsWith("https:")) findings.push({ kind: "cookie_without_secure", severity: "warning", page: cookie.firstSeenOn, evidence: `${cookie.name} on ${cookie.domain}`, confidence: "high" });
    if (!cookie.httpOnly && /session|auth|token/i.test(cookie.name)) findings.push({ kind: "session_cookie_without_httponly", severity: "warning", page: cookie.firstSeenOn, evidence: `${cookie.name} on ${cookie.domain}`, confidence: "medium" });
  }
  return { vendors: [...vendors.values()].sort((a,b) => b.requests-a.requests), unknownDestinations: [...unknown].sort(), dataFields: [...fields.values()].map((v) => ({ ...v, destinations: [...v.destinations] })), graph: [...edges.values()].map((v) => ({ ...v, categories: [...v.categories] })), findings: findings.slice(0, 500) };
}

export function diffScans(previous: ScanResult, current: ScanResult) {
  const added = (before: string[], after: string[]) => after.filter((item) => !new Set(before).has(item));
  return {
    destinations: added(previous.requests.map((r) => r.host), [...new Set(current.requests.map((r) => r.host))]),
    technologies: added(previous.technologies.map((t) => t.name), current.technologies.map((t) => t.name)),
    cookies: added(previous.cookies.map((c) => `${c.domain}:${c.name}`), current.cookies.map((c) => `${c.domain}:${c.name}`)),
    dataFields: added(previous.requests.flatMap((r) => [...(r.queryFields ?? []), ...(r.bodyFields ?? [])].map((f) => f.name)), [...new Set(current.requests.flatMap((r) => [...(r.queryFields ?? []), ...(r.bodyFields ?? [])].map((f) => f.name)))]),
  };
}
