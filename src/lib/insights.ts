// Health intelligence engine: trends, possible links between metrics, data quality and the 1–3
// things worth attention today. Deterministic and explainable; every finding carries the numbers
// it is based on and a confidence label. Too little data -> it says so instead of concluding.
import { addDays } from "./time";
import { median } from "./stats";
import type { Goal } from "./completeness";

export const ENGINE_VERSION = 1;

export type Point = { date: string; value: number };
export type Series = Record<string, Point[]>;
export type Tone = "good" | "watch" | "neutral" | "alert";
export type Confidence = "high" | "medium" | "low";

export interface Finding {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  confidence: Confidence;
  /** Which area it is about, for icons and grouping. */
  area: "sleep" | "body" | "activity" | "load" | "recovery" | "nutrition" | "data";
}

export interface LoadDay { date: string; acute7: number | null; chronic28: number | null; coachingMinutes: number; coachingLoad: number | null }

export interface Context {
  today: string;
  goal: Goal;
  series: Series;
  load: LoadDay[];
  redFlags: string[];
  pain: { area: string; severity: number | null }[];
  waterTargetMl: number | null;
  targetWeightKg: number | null;
}

export interface Report {
  focus: Finding[]; // at most 3
  changes: Finding[];
  links: Finding[];
  quality: Finding[];
  engineVersion: number;
}

const SCALE = 1.4826; // MAD -> standard deviation for normal data

const DIRECTION: Record<string, { label: string; unit: string; digits: number; higherIs: "good" | "bad" | "neutral"; minDelta: number }> = {
  sleep_hours_device: { label: "睡眠（设备）", unit: "小时", digits: 1, higherIs: "good", minDelta: 0.4 },
  sleep_hours_self: { label: "睡眠（自报）", unit: "小时", digits: 1, higherIs: "good", minDelta: 0.4 },
  steps: { label: "步数", unit: "步", digits: 0, higherIs: "good", minDelta: 800 },
  resting_heart_rate: { label: "静息心率", unit: "bpm", digits: 0, higherIs: "bad", minDelta: 3 },
  hrv_sdnn: { label: "HRV", unit: "ms", digits: 0, higherIs: "good", minDelta: 5 },
  readiness: { label: "主观恢复", unit: "分", digits: 1, higherIs: "good", minDelta: 0.5 },
  coaching_minutes: { label: "教学时长", unit: "分钟/天", digits: 0, higherIs: "neutral", minDelta: 30 },
};

function window(points: Point[] | undefined, from: string, to: string) {
  return (points ?? []).filter((p) => p.date >= from && p.date <= to);
}

function fmt(v: number, digits: number) {
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Last 7 days against the 28 days before them, using medians so one odd day cannot swing it. */
export function compareRecent(points: Point[] | undefined, today: string) {
  const recent = window(points, addDays(today, -6), today).map((p) => p.value);
  const base = window(points, addDays(today, -34), addDays(today, -7)).map((p) => p.value);
  if (recent.length < 4 || base.length < 14) return null;
  const r = median(recent)!; const b = median(base)!;
  const mad = median(base.map((v) => Math.abs(v - b)))!;
  return { recent: r, baseline: b, spread: mad * SCALE, nRecent: recent.length, nBase: base.length };
}

/** Least-squares slope in units per week. Needs 8 points spread over at least 14 days. */
export function weeklySlope(points: Point[]): { perWeek: number; n: number; spanDays: number } | null {
  if (points.length < 8) return null;
  const t0 = Date.parse(`${points[0]!.date}T12:00:00Z`);
  const xs = points.map((p) => (Date.parse(`${p.date}T12:00:00Z`) - t0) / 86_400_000);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 14) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, p) => a + p.value, 0) / points.length;
  let num = 0; let den = 0;
  points.forEach((p, i) => { num += (xs[i]! - mx) * (p.value - my); den += (xs[i]! - mx) ** 2; });
  return den ? { perWeek: (num / den) * 7, n: points.length, spanDays: Math.round(span) } : null;
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation over days where both series have a value. */
export function spearman(a: Point[] | undefined, b: Point[] | undefined, from: string): { rho: number; n: number } | null {
  const bm = new Map((b ?? []).filter((p) => p.date >= from).map((p) => [p.date, p.value]));
  const pairs = (a ?? []).filter((p) => p.date >= from && bm.has(p.date)).map((p) => [p.value, bm.get(p.date)!] as const);
  if (pairs.length < 3) return null;
  const rx = ranks(pairs.map((p) => p[0])); const ry = ranks(pairs.map((p) => p[1]));
  const n = pairs.length; const mx = (n + 1) / 2;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i]! - mx) * (ry[i]! - mx); dx += (rx[i]! - mx) ** 2; dy += (ry[i]! - mx) ** 2; }
  return dx && dy ? { rho: num / Math.sqrt(dx * dy), n } : null;
}

