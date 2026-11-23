// Three layers, as in docs/ARCHITECTURE.md:
//   raw     -> ingest_batches (the encrypted original payload lives in R2, never in D1)
//   core    -> observations, sleep_sessions, workouts, coaching_sessions, daily_checkins
//   derived -> daily_metrics, baselines, daily_load (safe to delete and recompute)
// All instants are stored as UTC ISO-8601 strings. `local_date` is the America/Vancouver
// calendar day the record belongs to (sleep belongs to the day you woke up).
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Where data may come from. Each source has its own bearer token (only the SHA-256 is stored). */
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // health_auto_export | manual | coachchalk
  name: text("name").notNull(),
  tokenSha256: text("token_sha256"),
  scopes: text("scopes").notNull().default("[]"), // JSON array of metric codes this source may write; [] = any
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  revokedAt: text("revoked_at"),
}, (t) => [uniqueIndex("idx_sources_token").on(t.tokenSha256)]);

export const ingestBatches = sqliteTable("ingest_batches", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  receivedAt: text("received_at").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  bytes: integer("bytes").notNull(),
  r2Key: text("r2_key").notNull(),
  status: text("status").notNull().default("queued"), // queued | processed | failed | duplicate
  processedAt: text("processed_at"),
  recordsUpserted: integer("records_upserted"),
  recordsSkipped: integer("records_skipped"),
  error: text("error"), // never contains health values
}, (t) => [index("idx_batches_source_time").on(t.sourceId, t.receivedAt)]);

/**
 * One measured or estimated value over an instant or interval.
 * provenance: device_measured | manual_measured | official_label | food_database | ai_estimate | user_estimate
 */
export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(),
  metric: text("metric").notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  startUtc: text("start_utc").notNull(),
  endUtc: text("end_utc"),
  utcOffsetMin: integer("utc_offset_min"),
  localDate: text("local_date").notNull(),
  sourceLabel: text("source_label"), // device/app as reported, e.g. "iPhone"
  sourceId: text("source_id").notNull(),
  provenance: text("provenance").notNull(),
  confidence: real("confidence"), // 0..1, null when not applicable
  extra: text("extra"), // JSON, e.g. {"min":..,"max":..} for heart rate
  dedupKey: text("dedup_key").notNull(),
  batchId: text("batch_id"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  uniqueIndex("idx_obs_dedup").on(t.dedupKey),
  index("idx_obs_metric_date").on(t.metric, t.localDate),
]);

