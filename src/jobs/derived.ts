// Derived layer: daily metrics, personal baselines, dual-track load. Safe to rerun any time.
import { addDays } from "../lib/time";
import { baseline, coachingLoad, coveredMean, hoursBetweenClock, trainingLoad } from "../lib/stats";

/** Metrics summed per day. Others are averaged per day. */
export const CUMULATIVE = new Set(["steps", "walking_running_distance", "flights_climbed", "active_energy", "basal_energy", "water"]);

/** Metrics that get a personal baseline (28 and 90 days). */
export const BASELINE_METRICS = [
  "steps", "walking_running_distance", "active_energy", "resting_heart_rate", "hrv_sdnn", "body_mass",
  "waist_circumference", "sleep_hours_device", "sleep_hours_self", "walking_speed", "coaching_minutes",
];

const RECOMPUTE_DAYS = 10; // covers the 7-day window Health Auto Export re-sends

export async function recomputeDailyMetrics(db: D1Database, today: string, now: string, days = RECOMPUTE_DAYS) {
  const from = addDays(today, -days);
  await db.prepare("DELETE FROM daily_metrics WHERE local_date >= ?").bind(from).run();

  // Cumulative: sum per device label, then take the largest device total for the day.
  // Conservative on purpose: if iPhone and Watch both report steps separately we never add them together.
  await db.prepare(
    `INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at)
     SELECT local_date, metric, MAX(total), unit, SUM(n), ? FROM (
       SELECT local_date, metric, unit, COALESCE(source_label, '') AS src, SUM(value) AS total, COUNT(*) AS n
       FROM observations WHERE local_date >= ? AND metric IN (${[...CUMULATIVE].map(() => "?").join(",")})
       GROUP BY local_date, metric, unit, src
     ) GROUP BY local_date, metric, unit`,
  ).bind(now, from, ...CUMULATIVE).run();

  await db.prepare(
    `INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at)
     SELECT local_date, metric, AVG(value), unit, COUNT(*), ? FROM observations
     WHERE local_date >= ? AND metric NOT IN (${[...CUMULATIVE].map(() => "?").join(",")})
     GROUP BY local_date, metric, unit`,
  ).bind(now, from, ...CUMULATIVE).run();

  // Device sleep and self-reported sleep are kept as two separate metrics and never mixed.
  await db.prepare(
    `INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at)
     SELECT local_date, 'sleep_hours_device', MAX(total_sleep_h), 'h', COUNT(*), ? FROM sleep_sessions
     WHERE local_date >= ? AND provenance = 'device_measured' AND total_sleep_h IS NOT NULL GROUP BY local_date`,
  ).bind(now, from).run();

  const checkins = await db.prepare(
    "SELECT local_date, bedtime_local, waketime_local FROM daily_checkins WHERE local_date >= ?",
  ).bind(from).all<{ local_date: string; bedtime_local: string | null; waketime_local: string | null }>();
  const selfSleep: D1PreparedStatement[] = [];
  for (const c of checkins.results ?? []) {
    const h = c.bedtime_local && c.waketime_local ? hoursBetweenClock(c.bedtime_local, c.waketime_local) : null;
    if (h !== null) selfSleep.push(db.prepare(
      "INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at) VALUES (?, 'sleep_hours_self', ?, 'h', 1, ?)",
    ).bind(c.local_date, h, now));
  }
  await db.prepare(
    `INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at)
     SELECT local_date, 'coaching_minutes', teaching_min, 'min', lessons, ? FROM work_daily
     WHERE local_date >= ? AND teaching_min > 0`,
  ).bind(now, from).run();
  await db.prepare(
    `INSERT INTO daily_metrics (local_date, metric, value, unit, samples, computed_at)
     SELECT local_date, 'work_total_minutes', total_min, 'min', 1, ? FROM work_daily
     WHERE local_date >= ? AND total_min > 0`,
  ).bind(now, from).run();
  if (selfSleep.length) await db.batch(selfSleep);
}

