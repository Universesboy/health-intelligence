import { describe, expect, it } from "vitest";
import { buildReport, clockSpreadMinutes, compareRecent, spearman, weeklySlope, type Point } from "../src/lib/insights";
import { analyses, nextSteps, notNeeded, readinessScore, type Coverage } from "../src/lib/completeness";
import { addDays } from "../src/lib/time";

const today = "2026-11-26";
const daily = (n: number, f: (i: number) => number | null, end = today): Point[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(end, -(n - 1 - i)), value: f(i) })).filter((p): p is Point => p.value !== null);

describe("statistics", () => {
  it("needs enough days before comparing", () => {
    expect(compareRecent(daily(10, () => 7), today)).toBeNull();
    const c = compareRecent(daily(35, (i) => (i >= 28 ? 6 : 7.5)), today);
    expect(c?.recent).toBe(6);
    expect(c?.baseline).toBe(7.5);
  });
  it("computes a weekly slope only with spread-out points", () => {
    expect(weeklySlope(daily(7, (i) => 80 - i * 0.1))).toBeNull();
    const s = weeklySlope(daily(28, (i) => 80 - i * 0.1));
    expect(s?.perWeek).toBeCloseTo(-0.7, 5);
  });
  it("spearman is 1 for a monotonic relation and handles ties", () => {
    const a = daily(25, (i) => i); const b = daily(25, (i) => i * i);
    expect(spearman(a, b, "2000-01-01")?.rho).toBeCloseTo(1, 6);
    expect(spearman(daily(25, () => 1), b, "2000-01-01")).toBeNull();
  });
  it("measures wake time spread across midnight", () => {
    expect(clockSpreadMinutes(["23:50", "00:10", "23:50", "00:10", "23:50", "00:10", "00:00"])).toBeLessThan(15);
    expect(clockSpreadMinutes(["07:00", "07:00"])).toBeNull();
  });
});

describe("report", () => {
  const base = { today, goal: "performance" as const, load: [], redFlags: [], pain: [], waterTargetMl: null, targetWeightKg: null };
  it("says nothing confident with little data", () => {
    const r = buildReport({ ...base, series: { steps: daily(5, () => 8000) } });
    expect(r.changes).toHaveLength(0);
    expect(r.links).toHaveLength(0);
  });
  it("flags short sleep against the personal baseline", () => {
    const sleep = daily(35, (i) => (i === 34 ? 5.5 : 7.5));
    const r = buildReport({ ...base, series: { sleep_hours_device: sleep } });
    expect(r.focus[0]?.key).toBe("short_sleep");
  });
  it("red flags replace all other advice", () => {
    const r = buildReport({ ...base, redFlags: ["chest_pain"], series: { sleep_hours_device: daily(35, () => 5) } });
    expect(r.focus).toHaveLength(1);
    expect(r.focus[0]?.tone).toBe("alert");
  });
  it("labels correlation, never causation, and needs 21 paired days", () => {
    const few = buildReport({ ...base, series: { sleep_hours_self: daily(15, (i) => 6 + (i % 3)), readiness: daily(15, (i) => 2 + (i % 3)) } });
    expect(few.links).toHaveLength(0);
    const many = buildReport({ ...base, series: { sleep_hours_self: daily(30, (i) => 6 + (i % 3)), readiness: daily(30, (i) => 2 + (i % 3)) } });
    expect(many.links[0]?.detail).toContain("不代表");
  });
  it("catches an implausible weight jump", () => {
    const r = buildReport({ ...base, series: { body_mass: [{ date: addDays(today, -1), value: 77 }, { date: today, value: 80.5 }] } });
    expect(r.quality.some((q) => q.key.startsWith("weight_jump"))).toBe(true);
  });
  it("never shows more than three focus items", () => {
    const r = buildReport({ ...base, goal: "weight", waterTargetMl: 2500, pain: [{ area: "膝", severity: 6 }],
      load: [{ date: today, acute7: 400, chronic28: 200, coachingMinutes: 0, coachingLoad: 0 }],
      series: { sleep_hours_device: daily(35, (i) => (i === 34 ? 5 : 7.5)), water: [{ date: addDays(today, -1), value: 500 }] } });
    expect(r.focus.length).toBe(3);
  });
});

describe("completeness", () => {
  const empty: Coverage = { days: 28, weighIns: 0, weighInSpanDays: 0, sleepNights: 0, deviceSleepNights: 0, wakeTimes: 0, stepsDays: 0,
    teachingDays: 0, teachingDaysWithIntensity: 0, workouts: 0, workoutsWithRpe: 0, subjectiveDays: 0, hrvDays: 0, restingHrDays: 0,
    mealDays: 0, dietaryEnergyDays: 0, waterDays: 0, pairedSleepReadiness: 0,
    profileFields: { heightCm: false, birthYear: false, goal: false, usualSchedule: false }, coachchalkConnected: false };
  it("weights analyses by goal", () => {
    const sleep = analyses(empty, "sleep"); const weight = analyses(empty, "weight");
    expect(sleep[0]?.key).toMatch(/sleep/);
    expect(weight[0]?.key).toMatch(/weight_trend|nutrition/);
    expect(notNeeded(sleep).map((a) => a.key)).toContain("weight_trend");
  });
  it("irrelevant data does not lower the score", () => {
    const good = { ...empty, sleepNights: 20, wakeTimes: 14, subjectiveDays: 20, pairedSleepReadiness: 21, stepsDays: 25, coachchalkConnected: true, teachingDays: 10, teachingDaysWithIntensity: 9, hrvDays: 14 };
    expect(readinessScore(analyses(good, "sleep"))).toBe(100);
    expect(readinessScore(analyses(good, "weight"))).toBeLessThan(60);
  });
  it("suggests at most two next steps, cheapest first", () => {
    const steps = nextSteps(analyses(empty, "performance"));
    expect(steps.length).toBe(2);
    expect(steps.every((s) => s.next)).toBe(true);
  });
});
