// Synthetic but realistic data for route tests and screenshots. Never used in production.
import type { DatabaseSync } from "node:sqlite";
import { addDays } from "../../src/lib/time";

export function seed(raw: DatabaseSync, today: string, days = 75) {
  let r = 42; const rand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const now = new Date().toISOString();
  raw.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at, last_seen_at) VALUES ('hae', 'health_auto_export', 'iPhone · Health Auto Export', 'x', ?, ?)").run(now, now);
  raw.prepare("INSERT INTO sources (id, kind, name, created_at) VALUES ('quick', 'quick_entry', '手动记录', ?)").run(now);
  raw.prepare(`INSERT INTO profile (id, primary_goal, secondary_goal, target_weight_kg, usual_bed_local, usual_wake_local, water_target_ml, height_cm, updated_at)
    VALUES (1, 'performance', 'weight', 75, '23:30', '07:00', 2500, 178, ?)`).run(now);
  raw.prepare("INSERT INTO goal_history (id, primary_goal, secondary_goal, target_weight_kg, started_on) VALUES ('g1', 'performance', 'weight', 75, ?)").run(addDays(today, -days));
  const obs = raw.prepare(`INSERT INTO observations (id, metric, value, unit, start_utc, local_date, source_label, source_id, provenance, dedup_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const work = raw.prepare(`INSERT INTO work_daily (local_date, teaching_min, coaching_min, admin_min, travel_min, total_min, lessons, longest_teaching_block_min, schema_version, fetched_at)
    VALUES (?, ?, 0, 20, 30, ?, ?, ?, 1, ?)`);
  const checkin = raw.prepare(`INSERT INTO daily_checkins (local_date, bedtime_local, waketime_local, sleep_quality, coaching_intensity, readiness, fatigue, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = days; i >= 0; i--) {
    const d = addDays(today, -i); const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    const teaching = dow === 1 ? 0 : dow === 6 || dow === 0 ? 240 + Math.round(rand() * 60) : 150 + Math.round(rand() * 90);
    const recent = i < 8;
    if (i > 0 || true) obs.run(crypto.randomUUID(), "steps", Math.round(6500 + teaching * 12 + rand() * 2500 - (recent ? 1200 : 0)), "count", `${d}T20:00:00Z`, d, "iPhone", "hae", "device_measured", `s|${d}`, now);
    if (i % 2 === 0 || rand() > 0.6) obs.run(crypto.randomUUID(), "body_mass", 78.6 - (days - i) * 0.035 + (rand() - 0.5) * 0.6, "kg", `${d}T14:00:00Z`, d, "手动记录", "quick", "manual_measured", `w|${d}`, now);
    if (rand() > 0.35) obs.run(crypto.randomUUID(), "water", Math.round(1600 + rand() * 1200), "mL", `${d}T22:00:00Z`, d, "手动记录", "quick", "manual_measured", `h|${d}`, now);
    if (teaching) work.run(d, teaching, teaching + 50, Math.round(teaching / 60), Math.min(teaching, 180), now);
    if (rand() > 0.15) {
      const bedM = 23 * 60 + 15 + Math.round(rand() * 80) + (recent ? 40 : 0); const wakeM = 6 * 60 + 45 + Math.round(rand() * 40);
      const bed = `${String(Math.floor(bedM / 60) % 24).padStart(2, "0")}:${String(bedM % 60).padStart(2, "0")}`;
      const wake = `${String(Math.floor(wakeM / 60)).padStart(2, "0")}:${String(wakeM % 60).padStart(2, "0")}`;
      const sleepH = (wakeM + 24 * 60 - bedM) / 60;
      const readiness = Math.max(1, Math.min(5, Math.round(sleepH - 3.6 + (rand() - 0.5) * 1.6)));
      checkin.run(d, bed, wake, Math.max(1, Math.min(5, readiness + (rand() > 0.5 ? 0 : 1))), teaching ? (rand() > 0.15 ? 5 + Math.round(rand() * 3) : null) : null, readiness, 6 - readiness, now);
    }
  }
  const meal = raw.prepare("INSERT INTO meals (id, local_date, slot, description, size, protein_serving, entry_method, created_at) VALUES (?, ?, ?, ?, ?, ?, 'form', ?)");
  const menu: [string, string][] = [["breakfast", "燕麦 + 鸡蛋"], ["lunch", "牛肉面"], ["dinner", "米饭 + 鸡胸 + 青菜"], ["lunch", "三文鱼饭团"], ["snack", "希腊酸奶"]];
  for (let i = 20; i >= 0; i--) for (const [slot, d] of menu) if (rand() > 0.5) meal.run(crypto.randomUUID(), addDays(today, -i), slot, d, "normal", 1, now);
  raw.prepare("INSERT INTO workouts (id, name, category, start_utc, end_utc, local_date, duration_s, source_id, dedup_key, updated_at) VALUES ('w1', 'Badminton', 'badminton_training', ?, ?, ?, 5400, 'hae', 'wk1', ?)")
    .run(`${addDays(today, -1)}T02:00:00Z`, `${addDays(today, -1)}T03:30:00Z`, addDays(today, -1), now);
  raw.prepare("INSERT INTO ingest_batches (id, source_id, received_at, payload_sha256, bytes, r2_key, status, records_upserted, records_skipped) VALUES ('b1', 'hae', ?, 'x', 18000, 'k', 'processed', 212, 4)").run(now);
  raw.prepare("INSERT INTO job_runs (job, run_key, status, detail) VALUES ('hourly', ?, 'ok', ?)").run(now.slice(0, 13), JSON.stringify({ coachchalk: "ok", imported: 30, removed: 0 }));
}
