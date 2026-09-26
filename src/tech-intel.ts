import type { CookieObservation, PageObservation, RequestObservation, ScriptObservation, TechnologyFinding, Evidence } from "./types";

interface Signature { id: string; name: string; category: string; patterns: Array<["script" | "request" | "cookie" | "header" | "dom", RegExp]> }

const SIGNATURES: Signature[] = [
  { id: "nextjs", name: "Next.js", category: "frontend_framework", patterns: [["dom", /^next$/], ["script", /\/_next\//i], ["request", /\/_next\//i]] },
  { id: "nuxt", name: "Nuxt", category: "frontend_framework", patterns: [["dom", /^nuxt$/], ["script", /\/_nuxt\//i]] },
  { id: "react", name: "React", category: "frontend_library", patterns: [["dom", /^react$/]] },
  { id: "vue", name: "Vue", category: "frontend_library", patterns: [["dom", /^vue$/]] },
  { id: "angular", name: "Angular", category: "frontend_framework", patterns: [["dom", /^angular$/]] },
  { id: "svelte", name: "Svelte", category: "frontend_framework", patterns: [["dom", /^svelte$/]] },
  { id: "astro", name: "Astro", category: "frontend_framework", patterns: [["dom", /^astro$/], ["script", /astro-island/i]] },
  { id: "vite", name: "Vite", category: "build_tool", patterns: [["dom", /^vite$/], ["script", /\/assets\/(?:index|main)-[\w-]+\.js$/i]] },
  { id: "webpack", name: "Webpack", category: "build_tool", patterns: [["dom", /^webpack$/]] },
  { id: "wordpress", name: "WordPress", category: "cms", patterns: [["dom", /^wordpress$/], ["script", /wp-content|wp-includes/i], ["request", /wp-content|wp-includes/i]] },
  { id: "drupal", name: "Drupal", category: "cms", patterns: [["dom", /^drupal$/], ["header", /^x-generator:.*drupal/i]] },
  { id: "shopify", name: "Shopify", category: "ecommerce", patterns: [["dom", /^shopify$/], ["script", /cdn\.shopify\.com/i], ["cookie", /^_shopify_/i]] },
  { id: "webflow", name: "Webflow", category: "cms", patterns: [["dom", /^webflow$/], ["script", /webflow\.js/i]] },
  { id: "wix", name: "Wix", category: "cms", patterns: [["script", /wixstatic\.com/i], ["request", /wixstatic\.com/i]] },
  { id: "squarespace", name: "Squarespace", category: "cms", patterns: [["script", /squarespace\.com/i], ["request", /squarespace\.com/i]] },
  { id: "vercel", name: "Vercel", category: "hosting", patterns: [["header", /^server:.*vercel/i], ["header", /^x-vercel-id:/i]] },
  { id: "cloudflare-edge", name: "Cloudflare", category: "cdn", patterns: [["header", /^server:.*cloudflare/i], ["header", /^cf-ray:/i]] },
  { id: "nginx", name: "Nginx", category: "web_server", patterns: [["header", /^server:.*nginx/i]] },
  { id: "apache", name: "Apache", category: "web_server", patterns: [["header", /^server:.*apache/i]] },
  { id: "express", name: "Express", category: "backend_framework", patterns: [["header", /^x-powered-by:.*express/i]] },
  { id: "php", name: "PHP", category: "runtime", patterns: [["header", /^x-powered-by:.*php/i], ["cookie", /^PHPSESSID$/i]] },
  { id: "aspnet", name: "ASP.NET", category: "backend_framework", patterns: [["header", /^x-powered-by:.*asp\.net/i], ["cookie", /^ASP\.NET_SessionId$/i]] },
  { id: "tailwind", name: "Tailwind CSS", category: "css_framework", patterns: [["dom", /^tailwind$/]] },
  { id: "bootstrap", name: "Bootstrap", category: "css_framework", patterns: [["dom", /^bootstrap$/], ["script", /bootstrap(?:\.min)?\.js/i]] },
  { id: "jquery", name: "jQuery", category: "javascript_library", patterns: [["dom", /^jquery$/], ["script", /jquery(?:-[\d.]+)?(?:\.min)?\.js/i]] },
];

function evidenceType(type: Signature["patterns"][number][0]): Evidence["type"] {
  return type === "header" ? "response_header" : type === "request" ? "network_host" : type === "cookie" ? "cookie" : type;
}

export function detectStackTechnologies(input: { pages: PageObservation[]; requests: RequestObservation[]; scripts: ScriptObservation[]; cookies: CookieObservation[] }): TechnologyFinding[] {
  const sources = {
    dom: input.pages.flatMap((page) => (page.frontendSignals ?? []).map((signal) => ({ value: signal, evidence: signal }))),
    script: input.scripts.filter((script) => script.url).map((script) => ({ value: script.url!, evidence: script.url! })),
    request: input.requests.map((request) => ({ value: request.url, evidence: request.host })),
    cookie: input.cookies.map((cookie) => ({ value: cookie.name, evidence: cookie.name })),
    header: input.pages.flatMap((page) => Object.entries(page.securityHeaders ?? {}).filter(([, value]) => value).map(([key, value]) => ({ value: `${key}:${value}`, evidence: `${key}: ${value}` }))),
  };
  const results: TechnologyFinding[] = [];
  for (const signature of SIGNATURES) {
    const evidence: Evidence[] = [];
    const kinds = new Set<string>();
    for (const [type, pattern] of signature.patterns) {
      for (const candidate of sources[type]) {
        if (!pattern.test(candidate.value)) continue;
        kinds.add(type);
        if (evidence.length < 5 && !evidence.some((item) => item.value === candidate.evidence)) evidence.push({ type: evidenceType(type), value: candidate.evidence.slice(0, 160) });
      }
    }
    if (!evidence.length) continue;
    const header = evidence.find((item) => item.type === "response_header")?.value;
    const version = header?.match(/\b(\d+\.\d+(?:\.\d+)?)\b/)?.[1] ?? null;
    results.push({ detectorId: `stack:${signature.id}`, name: signature.name, category: signature.category, confidence: kinds.size > 1 || kinds.has("dom") || kinds.has("header") ? "high" : "medium", evidence, destinationCountry: null, crossesBorder: false, version });
  }
  return results;
}

/** Reads a bounded script in memory and returns only signatures, never source. */
export function fingerprintScript(source: string): string[] {
  const signatures: Array<[string, RegExp]> = [
    ["react", /Symbol\.for\(["']react\.(?:element|fragment)["']\)|react\.production\.min|react-dom/i],
    ["vue", /__VUE__|Vue\.version|vue\.runtime\.esm/i],
    ["angular", /ng-version|angular\.module\(/i],
    ["svelte", /__svelte_meta|svelte\/internal/i],
    ["vite", /__vite__mapDeps|vite\/preload-helper|modulepreload.*polyfill/i],
    ["webpack", /__webpack_require__|webpackChunk/i],
    ["jquery", /jQuery JavaScript Library|jQuery\.fn\.jquery/i],
    ["bootstrap", /Bootstrap v\d+\.\d+/i],
  ];
  return signatures.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}
