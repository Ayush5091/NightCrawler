import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { open, type AsnResponse, type CityResponse } from "maxmind";
import type { RequestObservation, ScanResult } from "./types";

type Geo = NonNullable<NonNullable<ScanResult["infrastructure"]>["geo"]>;
type Readers = { city: Awaited<ReturnType<typeof open<CityResponse>>> | null; asn: Awaited<ReturnType<typeof open<AsnResponse>>> | null };
let readersPromise: Promise<Readers> | null = null;

async function readers(): Promise<Readers> {
  readersPromise ??= Promise.all([
    process.env.GEOLITE2_CITY_DB ? open<CityResponse>(process.env.GEOLITE2_CITY_DB).catch(() => null) : null,
    process.env.GEOLITE2_ASN_DB ? open<AsnResponse>(process.env.GEOLITE2_ASN_DB).catch(() => null) : null,
  ]).then(([city, asn]) => ({ city, asn }));
  return readersPromise;
}

function isPublic(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(ip) === 6) return !/^(::1|::|fe80:|fc|fd)/i.test(ip);
  return false;
}

async function hostIp(host: string): Promise<string | null> {
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS timeout")), 3000)),
    ]);
    return addresses.map((value) => value.address).find(isPublic) ?? null;
  } catch { return null; }
}

function lookupIp(ip: string | null, db: Readers): Geo {
  if (!ip) return { status: "lookup_failed", ip: null, country: null, city: null, asn: null, networkOwner: null };
  const city = db.city?.get(ip);
  const asn = db.asn?.get(ip);
  return {
    status: db.city || db.asn ? "available" : "database_missing",
    ip,
    country: city?.country?.iso_code ?? null,
    city: city?.city?.names?.en ?? null,
    asn: asn?.autonomous_system_number ?? null,
    networkOwner: asn?.autonomous_system_organization ?? null,
  };
}

/** Uses only local MaxMind databases. The DNS lookup is for the current IP, not enrichment. */
export async function enrichGeo(startUrl: string, requests: RequestObservation[]): Promise<Geo> {
  const db = await readers();
  const originHost = new URL(startUrl).hostname;
  const hosts = [originHost, ...new Set(requests.map((request) => request.host).filter((host) => host !== originHost))].slice(0, 60);
  const entries = await Promise.all(hosts.map(async (host) => [host, lookupIp(await hostIp(host), db)] as const));
  const byHost = new Map(entries);
  for (const request of requests) {
    const geo = byHost.get(request.host);
    if (!geo) continue;
    request.destinationIp = geo.ip;
    request.ipCountry = geo.country;
    request.asn = geo.asn;
    request.networkOwner = geo.networkOwner;
  }
  return byHost.get(originHost) ?? lookupIp(null, db);
}
