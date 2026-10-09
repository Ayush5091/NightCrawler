import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Box,
  Cable,
  CheckCircle2,
  CircleGauge,
  Cloud,
  Cookie,
  Database,
  Download,
  FileSearch,
  Fingerprint,
  Globe2,
  KeyRound,
  RadioTower,
  Route,
  Server,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { formatBytes, formatDate, truncate } from "./lib";
import type { ReportData } from "./types";
import { hasSection, sectionNumber, site } from "./site";
import { Card, Chip, DataTable, EmptyState, ExportLink, MetricCard, Reveal, SectionHeader, StatList } from "./components/UI";

const sumTransfer = (report: ReportData) => report.scan.requests.reduce((sum, request) => sum + (request.transferBytes || 0), 0);
const toneForScore = (score: number | null | undefined) => score == null ? "default" : score >= 90 ? "good" : score >= 50 ? "warning" : "danger";
const phaseLabel = (phase?: string) => phase === "after_consent_action" ? "After consent" : "Before consent";

function ReportHeading({ report }: { report: ReportData }) {
  const { scan, id } = report;
  const consent = scan.consentUi.action
    ? scan.consentUi.action.succeeded ? `${scan.consentUi.action.choice} clicked` : "Consent control unavailable"
    : "No consent action";
  return (
    <div className="report-heading">
      <div>
        <span className="eyebrow">LATEST OBSERVATION</span>
        <h2 id="report-title">{scan.demo ? "Demo report" : "Scan report"}<span> · {scan.startUrl}</span></h2>
        <p>{formatDate(scan.startedAt)} · {scan.device || "desktop"} · {scan.mode.replaceAll("_", " ")} · {consent}</p>
      </div>
      <div className="export-actions" aria-label="Export report">
        <span><Download size={16} /> Export</span>
        <ExportLink id={id} format="json">JSON</ExportLink>
        <ExportLink id={id} format="csv">CSV</ExportLink>
        <ExportLink id={id} format="pdf">PDF</ExportLink>
      </div>
    </div>
  );
}

