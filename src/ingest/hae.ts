// Parser for Health Auto Export JSON (format documented at
// https://help.healthyapps.dev/en/health-auto-export/export-format). Pure function: no I/O.
//
// Principles:
// - Allowlist only. Metrics we do not use are counted and dropped (minimum-necessary data).
// - Units are normalised to metric. Unknown units are rejected rather than guessed.
// - Nothing is invented: a sample without a valid number or date is skipped and counted.
import { parseHaeDate } from "../lib/time";

export interface NormalizedObservation {
  metric: string;
  value: number;
  unit: string;
  startUtc: string;
  endUtc: string | null;
  offsetMin: number;
  sourceLabel: string | null;
  extra?: Record<string, number>;
}

export interface NormalizedSleep {
  wakeUtc: string; // sleepEnd, or the record date when sleepEnd is absent
  offsetMin: number;
  sleepStartUtc: string | null;
  sleepEndUtc: string | null;
  inBedStartUtc: string | null;
  inBedEndUtc: string | null;
  totalSleepH: number | null;
  inBedH: number | null;
  coreH: number | null;
  deepH: number | null;
  remH: number | null;
  awakeH: number | null;
  sourceLabel: string | null;
}

export interface NormalizedWorkout {
  externalId: string | null;
  name: string;
  startUtc: string;
  endUtc: string;
  offsetMin: number;
  durationS: number;
  activeKcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  sourceLabel: string | null;
}

export interface ParseResult {
  observations: NormalizedObservation[];
  sleep: NormalizedSleep[];
  workouts: NormalizedWorkout[];
  skipped: Record<string, number>; // reason -> count (no values, safe to log)
}

type Converter = (value: number) => number;
const same: Converter = (v) => v;

interface MetricSpec {
  metric: string;
  unit: string;
  units: Record<string, Converter>; // accepted source unit -> converter to `unit`
}

const lengthToKm: Record<string, Converter> = { km: same, mi: (v) => v * 1.609344, m: (v) => v / 1000 };
const energyToKcal: Record<string, Converter> = { kcal: same, kJ: (v) => v / 4.184, Cal: same };
const lengthToCm: Record<string, Converter> = { cm: same, in: (v) => v * 2.54, m: (v) => v * 100 };
const grams: Record<string, Converter> = { g: same, mg: (v) => v / 1000, oz: (v) => v * 28.349523125 };
const percent: Record<string, Converter> = { "%": (v) => (v <= 1 ? v * 100 : v) }; // HealthKit percent may be a 0..1 fraction

