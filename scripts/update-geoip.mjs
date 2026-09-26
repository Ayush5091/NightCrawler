import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile, unlink, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

const envPath = resolve(".env.local");
if (existsSync(envPath)) loadEnvFile(envPath);
const account = process.env.MAXMIND_ACCOUNT_ID;
const license = process.env.MAXMIND_LICENSE_KEY;
if (!account || !license) throw new Error("Set MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY in .env.local or the process environment");
const run = promisify(execFile);
const root = resolve("data", "geoip");
await mkdir(root, { recursive: true });

for (const edition of ["GeoLite2-City", "GeoLite2-ASN"]) {
  const dir = join(root, edition);
  const archive = join(root, `${edition}.tar.gz`);
  await mkdir(dir, { recursive: true });
  const url = `https://download.maxmind.com/geoip/databases/${edition}/download?suffix=tar.gz`;
  const auth = Buffer.from(`${account}:${license}`).toString("base64");
  const response = await fetch(url, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`${edition} download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1000 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw new Error(`${edition} download was not a gzip archive`);
  await writeFile(archive, buffer);
  try {
    await run("tar", ["-xzf", archive, "-C", dir], { timeout: 120000 });
    const entries = await readdir(dir, { recursive: true });
    const database = entries.find((entry) => entry.endsWith(".mmdb"));
    if (!database) throw new Error(`${edition} archive contained no .mmdb file`);
    const target = join(root, `${edition}.mmdb`);
    await copyFile(join(dir, database), target);
    await unlink(join(dir, database));
    console.log(`${edition}: ${target}`);
  } finally { await unlink(archive).catch(() => {}); }
}

console.log("Restart the scanner to use the updated local databases.");