function Overview({ report }: { report: ReportData }) {
  const { scan, insights } = report;
  const audit = scan.lighthouse;
  const resourceCounts = new Map<string, number>();
  for (const request of scan.requests) resourceCounts.set(request.resourceType, (resourceCounts.get(request.resourceType) || 0) + 1);
  const resourceRows = [...resourceCounts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxResource = Math.max(1, ...resourceRows.map(([, count]) => count));
  const perf = scan.pages.find((page) => page.performance)?.performance;
  const crux = scan.cruxHistory;
  const cruxLast = crux?.status === "available" ? crux.periods.at(-1) : undefined;

  const metrics = [
    { label: "Pages", value: scan.summary.pagesScanned, icon: FileSearch },
    { label: "Requests", value: scan.summary.requestsObserved, icon: RadioTower },
    { label: "Third parties", value: scan.summary.thirdPartyDomains, icon: Globe2 },
    site.id === "built"
      ? { label: "Technologies", value: scan.summary.technologiesDetected, icon: Box }
      : { label: "Cookies", value: scan.summary.cookiesFound, icon: Cookie },
    { label: "Data fields", value: insights.dataFields.length, icon: Fingerprint },
  ];

  return (
    <section id="overview" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("overview")} / SIGNAL`} title="Overview" description="The scan at a glance—surface area, external reach, and the systems in between." />
      <motion.div className="metric-grid" initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.2 }} variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}>
        {metrics.map(({ label, value, icon: Icon }) => (
          <motion.div key={label} variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } }}>
            <MetricCard label={label} value={value} hint={<Icon size={16} aria-hidden="true" />} />
          </motion.div>
        ))}
      </motion.div>

      {site.id === "built" ? <>
      <div id="lighthouse-scores" className="score-grid">
        {audit?.status === "completed" ? Object.entries({ performance: "Performance", accessibility: "Accessibility", "best-practices": "Best practices", seo: "SEO" }).map(([key, label]) => {
          const score = audit.scores?.[key];
          return <MetricCard key={key} label={label} value={score ?? "—"} hint="Lighthouse score" tone={toneForScore(score)} />;
        }) : <div className="notice notice--muted">{audit?.error ? `Lighthouse audit failed: ${audit.error}` : "Lighthouse audit not available for this report."}</div>}
      </div>

      <div className="two-column-grid">
        <Reveal>
          <Card title="Resource mix" className="chart-card" action={<Chip tone="neutral">{scan.requests.length} total</Chip>}>
            {resourceRows.length ? <div className="bar-chart">
              {resourceRows.map(([name, count], index) => (
                <div className="bar-row" key={name}>
                  <span>{name}</span>
                  <div className="bar-track"><motion.i initial={{ scaleX: 0 }} whileInView={{ scaleX: count / maxResource }} viewport={{ once: true }} transition={{ duration: 0.7, delay: index * 0.05 }} /></div>
                  <strong>{count}</strong>
                </div>
              ))}
            </div> : <EmptyState>No resource data observed.</EmptyState>}
          </Card>
        </Reveal>
        <Reveal delay={0.05}>
          <Card title="Performance snapshot" action={<CircleGauge size={18} aria-hidden="true" />}>
            <StatList rows={[
              ["DOMContentLoaded", perf?.domContentLoadedMs == null ? "—" : `${perf.domContentLoadedMs} ms`],
              ["Load event", perf?.loadMs == null ? "—" : `${perf.loadMs} ms`],
              ["First contentful paint", perf?.fcpMs == null ? "—" : `${perf.fcpMs} ms`],
              ["Transferred resources", formatBytes(sumTransfer(report))],
              ...(audit?.status === "completed" ? [
                ["Largest contentful paint", audit.metrics?.["largest-contentful-paint"]?.displayValue || "—"],
                ["Cumulative layout shift", audit.metrics?.["cumulative-layout-shift"]?.displayValue || "—"],
                ["Total blocking time", audit.metrics?.["total-blocking-time"]?.displayValue || "—"],
              ] as Array<[string, string]> : []),
              ...(cruxLast ? [["Real-user LCP p75", cruxLast.lcpP75 == null ? "—" : `${(cruxLast.lcpP75 / 1000).toFixed(2)} s`]] as Array<[string, string]> : []),
            ]} />
            <p className="card-note">{crux?.status === "available" ? `CrUX ${crux.formFactor} · ${crux.periods.length} historical periods` : `Real-user history: ${crux?.status === "not_configured" ? "configure CRUX_API_KEY" : crux?.status === "insufficient_data" ? "insufficient data" : crux?.status === "failed" ? crux.error : "unavailable"}`}</p>
          </Card>
        </Reveal>
      </div>

      <div className="two-column-grid">
        <Reveal>
          <Card title="DNS & infrastructure" action={<Server size={18} aria-hidden="true" />}>
            {Object.values(scan.infrastructure?.dns || {}).some((values) => values.length) ? <StatList rows={[
              ...Object.entries(scan.infrastructure?.dns || {}).filter(([, values]) => values.length).map(([key, values]) => [key, truncate(values.join(", "), 82)] as [string, string]),
              ...(scan.infrastructure?.geo ? [
                ["Server IP", scan.infrastructure.geo.ip || "—"],
                ["IP country", scan.infrastructure.geo.country || "—"],
                ["Network owner", scan.infrastructure.geo.networkOwner || "—"],
              ] as Array<[string, string]> : []),
            ]} /> : <EmptyState>DNS records unavailable.</EmptyState>}
          </Card>
        </Reveal>
        <Reveal delay={0.05}>
          <Card title="TLS certificate" action={<KeyRound size={18} aria-hidden="true" />}>
            {scan.infrastructure?.tls ? <StatList rows={[
              ["Protocol", scan.infrastructure.tls.protocol || "—"],
              ["Subject", scan.infrastructure.tls.subject || "—"],
              ["Issuer", scan.infrastructure.tls.issuer || "—"],
              ["Expires", scan.infrastructure.tls.validTo || "—"],
              ["SANs", scan.infrastructure.tls.subjectAltNames.length],
            ]} /> : <EmptyState>TLS certificate unavailable.</EmptyState>}
          </Card>
        </Reveal>
      </div>
      </> : null}
    </section>
  );
}

function Opportunities({ report }: { report: ReportData }) {
  const audit = report.scan.lighthouse;
  return (
    <section id="audits" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("audits")} / OPTIMIZE`} title="Opportunities" description="Lighthouse findings with the greatest potential effect on experience and efficiency." />
      <Card className="table-card">
        <DataTable label="Lighthouse optimization opportunities" headers={["Audit", "Score", "Potential saving"]} rows={audit?.status === "completed" ? (audit.opportunities || []).map((item) => [<strong>{item.title}</strong>, item.score == null ? "—" : Math.round(item.score * 100), item.displayValue || "—"]) : []} empty="No Lighthouse audit is available for this report." />
      </Card>
    </section>
  );
}

