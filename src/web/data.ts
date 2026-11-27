// Read/write helpers shared by the pages. Everything goes through D1 prepared statements.
import { addDays } from "../lib/time";
import type { Coverage, Goal } from "../lib/completeness";
import { isGoal } from "../lib/completeness";
import type { LoadDay, Point, Series } from "../lib/insights";

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
export async function one<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).first<T>();
}

export interface Profile {
  birth_year: number | null; sex: string | null; height_cm: number | null; primary_goal: string | null; secondary_goal: string | null;
  target_weight_kg: number | null; activity_level: string | null; usual_bed_local: string | null; usual_wake_local: string | null;
  training_days_per_week: number | null; water_target_ml: number | null; protein_target_g: number | null; updated_at: string | null;
}

export async function getProfile(db: D1Database): Promise<Profile | null> {
  return one<Profile>(db, "SELECT * FROM profile WHERE id = 1");
}

export function goalOf(p: Profile | null): Goal {
  return isGoal(p?.primary_goal) ? p!.primary_goal as Goal : "general";
}

/** Daily metrics as series, oldest first. */
export async function getSeries(db: D1Database, from: string, metrics: string[]): Promise<Series> {
  const rows = await all<{ local_date: string; metric: string; value: number }>(db,
    `SELECT local_date, metric, value FROM daily_metrics WHERE local_date >= ? AND metric IN (${metrics.map(() => "?").join(",")})
     ORDER BY local_date`, from, ...metrics);
  const out: Series = {};
  for (const r of rows) (out[r.metric] ??= []).push({ date: r.local_date, value: r.value });
  return out;
}

export async function getLoad(db: D1Database, from: string): Promise<(LoadDay & { trainingLoad: number | null; trainingMinutes: number })[]> {
  const rows = await all<{ local_date: string; acute_7: number | null; chronic_28: number | null; coaching_minutes: number; coaching_load: number | null; training_load: number | null; training_minutes: number }>(
    db, "SELECT * FROM daily_load WHERE local_date >= ? ORDER BY local_date", from);
  return rows.map((r) => ({ date: r.local_date, acute7: r.acute_7, chronic28: r.chronic_28, coachingMinutes: r.coaching_minutes,
    coachingLoad: r.coaching_load, trainingLoad: r.training_load, trainingMinutes: r.training_minutes }));
}

