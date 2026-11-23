import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHaePayload, workoutCategory } from "../src/ingest/hae";
import { observationKey, sleepKey, workoutKey } from "../src/ingest/store";

const sample = JSON.parse(readFileSync(new URL("./fixtures/hae-sample.json", import.meta.url), "utf8"));

describe("parseHaePayload", () => {
  const r = parseHaePayload(sample);

  it("keeps valid allowlisted samples and counts the rest", () => {
    expect(r.observations.filter((o) => o.metric === "steps")).toHaveLength(3);
    expect(r.skipped["bad_value:step_count"]).toBe(1);
    expect(r.skipped["not_allowlisted:headphone_audio_exposure"]).toBe(1);
    expect(r.skipped["ignored_section:stateOfMind"]).toBe(1);
  });

  it("normalises units to metric", () => {
    expect(r.observations.find((o) => o.metric === "walking_running_distance")?.value).toBeCloseTo(1.609344);
    expect(r.observations.find((o) => o.metric === "body_mass")?.value).toBeCloseTo(74.84, 2);
    expect(r.observations.find((o) => o.metric === "body_fat_pct")?.value).toBeCloseTo(18.2);
  });

  it("keeps heart-rate min/max and splits blood pressure", () => {
    const hr = r.observations.find((o) => o.metric === "heart_rate");
    expect(hr).toMatchObject({ value: 61, extra: { min: 52, max: 75 } });
    expect(r.observations.find((o) => o.metric === "bp_systolic")?.value).toBe(118);
    expect(r.observations.find((o) => o.metric === "bp_diastolic")?.value).toBe(76);
  });

  it("reads summarised sleep and attributes it to the wake-up time", () => {
    expect(r.sleep).toHaveLength(1);
    expect(r.sleep[0]).toMatchObject({ totalSleepH: 6.75, deepH: 0.9, wakeUtc: "2026-11-20T13:55:00.000Z" });
  });

  it("reads v2 workouts", () => {
    expect(r.workouts[0]).toMatchObject({ externalId: "w-1", durationS: 5400, activeKcal: 610, avgHr: 138, maxHr: 176, sourceLabel: "Apple Watch" });
    expect(workoutCategory("Badminton")).toBe("badminton_training");
  });

  it("rejects unknown units instead of guessing", () => {
    const x = parseHaePayload({ data: { metrics: [{ name: "body_mass", units: "stone", data: [{ qty: 12, date: "2026-11-20 07:00:00 -0800" }] }] } });
    expect(x.observations).toHaveLength(0);
    expect(x.skipped["unknown_unit:body_mass"]).toBe(1);
  });

  it("skips unsummarised sleep segments rather than re-adding them", () => {
    const x = parseHaePayload({ data: { metrics: [{ name: "sleep_analysis", units: "hr", data: [
      { date: "2026-11-20 01:00:00 -0800", startDate: "2026-11-20 01:00:00 -0800", value: "Core", qty: 1 }] }] } });
    expect(x.sleep).toHaveLength(0);
    expect(x.skipped.sleep_segment_unsummarized).toBe(1);
  });

  it("survives empty or malformed payloads", () => {
    expect(parseHaePayload(null).skipped.no_data_object).toBe(1);
    expect(parseHaePayload({ data: { metrics: "nope" } }).observations).toHaveLength(0);
  });
});

describe("dedup keys never contain values", () => {
  it("identifies a measurement by metric, instant and device", () => {
    expect(observationKey({ metric: "steps", startUtc: "2026-11-20T15:00:00.000Z", sourceLabel: "iPhone" }))
      .toBe("obs|steps|2026-11-20T15:00:00.000Z|iPhone");
    expect(sleepKey("2026-11-20", null)).toBe("sleep|2026-11-20|");
    expect(workoutKey({ externalId: "w-1", startUtc: "x", name: "y" })).toBe("wk|w-1");
  });
});
