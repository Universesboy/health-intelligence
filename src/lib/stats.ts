// Small, deterministic statistics. The language model never computes these numbers.

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation (unscaled). Robust to the odd bad night or device glitch. */
export function mad(values: number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

export const BASELINE_MIN_DAYS = 14;

export interface Baseline {
  median: number | null;
  mad: number | null;
  n: number;
  ready: boolean; // false = "baseline still forming", no judgements may be made
}

export function baseline(values: number[]): Baseline {
  return { median: median(values), mad: mad(values), n: values.length, ready: values.length >= BASELINE_MIN_DAYS };
}

/**
 * Mean over a window of daily values where `null` means missing.
 * Returns null unless at least `minCoverage` of the days have data: missing days are never
 * treated as zero load.
 */
export function coveredMean(daily: (number | null)[], minCoverage: number): number | null {
  if (!daily.length) return null;
  const present = daily.filter((v): v is number => v !== null);
  if (present.length / daily.length < minCoverage) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Daily coaching load = teaching minutes x self-reported teaching intensity (1-10).
 * No teaching -> 0. Teaching but no intensity reported -> null (unknown, not zero, not guessed).
 */
export function coachingLoad(minutes: number, intensity: number | null): number | null {
  if (minutes <= 0) return 0;
  return intensity === null ? null : minutes * intensity;
}

/** Session-RPE training load (Foster): sum of minutes x RPE. Any session without RPE -> null. */
export function trainingLoad(sessions: { minutes: number; rpe: number | null }[]): number | null {
  let total = 0;
  for (const s of sessions) {
    if (s.rpe === null) return null;
    total += s.minutes * s.rpe;
  }
  return total;
}

/** Hours between "HH:MM" bedtime (previous evening) and "HH:MM" wake time. */
export function hoursBetweenClock(bed: string, wake: string): number | null {
  const parse = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const h = Number(m[1]); const min = Number(m[2]);
    return h < 24 && min < 60 ? h * 60 + min : null;
  };
  const b = parse(bed); const w = parse(wake);
  if (b === null || w === null) return null;
  const diff = (w - b + 24 * 60) % (24 * 60);
  return diff === 0 ? null : Math.round((diff / 60) * 100) / 100;
}