/** Known wake-up times: device sleep end (local clock) first, then the check-in. */
export async function getWakeClocks(db: D1Database, from: string, timeZone: string): Promise<string[]> {
  const [device, self] = await Promise.all([
    all<{ local_date: string; sleep_end_utc: string }>(db,
      "SELECT local_date, sleep_end_utc FROM sleep_sessions WHERE local_date >= ? AND sleep_end_utc IS NOT NULL ORDER BY local_date", from),
    all<{ local_date: string; waketime_local: string }>(db,
      "SELECT local_date, waketime_local FROM daily_checkins WHERE local_date >= ? AND waketime_local IS NOT NULL ORDER BY local_date", from),
  ]);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const byDay = new Map<string, string>();
  for (const s of self) byDay.set(s.local_date, s.waketime_local);
  for (const d of device) byDay.set(d.local_date, fmt.format(new Date(d.sleep_end_utc)));
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

export async function getCoverage(db: D1Database, today: string, profile: Profile | null, days = 28): Promise<Coverage> {
  const from = addDays(today, -(days - 1));
  const counts = await all<{ metric: string; n: number; first: string; last: string }>(db,
    `SELECT metric, COUNT(*) AS n, MIN(local_date) AS first, MAX(local_date) AS last FROM daily_metrics
     WHERE local_date >= ? GROUP BY metric`, from);
  const n = (m: string) => counts.find((c) => c.metric === m)?.n ?? 0;
  const span = (m: string) => { const c = counts.find((x) => x.metric === m); return c ? (Date.parse(c.last) - Date.parse(c.first)) / 86_400_000 : 0; };
  const [work, wl, sleepPairs, subjective, wake, worked] = await Promise.all([
    one<{ days: number; withI: number }>(db,
      `SELECT COUNT(*) AS days, SUM(CASE WHEN c.coaching_intensity IS NOT NULL THEN 1 ELSE 0 END) AS withI
       FROM work_daily w LEFT JOIN daily_checkins c ON c.local_date = w.local_date WHERE w.local_date >= ? AND w.teaching_min > 0`, from),
    one<{ n: number; rpe: number }>(db, "SELECT COUNT(*) AS n, SUM(CASE WHEN rpe IS NOT NULL THEN 1 ELSE 0 END) AS rpe FROM workouts WHERE local_date >= ?", from),
    one<{ n: number }>(db,
      `SELECT COUNT(DISTINCT r.local_date) AS n FROM daily_metrics r JOIN daily_metrics s ON s.local_date = r.local_date
       AND s.metric IN ('sleep_hours_device','sleep_hours_self') WHERE r.metric = 'readiness' AND r.local_date >= ?`, from),
    one<{ n: number }>(db,
      "SELECT COUNT(DISTINCT local_date) AS n FROM daily_metrics WHERE metric IN ('readiness','energy','fatigue') AND local_date >= ?", from),
    one<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM (SELECT local_date FROM sleep_sessions WHERE local_date >= ? AND sleep_end_utc IS NOT NULL
       UNION SELECT local_date FROM daily_checkins WHERE local_date >= ? AND waketime_local IS NOT NULL)`, from, from),
    one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM job_runs WHERE job = 'hourly' AND detail LIKE '%\"coachchalk\":\"ok\"%'"),
  ]);
  const sleepNights = await one<{ n: number }>(db,
    "SELECT COUNT(DISTINCT local_date) AS n FROM daily_metrics WHERE metric IN ('sleep_hours_device','sleep_hours_self') AND local_date >= ?", from);
  return {
    days, weighIns: n("body_mass"), weighInSpanDays: span("body_mass"), sleepNights: sleepNights?.n ?? 0,
    deviceSleepNights: n("sleep_hours_device"), wakeTimes: wake?.n ?? 0, stepsDays: n("steps"),
    teachingDays: work?.days ?? 0, teachingDaysWithIntensity: work?.withI ?? 0, workouts: wl?.n ?? 0, workoutsWithRpe: wl?.rpe ?? 0,
    subjectiveDays: subjective?.n ?? 0, hrvDays: n("hrv_sdnn"), restingHrDays: n("resting_heart_rate"), mealDays: n("meals_logged"),
    dietaryEnergyDays: n("dietary_energy"), waterDays: n("water"), pairedSleepReadiness: sleepPairs?.n ?? 0,
    profileFields: { heightCm: profile?.height_cm != null, birthYear: profile?.birth_year != null, goal: profile?.primary_goal != null,
      usualSchedule: Boolean(profile?.usual_bed_local && profile?.usual_wake_local) },
    coachchalkConnected: (worked?.n ?? 0) > 0 || (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM work_daily"))!.n > 0,
  };
}

/** The source row used for entries typed in this app (quick log and one-sentence entry). */
export async function quickSourceId(db: D1Database): Promise<string> {
  const row = await one<{ id: string }>(db, "SELECT id FROM sources WHERE kind = 'quick_entry' AND revoked_at IS NULL LIMIT 1");
  if (row) return row.id;
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO sources (id, kind, name, created_at) VALUES (?, 'quick_entry', '手动记录', ?)").bind(id, new Date().toISOString()).run();
  return id;
}

export const QUICK_METRICS: Record<string, { unit: string; min: number; max: number; additive: boolean; label: string }> = {
  body_mass: { unit: "kg", min: 25, max: 300, additive: false, label: "体重" },
  waist_circumference: { unit: "cm", min: 40, max: 200, additive: false, label: "腰围" },
  water: { unit: "mL", min: 1, max: 8000, additive: true, label: "饮水" },
  body_fat_pct: { unit: "%", min: 2, max: 70, additive: false, label: "体脂率" },
  bp_systolic: { unit: "mmHg", min: 60, max: 260, additive: false, label: "收缩压" },
  bp_diastolic: { unit: "mmHg", min: 30, max: 160, additive: false, label: "舒张压" },
};

/**
 * A typed measurement. Point measurements (weight, waist) keep one value per day and replace on
 * re-entry; additive ones (water) add a row per entry. Stored with provenance manual_measured.
 */
export function quickObservation(db: D1Database, sourceId: string, metric: string, value: number, day: string, now: Date, method: string) {
  const spec = QUICK_METRICS[metric]!;
  const stamp = now.toISOString();
  const key = spec.additive ? `quick|${metric}|${day}|${crypto.randomUUID()}` : `quick|${metric}|${day}`;
  return db.prepare(
    `INSERT INTO observations (id, metric, value, unit, start_utc, end_utc, utc_offset_min, local_date, source_label, source_id,
       provenance, confidence, extra, dedup_key, batch_id, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, '手动记录', ?, 'manual_measured', NULL, ?, ?, NULL, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET value = excluded.value, extra = excluded.extra, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), metric, value, spec.unit, stamp, day, sourceId, JSON.stringify({ method }), key, stamp);
}

export const CHECKIN_FIELDS = {
  sleep_quality: [1, 5], energy: [1, 5], fatigue: [1, 5], readiness: [1, 5], coaching_intensity: [1, 10], overall_rpe: [0, 10],
} as const;

/** Merge only the given check-in fields into a day, leaving everything else as it was. */
export async function mergeCheckin(db: D1Database, day: string, fields: Record<string, string | number | null>, method: string) {
  const allowed = new Set([...Object.keys(CHECKIN_FIELDS), "bedtime_local", "waketime_local", "sleep_hours_self", "caffeine_last_local", "note"]);
  const keys = Object.keys(fields).filter((k) => allowed.has(k));
  if (!keys.length) return;
  const stamp = new Date().toISOString();
  await db.prepare(
    `INSERT INTO daily_checkins (local_date, ${keys.join(", ")}, entry_method, updated_at) VALUES (?, ${keys.map(() => "?").join(", ")}, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}, entry_method = excluded.entry_method,
       updated_at = excluded.updated_at`,
  ).bind(day, ...keys.map((k) => fields[k]), method, stamp).run();
}

export function lastPoint(points: Point[] | undefined) {
  return points?.length ? points[points.length - 1]! : null;
}