function DataFlows({ report }: { report: ReportData }) {
  const { insights, scan } = report;
  return (
    <section id="flows" className="report-section report-section--atmospheric">
      <div className="section-glow" aria-hidden="true" />
      <SectionHeader eyebrow={`${sectionNumber("flows")} / TRACE`} title="Data flows" description="Follow each observed path from the page that initiated it to the service that received it." />
      <div className="flow-grid">
        <Card title="Destination graph" action={<Route size={18} aria-hidden="true" />}>
          <div id="flow-list" className="scroll-list">
            {insights.graph.length ? insights.graph.slice(0, 100).map((edge, index) => (
              <div className="flow-item" key={`${edge.source}-${edge.destination}-${index}`}>
                <span className="flow-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{truncate(edge.source, 48)}</strong><span><ArrowRight size={13} /> {edge.destination}</span></div>
                <Chip tone="neutral">{edge.requests} req</Chip>
              </div>
            )) : <EmptyState>No flows observed.</EmptyState>}
          </div>
        </Card>
        <Card title="Detected data fields" action={<Fingerprint size={18} aria-hidden="true" />}>
          <div id="field-list" className="scroll-list">
            {insights.dataFields.length ? insights.dataFields.slice(0, 100).map((field, index) => (
              <div className="field-item" key={`${field.field}-${index}`}>
                <div><strong>{field.field}</strong><small>{truncate(field.destinations.join(", "), 74)}</small></div>
                <Chip>{field.category}</Chip>
              </div>
            )) : <EmptyState>No field names observed.</EmptyState>}
          </div>
        </Card>
      </div>
      <Card title="Unknown destinations" className="unknown-card" action={<ShieldAlert size={18} aria-hidden="true" />}>
        <div id="unknown-list" className="chip-cloud">
          {insights.unknownDestinations.length ? insights.unknownDestinations.map((host) => <Chip key={host} tone="warning">{host}</Chip>) : <EmptyState>No unknown third parties observed.</EmptyState>}
        </div>
        <div className="signal-summary">
          <span><Cloud size={16} /> {scan.subdomains?.length || 0} subdomains</span>
          <span><Cable size={16} /> {scan.websockets?.length || 0} WebSockets</span>
          <span><Database size={16} /> {scan.serviceWorkers?.length || 0} service workers</span>
        </div>
      </Card>
    </section>
  );
}

