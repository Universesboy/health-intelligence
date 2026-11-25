// Work hours from Coachchalk, read through its Work Feed (a Service Binding RPC to the
// `HealthWorkFeed` entrypoint of the `coachos` Worker). Health never reads Coachchalk's database:
// the coach turns sharing on in Coachchalk, and Coachchalk logs every read.
import { addDays, localDate } from "../lib/time";

const WINDOW_DAYS = 30; // re-read this many days so corrections in Coachchalk flow through
export const WORK_FEED_SCHEMA_VERSION = 1;

export type WorkFeedDay = {
  date: string; teachingMinutes: number; coachingMinutes: number; adminMinutes: number; travelMinutes: number;
  totalMinutes: number; lessons: number; longestTeachingBlockMinutes: number;
};
export type WorkFeedResult =
  | { ok: true; schemaVersion: number; scope: string; from: string; to: string; timeZone: string; generatedAt: string; days: WorkFeedDay[] }
  | { ok: false; code: string; error: string };

/** The RPC surface of Coachchalk's `HealthWorkFeed` entrypoint. */
export interface CoachchalkWorkFeed {
  dailySummary(request: { workspaceId: string; from: string; to: string; purpose?: string }): Promise<WorkFeedResult>;
}

const isCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isDay = (day: WorkFeedDay) => /^\d{4}-\d{2}-\d{2}$/.test(day?.date) &&
  [day.teachingMinutes, day.coachingMinutes, day.adminMinutes, day.travelMinutes, day.totalMinutes, day.lessons, day.longestTeachingBlockMinutes].every(isCount);

export async function importCoachchalk(env: {
  DB: D1Database; COACHCHALK_WORK?: CoachchalkWorkFeed; COACHCHALK_WORKSPACE_ID?: string; LOCAL_TIME_ZONE: string;
}, now = new Date()): Promise<{ status: string; imported: number; removed: number }> {
  if (!env.COACHCHALK_WORK || !env.COACHCHALK_WORKSPACE_ID) return { status: "not_configured", imported: 0, removed: 0 };
  const to = localDate(now, env.LOCAL_TIME_ZONE);
  const from = addDays(to, -WINDOW_DAYS);
  const result = await env.COACHCHALK_WORK.dailySummary({ workspaceId: env.COACHCHALK_WORKSPACE_ID, from, to, purpose: "health: daily load and baselines" });
  // Denied or unavailable: keep what we already have. Never read a failed read as "no work".
  if (!result.ok) return { status: result.code, imported: 0, removed: 0 };
  if (result.schemaVersion !== WORK_FEED_SCHEMA_VERSION) return { status: "unsupported_schema", imported: 0, removed: 0 };
  const days = result.days.filter((day) => isDay(day) && day.date >= from && day.date <= to);
  const stamp = now.toISOString();

  // The feed lists only days with work. Inside the window a missing day means no recorded work,
  // so the window is replaced as a whole.
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM work_daily WHERE local_date >= ? AND local_date <= ?").bind(from, to).first<{ n: number }>();
  const statements: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM work_daily WHERE local_date >= ? AND local_date <= ?").bind(from, to)];
  for (const day of days) statements.push(env.DB.prepare(
    `INSERT INTO work_daily (local_date, teaching_min, coaching_min, admin_min, travel_min, total_min, lessons, longest_teaching_block_min, schema_version, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(day.date, day.teachingMinutes, day.coachingMinutes, day.adminMinutes, day.travelMinutes, day.totalMinutes, day.lessons, day.longestTeachingBlockMinutes, result.schemaVersion, stamp));
  await env.DB.batch(statements); // one batch is one transaction: the window is never half replaced
  return { status: "ok", imported: days.length, removed: Math.max(0, (before?.n ?? 0) - days.length) };
}
