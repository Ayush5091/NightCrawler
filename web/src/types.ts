import type { ScanResult } from "../../src/types";

export type { ScanResult };

export interface ScanInsights {
  vendors: Array<{ name: string; category: string; country: string | null; requests: number; hosts: string[] }>;
  unknownDestinations: string[];
  dataFields: Array<{ category: string; field: string; destinations: string[] }>;
  graph: Array<{ source: string; destination: string; requests: number; categories: string[] }>;
  findings: Array<{
    kind: string;
    severity: "info" | "warning";
    page: string;
    evidence: string;
    confidence: "high" | "medium";
  }>;
}

export interface ReportData {
  id: string;
  scan: ScanResult;
  insights: ScanInsights;
}

export interface ScanJob {
  id: string;
  status: "running" | "completed" | "failed";
  stage?: string;
  error?: string;
  scan?: ScanResult;
  insights?: ScanInsights;
}