function BrowserState({ report }: { report: ReportData }) {
  const { scan } = report;
  return (
    <section id="browser-state" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("browser-state")} / STATE`} title="Browser state" description="Cookie and storage identifiers only—TRAXELON does not retain their values." />
      <div className="two-column-grid">
        <Card title="Cookies" className="table-card" action={<Cookie size={18} aria-hidden="true" />}>
          <div id="cookie-list"><DataTable label="Observed cookies" headers={["Name", "Domain", "Expiry", "Protection", "Phase"]} rows={(scan.cookies || []).slice(0, 300).map((cookie) => [
            <strong>{cookie.name}</strong>,
            <><span>{cookie.domain}</span>{cookie.isThirdParty ? <Chip tone="warning">Third party</Chip> : null}<small className="cell-note">{cookie.vendor || cookie.category || ""}</small></>,
            cookie.expires || "Session",
            `${cookie.secure ? "Secure · " : ""}${cookie.httpOnly ? "HttpOnly · " : ""}${cookie.sameSite || "No SameSite"}`,
            phaseLabel(cookie.phase),
          ])} /></div>
        </Card>
        <Card title="Storage" className="table-card" action={<Database size={18} aria-hidden="true" />}>
          <div id="storage-list"><DataTable label="Observed browser storage" headers={["Kind", "Key / database", "Origin"]} rows={(scan.storage || []).slice(0, 300).map((item) => [item.kind.replaceAll("_", " "), <strong>{item.name}</strong>, truncate(item.origin, 55)])} /></div>
        </Card>
      </div>
      <Card title="Consent observations" action={<ShieldCheck size={18} aria-hidden="true" />}>
        <div id="consent-list"><StatList rows={[
          ["Banner detected", scan.consentUi.detected ? <Chip tone="success">Yes</Chip> : <Chip tone="neutral">No</Chip>],
          ["Action", scan.consentUi.action ? `${scan.consentUi.action.choice}: ${scan.consentUi.action.succeeded ? "clicked" : "unavailable"}` : "Baseline observation"],
          ...(scan.consentUi.signals || []).map((signal) => [signal.kind.replaceAll("_", " "), truncate(signal.detail, 76)] as [string, string]),
        ]} /></div>
      </Card>
    </section>
  );
}

function NetworkTimeline({ report }: { report: ReportData }) {
  const requests = report.scan.requests;
  const maxMs = Math.max(1, ...requests.map((request) => (request.timing?.startOffsetMs || 0) + (request.durationMs || 0)));
  return (
    <section id="network" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("network")} / REQUESTS`} title="Network timeline" description="Every observed request with destination, timing, transfer size, and exposed field names." />
      <Card className="table-card">
        <div id="request-list"><DataTable label="Network request timeline" headers={["Page / resource", "Method", "Status", "Type", "Destination", "Waterfall", "Time", "Transfer", "Fields", "Phase"]} rows={requests.slice(0, 500).map((request) => {
          const start = Math.min(98, Math.max(0, 100 * (request.timing?.startOffsetMs || 0) / maxMs));
          const width = request.durationMs == null ? 0 : Math.min(100 - start, Math.max(2, 100 * request.durationMs / maxMs));
          const fields = [...(request.queryFields || []), ...(request.bodyFields || [])].map((field) => field.name).join(", ") || "—";
          return [
            <div className="resource-cell"><strong>{truncate(request.url, 82)}</strong><small>{truncate(request.observedOn, 72)}</small></div>,
            request.method,
            request.status ?? (request.failed ? <Chip tone="warning">Failed</Chip> : "—"),
            request.resourceType,
            <>{request.vendor || request.host}{request.isThirdParty ? <Chip tone="warning">Third party</Chip> : null}</>,
            request.durationMs == null ? "—" : <div className="waterfall" title={`Request started at ${request.timing?.startOffsetMs || 0} ms and lasted ${request.durationMs} ms`}><i style={{ left: `${start}%`, width: `${width}%` }} /></div>,
            request.durationMs == null ? "—" : `${request.durationMs} ms`,
            formatBytes(request.transferBytes),
            truncate(fields, 64),
            phaseLabel(request.phase),
          ];
        })} /></div>
      </Card>
    </section>
  );
}

