// Data completeness, judged by what the data lets the system do for your goal, not by how many
// fields are filled. Pure functions over coverage counts so the rules are testable.

export type Goal = "sleep" | "weight" | "performance" | "recovery" | "general";
export type Status = "ready" | "partial" | "missing";
export type Acquisition = "auto" | "auto_with_device" | "quick_manual" | "optional";

export const GOAL_LABELS: Record<Goal, string> = {
  sleep: "改善睡眠", weight: "体重管理", performance: "运动表现", recovery: "恢复与少伤病", general: "整体健康",
};

/** What the engine knows about the last 28 days (counts of days with data unless stated). */
export interface Coverage {
  days: number; // window length, normally 28
  weighIns: number;
  weighInSpanDays: number; // first to last weigh-in in the window
  sleepNights: number; // device or self-reported duration
  deviceSleepNights: number;
  wakeTimes: number; // nights with a known wake-up time
  stepsDays: number;
  teachingDays: number;
  teachingDaysWithIntensity: number;
  workouts: number;
  workoutsWithRpe: number;
  subjectiveDays: number; // readiness, energy or fatigue
  hrvDays: number;
  restingHrDays: number;
  mealDays: number; // days with at least one meal logged
  dietaryEnergyDays: number; // nutrition arriving from Apple Health
  waterDays: number;
  pairedSleepReadiness: number; // days with both sleep and readiness
  profileFields: { heightCm: boolean; birthYear: boolean; goal: boolean; usualSchedule: boolean };
  coachchalkConnected: boolean;
}

export interface Analysis {
  key: string;
  title: string;
  status: Status;
  /** Plain-language: what you get now, or what it would take. */
  summary: string;
  /** What would move it forward, phrased as one small step; null when ready. */
  next: string | null;
  acquisition: Acquisition;
  weight: number; // importance for the current goal, 0..3
}

const WEIGHTS: Record<Goal, Record<string, number>> = {
  sleep: { sleep_pattern: 3, sleep_regularity: 3, recovery_signal: 2, load_balance: 1, activity_trend: 1, weight_trend: 0, nutrition: 0, sleep_vs_recovery: 2, physiology: 1 },
  weight: { weight_trend: 3, nutrition: 3, activity_trend: 2, sleep_pattern: 1, sleep_regularity: 0, recovery_signal: 1, load_balance: 1, sleep_vs_recovery: 0, physiology: 0 },
  performance: { load_balance: 3, recovery_signal: 3, sleep_pattern: 2, sleep_regularity: 1, activity_trend: 1, weight_trend: 1, nutrition: 1, sleep_vs_recovery: 2, physiology: 2 },
  recovery: { recovery_signal: 3, load_balance: 3, sleep_pattern: 2, sleep_regularity: 1, activity_trend: 1, weight_trend: 0, nutrition: 1, sleep_vs_recovery: 2, physiology: 2 },
  general: { sleep_pattern: 2, activity_trend: 2, weight_trend: 1, recovery_signal: 1, load_balance: 1, sleep_regularity: 1, nutrition: 1, sleep_vs_recovery: 1, physiology: 1 },
};

function level(have: number, need: number, partialAt = 0.4): Status {
  if (have >= need) return "ready";
  return have >= need * partialAt ? "partial" : "missing";
}

