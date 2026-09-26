import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  Boxes,
  ChevronRight,
  Clock3,
  Database,
  FileSearch,
  Fingerprint,
  Gauge,
  History,
  Menu,
  Network,
  Radar,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

const navItems = [
  { href: "#overview", label: "Overview", icon: Gauge },
  { href: "#flows", label: "Data flows", icon: Activity },
  { href: "#network", label: "Network", icon: Network },
  { href: "#technologies", label: "Technologies", icon: Boxes },
  { href: "#pages", label: "Pages", icon: FileSearch },
  { href: "#findings", label: "Findings", icon: ShieldCheck },
  { href: "#history", label: "History", icon: History },
] as const;

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="NightCrawler home">
      <span className="brand-mark" aria-hidden="true"><Radar size={24} /></span>
      <span><strong>NightCrawler</strong><small>WEBSITE INTELLIGENCE</small></span>
    </a>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="mobile-menu" type="button" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu size={21} />
      </button>
      <AnimatePresence>
        {open ? <motion.button className="nav-scrim" aria-label="Close navigation" type="button" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /> : null}
      </AnimatePresence>
      <motion.aside className={open ? "sidebar sidebar--open" : "sidebar"} initial={false}>
        <div className="sidebar-top">
          <Brand />
          <button className="mobile-close" type="button" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav aria-label="Report sections">
          <span className="nav-label">SCAN REPORT</span>
          {navItems.map(({ href, label, icon: Icon }, index) => (
            <motion.a
              href={href}
              key={href}
              onClick={() => setOpen(false)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.16 + index * 0.035, duration: 0.35 }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight className="nav-arrow" size={14} aria-hidden="true" />
            </motion.a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" aria-hidden="true" />
          <div><strong>Local analysis</strong><small>Values stay private</small></div>
        </div>
      </motion.aside>
    </>
  );
}

function Atmosphere() {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scope.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let active = true;
    let context: { revert: () => void } | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapModule, scrollModule]) => {
      if (!active) return;
      const { gsap } = gsapModule;
      const { ScrollTrigger } = scrollModule;
      gsap.registerPlugin(ScrollTrigger);
      context = gsap.context(() => {
        gsap.fromTo(".hero-orbit", { y: 0, rotate: 0 }, {
          y: 52,
          rotate: 8,
          ease: "none",
          scrollTrigger: { trigger: element, start: "top top", end: "bottom top", scrub: 1.2 },
        });
        gsap.to(".hero-pulse", { scale: 1.12, opacity: 0.68, duration: 4.2, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }, element);
    });
    return () => { active = false; context?.revert(); };
  }, []);
  return (
    <div className="atmosphere" ref={scope} aria-hidden="true">
      <div className="hero-orbit hero-orbit--one" />
      <div className="hero-orbit hero-orbit--two" />
      <div className="hero-pulse" />
      <div className="signal-grid" />
    </div>
  );
}

export function DashboardHeader() {
  const reducedMotion = useReducedMotion();
  return (
    <header className="hero" id="top">
      <Atmosphere />
      <div className="hero-copy">
        <motion.div className="eyebrow eyebrow--hero" initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <span className="live-dot" aria-hidden="true" /> Website observability
        </motion.div>
        <motion.h1 initial={reducedMotion ? false : { opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}>
          See beneath<br /><span>the surface.</span>
        </motion.h1>
        <motion.p initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.55, delay: 0.28 }}>
          Scan pages, expose third-party paths, trace data fields, and turn a website’s hidden activity into evidence you can act on.
        </motion.p>
      </div>
      <motion.div className="hero-visual" initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.15 }} aria-hidden="true">
        <div className="radar-disc">
          <div className="radar-ring radar-ring--outer" />
          <div className="radar-ring radar-ring--inner" />
          <div className="radar-sweep" />
          <span className="radar-node radar-node--one" />
          <span className="radar-node radar-node--two" />
          <span className="radar-node radar-node--three" />
          <Fingerprint size={42} />
        </div>
      </motion.div>
    </header>
  );
}