/** HAE metric name -> internal metric. Names come from the HAE docs (snake_case of the display name). */
export const METRICS: Record<string, MetricSpec> = {
  step_count: { metric: "steps", unit: "count", units: { count: same } },
  walking_running_distance: { metric: "walking_running_distance", unit: "km", units: lengthToKm },
  flights_climbed: { metric: "flights_climbed", unit: "count", units: { count: same } },
  active_energy: { metric: "active_energy", unit: "kcal", units: energyToKcal },
  basal_energy_burned: { metric: "basal_energy", unit: "kcal", units: energyToKcal },
  resting_heart_rate: { metric: "resting_heart_rate", unit: "bpm", units: { "count/min": same, bpm: same } },
  heart_rate_variability: { metric: "hrv_sdnn", unit: "ms", units: { ms: same } },
  heart_rate: { metric: "heart_rate", unit: "bpm", units: { "count/min": same, bpm: same } },
  weight_body_mass: { metric: "body_mass", unit: "kg", units: { kg: same, lb: (v) => v * 0.45359237 } },
  body_mass: { metric: "body_mass", unit: "kg", units: { kg: same, lb: (v) => v * 0.45359237 } },
  body_fat_percentage: { metric: "body_fat_pct", unit: "%", units: percent },
  waist_circumference: { metric: "waist_circumference", unit: "cm", units: lengthToCm },
  walking_speed: { metric: "walking_speed", unit: "km/h", units: { "km/hr": same, "km/h": same, "mi/hr": (v) => v * 1.609344, "m/s": (v) => v * 3.6 } },
  walking_step_length: { metric: "walking_step_length", unit: "cm", units: lengthToCm },
  walking_asymmetry_percentage: { metric: "walking_asymmetry_pct", unit: "%", units: percent },
  walking_double_support_percentage: { metric: "walking_double_support_pct", unit: "%", units: percent },
  dietary_water: { metric: "water", unit: "mL", units: { mL: same, L: (v) => v * 1000, fl_oz_us: (v) => v * 29.5735 } },
  // Nutrition written to Apple Health by any food app flows in automatically (no typing here).
  dietary_energy: { metric: "dietary_energy", unit: "kcal", units: energyToKcal },
  protein: { metric: "protein", unit: "g", units: grams },
  carbohydrates: { metric: "carbohydrates", unit: "g", units: grams },
  total_fat: { metric: "total_fat", unit: "g", units: grams },
  // Need an Apple Watch; accepted so data appears the day one is paired.
  apple_exercise_time: { metric: "exercise_minutes", unit: "min", units: { min: same } },
  blood_oxygen_saturation: { metric: "spo2_pct", unit: "%", units: percent },
  respiratory_rate: { metric: "respiratory_rate", unit: "count/min", units: { "count/min": same } },
  vo2_max: { metric: "vo2_max", unit: "mL/kg/min", units: { "ml/(kg·min)": same, "mL/min·kg": same, "ml/kg/min": same } },
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bump(skipped: Record<string, number>, reason: string, by = 1) {
  skipped[reason] = (skipped[reason] ?? 0) + by;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseMetric(metric: Record<string, unknown>, out: ParseResult) {
  const name = str(metric.name);
  const samples = asArray(metric.data);
  if (!name) return bump(out.skipped, "metric_without_name");
  if (name === "sleep_analysis") return parseSleep(samples, out);
  if (name === "blood_pressure") return parseBloodPressure(samples, str(metric.units), out);
  const spec = METRICS[name];
  if (!spec) return bump(out.skipped, `not_allowlisted:${name}`, samples.length || 1);
  const unit = str(metric.units) ?? "";
  const convert = spec.units[unit];
  if (!convert) return bump(out.skipped, `unknown_unit:${name}`, samples.length || 1);

  for (const raw of samples) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const when = parseHaeDate(s.date);
    if (!when) { bump(out.skipped, `bad_date:${name}`); continue; }
    if (name === "heart_rate") {
      const avg = num(s.Avg) ?? num(s.qty);
      if (avg === null) { bump(out.skipped, `bad_value:${name}`); continue; }
      const extra: Record<string, number> = {};
      const min = num(s.Min); const max = num(s.Max);
      if (min !== null) extra.min = convert(min);
      if (max !== null) extra.max = convert(max);
      out.observations.push({ metric: spec.metric, value: convert(avg), unit: spec.unit, startUtc: when.utc, endUtc: null, offsetMin: when.offsetMin, sourceLabel: str(s.source), extra });
      continue;
    }
    const qty = num(s.qty);
    if (qty === null || qty < 0) { bump(out.skipped, `bad_value:${name}`); continue; }
    out.observations.push({ metric: spec.metric, value: convert(qty), unit: spec.unit, startUtc: when.utc, endUtc: null, offsetMin: when.offsetMin, sourceLabel: str(s.source) });
  }
}

function parseBloodPressure(samples: unknown[], units: string | null, out: ParseResult) {
  if (units && units !== "mmHg") return bump(out.skipped, "unknown_unit:blood_pressure", samples.length || 1);
  for (const raw of samples) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const when = parseHaeDate(s.date) ?? parseHaeDate(s.start);
    const sys = num(s.systolic); const dia = num(s.diastolic);
    if (!when || sys === null || dia === null) { bump(out.skipped, "bad_sample:blood_pressure"); continue; }
    const base = { unit: "mmHg", startUtc: when.utc, endUtc: null, offsetMin: when.offsetMin, sourceLabel: str(s.source) };
    out.observations.push({ ...base, metric: "bp_systolic", value: sys }, { ...base, metric: "bp_diastolic", value: dia });
  }
}