/** Standard deviation of clock times in minutes (handles the midnight wrap). */
export function clockSpreadMinutes(clocks: string[]): number | null {
  const mins = clocks.map((c) => { const [h, m] = c.split(":").map(Number); return h! * 60 + m!; });
  if (mins.length < 7) return null;
  // Shift so times around midnight stay together.
  const shifted = mins.map((m) => (m < 12 * 60 ? m + 24 * 60 : m));
  const pick = Math.max(...mins) - Math.min(...mins) > Math.max(...shifted) - Math.min(...shifted) ? shifted : mins;
  const mean = pick.reduce((a, b) => a + b, 0) / pick.length;
  return Math.sqrt(pick.reduce((a, b) => a + (b - mean) ** 2, 0) / pick.length);
}

function sleepSeries(s: Series) {
  // Device sleep where present, otherwise self-report. Never averaged together.
  const device = new Map((s.sleep_hours_device ?? []).map((p) => [p.date, p.value]));
  const self = (s.sleep_hours_self ?? []).filter((p) => !device.has(p.date));
  return [...(s.sleep_hours_device ?? []), ...self].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildReport(ctx: Context, wakeClocks: string[] = []): Report {
  const { today, series: s } = ctx;
  const changes: Finding[] = []; const links: Finding[] = []; const quality: Finding[] = []; const focus: Finding[] = [];

  // ---------- Trends ----------
  for (const [metric, spec] of Object.entries(DIRECTION)) {
    const c = compareRecent(s[metric], today);
    if (!c) continue;
    const delta = c.recent - c.baseline;
    if (Math.abs(delta) < Math.max(spec.minDelta, c.spread)) continue;
    const up = delta > 0;
    const tone: Tone = spec.higherIs === "neutral" ? "neutral" : (up === (spec.higherIs === "good")) ? "good" : "watch";
    changes.push({
      key: `trend_${metric}`, tone, area: metric.startsWith("sleep") ? "sleep" : metric === "steps" ? "activity" : metric === "coaching_minutes" ? "load" : "recovery",
      title: `${spec.label}近 7 天${up ? "高于" : "低于"}你的平常水平`,
      detail: `近 7 天中位数 ${fmt(c.recent, spec.digits)} ${spec.unit}，之前 4 周 ${fmt(c.baseline, spec.digits)} ${spec.unit}（${c.nRecent} 天对比 ${c.nBase} 天）。`,
      confidence: c.nRecent >= 6 && c.nBase >= 21 ? "high" : "medium",
    });
  }

  const weights = window(s.body_mass, addDays(today, -27), today);
  const slope = weeklySlope(weights);
  if (slope) {
    const flat = Math.abs(slope.perWeek) < 0.15;
    const toward = ctx.targetWeightKg !== null && weights.length
      ? Math.sign(ctx.targetWeightKg - weights[weights.length - 1]!.value) === Math.sign(slope.perWeek) : null;
    changes.push({
      key: "weight_slope", area: "body",
      tone: flat ? "neutral" : ctx.goal === "weight" && toward !== null ? (toward ? "good" : "watch") : "neutral",
      title: flat ? "体重基本稳定" : `体重每周约${slope.perWeek > 0 ? "上升" : "下降"} ${fmt(Math.abs(slope.perWeek), 2)} kg`,
      detail: `根据近 ${slope.spanDays} 天 ${slope.n} 次称重的线性趋势，单日波动（饮水、饮食、出汗）已被平滑。`
        + (ctx.targetWeightKg !== null ? ` 目标 ${fmt(ctx.targetWeightKg, 1)} kg。` : ""),
      confidence: slope.n >= 12 ? "high" : "medium",
    });
  }

  const spread = clockSpreadMinutes(wakeClocks.slice(-14));
  if (spread !== null) {
    changes.push({
      key: "wake_regularity", area: "sleep", tone: spread > 60 ? "watch" : "good",
      title: spread > 60 ? "起床时间波动较大" : "起床时间比较规律",
      detail: `近 ${Math.min(14, wakeClocks.length)} 天起床时间的标准差约 ${Math.round(spread)} 分钟。固定起床时间是改善睡眠最可靠的习惯之一。`,
      confidence: wakeClocks.length >= 12 ? "high" : "medium",
    });
  }

  // ---------- Load (acute:chronic) ----------
  const todayLoad = ctx.load.find((d) => d.date === today) ?? ctx.load[ctx.load.length - 1];
  let ratio: number | null = null;
  if (todayLoad?.acute7 != null && todayLoad.chronic28 != null && todayLoad.chronic28 > 0) {
    ratio = todayLoad.acute7 / todayLoad.chronic28;
    if (ratio > 1.3 || ratio < 0.7) {
      changes.push({
        key: "load_ratio", area: "load", tone: ratio > 1.3 ? "watch" : "neutral",
        title: ratio > 1.3 ? `近 7 天负荷比 4 周平均高 ${Math.round((ratio - 1) * 100)}%` : `近 7 天负荷比 4 周平均低 ${Math.round((1 - ratio) * 100)}%`,
        detail: "负荷 = 教学时长 × 教学强度 + 训练时长 × RPE。短期快速上升时，疲劳和伤病风险通常更高；这是参考信号，不是诊断。",
        confidence: "medium",
      });
    }
  }

  // ---------- Possible links (correlation, never causation) ----------
  const from = addDays(today, -59);
  const sleep = sleepSeries(s);
  const pairs: [string, Point[] | undefined, string, Point[] | undefined, string][] = [
    ["sleep_readiness", sleep, "睡眠时长", s.readiness, "第二天的恢复感受"],
    ["steps_readiness", s.steps, "步数", s.readiness, "恢复感受"],
    ["coaching_readiness", s.coaching_minutes, "教学时长", s.readiness, "恢复感受"],
  ];
  for (const [key, a, aLabel, b, bLabel] of pairs) {
    const r = spearman(a, b, from);
    if (!r) continue;
    if (r.n < 21) continue;
    if (Math.abs(r.rho) < 0.3) {
      links.push({ key, area: "recovery", tone: "neutral", confidence: "medium",
        title: `${aLabel}和${bLabel}暂时看不出明显关联`, detail: `${r.n} 天配对数据，相关系数 ${r.rho.toFixed(2)}。` });
      continue;
    }
    links.push({
      key, area: "recovery", tone: "neutral", confidence: r.n >= 40 && Math.abs(r.rho) >= 0.4 ? "medium" : "low",
      title: `${aLabel}越多的日子，${bLabel}往往${r.rho > 0 ? "越好" : "越差"}`,
      detail: `${r.n} 天配对数据，相关系数 ${r.rho.toFixed(2)}。这只说明两者一起变化，不代表一个导致另一个；其他因素（比赛、生病、压力）也可能同时影响两者。`,
    });
  }

  // ---------- Data quality ----------
  const lastWeight = s.body_mass ?? [];
  for (let i = 1; i < lastWeight.length; i++) {
    const a = lastWeight[i - 1]!; const b = lastWeight[i]!;
    if (b.date < addDays(today, -13)) continue;
    const gap = (Date.parse(b.date) - Date.parse(a.date)) / 86_400_000;
    if (gap <= 2 && Math.abs(b.value - a.value) > 2) {
      quality.push({ key: `weight_jump_${b.date}`, area: "data", tone: "watch", confidence: "high",
        title: `${b.date} 体重与前一次相差 ${fmt(Math.abs(b.value - a.value), 1)} kg`,
        detail: "两天内变化超过 2 kg 通常是称重条件不同（衣物、饭后、不同秤）或录入错误，趋势计算仍然使用它，请确认。" });
    }
  }
  const dev = new Map((s.sleep_hours_device ?? []).map((p) => [p.date, p.value]));
  for (const p of window(s.sleep_hours_self, addDays(today, -13), today)) {
    const d = dev.get(p.date);
    if (d !== undefined && Math.abs(d - p.value) > 1.5) {
      quality.push({ key: `sleep_mismatch_${p.date}`, area: "data", tone: "neutral", confidence: "high",
        title: `${p.date} 设备睡眠与自报相差 ${fmt(Math.abs(d - p.value), 1)} 小时`,
        detail: "两者分开保存、不会混合。差距大时通常是手表没戴整晚，或在床上醒着的时间被算作睡眠。" });
    }
  }
  const lastSteps = (s.steps ?? []).at(-1)?.date;
  if (lastSteps && lastSteps < addDays(today, -2)) {
    quality.push({ key: "steps_stale", area: "data", tone: "watch", confidence: "high",
      title: `iPhone 数据最后一次是 ${lastSteps}`,
      detail: "超过 2 天没有新的步数，Health Auto Export 自动化可能停了。打开 App 运行一次即可补齐最近 7 天。" });
  }
  if (todayLoad && todayLoad.coachingMinutes > 0 && todayLoad.coachingLoad === null) {
    quality.push({ key: "intensity_missing", area: "load", tone: "neutral", confidence: "high",
      title: "今天的教学负荷缺少强度", detail: "教学时长已从 Coachchalk 自动获取，再点一下教学强度（1–10）就能计算负荷。" });
  }

  // ---------- Focus: 1–3 things for today ----------
  if (ctx.redFlags.length) {
    focus.push({ key: "red_flag", area: "recovery", tone: "alert", confidence: "high",
      title: "你报告了需要马上就医评估的症状", detail: "请拨打 911 或前往急诊，不要等待本系统的分析。" });
    return { focus, changes, links, quality, engineVersion: ENGINE_VERSION };
  }
  const painful = ctx.pain.filter((p) => (p.severity ?? 0) >= 4);
  if (painful.length) {
    focus.push({ key: "pain", area: "recovery", tone: "watch", confidence: "high",
      title: `${painful.map((p) => p.area).join("、")}疼痛：今天避开会加重它的动作`,
      detail: "示范时减少该部位的爆发动作。持续超过 3 天、夜间痛或肿胀，请找医生或物理治疗师评估。" });
  }
  const lastNight = sleep.find((p) => p.date === today);
  const sleepCmp = compareRecent(sleep, today);
  if (lastNight && (lastNight.value < 6 || (sleepCmp && lastNight.value < sleepCmp.baseline - 1))) {
    focus.push({ key: "short_sleep", area: "sleep", tone: "watch", confidence: sleepCmp ? "high" : "medium",
      title: `昨晚只睡了 ${fmt(lastNight.value, 1)} 小时`,
      detail: (sleepCmp ? `比你平常（${fmt(sleepCmp.baseline, 1)} 小时）少。` : "")
        + "今天高强度示范量力而行，下午 2 点后少喝咖啡，今晚争取提前 30 分钟上床。" });
  }
  if (ratio !== null && ratio > 1.3) {
    focus.push({ key: "load_high", area: "load", tone: "watch", confidence: "medium",
      title: "本周负荷上升较快，留出一天轻量日", detail: `近 7 天/4 周负荷比 ${ratio.toFixed(2)}。有课的话减少自己陪打和喂球量。` });
  }
  const water = s.water?.find((p) => p.date === addDays(today, -1));
  if (ctx.waterTargetMl && water && water.value < ctx.waterTargetMl * 0.6) {
    focus.push({ key: "water_low", area: "nutrition", tone: "neutral", confidence: "medium",
      title: "昨天饮水明显少于目标", detail: `昨天记录 ${fmt(water.value, 0)} mL，目标 ${fmt(ctx.waterTargetMl, 0)} mL。上课前后各一瓶水最容易做到。` });
  }
  if (ctx.goal === "weight" && !(s.body_mass ?? []).some((p) => p.date >= addDays(today, -6))) {
    focus.push({ key: "weigh_in", area: "body", tone: "neutral", confidence: "high",
      title: "这周还没称体重", detail: "明早起床、如厕后称一次。体重目标需要每周约 3 次称重才能看清趋势。" });
  }
  for (const f of changes) if (focus.length < 3 && f.tone === "watch" && !focus.some((x) => x.area === f.area)) focus.push(f);
  for (const f of changes) if (focus.length < 3 && f.tone === "good" && !focus.some((x) => x.key === f.key)) focus.push(f);
  return { focus: focus.slice(0, 3), changes, links, quality, engineVersion: ENGINE_VERSION };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "数据充分", medium: "数据尚可", low: "仅供参考" };