export interface ScanFormValues {
  url: string;
  maxPages: number;
  maxDepth: number;
  device: "desktop" | "mobile";
  mode: "baseline" | "all" | "necessary_only";
  storageState?: unknown;
}

export function ScanForm({ busy, onSubmit, onDemo, onError }: { busy: boolean; onSubmit: (values: ScanFormValues) => Promise<void>; onDemo: () => Promise<void>; onError: (message: string) => void }) {
  const [url, setUrl] = useState("");
  const [pages, setPages] = useState(10);
  const [depth, setDepth] = useState(2);
  const [device, setDevice] = useState<ScanFormValues["device"]>("desktop");
  const [mode, setMode] = useState<ScanFormValues["mode"]>("baseline");
  const [file, setFile] = useState<File | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let storageState: unknown;
    if (file) {
      if (file.size > 800_000) throw new Error("Session file is too large (800 KB maximum).");
      try { storageState = JSON.parse(await file.text()); }
      catch { throw new Error("Session file is not valid JSON."); }
      if (!storageState || typeof storageState !== "object" || !Array.isArray((storageState as { cookies?: unknown }).cookies) || !Array.isArray((storageState as { origins?: unknown }).origins)) {
        throw new Error("Select a Playwright storageState JSON file.");
      }
    }
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await onSubmit({ url: normalizedUrl, maxPages: pages, maxDepth: depth, device, mode, storageState });
  };

  return (
    <motion.section className="scan-panel" aria-labelledby="scan-heading" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.58, delay: 0.22 }}>
      <div className="scan-panel__heading">
        <div className="icon-well"><ScanLine size={21} aria-hidden="true" /></div>
        <div><span className="eyebrow">NEW OBSERVATION</span><h2 id="scan-heading">Start a website scan</h2></div>
        <span className="secure-note"><ShieldCheck size={15} /> Local & private</span>
      </div>
      <form id="scan-form" onSubmit={(event) => void submit(event).catch((error: Error) => onError(error.message))}>
        <div className="field field--url">
          <label htmlFor="url">Website URL</label>
          <div className="input-shell"><input id="url" type="text" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" required /></div>
        </div>
        <div className="field"><label htmlFor="pages-limit">Pages</label><input id="pages-limit" type="number" value={pages} onChange={(event) => setPages(Number(event.target.value))} min="1" max="100" /></div>
        <div className="field"><label htmlFor="depth-limit">Depth</label><input id="depth-limit" type="number" value={depth} onChange={(event) => setDepth(Number(event.target.value))} min="0" max="5" /></div>
        <div className="field"><label htmlFor="device">Device</label><select id="device" value={device} onChange={(event) => setDevice(event.target.value as ScanFormValues["device"])}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></div>
        <div className="field"><label htmlFor="mode">Consent</label><select id="mode" value={mode} onChange={(event) => setMode(event.target.value as ScanFormValues["mode"])}><option value="baseline">Before</option><option value="all">Accept all</option><option value="necessary_only">Reject all</option></select></div>
        <motion.button id="scan-button" className="button button--primary" disabled={busy} type="submit" whileTap={{ scale: 0.97 }}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <Radar size={18} aria-hidden="true" />}
          {busy ? "Scanning…" : "Start scan"}
        </motion.button>
        <label className="session-upload" htmlFor="session-file"><Upload size={16} aria-hidden="true" /><span>{file ? file.name : "Attach saved browser session"}</span><input id="session-file" type="file" accept=".json,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" id="demo-button" className="button button--tonal" disabled={busy} onClick={() => void onDemo()}><Sparkles size={17} /> View demo report</button>
      </form>
    </motion.section>
  );
}

export function StatusBar({ message, tone = "idle" }: { message: string; tone?: "idle" | "busy" | "success" | "error" }) {
  return (
    <div id="status" className={`status-bar status-bar--${tone}`} role="status" aria-live="polite">
      <span className="status-bar__icon" aria-hidden="true">{tone === "busy" ? <span className="status-pulse" /> : tone === "success" ? <ShieldCheck size={17} /> : tone === "error" ? <X size={17} /> : <Clock3 size={17} />}</span>
      <span>{message}</span>
    </div>
  );
}