function parseSleep(samples: unknown[], out: ParseResult) {
  for (const raw of samples) {
    const s = (raw ?? {}) as Record<string, unknown>;
    // Unaggregated segments ("Summarize Data" off) carry `value` + `startDate`. We require the
    // summarised daily shape so that totals are Apple's, not re-added by us.
    if (typeof s.value === "string" && s.totalSleep === undefined) { bump(out.skipped, "sleep_segment_unsummarized"); continue; }
    const date = parseHaeDate(s.date);
    const sleepStart = parseHaeDate(s.sleepStart);
    const sleepEnd = parseHaeDate(s.sleepEnd);
    const wake = sleepEnd ?? date;
    if (!wake) { bump(out.skipped, "bad_date:sleep_analysis"); continue; }
    const total = num(s.totalSleep) ?? num(s.asleep);
    if (total === null || total < 0 || total > 24) { bump(out.skipped, "bad_value:sleep_analysis"); continue; }
    out.sleep.push({
      wakeUtc: wake.utc,
      offsetMin: wake.offsetMin,
      sleepStartUtc: sleepStart?.utc ?? null,
      sleepEndUtc: sleepEnd?.utc ?? null,
      inBedStartUtc: parseHaeDate(s.inBedStart)?.utc ?? null,
      inBedEndUtc: parseHaeDate(s.inBedEnd)?.utc ?? null,
      totalSleepH: total,
      inBedH: num(s.inBed),
      coreH: num(s.core),
      deepH: num(s.deep),
      remH: num(s.rem),
      awakeH: num(s.awake),
      sourceLabel: str(s.source),
    });
  }
}

function qtyOf(value: unknown, unitMap: Record<string, Converter>): number | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const q = num(v.qty);
  const convert = unitMap[str(v.units) ?? ""];
  return q !== null && convert ? convert(q) : null;
}

function parseWorkout(raw: Record<string, unknown>, out: ParseResult) {
  const name = str(raw.name);
  const start = parseHaeDate(raw.start);
  const end = parseHaeDate(raw.end);
  if (!name || !start || !end) return bump(out.skipped, "bad_workout");
  const computed = Math.round((Date.parse(end.utc) - Date.parse(start.utc)) / 1000);
  const duration = num(raw.duration) ?? computed;
  if (duration <= 0 || duration > 24 * 3600) return bump(out.skipped, "bad_workout_duration");
  const hr = (raw.heartRate ?? {}) as Record<string, unknown>;
  const hrUnits = { "count/min": same, bpm: same };
  const source = raw.source && typeof raw.source === "object" ? str((raw.source as Record<string, unknown>).name) : str(raw.source);
  out.workouts.push({
    externalId: str(raw.id),
    name,
    startUtc: start.utc,
    endUtc: end.utc,
    offsetMin: start.offsetMin,
    durationS: Math.round(duration),
    activeKcal: qtyOf(raw.activeEnergyBurned, energyToKcal) ?? qtyOf(raw.activeEnergy, energyToKcal),
    avgHr: qtyOf(raw.avgHeartRate, hrUnits) ?? num((hr.avg as Record<string, unknown> | undefined)?.qty) ?? num(hr.avg),
    maxHr: qtyOf(raw.maxHeartRate, hrUnits) ?? num((hr.max as Record<string, unknown> | undefined)?.qty) ?? num(hr.max),
    sourceLabel: source,
  });
}

export function parseHaePayload(payload: unknown): ParseResult {
  const out: ParseResult = { observations: [], sleep: [], workouts: [], skipped: {} };
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") {
    bump(out.skipped, "no_data_object");
    return out;
  }
  for (const metric of asArray(data.metrics)) {
    if (metric && typeof metric === "object") parseMetric(metric as Record<string, unknown>, out);
  }
  for (const workout of asArray(data.workouts)) {
    if (workout && typeof workout === "object") parseWorkout(workout as Record<string, unknown>, out);
  }
  for (const key of Object.keys(data)) {
    if (key !== "metrics" && key !== "workouts") bump(out.skipped, `ignored_section:${key}`, asArray(data[key]).length);
  }
  return out;
}

/** Map an Apple workout name to our categories. Badminton defaults to training; you can relabel later. */
export function workoutCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("badminton")) return "badminton_training";
  if (n.includes("strength") || n.includes("functional")) return "strength";
  if (/(run|walk|cycl|bike|swim|row|elliptical|hiit|cardio)/.test(n)) return "cardio";
  return "other";
}
