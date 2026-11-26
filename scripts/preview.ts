// Local preview with synthetic data (no Cloudflare account needed): npx tsx scripts/preview.ts
import { createServer } from "node:http";
import app from "../src/index";
import { memoryD1 } from "../tests/helpers/d1";
import { seed } from "../tests/helpers/seed";
import { recomputeAll } from "../src/jobs/derived";
import { localDate } from "../src/lib/time";

const tz = "America/Vancouver"; const today = localDate(new Date(), tz);
const { raw, d1 } = memoryD1();
if (!process.argv.includes("--empty")) seed(raw, today);
await recomputeAll(d1, today, new Date().toISOString(), 90);
const env = { DB: d1, LOCAL_TIME_ZONE: tz, AUTH_MODE: "dev-insecure", RAW_ENCRYPTION_KEY: "0".repeat(64) };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const port = Number(process.env.PORT ?? 8788);
createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const r = await app.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers as HeadersInit, body: chunks.length ? Buffer.concat(chunks) : undefined }), env as never, ctx as never);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
