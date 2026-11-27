import { describe, expect, it } from "vitest";
import { baseline, coachingLoad, coveredMean, hoursBetweenClock, mad, median, trainingLoad } from "../src/lib/stats";

describe("baseline", () => {
  it("uses median and MAD", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
  it("is not ready before 14 days", () => {
    expect(baseline(Array(13).fill(60)).ready).toBe(false);
    expect(baseline(Array(14).fill(60)).ready).toBe(true);
  });
});

describe("dual-track load", () => {
  it("coaching load is minutes x intensity, unknown when intensity is missing", () => {
    expect(coachingLoad(480, 4)).toBe(1920);
    expect(coachingLoad(480, null)).toBeNull();
    expect(coachingLoad(0, null)).toBe(0);
  });
  it("training load is session RPE, unknown when any RPE is missing", () => {
    expect(trainingLoad([{ minutes: 90, rpe: 7 }, { minutes: 30, rpe: 5 }])).toBe(780);
    expect(trainingLoad([{ minutes: 90, rpe: null }])).toBeNull();
    expect(trainingLoad([])).toBe(0);
  });
  it("rolling means require coverage and never treat missing as zero", () => {
    expect(coveredMean([100, null, 200, 300, 400, 500, 600], 5 / 7)).toBe(350);
    expect(coveredMean([100, null, null, 300, 400, 500, 600], 5 / 7)).toBe(380);
    expect(coveredMean([100, null, null, null, 400, 500, 600], 5 / 7)).toBeNull();
  });
});

describe("self-reported sleep", () => {
  it("handles midnight crossing", () => {
    expect(hoursBetweenClock("23:30", "07:00")).toBe(7.5);
    expect(hoursBetweenClock("01:00", "08:15")).toBe(7.25);
    expect(hoursBetweenClock("25:00", "07:00")).toBeNull();
  });
});

import { decryptBytes, encryptBytes } from "../src/lib/crypto";
describe("raw payload encryption", () => {
  it("round-trips and tolerates a trailing newline on the key", async () => {
    const key = "ab".repeat(32);
    const sealed = await encryptBytes(new TextEncoder().encode("{}"), `${key}\r\n`);
    expect(new TextDecoder().decode(await decryptBytes(sealed, key))).toBe("{}");
  });
});
