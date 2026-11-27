import { describe, expect, it } from "vitest";
import { addDays, localDate, parseHaeDate } from "../src/lib/time";

const TZ = "America/Vancouver";

describe("parseHaeDate", () => {
  it("parses the Health Auto Export format into UTC", () => {
    expect(parseHaeDate("2024-02-06 14:30:00 -0800")).toEqual({ utc: "2024-02-06T22:30:00.000Z", offsetMin: -480 });
    expect(parseHaeDate("2026-07-01 06:00:00 -0700")?.utc).toBe("2026-07-01T13:00:00.000Z");
    expect(parseHaeDate("2026-07-01 06:00:00 +08:00")?.utc).toBe("2026-06-30T22:00:00.000Z");
  });
  it("rejects garbage and impossible dates instead of guessing", () => {
    expect(parseHaeDate("yesterday")).toBeNull();
    expect(parseHaeDate("2024-02-31 10:00:00 -0800")).toBeNull();
    expect(parseHaeDate(12345)).toBeNull();
  });
});

describe("localDate in Vancouver across clock changes", () => {
  it("spring forward 2026-03-08: 01:59 PST and 03:00 PDT are the same day", () => {
    expect(localDate("2026-03-08T09:59:00Z", TZ)).toBe("2026-03-08"); // 01:59 PST
    expect(localDate("2026-03-08T10:00:00Z", TZ)).toBe("2026-03-08"); // 03:00 PDT
    expect(localDate("2026-03-08T07:59:00Z", TZ)).toBe("2026-03-07"); // 23:59 PST previous day
  });
  it("B.C. stays on UTC-7 after 2026-03-08 (permanent daylight time, tzdata 2026b+): no fall-back on 2026-11-01", () => {
    expect(localDate("2026-11-01T08:30:00Z", TZ)).toBe("2026-11-01"); // 01:30 UTC-7
    expect(localDate("2026-11-01T09:30:00Z", TZ)).toBe("2026-11-01"); // 02:30 UTC-7, no repeated hour
    expect(localDate("2026-11-22T06:59:00Z", TZ)).toBe("2026-11-21"); // 23:59 UTC-7
    expect(localDate("2026-11-22T07:00:00Z", TZ)).toBe("2026-11-22"); // 00:00 UTC-7
  });
  it("historical winter data before the change still uses UTC-8", () => {
    expect(localDate("2025-11-15T07:30:00Z", TZ)).toBe("2025-11-14"); // 23:30 PST
  });
  it("a late-evening sample is not pushed into the next UTC day", () => {
    expect(localDate(parseHaeDate("2026-11-20 23:00:00 -0700")!.utc, TZ)).toBe("2026-11-20");
  });
  it("addDays crosses month and DST boundaries by calendar day", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});