export const sleepSessions = sqliteTable("sleep_sessions", {
  id: text("id").primaryKey(),
  localDate: text("local_date").notNull(), // wake-up day
  sleepStartUtc: text("sleep_start_utc"),
  sleepEndUtc: text("sleep_end_utc"),
  inBedStartUtc: text("in_bed_start_utc"),
  inBedEndUtc: text("in_bed_end_utc"),
  totalSleepH: real("total_sleep_h"),
  inBedH: real("in_bed_h"),
  coreH: real("core_h"),
  deepH: real("deep_h"),
  remH: real("rem_h"),
  awakeH: real("awake_h"),
  quality: integer("quality"), // 1..5, self-reported only
  sourceLabel: text("source_label"),
  sourceId: text("source_id").notNull(),
  provenance: text("provenance").notNull(), // device_measured | user_estimate
  dedupKey: text("dedup_key").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_sleep_dedup").on(t.dedupKey), index("idx_sleep_date").on(t.localDate)]);

/** Formal workouts. category: badminton_training | badminton_personal | strength | cardio | other */
export const workouts = sqliteTable("workouts", {
  id: text("id").primaryKey(),
  externalId: text("external_id"),
  name: text("name").notNull(),
  category: text("category").notNull(),
  startUtc: text("start_utc").notNull(),
  endUtc: text("end_utc").notNull(),
  localDate: text("local_date").notNull(),
  durationS: integer("duration_s").notNull(),
  activeKcal: real("active_kcal"),
  avgHr: real("avg_hr"),
  maxHr: real("max_hr"),
  rpe: integer("rpe"), // 0..10 session RPE, added by you
  sourceLabel: text("source_label"),
  sourceId: text("source_id").notNull(),
  dedupKey: text("dedup_key").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_workouts_dedup").on(t.dedupKey), index("idx_workouts_date").on(t.localDate)]);

/** Teaching sessions, imported read-only from Coachchalk completed lessons. */
export const coachingSessions = sqliteTable("coaching_sessions", {
  id: text("id").primaryKey(),
  coachchalkLessonId: text("coachchalk_lesson_id").notNull(),
  localDate: text("local_date").notNull(),
  startUtc: text("start_utc").notNull(),
  durationMin: integer("duration_min").notNull(),
  lessonType: text("lesson_type").notNull(),
  importedAt: text("imported_at").notNull(),
}, (t) => [uniqueIndex("idx_coaching_lesson").on(t.coachchalkLessonId), index("idx_coaching_date").on(t.localDate)]);

/** The 20-second daily check-in. Every field is optional: missing stays missing. */
export const dailyCheckins = sqliteTable("daily_checkins", {
  localDate: text("local_date").primaryKey(),
  bedtimeLocal: text("bedtime_local"), // "23:30" the night before
  waketimeLocal: text("waketime_local"), // "07:00"
  sleepQuality: integer("sleep_quality"), // 1..5
  overallRpe: integer("overall_rpe"), // 0..10, whole day
  coachingIntensity: integer("coaching_intensity"), // 1..10, teaching only
  fatigue: integer("fatigue"), // 1..5
  energy: integer("energy"), // 1..5
  sorenessAreas: text("soreness_areas").notNull().default("[]"), // JSON array
  painAreas: text("pain_areas").notNull().default("[]"), // JSON array of {area, severity 1..10}
  caffeineLastLocal: text("caffeine_last_local"),
  redFlags: text("red_flags").notNull().default("[]"), // JSON array; any entry shows the emergency notice
  note: text("note"),
  updatedAt: text("updated_at").notNull(),
});

export const dailyMetrics = sqliteTable("daily_metrics", {
  localDate: text("local_date").notNull(),
  metric: text("metric").notNull(),
  value: real("value").notNull(),
  unit: text("unit").notNull(),
  samples: integer("samples").notNull(),
  computedAt: text("computed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.localDate, t.metric] })]);

/** Personal baseline: rolling median and MAD. n < 14 means "baseline still forming". */
export const baselines = sqliteTable("baselines", {
  metric: text("metric").notNull(),
  asOfDate: text("as_of_date").notNull(),
  windowDays: integer("window_days").notNull(),
  median: real("median"),
  mad: real("mad"),
  n: integer("n").notNull(),
  computedAt: text("computed_at").notNull(),
}, (t) => [primaryKey({ columns: [t.metric, t.asOfDate, t.windowDays] })]);

/** Dual-track load. Null means an input was missing (e.g. no coaching intensity reported). */
export const dailyLoad = sqliteTable("daily_load", {
  localDate: text("local_date").primaryKey(),
  coachingMinutes: integer("coaching_minutes").notNull().default(0),
  coachingLoad: real("coaching_load"),
  trainingMinutes: integer("training_minutes").notNull().default(0),
  trainingLoad: real("training_load"),
  acute7: real("acute_7"),
  chronic28: real("chronic_28"),
  computedAt: text("computed_at").notNull(),
});

/** Idempotency for scheduled jobs: one row per (job, local day). */
export const jobRuns = sqliteTable("job_runs", {
  job: text("job").notNull(),
  runKey: text("run_key").notNull(),
  ranAt: text("ran_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  status: text("status").notNull(),
  detail: text("detail"),
}, (t) => [primaryKey({ columns: [t.job, t.runKey] })]);
