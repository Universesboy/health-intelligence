// One-sentence health entry: "今天早上体重 77 公斤，昨晚睡了七个半小时，感觉恢复不错。"
// Deterministic rules, no language model: every proposal points at the words it came from, and
// nothing is written until the user confirms the preview. Anything not understood is listed as
// such instead of guessed.
import { addDays } from "./time";

export type ProposalKind =
  | "weight" | "waist" | "water" | "sleep_hours" | "bedtime" | "waketime"
  | "readiness" | "energy" | "fatigue" | "sleep_quality" | "coaching_intensity" | "meal";

export interface Proposal {
  kind: ProposalKind;
  value: number | string;
  unit: string;
  /** Local day the value belongs to. Sleep belongs to the day you woke up. */
  date: string;
  /** The words this came from, shown on the preview. */
  evidence: string;
  /** Extra detail, e.g. the meal slot. */
  detail?: string;
}

export interface ParseOutcome {
  proposals: Proposal[];
  /** Pieces of the sentence that contained no value we understood. */
  leftovers: string[];
}

const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Chinese numerals up to 9999 ("七", "十二", "一百五十四", "七十七点五"). Returns null if not a numeral. */
export function chineseNumber(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const [intPart, fracPart] = t.split("点");
  let total = 0; let section = 0; let seen = false;
  for (const ch of intPart ?? "") {
    if (ch in DIGIT) { section = DIGIT[ch]!; seen = true; continue; }
    const unit = ch === "十" ? 10 : ch === "百" ? 100 : ch === "千" ? 1000 : 0;
    if (!unit) return null;
    total += (section || (unit === 10 ? 1 : 0)) * unit; section = 0; seen = true;
  }
  total += section;
  if (!seen && !intPart) return null;
  if (fracPart !== undefined) {
    if (!fracPart || ![...fracPart].every((c) => c in DIGIT)) return null;
    total = Number(`${total}.${[...fracPart].map((c) => DIGIT[c]).join("")}`);
  }
  return total;
}

const NUM = String.raw`(\d+(?:\.\d+)?|[零〇一二两俩三四五六七八九十百千]+(?:点[零〇一二三四五六七八九]+)?)`;
const num = (raw: string) => chineseNumber(raw);

/** Splits on punctuation and on spaces/"然后/还有" so each clause has one date context. */
function clauses(text: string): string[] {
  return text.normalize("NFKC").split(/[，,。;；!！?？\n]+|(?<!\d)\.|\.(?!\d)|(?:然后|还有|另外)/).map((s) => s.trim()).filter(Boolean);
}

function dayOf(clause: string, today: string, fallback: string): string {
  if (/前天/.test(clause)) return addDays(today, -2);
  if (/昨天|昨日|yesterday/i.test(clause)) return addDays(today, -1);
  if (/今天|今早|今晨|今天早上|today|this morning/i.test(clause)) return today;
  return fallback;
}

