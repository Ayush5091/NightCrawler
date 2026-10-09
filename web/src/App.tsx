import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { DashboardHeader, ScanForm, Sidebar, StatusBar, type ScanFormValues } from "./components/Shell";
import { Report } from "./Report";
import { apiJson } from "./lib";
import { TOOLS_URL } from "./site";
import type { ReportData, ScanJob } from "./types";

type StatusTone = "idle" | "busy" | "success" | "error";

export default function App() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Enter a website to begin. Scans run in a real Chromium browser.");
  const [statusTone, setStatusTone] = useState<StatusTone>("idle");

  const startScan = async (values: ScanFormValues) => {
    setBusy(true);
    setReport(null);
    setStatus(`Launching a Chromium observation for ${values.url}…`);
    setStatusTone("busy");
    try {
      const created = await apiJson<{ id: string; error?: string }>("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!created.id) throw new Error(created.error || "Could not start the scan.");

      for (;;) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const job = await apiJson<ScanJob>(`/api/scans/${created.id}`);
        if (job.status === "completed" && job.scan && job.insights) {
          setReport({ id: created.id, scan: job.scan, insights: job.insights });
          setStatus("Scan complete. The report is ready to explore.");
          setStatusTone("success");
          requestAnimationFrame(() => document.querySelector("#report")?.scrollIntoView({ behavior: "smooth", block: "start" }));
          break;
        }
        if (job.status === "failed") throw new Error(job.error || "The scan failed.");
        setStatus(`${job.stage || "Observing website"}…`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The scan could not be completed.");
      setStatusTone("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main>
        <DashboardHeader />
        <ScanForm
          busy={busy}
          onSubmit={startScan}
          onError={(message) => { setStatus(message); setStatusTone("error"); }}
        />
        <StatusBar message={status} tone={statusTone} />
        <AnimatePresence mode="wait">
          {report ? <Report key={report.id} report={report} /> : null}
        </AnimatePresence>
        <footer>
          <div className="footer-mark"><ShieldCheck size={18} aria-hidden="true" /> TRAXELON</div>
          <p>Reports observed evidence. Field names are stored; request and cookie values are not.</p>
          <a href={TOOLS_URL}>Part of TRAXELON Tools</a>
        </footer>
      </main>
    </div>
  );
}
