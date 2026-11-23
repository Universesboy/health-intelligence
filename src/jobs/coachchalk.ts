// Read-only import of completed Coachchalk lessons as teaching sessions.
// Coachchalk's D1 has no read-only binding, so every query here goes through `selectOnly`.
import { addDays, localDate } from "../lib/time";

const WINDOW_DAYS = 30; // re-sync this many days so corrections/cancellations in Coachchalk flow through

export function assertSelectOnly(sql: string) {
  const s = sql.trim();
  if (!/^select\b/i.test(s) || s.includes(";")) throw new Error("Coachchalk access is SELECT-only.");
}

async function selectOnly<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  assertSelectOnly(sql);
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

interface LessonRow {
  id: string;
  occurred_at: string;
  duration_minutes: number;
  lesson_type: string;
}

export async function importCoachchalk(env: {
  DB: D1Database; COACHCHALK_DB?: D1Database; COACHCHALK_WORKSPACE_ID?: string; LOCAL_TIME_ZONE: string;
}, now = new Date()): Promise<{ status: string; imported: number; removed: number }> {
  if (!env.COACHCHALK_DB || !env.COACHCHALK_WORKSPACE_ID) return { status: "not_configured", imported: 0, removed: 0 };
  const today = localDate(now, env.LOCAL_TIME_ZONE);
  const since = addDays(today, -WINDOW_DAYS);
  const rows = await selectOnly<LessonRow>(
    env.COACHCHALK_DB,
    `SELECT id, occurred_at, duration_minutes, lesson_type FROM lessons
     WHERE workspace_id = ? AND status = 'completed' AND business_date >= ?`,
    env.COACHCHALK_WORKSPACE_ID, since,
  );
  const stamp = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const keep: string[] = [];
  for (const r of rows) {
    const start = new Date(r.occurred_at);
    if (Number.isNaN(start.getTime()) || !(r.duration_minutes > 0)) continue;
    keep.push(r.id);
    statements.push(env.DB.prepare(
      `INSERT INTO coaching_sessions (id, coachchalk_lesson_id, local_date, start_utc, duration_min, lesson_type, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(coachchalk_lesson_id) DO UPDATE SET local_date = excluded.local_date, start_utc = excluded.start_utc,
         duration_min = excluded.duration_min, lesson_type = excluded.lesson_type, imported_at = excluded.imported_at`,
    ).bind(crypto.randomUUID(), r.id, localDate(start, env.LOCAL_TIME_ZONE), start.toISOString(), r.duration_minutes, r.lesson_type, stamp));
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));

  // Lessons in the window that are no longer completed in Coachchalk (cancelled, corrected) are removed here too.
  const existing = await env.DB.prepare("SELECT coachchalk_lesson_id AS id FROM coaching_sessions WHERE local_date >= ?")
    .bind(since).all<{ id: string }>();
  const keepSet = new Set(keep);
  const stale = (existing.results ?? []).map((r) => r.id).filter((id) => !keepSet.has(id));
  for (const id of stale) await env.DB.prepare("DELETE FROM coaching_sessions WHERE coachchalk_lesson_id = ?").bind(id).run();
  return { status: "ok", imported: keep.length, removed: stale.length };
}