function TechnologyTable({ report }: { report: ReportData }) {
  return (
    <section id="technologies" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("technologies")} / STACK`} title="Technologies & vendors" description="Evidence-backed detection across requests, scripts, cookies, DOM signals, and response headers." />
      <Card className="table-card">
        <div id="technology-list"><DataTable label="Detected technologies and vendors" headers={["Technology", "Category", "Confidence", "Country", "Evidence"]} rows={report.scan.technologies.map((technology) => [
          <strong>{technology.name}</strong>,
          technology.category.replaceAll("_", " "),
          <Chip tone={technology.confidence === "high" ? "success" : "info"}>{technology.confidence}</Chip>,
          technology.destinationCountry || "—",
          truncate(technology.evidence.map((evidence) => evidence.value).join(", "), 100),
        ])} /></div>
      </Card>
    </section>
  );
}

function PageInventory({ report }: { report: ReportData }) {
  return (
    <section id="pages" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("pages")} / INVENTORY`} title="Page inventory" description="Rendered pages, page-level performance, forms, SEO signals, and transport security." />
      <Card className="table-card">
        <div id="page-list"><DataTable label="Scanned page inventory" headers={["Page", "Status", "Title", "Load", "Forms", "SEO", "Security"]} rows={report.scan.pages.map((page) => [
          <details><summary>{truncate(page.finalUrl || page.url, 88)}</summary><div className="details-content"><span>Description: {page.description || "—"}</span><span>Canonical: {page.canonical || "—"}</span><span>Headings: {Object.entries(page.headings || {}).map(([key, value]) => `${key}: ${value}`).join(", ") || "—"}</span><span>Frames: {(page.frames || []).join(", ") || "—"}</span></div></details>,
          page.status || "—",
          truncate(page.title || "—", 58),
          page.performance?.loadMs == null ? "—" : `${page.performance.loadMs} ms`,
          page.forms?.length || 0,
          page.seo?.robots || "—",
          page.url.startsWith("https:") ? page.securityHeaders?.["strict-transport-security"] ? <Chip tone="success">HSTS</Chip> : <Chip tone="warning">No HSTS</Chip> : <Chip tone="warning">HTTP</Chip>,
        ])} /></div>
      </Card>
    </section>
  );
}

function Findings({ report }: { report: ReportData }) {
  return (
    <section id="findings" className="report-section">
      <SectionHeader eyebrow={`${sectionNumber("findings")} / REVIEW`} title="Findings" description="Evidence worth a closer look, presented as observations rather than legal conclusions." />
      <div id="finding-list" className="finding-list">
        {report.insights.findings.length ? report.insights.findings.slice(0, 100).map((finding, index) => (
          <motion.article className={`finding finding--${finding.severity}`} key={`${finding.kind}-${index}`} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: Math.min(index * 0.025, 0.3) }}>
            <span className="finding-icon" aria-hidden="true">{finding.severity === "warning" ? <TriangleAlert size={19} /> : <CheckCircle2 size={19} />}</span>
            <div><strong>{finding.kind.replaceAll("_", " ")}</strong><p>{truncate(finding.page, 100)} · {finding.evidence}</p></div>
            <Chip tone={finding.severity === "warning" ? "warning" : "info"}>{finding.confidence}</Chip>
          </motion.article>
        )) : <Card><EmptyState>No findings from the checks currently implemented.</EmptyState></Card>}
      </div>
    </section>
  );
}

export function Report({ report }: { report: ReportData }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div id="report" initial={reducedMotion ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
      <ReportHeading report={report} />
      {hasSection("overview") ? <Overview report={report} /> : null}
      {hasSection("audits") ? <Opportunities report={report} /> : null}
      {hasSection("flows") ? <DataFlows report={report} /> : null}
      {hasSection("browser-state") ? <BrowserState report={report} /> : null}
      {hasSection("network") ? <NetworkTimeline report={report} /> : null}
      {hasSection("technologies") ? <TechnologyTable report={report} /> : null}
      {hasSection("pages") ? <PageInventory report={report} /> : null}
      {hasSection("findings") ? <Findings report={report} /> : null}
    </motion.div>
  );
}