function clockFrom(hourRaw: string, minuteRaw: string | undefined, half: boolean, pm: boolean): string | null {
  let h = num(hourRaw);
  let m = minuteRaw ? num(minuteRaw) : half ? 30 : 0;
  if (h === null || m === null || h > 24 || m >= 60) return null;
  if (pm && h < 12) h += 12;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(Math.round(m)).padStart(2, "0")}`;
}

const FEEL_GOOD = /(恢复|状态|感觉|身体)[^，,。]{0,4}(很好|不错|挺好|还行|可以|好多了|满血)|精神(很好|不错)|满血/;
const FEEL_BAD = /(恢复|状态|感觉|身体)[^，,。]{0,4}(很差|不好|一般般?|较差|没恢复)|很累|好累|累死|疲惫|没精神|酸痛/;

export function parseHealthSentence(input: string, today: string): ParseOutcome {
  const proposals: Proposal[] = [];
  const leftovers: string[] = [];
  let context = today;
  for (const clause of clauses(input)) {
    context = dayOf(clause, today, context);
    const before = proposals.length;
    const push = (p: Omit<Proposal, "date"> & { date?: string }) => proposals.push({ date: context, ...p });

    // Weight: 77 公斤 / 77kg / 154 斤 / 170 lb
    const w = new RegExp(String.raw`(?:体重|称了?|重)?\s*${NUM}\s*(公斤|千克|kg|斤|磅|lbs?)`, "i").exec(clause);
    if (w && !/腰/.test(clause)) {
      const v = num(w[1]!); const unit = w[2]!.toLowerCase();
      const kg = v === null ? null : unit === "斤" ? v / 2 : unit.startsWith("lb") || unit === "磅" ? v * 0.45359237 : v;
      if (kg !== null && kg >= 25 && kg <= 300) push({ kind: "weight", value: Math.round(kg * 10) / 10, unit: "kg", evidence: w[0].trim() });
    }

    // Waist: 腰围 84 厘米 / 腰围 33 寸 (市寸 is ambiguous, so inches only when written "inch/in")
    const waist = new RegExp(String.raw`腰围\s*${NUM}\s*(厘米|cm|公分|inch|in)?`, "i").exec(clause);
    if (waist) {
      const v = num(waist[1]!); const unit = (waist[2] ?? "cm").toLowerCase();
      const cm = v === null ? null : unit.startsWith("in") ? v * 2.54 : v;
      if (cm !== null && cm >= 40 && cm <= 200) push({ kind: "waist", value: Math.round(cm * 10) / 10, unit: "cm", evidence: waist[0] });
    }

    // Water: 喝了 2 升水 / 500 毫升 / 3 杯水 (a cup is counted as 250 mL and shown so on the preview)
    const water = new RegExp(String.raw`${NUM}\s*(升|l|毫升|ml|杯|瓶)\s*(?:的)?(?:水|白开水|温水)?`, "i").exec(clause);
    if (water && /水|喝/.test(clause) && !/咖啡|奶茶|啤酒|酒/.test(clause)) {
      const v = num(water[1]!); const unit = water[2]!.toLowerCase();
      const ml = v === null ? null : unit === "升" || unit === "l" ? v * 1000 : unit === "杯" ? v * 250 : unit === "瓶" ? v * 500 : v;
      if (ml !== null && ml > 0 && ml <= 8000) {
        push({ kind: "water", value: Math.round(ml), unit: "mL", evidence: water[0], detail: unit === "杯" ? "按 1 杯 = 250 mL" : unit === "瓶" ? "按 1 瓶 = 500 mL" : undefined });
      }
    }

    // Sleep duration: 睡了七个半小时 / 睡了 6 小时 40 分 / 睡了 7.5h. Sleep belongs to the wake-up day:
    // "昨晚睡了" is last night's sleep, which ends today.
    if (/睡/.test(clause)) {
      const sleepDay = /前晚|前天晚上/.test(clause) ? addDays(today, -1) : /昨晚|昨天晚上|昨夜|last night/i.test(clause) ? today : context;
      const dur = new RegExp(String.raw`睡了?\s*(?:大概|差不多|约|将近)?\s*${NUM}\s*(?:个)?\s*(半)?\s*(?:小时|钟头|h)(?:\s*${NUM}\s*分(?:钟)?)?`, "i").exec(clause);
      if (dur) {
        const h = num(dur[1]!); const extra = dur[3] ? num(dur[3]) : 0;
        if (h !== null && extra !== null) {
          const hours = h + (dur[2] ? 0.5 : 0) + extra / 60;
          if (hours > 0 && hours <= 16) push({ kind: "sleep_hours", value: Math.round(hours * 100) / 100, unit: "h", evidence: dur[0], date: sleepDay });
        }
      }
      const bed = new RegExp(String.raw`(凌晨|晚上|夜里|半夜)?\s*${NUM}\s*点\s*(?:${NUM}\s*分?|(半))?\s*(?:才)?(?:睡|上床|入睡)`).exec(clause);
      if (bed) {
        const hourRaw = bed[2]!; const h = num(hourRaw);
        const pm = bed[1] === "晚上" || (bed[1] === undefined && h !== null && h >= 8 && h < 12);
        // "12 点半睡" at night is half past midnight.
        const clock = clockFrom(h === 12 ? "0" : hourRaw, bed[3], Boolean(bed[4]), pm && h !== 12);
        if (clock) push({ kind: "bedtime", value: clock, unit: "", evidence: bed[0], date: sleepDay });
      }
      const wake = new RegExp(String.raw`(早上|上午|中午)?\s*${NUM}\s*点\s*(?:${NUM}\s*分?|(半))?\s*(?:才)?(?:起床|起来|醒)`).exec(clause);
      if (wake) {
        const clock = clockFrom(wake[2]!, wake[3], Boolean(wake[4]), wake[1] === "中午");
        if (clock) push({ kind: "waketime", value: clock, unit: "", evidence: wake[0], date: sleepDay });
      }
      if (/睡得(很好|不错|挺好|香)|睡眠(很好|不错)/.test(clause)) push({ kind: "sleep_quality", value: 4, unit: "1–5", evidence: clause, date: sleepDay });
      else if (/睡得(很差|不好|一般)|没睡好|失眠|醒了好几次/.test(clause)) push({ kind: "sleep_quality", value: 2, unit: "1–5", evidence: clause, date: sleepDay });
    } else {
      const wake = new RegExp(String.raw`(早上|上午)?\s*${NUM}\s*点\s*(?:${NUM}\s*分?|(半))?\s*(?:才)?(?:起床|起来|醒)`).exec(clause);
      if (wake) {
        const clock = clockFrom(wake[2]!, wake[3], Boolean(wake[4]), false);
        if (clock) push({ kind: "waketime", value: clock, unit: "", evidence: wake[0] });
      }
    }

    // Subjective recovery. Words map to a 1–5 scale, shown on the preview so it can be changed.
    if (FEEL_GOOD.test(clause)) push({ kind: "readiness", value: /很好|满血/.test(clause) ? 5 : 4, unit: "1–5", evidence: clause });
    else if (FEEL_BAD.test(clause)) push({ kind: "readiness", value: /很差|累死|没恢复/.test(clause) ? 1 : 2, unit: "1–5", evidence: clause });
    const fatigue = new RegExp(String.raw`疲劳\s*${NUM}`).exec(clause);
    if (fatigue) { const v = num(fatigue[1]!); if (v !== null && v >= 1 && v <= 5) push({ kind: "fatigue", value: v, unit: "1–5", evidence: fatigue[0] }); }
    const energy = new RegExp(String.raw`精力\s*${NUM}`).exec(clause);
    if (energy) { const v = num(energy[1]!); if (v !== null && v >= 1 && v <= 5) push({ kind: "energy", value: v, unit: "1–5", evidence: energy[0] }); }
    const intensity = new RegExp(String.raw`(?:教学|上课|教课)(?:强度)?\s*${NUM}`).exec(clause);
    if (intensity) { const v = num(intensity[1]!); if (v !== null && v >= 1 && v <= 10) push({ kind: "coaching_intensity", value: v, unit: "1–10", evidence: intensity[0] }); }

    // Meals: 早餐吃了燕麦和鸡蛋 / 午饭 牛肉面. Kept as a description; no calories are guessed.
    const meal = /(早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|加餐|宵夜|零食)\s*(?:吃了|吃的|是|:|：)?\s*(.{1,60})/.exec(clause);
    if (meal && meal[2]!.trim()) {
      const slot = /早/.test(meal[1]!) ? "breakfast" : /午|中/.test(meal[1]!) ? "lunch" : /晚/.test(meal[1]!) ? "dinner" : "snack";
      push({ kind: "meal", value: meal[2]!.trim(), unit: "", evidence: meal[0], detail: slot });
    }

    if (proposals.length === before) leftovers.push(clause);
  }
  // One value per kind and day: the last mention wins ("77, no, 76.5").
  const seen = new Map<string, Proposal>();
  for (const p of proposals) seen.set(p.kind === "meal" || p.kind === "water" ? `${p.kind}|${p.date}|${p.evidence}` : `${p.kind}|${p.date}`, p);
  return { proposals: [...seen.values()], leftovers };
}

export const PROPOSAL_LABELS: Record<ProposalKind, string> = {
  weight: "体重", waist: "腰围", water: "饮水", sleep_hours: "睡眠时长（自报）", bedtime: "入睡时间", waketime: "起床时间",
  readiness: "主观恢复", energy: "精力", fatigue: "疲劳", sleep_quality: "睡眠质量", coaching_intensity: "教学强度", meal: "饮食",
};