export async function recomputeBaselines(db: D1Database, today: string, now: string) {
  const from = addDays(today, -90);
  const rows = await db.prepare(
    `SELECT local_date, metric, value FROM daily_metrics WHERE local_date >= ? AND local_date < ?
     AND metric IN (${BASELINE_METRICS.map(() => "?").join(",")})`,
  ).bind(from, today, ...BASELINE_METRICS).all<{ local_date: string; metric: string; value: number }>();
  const statements: D1PreparedStatement[] = [];
  for (const metric of BASELINE_METRICS) {
    for (const windowDays of [28, 90]) {
      const start = addDays(today, -windowDays);
      // Baseline excludes today, so today can be compared against it.
      const values = (rows.results ?? []).filter((r) => r.metric === metric && r.local_date >= start).map((r) => r.value);
      const b = baseline(values);
      statements.push(db.prepare(
        `INSERT INTO baselines (metric, as_of_date, window_days, median, mad, n, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(metric, as_of_date, window_days) DO UPDATE SET median = excluded.median, mad = excluded.mad,
           n = excluded.n, computed_at = excluded.computed_at`,
      ).bind(metric, today, windowDays, b.median, b.mad, b.n, now));
    }
  }
  await db.batch(statements);
}

export async function recomputeLoad(db: D1Database, today: string, now: string, days = RECOMPUTE_DAYS) {
  const from = addDays(today, -(days + 28));
  const [coaching, workouts, checkins] = await Promise.all([
    db.prepare("SELECT local_date, teaching_min AS minutes FROM work_daily WHERE local_date >= ?")
      .bind(from).all<{ local_date: string; minutes: number }>(),
    db.prepare("SELECT local_date, duration_s, rpe FROM workouts WHERE local_date >= ?")
      .bind(from).all<{ local_date: string; duration_s: number; rpe: number | null }>(),
    db.prepare("SELECT local_date, coaching_intensity FROM daily_checkins WHERE local_date >= ?")
      .bind(from).all<{ local_date: string; coaching_intensity: number | null }>(),
  ]);
  const minutesByDay = new Map((coaching.results ?? []).map((r) => [r.local_date, r.minutes]));
  const intensityByDay = new Map((checkins.results ?? []).map((r) => [r.local_date, r.coaching_intensity]));
  const sessionsByDay = new Map<string, { minutes: number; rpe: number | null }[]>();
  for (const w of workouts.results ?? []) {
    const list = sessionsByDay.get(w.local_date) ?? [];
    list.push({ minutes: Math.round(w.duration_s / 60), rpe: w.rpe });
    sessionsByDay.set(w.local_date, list);
  }

  const totals = new Map<string, number | null>();
  const rows: { day: string; cMin: number; cLoad: number | null; tMin: number; tLoad: number | null }[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const cMin = minutesByDay.get(d) ?? 0;
    const cLoad = coachingLoad(cMin, intensityByDay.get(d) ?? null);
    const sessions = sessionsByDay.get(d) ?? [];
    const tLoad = trainingLoad(sessions);
    const tMin = sessions.reduce((a, s) => a + s.minutes, 0);
    totals.set(d, cLoad === null || tLoad === null ? null : cLoad + tLoad);
    rows.push({ day: d, cMin, cLoad, tMin, tLoad });
  }

  const window = (end: string, n: number) => Array.from({ length: n }, (_, i) => totals.get(addDays(end, -i)) ?? null);
  const writeFrom = addDays(today, -days);
  const statements = rows.filter((r) => r.day >= writeFrom).map((r) => db.prepare(
    `INSERT INTO daily_load (local_date, coaching_minutes, coaching_load, training_minutes, training_load, acute_7, chronic_28, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET coaching_minutes = excluded.coaching_minutes, coaching_load = excluded.coaching_load,
       training_minutes = excluded.training_minutes, training_load = excluded.training_load, acute_7 = excluded.acute_7,
       chronic_28 = excluded.chronic_28, computed_at = excluded.computed_at`,
  ).bind(r.day, r.cMin, r.cLoad, r.tMin, r.tLoad, coveredMean(window(r.day, 7), 5 / 7), coveredMean(window(r.day, 28), 0.7), now));
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
}

export async function recomputeAll(db: D1Database, today: string, now = new Date().toISOString()) {
  await recomputeDailyMetrics(db, today, now);
  await recomputeBaselines(db, today, now);
  await recomputeLoad(db, today, now);
}
