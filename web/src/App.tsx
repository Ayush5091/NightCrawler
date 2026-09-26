import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, GitCompareArrows, History as HistoryIcon, ShieldCheck } from "lucide-react";
import { DashboardHeader, ScanForm, Sidebar, StatusBar, type ScanFormValues } from "./components/Shell";
import { Card, Chip, DataTable, SectionHeader } from "./components/UI";
import { Report } from "./Report";
import { apiJson, formatDate, truncate } from "./lib";
import type { ComparisonResult, HistoryItem, ReportData, ScanJob, ScanInsights, ScanResult } from "./types";

type StatusTone = "idle" | "busy" | "success" | "error";

export default function App() {
  const [report, setReport] = useState<ReportData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Enter a website to begin. Scans run in a real Chromium browser.");
  const [statusTone, setStatusTone] = useState<StatusTone>("idle");

  const refreshHistory = useCallback(async () => {
    const items = await apiJson<HistoryItem[]>("/api/scans");
    setHistory(items);
  }, []);

  useEffect(() => {
    void refreshHistory().catch((error: Error) => {
      setStatus(error.message);
      setStatusTone("error");
    });
  }, [refreshHistory]);

  const openScan = useCallback(async (id: string) => {
    setBusy(true);
    setStatus("Loading scan evidence…");
    setStatusTone("busy");
    try {
      const result = await apiJson<ScanJob>(`/api/scans/${id}`);
      if (result.status === "completed" && result.scan && result.insights) {
        setReport({ id, scan: result.scan, insights: result.insights });
        setStatus("Scan ready. Evidence has been organized below.");
        setStatusTone("success");
        await refreshHistory();
        requestAnimationFrame(() => document.querySelector("#report")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      throw new Error(result.error || result.stage || "Scan is still running.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the scan.");
      setStatusTone("error");
    } finally {
      setBusy(false);
    }
  }, [refreshHistory]);

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
          await refreshHistory();
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

  const compare = async (historyId: string) => {
    if (!report || report.id === "demo") return;
    setStatus("Comparing observations…");
    setStatusTone("busy");
    try {
      const diff = await apiJson<ComparisonResult>(`/api/scans/${report.id}/compare?with=${historyId}`);
      setStatus(`New since comparison: ${diff.destinations?.length || 0} destinations, ${diff.technologies?.length || 0} technologies, ${diff.cookies?.length || 0} cookies, and ${diff.dataFields?.length || 0} fields.`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not compare scans.");
      setStatusTone("error");
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
          onDemo={() => openScan("demo")}
          onError={(message) => { setStatus(message); setStatusTone("error"); }}
        />
        <StatusBar message={status} tone={statusTone} />
        <AnimatePresence mode="wait">
          {report ? <Report key={report.id} report={report} /> : null}
        </AnimatePresence>
        <HistorySection history={history} selectedId={report?.id || null} onOpen={openScan} onCompare={compare} />
        <footer>
          <div className="footer-mark"><ShieldCheck size={18} aria-hidden="true" /> NightCrawler</div>
          <p>Reports observed evidence. Field names are stored; request and cookie values are not.</p>
          <span>Local-first website intelligence</span>
        </footer>
      </main>
    </div>
  );
}

function HistorySection({
  history,
  selectedId,
  onOpen,
  onCompare,
}: {
  history: HistoryItem[];
  selectedId: string | null;
  onOpen: (id: string) => Promise<void>;
  onCompare: (id: string) => Promise<void>;
}) {
  return (
    <section id="history" className="report-section history-section">
      <SectionHeader eyebrow="ARCHIVE" title="Scan history" description="Open a previous observation or compare it with the report currently in view." />
      <Card className="table-card" action={<HistoryIcon size={18} aria-hidden="true" />}>
        <div id="history-list">
          <DataTable label="Saved scan history" headers={["Website", "Status", "Scanned", "Pages", "Compare"]} rows={history.map((item) => [
            <button className="text-button text-button--url" type="button" data-open={item.id} onClick={() => void onOpen(item.id)}>
              <span>{truncate(item.url, 74)}</span><ArrowRight size={15} aria-hidden="true" />
            </button>,
            item.status === "failed" ? <Chip tone="warning" title={item.error || "Page failed"}>Failed</Chip> : <Chip tone="success">Complete</Chip>,
            formatDate(item.startedAt),
            item.summary.pagesScanned,
            selectedId && selectedId !== "demo" && selectedId !== item.id ? (
              <motion.button className="text-button" type="button" data-compare={item.id} onClick={() => void onCompare(item.id)} whileTap={{ scale: 0.96 }}>
                <GitCompareArrows size={15} /> Compare
              </motion.button>
            ) : "—",
          ])} empty="Completed scans will appear here." />
        </div>
      </Card>
    </section>
  );
}
