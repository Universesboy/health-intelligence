import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importCoachchalk, type CoachchalkWorkFeed, type WorkFeedResult } from "../src/jobs/coachchalk";

// Minimal D1 over node:sqlite with the real migrations applied.
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0000_init.sql", "0001_work_daily.sql"])
    for (const sql of readFileSync(`migrations/${file}`, "utf8").split("--> statement-breakpoint")) if (sql.trim()) db.exec(sql);
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind: (...values: unknown[]) => { params = values; return stmt; },
      run: async () => { db.prepare(sql).run(...(params as never[])); return { success: true }; },
      all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...(params as never[])) ?? null) as T | null,
    };
    return stmt;
  };
  const batch = async (statements: { run: () => Promise<unknown> }[]) => {
    db.exec("BEGIN");
    try { for (const s of statements) await s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    return [];
  };
  return { raw: db, d1: { prepare, batch } as unknown as D1Database };
}

const day = (date: string, teaching: number, total = teaching) => ({
  date, teachingMinutes: teaching, coachingMinutes: 0, adminMinutes: 0, travelMinutes: total - teaching,
  totalMinutes: total, lessons: teaching ? 2 : 0, longestTeachingBlockMinutes: teaching,
});
const feed = (result: WorkFeedResult, calls: unknown[] = []): CoachchalkWorkFeed => ({
  dailySummary: async (request) => { calls.push(request); return result; },
});
const ok = (days: ReturnType<typeof day>[]): WorkFeedResult => ({
  ok: true, schemaVersion: 1, scope: "work.daily_summary", from: "2026-10-25", to: "2026-11-24", timeZone: "America/Vancouver", generatedAt: "", days,
});
const now = new Date("2026-11-24T20:00:00Z"); // 13:00 in Vancouver
const rows = (raw: DatabaseSync) => raw.prepare("SELECT local_date, teaching_min, total_min FROM work_daily ORDER BY local_date").all();

describe("Coachchalk work feed import", () => {
  it("is skipped when not configured", async () => {
    const { d1: DB } = d1();
    expect((await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver" }, now)).status).toBe("not_configured");
  });

  it("asks for the last 30 local days for the configured workspace and stores each day", async () => {
    const { d1: DB, raw } = d1();
    const calls: unknown[] = [];
    const result = await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver", COACHCHALK_WORKSPACE_ID: "ws1", COACHCHALK_WORK: feed(ok([day("2026-11-20", 180, 240), day("2026-11-24", 60)]), calls) }, now);
    expect(calls).toEqual([{ workspaceId: "ws1", from: "2026-10-25", to: "2026-11-24", purpose: expect.any(String) }]);
    expect(result).toEqual({ status: "ok", imported: 2, removed: 0 });
    expect(rows(raw)).toEqual([{ local_date: "2026-11-20", teaching_min: 180, total_min: 240 }, { local_date: "2026-11-24", teaching_min: 60, total_min: 60 }]);
  });

  it("replaces the window, so a day corrected to no work disappears, and keeps older days", async () => {
    const { d1: DB, raw } = d1();
    raw.exec("INSERT INTO work_daily VALUES ('2026-09-01', 90, 0, 0, 0, 90, 1, 90, 1, 'x'), ('2026-11-20', 180, 0, 0, 0, 180, 3, 120, 1, 'x')");
    const result = await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver", COACHCHALK_WORKSPACE_ID: "ws1", COACHCHALK_WORK: feed(ok([day("2026-11-21", 60)])) }, now);
    expect(result).toEqual({ status: "ok", imported: 1, removed: 0 });
    expect(rows(raw)).toEqual([{ local_date: "2026-09-01", teaching_min: 90, total_min: 90 }, { local_date: "2026-11-21", teaching_min: 60, total_min: 60 }]);
  });

  it("keeps existing data when sharing is off or the schema is unknown", async () => {
    const { d1: DB, raw } = d1();
    raw.exec("INSERT INTO work_daily VALUES ('2026-11-20', 180, 0, 0, 0, 180, 3, 120, 1, 'x')");
    const denied = await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver", COACHCHALK_WORKSPACE_ID: "ws1", COACHCHALK_WORK: feed({ ok: false, code: "not_granted", error: "off" }) }, now);
    expect(denied.status).toBe("not_granted");
    const future = await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver", COACHCHALK_WORKSPACE_ID: "ws1", COACHCHALK_WORK: feed({ ...ok([]), schemaVersion: 2 } as WorkFeedResult) }, now);
    expect(future.status).toBe("unsupported_schema");
    expect(rows(raw)).toHaveLength(1);
  });

  it("drops malformed days and days outside the window", async () => {
    const { d1: DB, raw } = d1();
    const bad = { ...day("2026-11-22", 60), totalMinutes: -5 };
    await importCoachchalk({ DB, LOCAL_TIME_ZONE: "America/Vancouver", COACHCHALK_WORKSPACE_ID: "ws1", COACHCHALK_WORK: feed(ok([bad, day("2026-12-01", 60), day("2026-11-23", 45)])) }, now);
    expect(rows(raw)).toEqual([{ local_date: "2026-11-23", teaching_min: 45, total_min: 45 }]);
  });
});
