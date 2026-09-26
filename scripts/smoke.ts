import { createServer } from "node:http";
import assert from "node:assert/strict";
import { crawl } from "../src/crawl";
import { renderPdf } from "../src/pdf";

const server = createServer((req, res) => {
  if (req.url === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("User-agent: *\nAllow: /"); }
  if (req.url === "/app.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end('Symbol.for("react.element"); const __vite__mapDeps = [];'); }
  if (req.url === "/protected") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<title>${req.headers.cookie?.includes("auth=fixture-secret") ? "Private dashboard" : "Sign in"}</title>`); }
  if (req.url?.startsWith("/api")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  res.writeHead(200, { "content-type": "text/html", "x-content-type-options": "nosniff" });
  res.end(`<!doctype html><title>Fixture</title><meta name="description" content="Test page"><h1>Fixture</h1>
    <form method="post" action="https://forms.example.com/submit"><input name="email" type="email"></form>
    <button onclick="fetch('/consented?event=accepted')">Accept all</button><script src="/app.js"></script>
    <script>fetch('/api?email=private@example.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:'secret',event:'click'})});</script>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const result = await crawl({ startUrl: `http://127.0.0.1:${address.port}/?token=secret`, allowPrivateTargets: true, limits: { maxPages: 1, maxDepth: 0, stabilisationMs: 500 } });
  assert.equal(result.pages[0]?.title, "Fixture");
  assert.equal(result.pages[0]?.forms?.[0]?.external, true);
  assert.equal(result.requests.some((request) => request.queryFields?.some((field) => field.name === "email")), true);
  assert.equal(result.requests.some((request) => request.bodyFields?.some((field) => field.name === "userId")), true);
  assert.equal(result.technologies.some((technology) => technology.name === "React"), true);
  assert.equal(result.technologies.some((technology) => technology.name === "Vite"), true);
  assert.equal(result.requests.some((request) => request.url.endsWith("/app.js") && request.timing?.ttfbMs != null), true);
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
  assert.equal(JSON.stringify(result).includes('"secret"'), false);
  const accepted = await crawl({ startUrl: `http://127.0.0.1:${address.port}/`, allowPrivateTargets: true, mode: "all", limits: { maxPages: 1, maxDepth: 0, stabilisationMs: 500 } });
  assert.equal(accepted.consentUi.action?.succeeded, true);
  assert.equal(accepted.requests.some((request) => request.url.endsWith("/consented") && request.phase === "after_consent_action"), true);
  const authenticated = await crawl({ startUrl: `http://127.0.0.1:${address.port}/protected`, allowPrivateTargets: true, storageState: { cookies: [{ name: "auth", value: "fixture-secret", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] }, limits: { maxPages: 1, maxDepth: 0, stabilisationMs: 200 } });
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.pages[0]?.title, "Private dashboard");
  assert.equal(JSON.stringify(authenticated).includes("fixture-secret"), false);
  const pdf = await renderPdf(result);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  console.log("Smoke test passed: page, forms, request fields, consent action, saved session, value redaction, and PDF");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
