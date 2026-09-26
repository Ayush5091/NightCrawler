import { Resolver as DnsResolver } from "node:dns/promises";
import { connect } from "node:tls";
import type { ScanResult } from "./types";

export async function inspectInfrastructure(rawUrl: string): Promise<NonNullable<ScanResult["infrastructure"]>> {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const resolver = new DnsResolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const dns: Record<string, string[]> = {};
  await Promise.all(["A","AAAA","CNAME","MX","NS","TXT","CAA","SOA"].map(async (type) => {
    try {
      const result = await Promise.race([
        resolver.resolve(host, type as "A"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), 4000)),
      ]);
      dns[type] = (result as unknown[]).map((item) => typeof item === "string" ? item : JSON.stringify(item)).slice(0, 30);
    } catch { dns[type] = []; }
  }));
  resolver.cancel();
  if (url.protocol !== "https:") return { dns, tls: null };
  const tls = await new Promise<NonNullable<ScanResult["infrastructure"]>["tls"]>((resolve) => {
    const socket = connect({ host, port: Number(url.port) || 443, servername: host, timeout: 5000, rejectUnauthorized: true }, () => {
      const cert = socket.getPeerCertificate();
      resolve({ protocol: socket.getProtocol(), issuer: String(cert.issuer?.O ?? "") || null, subject: String(cert.subject?.CN ?? "") || null, validTo: cert.valid_to ?? null, subjectAltNames: (cert.subjectaltname ?? "").split(", ").map((name) => name.replace(/^DNS:/, "")).slice(0, 50) });
      socket.end();
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => { socket.destroy(); resolve(null); });
  });
  return { dns, tls };
}
