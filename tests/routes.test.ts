import { describe, expect, it, beforeAll } from "vitest";
import app from "../src/index";
import { memoryD1 } from "./helpers/d1";
import { seed } from "./helpers/seed";
import { recomputeAll } from "../src/jobs/derived";
import { localDate } from "../src/lib/time";
import type { Env } from "../src/env";

const tz = "America/Vancouver";
const today = localDate(new Date(), tz);
const { raw, d1 } = memoryD1();
const env = { DB: d1, LOCAL_TIME_ZONE: tz, AUTH_MODE: "dev-insecure", RAW_ENCRYPTION_KEY: "0".repeat(64) } as unknown as Env;
const ctx = { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException() {} } as unknown as ExecutionContext;
const get = (path: string) => app.fetch(new Request(`http://localhost${path}`), env, ctx);
const post = (path: string, body: Record<string, string | string[]>) => {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
  return app.fetch(new Request(`http://localhost${path}`, { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } }), env, ctx);
};

beforeAll(async () => { seed(raw, today); await recomputeAll(d1, today, new Date().toISOString(), 90); });

describe("pages render with real data", () => {
  for (const path of ["/", "/log", "/trends", "/trends?range=90", "/insights", "/data", "/profile", "/import", "/sources", "/privacy"]) {
    it(path, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Coach Health");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    });
  }
  it("never shows unimplemented integrations as connected", async () => {
    const html = await (await get("/data")).text();
    expect(html).toMatch(/饮食拍照识别[\s\S]*?规划中/);
    expect(html).toMatch(/Health Connect[\s\S]*?不适用/);
  });
});

describe("writes", () => {
  it("one sentence previews first and writes nothing", async () => {
    const before = raw.prepare("SELECT COUNT(*) AS n FROM observations").get() as { n: number };
    const res = await post("/log/sentence", { text: "今天早上体重 76.4 公斤，昨晚睡了七个半小时，感觉恢复不错" });
    const html = await res.text();
    expect(html).toContain("76.4");
    expect(html).toContain("7.5");
    expect((raw.prepare("SELECT COUNT(*) AS n FROM observations").get() as { n: number }).n).toBe(before.n);
  });
  it("confirm writes only the ticked items", async () => {
    raw.prepare("DELETE FROM daily_checkins WHERE local_date = ?").run(today);
    const res = await post("/log/confirm", { n: "3", use: ["0", "1"], k0: "weight", d0: today, v0: "76.4", k1: "sleep_hours", d1: today, v1: "7.5", k2: "readiness", d2: today, v2: "4" });
    expect(res.status).toBe(303);
    const w = raw.prepare("SELECT value, provenance FROM observations WHERE metric = 'body_mass' AND local_date = ? AND source_id = 'quick' AND dedup_key LIKE 'quick|%'").get(today) as { value: number; provenance: string };
    expect(w).toEqual({ value: 76.4, provenance: "manual_measured" });
    const ci = raw.prepare("SELECT sleep_hours_self, readiness, entry_method FROM daily_checkins WHERE local_date = ?").get(today);
    expect(ci).toEqual({ sleep_hours_self: 7.5, readiness: null, entry_method: "sentence" });
    const m = raw.prepare("SELECT value FROM daily_metrics WHERE metric = 'sleep_hours_self' AND local_date = ?").get(today) as { value: number };
    expect(m.value).toBe(7.5);
  });
  it("a one-tap check-in merges and keeps other fields", async () => {
    await post("/checkin/quick", { local_date: today, readiness: "5" });
    const ci = raw.prepare("SELECT sleep_hours_self, readiness FROM daily_checkins WHERE local_date = ?").get(today);
    expect(ci).toEqual({ sleep_hours_self: 7.5, readiness: 5 });
  });
  it("rejects out-of-range quick values", async () => {
    expect((await post("/log/quick", { metric: "body_mass", value: "7" })).status).toBe(400);
    expect((await post("/log/quick", { metric: "steps", value: "7000" })).status).toBe(400);
  });
  it("water adds up; weight replaces within a day", async () => {
    raw.prepare("DELETE FROM observations WHERE metric = 'water' AND local_date = ?").run(today);
    await post("/log/quick", { metric: "water", value: "500" });
    await post("/log/quick", { metric: "water", value: "250" });
    const water = raw.prepare("SELECT value FROM daily_metrics WHERE metric = 'water' AND local_date = ?").get(today) as { value: number };
    expect(water.value).toBe(750);
    await post("/log/quick", { metric: "body_mass", value: "76.0" });
    const n = raw.prepare("SELECT COUNT(*) AS n FROM observations WHERE metric = 'body_mass' AND local_date = ? AND source_id = 'quick' AND dedup_key LIKE 'quick|%'").get(today) as { n: number };
    expect(n.n).toBe(1);
  });
  it("records goal changes in history", async () => {
    await post("/profile", { primary_goal: "sleep", usual_bed_local: "23:00", usual_wake_local: "07:00" });
    const rows = raw.prepare("SELECT primary_goal, ended_on FROM goal_history ORDER BY started_on, rowid").all() as { primary_goal: string; ended_on: string | null }[];
    expect(rows.at(-1)).toEqual({ primary_goal: "sleep", ended_on: null });
    expect(rows.filter((r) => r.ended_on === null)).toHaveLength(1);
  });
  it("RPE on a synced workout makes training load computable", async () => {
    await post("/workouts/rpe", { rpe_w1: "7" });
    const row = raw.prepare("SELECT rpe FROM workouts WHERE id = 'w1'").get() as { rpe: number };
    expect(row.rpe).toBe(7);
  });
});
