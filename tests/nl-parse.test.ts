import { describe, expect, it } from "vitest";
import { chineseNumber, parseHealthSentence } from "../src/lib/nl-parse";

const today = "2026-11-26";
const pick = (text: string) => Object.fromEntries(parseHealthSentence(text, today).proposals.map((p) => [p.kind, p]));

describe("chineseNumber", () => {
  it("reads common numerals", () => {
    expect(chineseNumber("七")).toBe(7);
    expect(chineseNumber("十二")).toBe(12);
    expect(chineseNumber("七十七点五")).toBe(77.5);
    expect(chineseNumber("一百五十四")).toBe(154);
    expect(chineseNumber("两")).toBe(2);
    expect(chineseNumber("77.5")).toBe(77.5);
    expect(chineseNumber("abc")).toBeNull();
  });
});

describe("parseHealthSentence", () => {
  it("handles the example sentence", () => {
    const r = pick("今天早上体重 77 公斤，昨晚睡了七个半小时，感觉恢复不错。");
    expect(r.weight).toMatchObject({ value: 77, unit: "kg", date: today });
    expect(r.sleep_hours).toMatchObject({ value: 7.5, date: today }); // last night's sleep ends today
    expect(r.readiness).toMatchObject({ value: 4, date: today });
  });
  it("converts jin and pounds", () => {
    expect(pick("体重154斤").weight?.value).toBe(77);
    expect(pick("weight 170 lb").weight?.value).toBe(77.1);
  });
  it("assigns yesterday when said", () => {
    const r = pick("昨天体重76.8kg");
    expect(r.weight).toMatchObject({ value: 76.8, date: "2026-11-25" });
  });
  it("reads hours and minutes, bed and wake times", () => {
    const r = pick("昨晚12点半睡，早上7点起床，睡了6小时40分");
    expect(r.sleep_hours?.value).toBe(6.67);
    expect(r.bedtime?.value).toBe("00:30");
    expect(r.waketime?.value).toBe("07:00");
    const late = pick("昨晚十一点睡的");
    expect(late.bedtime?.value).toBe("23:00");
  });
  it("reads water in cups and litres and states the cup size", () => {
    const r = pick("今天喝了3杯水");
    expect(r.water).toMatchObject({ value: 750, detail: "按 1 杯 = 250 mL" });
    expect(pick("喝了两升水").water?.value).toBe(2000);
  });
  it("does not mistake waist for weight", () => {
    const r = pick("腰围84厘米");
    expect(r.waist?.value).toBe(84);
    expect(r.weight).toBeUndefined();
  });
  it("keeps meals as text and never guesses calories", () => {
    const r = pick("午饭吃了牛肉面");
    expect(r.meal).toMatchObject({ value: "牛肉面", detail: "lunch" });
  });
  it("lists what it did not understand instead of guessing", () => {
    const out = parseHealthSentence("今天天气很好，体重77kg", today);
    expect(out.leftovers).toEqual(["今天天气很好"]);
    expect(out.proposals).toHaveLength(1);
  });
  it("rejects impossible values", () => {
    expect(pick("体重 7 公斤").weight).toBeUndefined();
    expect(pick("睡了30小时").sleep_hours).toBeUndefined();
  });
  it("reads tiredness and teaching intensity", () => {
    const r = pick("今天很累，教学强度8");
    expect(r.readiness?.value).toBe(2);
    expect(r.coaching_intensity?.value).toBe(8);
  });
});
