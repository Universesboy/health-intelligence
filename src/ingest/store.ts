// Idempotent writes. Every record has a dedup key built from what identifies the measurement
// (metric + instant + device), never from the value, so re-sending the same 7-day window
// updates rows in place instead of duplicating them.
import { localDate } from "../lib/time";
import { workoutCategory, type NormalizedObservation, type NormalizedSleep, type NormalizedWorkout, type ParseResult } from "./hae";

const CHUNK = 50; // statements per D1 batch; each statement binds < 20 parameters

export function observationKey(o: Pick<NormalizedObservation, "metric" | "startUtc" | "sourceLabel">): string {
  return `obs|${o.metric}|${o.startUtc}|${o.sourceLabel ?? ""}`;
}

export function sleepKey(localDay: string, sourceLabel: string | null): string {
  return `sleep|${localDay}|${sourceLabel ?? ""}`;
}

export function workoutKey(w: Pick<NormalizedWorkout, "externalId" | "startUtc" | "name">): string {
  return w.externalId ? `wk|${w.externalId}` : `wk|${w.startUtc}|${w.name}`;
}

async function runChunked(db: D1Database, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += CHUNK) await db.batch(statements.slice(i, i + CHUNK));
}

export interface StoreContext {
  db: D1Database;
  sourceId: string;
  batchId: string | null;
  timeZone: string;
  now: string;
}

function observationStatement(ctx: StoreContext, o: NormalizedObservation, provenance: string) {
  return ctx.db.prepare(
    `INSERT INTO observations (id, metric, value, unit, start_utc, end_utc, utc_offset_min, local_date, source_label,
       source_id, provenance, confidence, extra, dedup_key, batch_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET value = excluded.value, unit = excluded.unit, extra = excluded.extra,
       batch_id = excluded.batch_id, updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), o.metric, o.value, o.unit, o.startUtc, o.endUtc, o.offsetMin, localDate(o.startUtc, ctx.timeZone),
    o.sourceLabel, ctx.sourceId, provenance, o.extra && Object.keys(o.extra).length ? JSON.stringify(o.extra) : null,
    observationKey(o), ctx.batchId, ctx.now,
  );
}

function sleepStatement(ctx: StoreContext, s: NormalizedSleep) {
  const day = localDate(s.wakeUtc, ctx.timeZone);
  return ctx.db.prepare(
    `INSERT INTO sleep_sessions (id, local_date, sleep_start_utc, sleep_end_utc, in_bed_start_utc, in_bed_end_utc,
       total_sleep_h, in_bed_h, core_h, deep_h, rem_h, awake_h, source_label, source_id, provenance, dedup_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'device_measured', ?, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET sleep_start_utc = excluded.sleep_start_utc, sleep_end_utc = excluded.sleep_end_utc,
       in_bed_start_utc = excluded.in_bed_start_utc, in_bed_end_utc = excluded.in_bed_end_utc,
       total_sleep_h = excluded.total_sleep_h, in_bed_h = excluded.in_bed_h, core_h = excluded.core_h,
       deep_h = excluded.deep_h, rem_h = excluded.rem_h, awake_h = excluded.awake_h, updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), day, s.sleepStartUtc, s.sleepEndUtc, s.inBedStartUtc, s.inBedEndUtc, s.totalSleepH, s.inBedH,
    s.coreH, s.deepH, s.remH, s.awakeH, s.sourceLabel, ctx.sourceId, sleepKey(day, s.sourceLabel), ctx.now,
  );
}

function workoutStatement(ctx: StoreContext, w: NormalizedWorkout) {
  // On conflict only device fields change: your RPE and category edits are kept.
  return ctx.db.prepare(
    `INSERT INTO workouts (id, external_id, name, category, start_utc, end_utc, local_date, duration_s, active_kcal,
       avg_hr, max_hr, rpe, source_label, source_id, dedup_key, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(dedup_key) DO UPDATE SET end_utc = excluded.end_utc, duration_s = excluded.duration_s,
       active_kcal = excluded.active_kcal, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), w.externalId, w.name, workoutCategory(w.name), w.startUtc, w.endUtc, localDate(w.startUtc, ctx.timeZone),
    w.durationS, w.activeKcal, w.avgHr, w.maxHr, w.sourceLabel, ctx.sourceId, workoutKey(w), ctx.now,
  );
}

/** Writes a parsed payload. Returns how many records were upserted. */
export async function storeParsed(ctx: StoreContext, parsed: ParseResult, provenance = "device_measured"): Promise<number> {
  const statements = [
    ...parsed.observations.map((o) => observationStatement(ctx, o, provenance)),
    ...parsed.sleep.map((s) => sleepStatement(ctx, s)),
    ...parsed.workouts.map((w) => workoutStatement(ctx, w)),
  ];
  await runChunked(ctx.db, statements);
  return statements.length;
}