export function analyses(c: Coverage, goal: Goal): Analysis[] {
  const w = WEIGHTS[goal];
  const list: Omit<Analysis, "weight">[] = [
    {
      key: "weight_trend", title: "体重趋势",
      status: c.weighIns >= 8 && c.weighInSpanDays >= 14 ? "ready" : c.weighIns >= 3 ? "partial" : "missing",
      summary: c.weighIns >= 8 && c.weighInSpanDays >= 14 ? `近 ${c.days} 天称了 ${c.weighIns} 次，可以看出真实趋势而不是每天的水分波动。`
        : `近 ${c.days} 天称了 ${c.weighIns} 次。每周 3 次左右、覆盖 2 周以上，就能分清趋势和日常波动。`,
      next: c.weighIns >= 8 && c.weighInSpanDays >= 14 ? null : "早上起床后称一次，一句话记录或接入智能秤（经 Apple Health 自动同步）。",
      acquisition: "quick_manual",
    },
    {
      key: "sleep_pattern", title: "睡眠时长与基线",
      status: level(c.sleepNights, 14),
      summary: c.sleepNights >= 14 ? `已有 ${c.sleepNights} 晚数据，能和你自己的基线比较。` : `已有 ${c.sleepNights}/14 晚。满 14 晚后开始和你自己的平常水平比较。`,
      next: c.sleepNights >= 14 ? null : c.deviceSleepNights ? "保持手表佩戴入睡即可。" : "起床后一句话记录「昨晚睡了几小时」，或佩戴 Apple Watch 自动记录。",
      acquisition: c.deviceSleepNights ? "auto_with_device" : "quick_manual",
    },
    {
      key: "sleep_regularity", title: "作息规律",
      status: level(c.wakeTimes, 10),
      summary: c.wakeTimes >= 10 ? `有 ${c.wakeTimes} 个起床时间，可以计算作息波动。` : `有 ${c.wakeTimes}/10 个起床时间。作息规律需要知道几点起床。`,
      next: c.wakeTimes >= 10 ? null : c.profileFields.usualSchedule ? "签到时点「按常规作息」一键填入，有变化再改。" : "在档案里填常规作息，之后签到可一键填入。",
      acquisition: "quick_manual",
    },
    {
      key: "activity_trend", title: "日常活动量",
      status: level(c.stepsDays, 20),
      summary: c.stepsDays >= 20 ? `iPhone 已自动记录 ${c.stepsDays} 天步数。` : `只有 ${c.stepsDays} 天步数。iPhone 随身就会自动记录，不需要手动输入。`,
      next: c.stepsDays >= 20 ? null : "确认 Health Auto Export 自动化在运行（数据页可以看到最近同步时间）。",
      acquisition: "auto",
    },
    {
      key: "load_balance", title: "教学 + 训练负荷",
      status: !c.coachchalkConnected ? "missing"
        : c.teachingDays === 0 ? "partial"
        : level(c.teachingDaysWithIntensity / Math.max(1, c.teachingDays), 0.7, 0.3),
      summary: !c.coachchalkConnected ? "教学时长来自 Coachchalk，目前还没有收到数据。"
        : `Coachchalk 自动提供教学时长（${c.teachingDays} 天有课）。其中 ${c.teachingDaysWithIntensity} 天有教学强度，负荷 = 时长 × 强度。`
          + (c.workouts ? ` 训练 ${c.workouts} 次，${c.workoutsWithRpe} 次有 RPE。` : ""),
      next: !c.coachchalkConnected ? "在 Coachchalk「工时」页打开「共享给 Coach Health」。"
        : c.teachingDays && c.teachingDaysWithIntensity / c.teachingDays < 0.7 ? "有课的日子点一下教学强度（1 秒，可沿用上次）。"
        : c.workouts > c.workoutsWithRpe ? "给训练补一个 RPE，训练负荷才能计算。" : null,
      acquisition: "auto",
    },
    {
      key: "recovery_signal", title: "主观恢复",
      status: level(c.subjectiveDays, 14),
      summary: c.subjectiveDays >= 14 ? `${c.subjectiveDays} 天有恢复/精力记录，能看出变化。` : `${c.subjectiveDays}/14 天有恢复感受。一键点选即可，不需要写字。`,
      next: c.subjectiveDays >= 14 ? null : "每天在「今天」页点一下恢复感受（1–5）。",
      acquisition: "quick_manual",
    },
    {
      key: "sleep_vs_recovery", title: "睡眠与恢复的关联",
      status: level(c.pairedSleepReadiness, 21, 0.5),
      summary: c.pairedSleepReadiness >= 21 ? `${c.pairedSleepReadiness} 天同时有睡眠和恢复数据，可以观察两者是否一起变化（相关不等于因果）。`
        : `需要约 21 天同时有睡眠和恢复感受，目前 ${c.pairedSleepReadiness} 天。数据少时不做结论。`,
      next: c.pairedSleepReadiness >= 21 ? null : "同一天记录睡眠和恢复感受即可，系统会自动配对。",
      acquisition: "quick_manual",
    },
    {
      key: "nutrition", title: "饮食规律",
      status: c.dietaryEnergyDays >= 14 ? "ready" : level(c.mealDays, 12),
      summary: c.dietaryEnergyDays >= 14 ? `饮食 App 经 Apple Health 同步了 ${c.dietaryEnergyDays} 天营养数据。`
        : `近 ${c.days} 天有 ${c.mealDays} 天记录了饮食。只记吃了什么和份量，不需要算热量。`,
      next: c.dietaryEnergyDays >= 14 || c.mealDays >= 12 ? null : "每天记主要的一两餐，可一键重复常吃的餐。",
      acquisition: "quick_manual",
    },
    {
      key: "physiology", title: "心率与 HRV",
      status: level(Math.max(c.hrvDays, c.restingHrDays), 14),
      summary: Math.max(c.hrvDays, c.restingHrDays) >= 14 ? "静息心率/HRV 已有足够天数建立基线。"
        : "静息心率和 HRV 需要 Apple Watch 等可穿戴设备，iPhone 本身测不到。没有设备时系统不会估算。",
      next: Math.max(c.hrvDays, c.restingHrDays) >= 14 ? null : "可选：佩戴 Apple Watch 后在 Health Auto Export 勾选心率、HRV。",
      acquisition: "auto_with_device",
    },
  ];
  return list.map((a) => ({ ...a, weight: w[a.key] ?? 1 })).sort((a, b) => b.weight - a.weight);
}

/**
 * 0–100: how much of what matters for this goal the system can already analyse.
 * Analyses with weight 0 do not count, so missing irrelevant data never lowers the score.
 */
export function readinessScore(list: Analysis[]): number {
  const value: Record<Status, number> = { ready: 1, partial: 0.5, missing: 0 };
  const total = list.reduce((a, x) => a + x.weight, 0);
  if (!total) return 0;
  return Math.round((list.reduce((a, x) => a + x.weight * value[x.status], 0) / total) * 100);
}

/** Data the current goal does not need: shown so the user knows they can skip it. */
export function notNeeded(list: Analysis[]): Analysis[] {
  return list.filter((a) => a.weight === 0);
}

/** The one or two most valuable next steps (highest weight, cheapest first). */
export function nextSteps(list: Analysis[], max = 2): Analysis[] {
  const cost: Record<Acquisition, number> = { auto: 0, quick_manual: 1, optional: 2, auto_with_device: 3 };
  return list.filter((a) => a.next && a.weight > 0)
    .sort((a, b) => b.weight - a.weight || cost[a.acquisition] - cost[b.acquisition])
    .slice(0, max);
}

export function isGoal(value: unknown): value is Goal {
  return typeof value === "string" && value in GOAL_LABELS;
}
