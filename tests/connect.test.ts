import { describe, expect, it } from "vitest";
import app from "../src/index";
import { memoryD1 } from "./helpers/d1";
import { HAE_METRICS, haeDeepLink } from "../src/web/connect";
import { METRICS } from "../src/ingest/hae";
import type { Env } from "../src/env";

const { raw, d1 } = memoryD1();
const env = { DB: d1, LOCAL_TIME_ZONE: "America/Vancouver", AUTH_MODE: "dev-insecure", RAW_ENCRYPTION_KEY: "0".repeat(64) } as unknown as Env;
const ctx = { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (path: string, init?: RequestInit) => app.fetch(new Request(`http://localhost${path}`, init), env, ctx);

const snake = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

describe("HAE deep link", () => {
  const link = haeDeepLink({ url: "https://health.example.com/ingest/hae", token: "a".repeat(64), kind: "metrics" });
  it("uses the documented scheme and order", () => {
    expect(link.startsWith("com.HealthExport://automation?url=https%3A%2F%2Fhealth.example.com%2Fingest%2Fhae&")).toBe(true);
    const keys = new URL(link.replace("com.HealthExport://", "https://x/")).searchParams;
    const order = [...keys.keys()];
    expect(order.indexOf("datatype")).toBeLessThan(order.indexOf("metrics"));
    expect(order.indexOf("format")).toBeLessThan(order.indexOf("aggregatedata"));
    expect(keys.get("headers")).toBe(`Authorization,Bearer ${"a".repeat(64)}`);
    expect(keys.get("interval")).toBe("hours");
    expect(keys.get("aggregatesleep")).toBe("true");
  });
  it("encodes + and & in metric names but keeps list commas", () => {
    expect(link).toContain("Walking%20%2B%20Running%20Distance,");
    expect(link).toContain("Weight%20%26%20Body%20Mass");
    expect(link).not.toMatch(/ /);
  });
  it("only asks for metrics the parser accepts", () => {
    const special = new Set(["sleep_analysis", "blood_pressure"]);
    const map: Record<string, string> = { "Weight & Body Mass": "weight_body_mass", "Heart Rate Variability": "heart_rate_variability" };
    for (const m of HAE_METRICS) {
      const key = map[m] ?? snake(m);
      expect(special.has(key) || key in METRICS, m).toBe(true);
    }
  });
  it("adds Access headers only when configured", () => {
    const w = haeDeepLink({ url: "https://h/ingest/hae", token: "b".repeat(64), kind: "workouts", access: { id: "id1", secret: "s1" } });
    expect(w).toContain("datatype=workouts");
    expect(w).toContain("CF-Access-Client-Id,id1,CF-Access-Client-Secret,s1");
    expect(w).not.toContain("metrics=");
  });
});

describe("/connect wizard", () => {
  it("renders the guide and a QR for desktop", async () => {
    const html = await (await call("/connect")).text();
    expect(html).toContain("连接 Apple Health");
    expect(html).toContain("apps.apple.com/app/id1115567069");
    expect(html).toContain("<svg");
    expect(html).not.toContain("undefined");
  });
  it("creates a token, retires unused ones, and the token can ingest", async () => {
    raw.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at) VALUES ('old', 'health_auto_export', 'old', 'x', '2026-01-01T00:00:00Z')").run();
    raw.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at, last_seen_at) VALUES ('used', 'health_auto_export', 'used', 'y', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')").run();
    const res = await call("/connect/create", { method: "POST" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    const token = /Bearer%20([0-9a-f]{64})/.exec(html)?.[1];
    expect(token).toBeTruthy();
    expect(html).toContain("com.HealthExport://automation?");
    const rows = raw.prepare("SELECT id, revoked_at FROM sources WHERE kind = 'health_auto_export' ORDER BY created_at").all() as { id: string; revoked_at: string | null }[];
    expect(rows.find((r) => r.id === "old")!.revoked_at).not.toBeNull();
    expect(rows.find((r) => r.id === "used")!.revoked_at).toBeNull();
    expect(rows.filter((r) => !r.revoked_at)).toHaveLength(2);
    // The new token passes the ingest guard (401 would mean rejected; an empty body is a 400 from the handler).
    const ingest = await call("/ingest/hae", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(ingest.status).toBe(400);
  });
  it("status goes from waiting to processed with per-metric counts", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const empty = await (await call(`/connect/status?since=${since}`)).json() as { batch: unknown };
    expect(empty.batch).toBeNull();
    const src = (raw.prepare("SELECT id FROM sources WHERE kind = 'health_auto_export' AND revoked_at IS NULL AND last_seen_at IS NULL").get() as { id: string }).id;
    const now = new Date().toISOString();
    raw.prepare("INSERT INTO ingest_batches (id, source_id, received_at, payload_sha256, bytes, r2_key, status, records_upserted) VALUES ('b1', ?, ?, 'h', 10, 'k', 'processed', 2)").run(src, now);
    for (const id of ["o1", "o2"]) raw.prepare(`INSERT INTO observations (id, metric, value, unit, start_utc, local_date, source_id, provenance, dedup_key, batch_id, updated_at)
      VALUES (?, 'steps', 100, 'count', ?, '2026-11-27', ?, 'device_measured', ?, 'b1', ?)`).run(id, now, src, `k${id}`, now);
    const done = await (await call(`/connect/status?since=${since}`)).json() as { batch: { status: string; records: number }; metrics: { label: string; n: number }[] };
    expect(done.batch.status).toBe("processed");
    expect(done.batch.records).toBe(2);
    expect(done.metrics).toEqual([{ metric: "steps", label: "步数", n: 2 }]);
  });
});
