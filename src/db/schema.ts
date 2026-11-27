// Three layers, as in docs/ARCHITECTURE.md:
//   raw     -> ingest_batches (the encrypted original payload lives in R2, never in D1)
//   core    -> observations, sleep_sessions, workouts, work_daily, daily_checkins
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

/** Earlier per-lesson copy from Coachchalk. No longer written (see work_daily); kept so nothing is lost. */
export const coachingSessions = sqliteTable("coaching_sessions", {
  id: text("id").primaryKey(),
  coachchalkLessonId: text("coachchalk_lesson_id").notNull(),
  localDate: text("local_date").notNull(),
  startUtc: text("start_utc").notNull(),
  durationMin: integer("duration_min").notNull(),
  lessonType: text("lesson_type").notNull(),
  importedAt: text("imported_at").notNull(),
}, (t) => [uniqueIndex("idx_coaching_lesson").on(t.coachchalkLessonId), index("idx_coaching_date").on(t.localDate)]);

/** Daily work summary from Coachchalk's Work Feed (contract v1). A day with no row had no recorded work. */
export const workDaily = sqliteTable("work_daily", {
  localDate: text("local_date").primaryKey(),
  teachingMin: integer("teaching_min").notNull(),
  coachingMin: integer("coaching_min").notNull(), // lesson planning, training plans, video review
  adminMin: integer("admin_min").notNull(),
  travelMin: integer("travel_min").notNull(),
  totalMin: integer("total_min").notNull(), // overlapping blocks counted once
  lessons: integer("lessons").notNull(),
  longestTeachingBlockMin: integer("longest_teaching_block_min").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

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
  sleepHoursSelf: real("sleep_hours_self"), // stated duration ("slept 7.5 h") when no clock times were given
  readiness: integer("readiness"), // 1..5, how recovered you feel
  entryMethod: text("entry_method"), // form | quick | sentence
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

/**
 * Single-row health profile. Every field is optional: nothing sensitive is required, and an
 * empty field only means some analyses explain what they would need.
 */
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(), // always 1
  birthYear: integer("birth_year"),
  sex: text("sex"), // female | male | unspecified (only used for reference ranges, never required)
  heightCm: real("height_cm"),
  primaryGoal: text("primary_goal"), // sleep | weight | performance | recovery | general
  secondaryGoal: text("secondary_goal"),
  targetWeightKg: real("target_weight_kg"),
  activityLevel: text("activity_level"), // low | moderate | high | athlete
  usualBedLocal: text("usual_bed_local"), // "23:30"
  usualWakeLocal: text("usual_wake_local"), // "07:00"
  trainingDaysPerWeek: integer("training_days_per_week"),
  waterTargetMl: integer("water_target_ml"),
  proteinTargetG: integer("protein_target_g"),
  updatedAt: text("updated_at").notNull(),
});

/** Every goal the user has had, so trends can be read against the goal at that time. */
export const goalHistory = sqliteTable("goal_history", {
  id: text("id").primaryKey(),
  primaryGoal: text("primary_goal").notNull(),
  secondaryGoal: text("secondary_goal"),
  targetWeightKg: real("target_weight_kg"),
  startedOn: text("started_on").notNull(),
  endedOn: text("ended_on"),
}, (t) => [index("idx_goal_started").on(t.startedOn)]);

/**
 * Low-effort meal log: a description and a rough size. Numbers are optional estimates and are
 * always labelled as such (provenance user_estimate); nothing is computed by guessing.
 */
export const meals = sqliteTable("meals", {
  id: text("id").primaryKey(),
  localDate: text("local_date").notNull(),
  slot: text("slot").notNull(), // breakfast | lunch | dinner | snack
  description: text("description").notNull(),
  size: text("size"), // light | normal | large
  proteinServing: integer("protein_serving"), // 0 none, 1 some, 2 a palm or more
  kcalEstimate: real("kcal_estimate"),
  proteinGEstimate: real("protein_g_estimate"),
  provenance: text("provenance").notNull().default("user_estimate"),
  entryMethod: text("entry_method").notNull(), // form | repeat | sentence
  createdAt: text("created_at").notNull(),
}, (t) => [index("idx_meals_date").on(t.localDate)]);

/** One saved analysis per local day, kept only when it differs from the previous one. */
export const insightSnapshots = sqliteTable("insight_snapshots", {
  localDate: text("local_date").primaryKey(),
  contentSha256: text("content_sha256").notNull(),
  payload: text("payload").notNull(), // JSON: focus, changes, quality, completeness summary
  engineVersion: integer("engine_version").notNull(),
  createdAt: text("created_at").notNull(),
});
