// Pages: Today, Log, Trends, Insights, Data, Profile. Read-heavy pages compute from the derived
// layer; every write goes through a preview or a single explicit tap.
import type { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { addDays, isIsoDate, localDate, localParts } from "../lib/time";
import { sha256Hex } from "../lib/crypto";
import { BASELINE_MIN_DAYS } from "../lib/stats";
import { recomputeAll } from "../jobs/derived";
import { analyses, GOAL_LABELS, isGoal, nextSteps, notNeeded, readinessScore, type Analysis, type Goal } from "../lib/completeness";
import { buildReport, CONFIDENCE_LABEL, ENGINE_VERSION, type Finding, type Report } from "../lib/insights";
import { parseHealthSentence, PROPOSAL_LABELS, type Proposal } from "../lib/nl-parse";
import { all, CHECKIN_FIELDS, getCoverage, getLoad, getProfile, getSeries, getWakeClocks, goalOf, lastPoint, mergeCheckin, one,
  quickObservation, quickSourceId, QUICK_METRICS, type Profile } from "./data";
import { barChart, loadChart, ring, sparkline, trendChart } from "./charts";
import { esc, page } from "./html";
import { icon, type IconName } from "./icons";

export const RED_FLAGS: Record<string, string> = {
  chest_pain: "胸痛或胸闷", severe_breathlessness: "严重呼吸困难", fainting: "晕厥或几乎晕倒", palpitations_dizzy: "心悸并伴头晕",
};
export const BODY_AREAS = ["肩", "肘", "腕", "颈", "下背", "髋", "大腿", "膝", "小腿", "跟腱/踝", "足底"];

const SERIES_METRICS = ["sleep_hours_device", "sleep_hours_self", "steps", "body_mass", "resting_heart_rate", "hrv_sdnn", "readiness",
  "energy", "fatigue", "sleep_quality", "coaching_minutes", "water", "waist_circumference", "active_energy", "dietary_energy", "protein", "meals_logged"];

const AREA: Record<string, { icon: IconName; color: string; soft: string }> = {
  sleep: { icon: "moon", color: "var(--series-sleep)", soft: "var(--series-sleep-soft)" },
  activity: { icon: "footprints", color: "var(--series-activity)", soft: "var(--series-activity-soft)" },
  load: { icon: "whistle", color: "var(--series-load)", soft: "var(--series-load-soft)" },
  body: { icon: "scale", color: "var(--series-body)", soft: "var(--series-body-soft)" },
  recovery: { icon: "battery", color: "var(--series-recovery)", soft: "var(--series-recovery-soft)" },
  nutrition: { icon: "utensils", color: "var(--series-activity)", soft: "var(--series-activity-soft)" },
  data: { icon: "layers", color: "var(--color-text-secondary)", soft: "var(--color-surface-muted)" },
};

function num(v: number | null | undefined, digits = 0) {
  return v === null || v === undefined ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
function parseJsonArray(value: unknown): unknown[] {
  try { const v = JSON.parse(typeof value === "string" ? value : "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function weekday(date: string) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00Z`).getUTCDay()];
}
function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function numIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function clock(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
}
const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");

function findingItem(f: Finding, dark = false) {
  const a = AREA[f.area] ?? AREA.data!;
  if (dark) return `<li class="focus-item ${f.tone}"><span class="dot">${icon(f.tone === "alert" ? "alert" : a.icon, 16)}</span><div><strong>${esc(f.title)}</strong><span>${esc(f.detail)}</span></div></li>`;
  const badge = f.tone === "good" ? '<span class="badge success">改善</span>' : f.tone === "watch" ? '<span class="badge warning">留意</span>'
    : f.tone === "alert" ? '<span class="badge danger">就医</span>' : '<span class="badge neutral">观察</span>';
  return `<li style="--accent:${a.color};--soft:${a.soft}"><span class="ico">${icon(a.icon, 17)}</span><div><strong>${esc(f.title)}</strong><span class="sub">${esc(f.detail)}</span></div>
<div style="display:grid;gap:4px;justify-items:end">${badge}<span class="hint">${CONFIDENCE_LABEL[f.confidence]}</span></div></li>`;
}

async function loadReport(db: D1Database, today: string, tz: string, profile: Profile | null, checkin: Record<string, unknown> | null) {
  const [series, load, wake] = await Promise.all([
    getSeries(db, addDays(today, -89), SERIES_METRICS), getLoad(db, addDays(today, -40)), getWakeClocks(db, addDays(today, -27), tz),
  ]);
  const report = buildReport({
    today, goal: goalOf(profile), series, load,
    redFlags: parseJsonArray(checkin?.red_flags).filter((f): f is string => typeof f === "string" && f in RED_FLAGS),
    pain: parseJsonArray(checkin?.pain_areas) as { area: string; severity: number | null }[],
    waterTargetMl: profile?.water_target_ml ?? null, targetWeightKg: profile?.target_weight_kg ?? null,
  }, wake);
  return { series, load, report };
}

/** Save at most one snapshot per day, and only when the analysis changed. */
async function saveSnapshot(db: D1Database, today: string, report: Report, score: number) {
  const payload = JSON.stringify({ focus: report.focus, changes: report.changes, links: report.links, quality: report.quality, score });
  const hash = await sha256Hex(payload);
  const prev = await one<{ content_sha256: string }>(db, "SELECT content_sha256 FROM insight_snapshots WHERE local_date < ? ORDER BY local_date DESC LIMIT 1", today);
  if (prev?.content_sha256 === hash) { await db.prepare("DELETE FROM insight_snapshots WHERE local_date = ?").bind(today).run(); return; }
  await db.prepare(
    `INSERT INTO insight_snapshots (local_date, content_sha256, payload, engine_version, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET content_sha256 = excluded.content_sha256, payload = excluded.payload,
       engine_version = excluded.engine_version, created_at = excluded.created_at`,
  ).bind(today, hash, payload, ENGINE_VERSION, new Date().toISOString()).run();
}

function scale(name: string, current: unknown, labels: string[], start = 1, legend = "") {
  return `<fieldset class="scale"><legend>${legend}</legend>${labels.map((l, i) => {
    const v = i + start;
    return `<label><input type="radio" name="${name}" value="${v}"${current === v ? " checked" : ""}><span>${v}${l ? `<small>${esc(l)}</small>` : ""}</span></label>`;
  }).join("")}</fieldset>`;
}

const sayBox = (placeholder = "说一句：今天体重 77 公斤，昨晚睡了七个半小时，感觉恢复不错") => `<form class="say" method="post" action="/log/sentence">
<label class="sr-only" for="say">一句话记录</label><input id="say" name="text" autocomplete="off" enterkeyhint="go" placeholder="${esc(placeholder)}" required maxlength="300">
<button class="btn primary" type="submit">${icon("sparkles", 16)}<span>识别</span></button></form>
<p class="hint" style="margin-top:6px">可以用键盘上的麦克风直接说。识别后会先给你确认，不会直接写入。</p>`;

export function registerPages(app: Hono<AppEnv>) {
  // ---------------- Today ----------------
  app.get("/", async (c) => {
    const tz = c.env.LOCAL_TIME_ZONE; const db = c.env.DB;
    const today = localDate(new Date(), tz);
    const [checkin, profile, lastIntensity] = await Promise.all([
      one<Record<string, string | number | null>>(db, "SELECT * FROM daily_checkins WHERE local_date = ?", today),
      getProfile(db),
      one<{ coaching_intensity: number }>(db, "SELECT coaching_intensity FROM daily_checkins WHERE coaching_intensity IS NOT NULL AND local_date < ? ORDER BY local_date DESC LIMIT 1", today),
    ]);
    const goal = goalOf(profile);
    const [{ series, load, report }, coverage, work, baselines] = await Promise.all([
      loadReport(db, today, tz, profile, checkin), getCoverage(db, today, profile),
      one<{ teaching_min: number; lessons: number }>(db, "SELECT teaching_min, lessons FROM work_daily WHERE local_date = ?", today),
      all<{ metric: string; median: number | null; mad: number | null; n: number }>(db, "SELECT metric, median, mad, n FROM baselines WHERE as_of_date = ? AND window_days = 28", today),
    ]);
    const list28 = analyses(coverage, goal); const score = readinessScore(list28);
    c.executionCtx.waitUntil(saveSnapshot(db, today, report, score).catch(() => undefined));
    const base = (m: string) => baselines.find((b) => b.metric === m);
    const from30 = addDays(today, -29);
    const redFlags = parseJsonArray(checkin?.red_flags).filter((f): f is string => typeof f === "string" && f in RED_FLAGS);

    // Status plates: sleep, load, body. Colour only says how complete/normal; the label says what.
    const sleepNow = lastPoint(series.sleep_hours_device)?.date === today ? lastPoint(series.sleep_hours_device) : lastPoint(series.sleep_hours_self)?.date === today ? lastPoint(series.sleep_hours_self) : null;
    const todayLoad = load.find((l) => l.date === today);
    const ratio = todayLoad?.acute7 && todayLoad.chronic28 ? todayLoad.acute7 / todayLoad.chronic28 : null;
    const w = lastPoint(series.body_mass);
    const plate = (state: "ok" | "watch" | "none") => state === "ok" ? "#9be15d" : state === "watch" ? "#ffc466" : "rgba(255,255,255,.14)";
    const plates = [
      { name: "睡眠", value: sleepNow ? `${num(sleepNow.value, 1)} 小时` : "未记录", color: plate(!sleepNow ? "none" : sleepNow.value < 6 ? "watch" : "ok") },
      { name: "负荷", value: ratio ? `7天/4周 ${ratio.toFixed(2)}` : work?.teaching_min ? `教学 ${work.teaching_min} 分钟` : "数据不足", color: plate(ratio === null ? (work?.teaching_min ? "ok" : "none") : ratio > 1.3 ? "watch" : "ok") },
      { name: "身体", value: w ? `${num(w.value, 1)} kg · ${w.date.slice(5)}` : "未记录", color: plate(w ? "ok" : "none") },
    ];

    const tile = (label: string, ic: IconName, color: string, metric: string, unit: string, digits: number, href: string) => {
      const p = lastPoint(series[metric]); const b = base(metric);
      const fresh = p && p.date >= addDays(today, -1);
      let delta = "";
      if (p && b && b.n >= BASELINE_MIN_DAYS && b.median !== null) {
        const d = p.value - b.median; const sig = Math.abs(d) > Math.max((b.mad ?? 0) * 1.4826, b.median * 0.03);
        delta = `<span class="delta ${sig ? "watch" : "neutral"}">${sig ? (d > 0 ? "↑" : "↓") : "≈"} 平常 ${num(b.median, digits)}</span>`;
      } else if (b) delta = `<span class="delta neutral">基线 ${b.n}/${BASELINE_MIN_DAYS} 天</span>`;
      return `<a class="tile${p ? "" : " missing"}" href="${href}" style="--accent:${color}"><span class="label">${icon(ic, 15)}${label}</span>
<span class="value">${p ? `${num(p.value, digits)}<small>${unit}</small>` : "暂无数据"}</span>
<span class="meta">${p ? `${fresh ? (p.date === today ? "今天" : "昨天") : p.date}` : "看看怎么获取 →"} ${delta}</span>${sparkline(series[metric] ?? [], from30, today, color)}</a>`;
    };
    const order: Record<Goal, string[]> = {
      sleep: ["sleep", "readiness", "steps", "coaching", "weight"], weight: ["weight", "steps", "sleep", "readiness", "coaching"],
      performance: ["readiness", "sleep", "coaching", "steps", "weight"], recovery: ["readiness", "sleep", "coaching", "steps", "weight"],
      general: ["sleep", "steps", "readiness", "weight", "coaching"],
    };
    const deviceSleep = (series.sleep_hours_device?.length ?? 0) > 0;
    const tiles: Record<string, string> = {
      sleep: tile(deviceSleep ? "睡眠（设备）" : "睡眠（自报）", "moon", "var(--series-sleep)", deviceSleep ? "sleep_hours_device" : "sleep_hours_self", "小时", 1, "/trends#sleep"),
      readiness: tile("主观恢复", "battery", "var(--series-recovery)", "readiness", "/5", 0, "/trends#recovery"),
      steps: tile("步数", "footprints", "var(--series-activity)", "steps", "步", 0, "/trends#activity"),
      coaching: tile("教学时长", "whistle", "var(--series-load)", "coaching_minutes", "分钟", 0, "/trends#load"),
      weight: tile("体重", "scale", "var(--series-body)", "body_mass", "kg", 1, "/trends#body"),
    };
    if ((series.resting_heart_rate?.length ?? 0) > 0) tiles.rhr = tile("静息心率", "heart", "var(--series-body)", "resting_heart_rate", "bpm", 0, "/trends#recovery");

    const pain = parseJsonArray(checkin?.pain_areas) as { area: string; severity: number }[];
    const usual = profile?.usual_bed_local && profile?.usual_wake_local;
    const emergency = redFlags.length ? `<div class="notice danger">${icon("alert", 20)}<div><strong>请立即拨打 911 或前往最近的急诊。</strong><br>
你今天报告了：${redFlags.map((f) => esc(RED_FLAGS[f])).join("、")}。这类症状需要马上由医疗人员评估，不要等待本系统的分析。</div></div>` : "";
    const steps = nextSteps(list28, 2);
    const hour = localParts(new Date(), tz).hour;
    const greet = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

    return c.html(page("今天", `${emergency}
<section class="board-wrap" aria-labelledby="hero"><div class="board">
  <div><p class="eyebrow">${esc(today)} · ${weekday(today)} · 目标：${GOAL_LABELS[goal]}</p>
  <h1 id="hero" style="margin-top:6px">${greet}，Colin</h1>
  <p class="lede">${work?.teaching_min ? `今天 Coachchalk 里有 ${work.lessons} 节课，共 ${work.teaching_min} 分钟教学。` : "今天 Coachchalk 里没有已完成的课。"}${report.focus.length ? " 今天最值得关注的是：" : ""}</p>
  ${report.focus.length ? `<ul class="focus-list">${report.focus.map((f) => findingItem(f, true)).join("")}</ul>`
    : `<p class="focus-empty">${icon("check", 14)} 今天没有需要特别留意的变化。数据越完整，提示越具体。</p>`}
  </div>
  <div class="stack" aria-label="状态总览"><div class="stack-scene" aria-hidden="true">${plates.map((p, i) => `<div class="plate p${i + 1}" style="--plate:${p.color}"></div>`).join("")}</div>
  <ul class="stack-legend">${[...plates].reverse().map((p) => `<li style="--plate:${p.color}"><i></i><span>${p.name}</span><b>${esc(p.value)}</b></li>`).join("")}</ul></div>
</div></section>

${sayBox()}

<div class="grid split">
<form class="card" method="post" action="/checkin/quick"><input type="hidden" name="local_date" value="${today}">
  <div class="card-head"><div><h2>今天感觉怎么样</h2><p>点一下就保存，空着就是“未知”。${checkin?.updated_at ? `已于 ${esc(String(checkin.updated_at).slice(11, 16))} UTC 更新。` : ""}</p></div></div>
  <div class="grid" style="gap:14px">
  ${scale("readiness", checkin?.readiness, ["很差", "偏累", "一般", "不错", "满血"], 1, "恢复感受")}
  ${scale("sleep_quality", checkin?.sleep_quality, ["很差", "", "", "", "很好"], 1, "昨晚睡眠质量")}
  ${work?.teaching_min ? scale("coaching_intensity", checkin?.coaching_intensity, ["", "", "", "", "", "", "", "", "", ""], 1, `教学强度（喂球/示范/对抗多 = 高）${lastIntensity && checkin?.coaching_intensity == null ? ` · 上次 ${lastIntensity.coaching_intensity}` : ""}`) : ""}
  </div>
  <details class="more"${pain.length || redFlags.length ? " open" : ""}><summary>睡眠时间、疲劳、酸痛与症状</summary>
  <div class="form-grid" style="margin-top:12px">
    ${deviceSleep ? `<p class="hint full">睡眠已由设备自动记录，这里可以不填。</p>` : ""}
    <label class="field">昨晚几点睡<input type="time" name="bedtime_local" value="${esc(checkin?.bedtime_local)}"></label>
    <label class="field">今早几点起<input type="time" name="waketime_local" value="${esc(checkin?.waketime_local)}"></label>
    ${usual ? `<div class="full"><button class="btn secondary sm" type="submit" name="use_usual" value="1">按常规作息 ${esc(profile!.usual_bed_local)}–${esc(profile!.usual_wake_local)} 填入</button></div>` : `<p class="hint full">在<a href="/profile">档案</a>里填常规作息后，可以一键填入。</p>`}
    <div class="full">${scale("fatigue", checkin?.fatigue, ["", "", "", "", ""], 1, "疲劳（1 不累 – 5 很累）")}</div>
    <label class="field">全天整体用力 RPE（0–10）<input type="number" inputmode="numeric" min="0" max="10" name="overall_rpe" value="${esc(checkin?.overall_rpe)}"></label>
    <label class="field">最后一杯咖啡/茶<input type="time" name="caffeine_last_local" value="${esc(checkin?.caffeine_last_local)}"></label>
    <div class="full"><span class="hint">酸痛部位</span><div class="chips">${BODY_AREAS.map((a) => `<label class="chip"><input type="checkbox" name="soreness" value="${esc(a)}"${parseJsonArray(checkin?.soreness_areas).includes(a) ? " checked" : ""}>${esc(a)}</label>`).join("")}</div></div>
    <div class="full"><span class="hint">疼痛部位（不是普通酸痛）</span><div class="chips">${BODY_AREAS.map((a) => `<label class="chip"><input type="checkbox" name="pain" value="${esc(a)}"${pain.some((p) => p.area === a) ? " checked" : ""}>${esc(a)}</label>`).join("")}</div></div>
    <label class="field">最严重疼痛（0–10）<input type="number" inputmode="numeric" min="0" max="10" name="pain_severity" value="${esc(pain[0]?.severity ?? "")}"></label>
    <div class="full"><span class="hint">今天是否出现以下症状</span><div class="chips">${Object.entries(RED_FLAGS).map(([k, v]) => `<label class="chip"><input type="checkbox" name="red_flags" value="${k}"${redFlags.includes(k) ? " checked" : ""}>${v}</label>`).join("")}</div></div>
    <label class="field full">备注<textarea name="note" rows="2">${esc(checkin?.note)}</textarea></label>
    <input type="hidden" name="details" value="1">
  </div></details>
  <div class="actions" style="margin-top:14px"><button class="btn primary" type="submit">保存</button></div>
</form>

<div class="card">
  <div class="card-head"><div><h2>系统掌握的数据</h2><p>按「${GOAL_LABELS[goal]}」目标衡量，能分析多少</p></div><a class="btn ghost sm" href="/data">详情 ${icon("arrowRight", 14)}</a></div>
  <div class="status-row">${ring(score, "可分析")}<div style="display:grid;gap:8px;min-width:0">
  ${list28.filter((a) => a.weight >= 2).slice(0, 4).map((a) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(a.title)}</span>${statusBadge(a)}</div>`).join("")}</div></div>
  ${steps.length ? `<p class="small" style="margin-top:14px;font-weight:600">下一步最有价值</p><ul class="list">${steps.map((a) => `<li><span class="ico">${icon(acqIcon(a), 16)}</span><div><span class="sub">${esc(a.next)}</span></div><span></span></li>`).join("")}</ul>` : ""}
</div>
</div>

<div class="section-title"><h2>身体变化</h2><p>点开看趋势 · 与你自己的 28 天基线比较</p></div>
<div class="tiles">${[...order[goal], ...(tiles.rhr ? ["rhr"] : [])].map((k) => tiles[k]).join("")}</div>
`, { path: "/", subtitle: "Coach Health" }));
  });

  app.post("/checkin/quick", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const tz = c.env.LOCAL_TIME_ZONE; const today = localDate(new Date(), tz);
    const day = isIsoDate(form.local_date) && form.local_date <= today ? form.local_date : today;
    const fields: Record<string, string | number | null> = {};
    for (const [k, [min, max]] of Object.entries(CHECKIN_FIELDS)) {
      if (form[k] !== undefined) fields[k] = intIn(form[k], min, max);
    }
    if (form.use_usual === "1") {
      const p = await getProfile(c.env.DB);
      if (p?.usual_bed_local && p.usual_wake_local) { fields.bedtime_local = p.usual_bed_local; fields.waketime_local = p.usual_wake_local; }
    } else if (form.details === "1") {
      fields.bedtime_local = clock(form.bedtime_local); fields.waketime_local = clock(form.waketime_local);
    }
    if (form.details === "1") {
      fields.caffeine_last_local = clock(form.caffeine_last_local);
      fields.note = typeof form.note === "string" && form.note.trim() ? form.note.trim().slice(0, 1000) : null;
    }
    await mergeCheckin(c.env.DB, day, fields, "quick");
    if (form.details === "1") {
      const areas = list(form.pain).filter((a) => BODY_AREAS.includes(a));
      const severity = intIn(form.pain_severity, 0, 10);
      await c.env.DB.prepare("UPDATE daily_checkins SET soreness_areas = ?, pain_areas = ?, red_flags = ? WHERE local_date = ?").bind(
        JSON.stringify(list(form.soreness).filter((a) => BODY_AREAS.includes(a))), JSON.stringify(areas.map((area) => ({ area, severity }))),
        JSON.stringify(list(form.red_flags).filter((f) => f in RED_FLAGS)), day).run();
    }
    await recomputeAll(c.env.DB, today);
    return c.redirect(typeof form.back === "string" && form.back.startsWith("/") ? form.back : "/", 303);
  });

  // ---------------- Log ----------------
  app.get("/log", async (c) => {
    const db = c.env.DB; const tz = c.env.LOCAL_TIME_ZONE; const today = localDate(new Date(), tz);
    const hour = localParts(new Date(), tz).hour;
    const slot = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : hour < 21 ? "dinner" : "snack";
    const [recentObs, meals, frequent, workouts, profile, waterToday] = await Promise.all([
      all<{ id: string; metric: string; value: number; unit: string; local_date: string; updated_at: string }>(db,
        `SELECT o.id, o.metric, o.value, o.unit, o.local_date, o.updated_at FROM observations o JOIN sources s ON s.id = o.source_id
         WHERE s.kind = 'quick_entry' ORDER BY o.local_date DESC, o.updated_at DESC LIMIT 8`),
      all<{ id: string; local_date: string; slot: string; description: string; size: string | null; protein_serving: number | null }>(db,
        "SELECT id, local_date, slot, description, size, protein_serving FROM meals WHERE local_date >= ? ORDER BY local_date DESC, created_at DESC LIMIT 8", addDays(today, -6)),
      all<{ description: string; slot: string; size: string | null; protein_serving: number | null; n: number }>(db,
        `SELECT description, slot, size, protein_serving, COUNT(*) AS n FROM meals WHERE local_date >= ? GROUP BY description, slot ORDER BY n DESC, MAX(created_at) DESC LIMIT 6`, addDays(today, -60)),
      all<{ id: string; name: string; local_date: string; duration_s: number; rpe: number | null; category: string }>(db,
        "SELECT id, name, local_date, duration_s, rpe, category FROM workouts WHERE local_date >= ? ORDER BY start_utc DESC LIMIT 10", addDays(today, -13)),
      getProfile(db),
      one<{ v: number | null }>(db, "SELECT value AS v FROM daily_metrics WHERE local_date = ? AND metric = 'water'", today),
    ]);
    const lastWeight = await one<{ value: number }>(db, "SELECT value FROM daily_metrics WHERE metric = 'body_mass' ORDER BY local_date DESC LIMIT 1");
    const SLOT: Record<string, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
    const SIZE: Record<string, string> = { light: "少", normal: "正常", large: "多" };
    const pending = workouts.filter((w) => w.rpe === null);
    return c.html(page("记录", `
${sayBox("例如：体重 76.8，昨晚 12 点睡 7 点起，午饭牛肉面，喝了 3 杯水")}
<div class="grid three">
  <form class="card" method="post" action="/log/quick"><input type="hidden" name="metric" value="body_mass">
    <div class="card-head"><div><h2>${icon("scale", 18)} 体重</h2><p>早上起床、如厕后称最准</p></div></div>
    <label class="field">公斤<input name="value" type="number" step="0.1" inputmode="decimal" min="25" max="300" placeholder="${lastWeight ? num(lastWeight.value, 1) : "例如 77.0"}" required></label>
    <div class="actions" style="margin-top:12px"><button class="btn primary">保存</button><span class="hint">同一天再记会覆盖</span></div></form>
  <form class="card" method="post" action="/log/quick"><input type="hidden" name="metric" value="water">
    <div class="card-head"><div><h2>${icon("droplet", 18)} 饮水</h2><p>今天已记 ${num(waterToday?.v ?? 0)} mL${profile?.water_target_ml ? ` / 目标 ${num(profile.water_target_ml)}` : ""}</p></div></div>
    <div class="chips">${[250, 500, 750].map((v) => `<button class="chip" name="value" value="${v}">+${v} mL</button>`).join("")}</div>
    <p class="hint" style="margin-top:10px">如果其他 App 已把饮水写入 Apple Health，会自动同步，两边取较大的一边，不会重复相加。</p></form>
  <form class="card" method="post" action="/log/quick"><input type="hidden" name="metric" value="waist_circumference">
    <div class="card-head"><div><h2>${icon("ruler", 18)} 腰围</h2><p>可选 · 每 2–4 周一次就够</p></div></div>
    <label class="field">厘米（肚脐高度）<input name="value" type="number" step="0.5" inputmode="decimal" min="40" max="200" required></label>
    <div class="actions" style="margin-top:12px"><button class="btn secondary">保存</button></div></form>
</div>

<form class="card" method="post" action="/log/meal">
  <div class="card-head"><div><h2>${icon("utensils", 18)} 饮食</h2><p>只记吃了什么和大概份量，不用算热量。常吃的一键重复。</p></div></div>
  ${frequent.length ? `<div class="chips" style="margin-bottom:14px">${frequent.map((m) => `<button class="chip" type="submit" name="repeat" value="${esc(JSON.stringify({ d: m.description, s: m.slot, z: m.size, p: m.protein_serving }))}">${icon("refresh", 13)} ${esc(SLOT[m.slot] ?? "")} · ${esc(m.description)}</button>`).join("")}</div>` : ""}
  <div class="form-grid">
    <label class="field">哪一餐<select name="slot">${Object.entries(SLOT).map(([k, v]) => `<option value="${k}"${k === slot ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="field">吃了什么<input name="description" maxlength="80" placeholder="例如：牛肉面 + 青菜" list="meal-history"></label>
    <datalist id="meal-history">${frequent.map((m) => `<option value="${esc(m.description)}">`).join("")}</datalist>
    <div>${radioRow("size", [["light", "少"], ["normal", "正常"], ["large", "多"]], "normal", "份量")}</div>
    <div>${radioRow("protein_serving", [["0", "几乎没有"], ["1", "一些"], ["2", "一掌以上"]], "1", "蛋白质（肉蛋奶豆）")}</div>
  </div>
  <div class="actions" style="margin-top:12px"><button class="btn primary">保存这一餐</button></div>
</form>

${pending.length ? `<form class="card" method="post" action="/workouts/rpe"><div class="card-head"><div><h2>${icon("dumbbell", 18)} 给训练打个 RPE</h2><p>Apple Health 同步来的训练缺少主观强度时，训练负荷无法计算。</p></div></div>
<ul class="list">${pending.map((w) => `<li><span class="ico">${icon("dumbbell", 16)}</span><div><strong>${esc(w.name)}</strong><span class="sub">${esc(w.local_date)} · ${Math.round(w.duration_s / 60)} 分钟</span></div>
<select name="rpe_${esc(w.id)}" aria-label="RPE" style="width:auto"><option value="">RPE</option>${Array.from({ length: 11 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}</select></li>`).join("")}</ul>
<div class="actions" style="margin-top:8px"><button class="btn primary">保存 RPE</button></div></form>` : ""}

<div class="grid two">
<div class="card"><div class="card-head"><div><h2>最近的手动记录</h2><p>记错了可以删除</p></div></div>
${recentObs.length ? `<ul class="list">${recentObs.map((o) => `<li><span class="ico">${icon(o.metric === "water" ? "droplet" : o.metric === "body_mass" ? "scale" : "ruler", 16)}</span>
<div><strong>${esc(QUICK_METRICS[o.metric]?.label ?? o.metric)} ${num(o.value, 1)} ${esc(o.unit)}</strong><span class="sub">${esc(o.local_date)}</span></div>
<form method="post" action="/log/obs/${esc(o.id)}/delete"><button class="btn ghost icon-only" aria-label="删除">${icon("trash", 15)}</button></form></li>`).join("")}</ul>` : '<p class="empty">还没有手动记录</p>'}</div>
<div class="card"><div class="card-head"><div><h2>最近 7 天饮食</h2><p>${meals.length} 条</p></div></div>
${meals.length ? `<ul class="list">${meals.map((m) => `<li><span class="ico">${icon("utensils", 16)}</span><div><strong>${esc(m.description)}</strong><span class="sub">${esc(m.local_date)} · ${esc(SLOT[m.slot] ?? m.slot)}${m.size ? ` · 份量${esc(SIZE[m.size] ?? "")}` : ""}</span></div>
<form method="post" action="/log/meal/${esc(m.id)}/delete"><button class="btn ghost icon-only" aria-label="删除">${icon("trash", 15)}</button></form></li>`).join("")}</ul>` : '<p class="empty">还没有饮食记录</p>'}</div>
</div>`, { path: "/log", subtitle: "低操作成本录入" }));
  });

  app.post("/log/quick", async (c) => {
    const form = await c.req.parseBody();
    const metric = typeof form.metric === "string" ? form.metric : "";
    const spec = QUICK_METRICS[metric];
    if (!spec) return c.text("不支持的指标", 400);
    const value = numIn(form.value, spec.min, spec.max);
    if (value === null) return c.text(`${spec.label}的数值不在合理范围（${spec.min}–${spec.max} ${spec.unit}）`, 400);
    const tz = c.env.LOCAL_TIME_ZONE; const today = localDate(new Date(), tz);
    const day = isIsoDate(form.local_date) && form.local_date <= today ? form.local_date : today;
    await quickObservation(c.env.DB, await quickSourceId(c.env.DB), metric, value, day, new Date(), "form").run();
    await recomputeAll(c.env.DB, today);
    return c.redirect("/log", 303);
  });

  app.post("/log/obs/:id/delete", async (c) => {
    // Only entries typed in this app can be deleted here; device data is removed per source on the privacy page.
    await c.env.DB.prepare("DELETE FROM observations WHERE id = ? AND source_id IN (SELECT id FROM sources WHERE kind = 'quick_entry')").bind(c.req.param("id")).run();
    await recomputeAll(c.env.DB, localDate(new Date(), c.env.LOCAL_TIME_ZONE));
    return c.redirect("/log", 303);
  });

  app.post("/log/meal", async (c) => {
    const form = await c.req.parseBody();
    const tz = c.env.LOCAL_TIME_ZONE; const today = localDate(new Date(), tz);
    let desc = typeof form.description === "string" ? form.description.trim().slice(0, 80) : "";
    let slot = typeof form.slot === "string" ? form.slot : "snack";
    let size = typeof form.size === "string" ? form.size : null;
    let protein = intIn(form.protein_serving, 0, 2);
    let method = "form";
    if (typeof form.repeat === "string") {
      try { const r = JSON.parse(form.repeat) as { d: string; s: string; z: string | null; p: number | null }; desc = String(r.d).slice(0, 80); slot = r.s; size = r.z; protein = r.p; method = "repeat"; } catch { /* ignore */ }
    }
    if (!desc) return c.text("请写下吃了什么", 400);
    if (!["breakfast", "lunch", "dinner", "snack"].includes(slot)) slot = "snack";
    if (size !== null && !["light", "normal", "large"].includes(size)) size = null;
    await c.env.DB.prepare("INSERT INTO meals (id, local_date, slot, description, size, protein_serving, entry_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), today, slot, desc, size, protein, method, new Date().toISOString()).run();
    await recomputeAll(c.env.DB, today);
    return c.redirect("/log", 303);
  });

  app.post("/log/meal/:id/delete", async (c) => {
    await c.env.DB.prepare("DELETE FROM meals WHERE id = ?").bind(c.req.param("id")).run();
    await recomputeAll(c.env.DB, localDate(new Date(), c.env.LOCAL_TIME_ZONE));
    return c.redirect("/log", 303);
  });

  app.post("/workouts/rpe", async (c) => {
    const form = await c.req.parseBody();
    const statements = Object.entries(form).filter(([k]) => k.startsWith("rpe_")).map(([k, v]) => [k.slice(4), intIn(v, 0, 10)] as const)
      .filter(([, v]) => v !== null).map(([id, v]) => c.env.DB.prepare("UPDATE workouts SET rpe = ? WHERE id = ?").bind(v, id));
    if (statements.length) await c.env.DB.batch(statements);
    await recomputeAll(c.env.DB, localDate(new Date(), c.env.LOCAL_TIME_ZONE));
    return c.redirect("/log", 303);
  });

  // One sentence -> preview -> confirm. Nothing is written by the first step.
  app.post("/log/sentence", async (c) => {
    const form = await c.req.parseBody();
    const text = typeof form.text === "string" ? form.text.slice(0, 300) : "";
    const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
    const { proposals, leftovers } = parseHealthSentence(text, today);
    const SLOT: Record<string, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
    const row = (p: Proposal, i: number) => {
      const input = typeof p.value === "number"
        ? `<input name="v${i}" value="${esc(p.value)}" inputmode="decimal" style="max-width:120px" aria-label="${PROPOSAL_LABELS[p.kind]}">`
        : `<input name="v${i}" value="${esc(p.value)}" maxlength="80" aria-label="${PROPOSAL_LABELS[p.kind]}">`;
      return `<li><label class="chip" style="border:0;padding:0"><input type="checkbox" name="use" value="${i}" checked><span class="sr-only">保存</span></label>
<div><strong>${PROPOSAL_LABELS[p.kind]}${p.kind === "meal" ? ` · ${SLOT[p.detail ?? ""] ?? ""}` : ""}</strong><span class="sub">“${esc(p.evidence)}” → ${esc(p.date)}${p.detail && p.kind !== "meal" ? ` · ${esc(p.detail)}` : ""}</span>
<input type="hidden" name="k${i}" value="${p.kind}"><input type="hidden" name="d${i}" value="${esc(p.date)}"><input type="hidden" name="x${i}" value="${esc(p.detail ?? "")}"></div>
<div class="actions">${input}<span class="hint">${esc(p.unit)}</span></div></li>`;
    };
    return c.html(page("确认记录", `<form class="card" method="post" action="/log/confirm">
<div class="card-head"><div><h2>识别结果</h2><p>“${esc(text)}”</p></div></div>
${proposals.length ? `<ul class="list">${proposals.map(row).join("")}</ul>` : '<p class="empty">没有识别出可以记录的数值。可以换个说法，例如「体重 77 公斤」「睡了 7 小时」。</p>'}
${leftovers.length ? `<div class="notice info" style="margin-top:12px">${icon("info", 18)}<div>这些内容没有识别为数据，不会保存：${leftovers.map((l) => `“${esc(l)}”`).join("、")}</div></div>` : ""}
<input type="hidden" name="n" value="${proposals.length}">
<div class="actions" style="margin-top:16px">${proposals.length ? '<button class="btn primary">确认保存</button>' : ""}<a class="btn ghost" href="/log">取消</a></div>
</form>`, { path: "/log", subtitle: "一句话记录" }));
  });

  app.post("/log/confirm", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const db = c.env.DB; const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
    const use = new Set(list(form.use));
    const n = intIn(form.n, 0, 40) ?? 0;
    const sourceId = await quickSourceId(db);
    const checkins = new Map<string, Record<string, string | number | null>>();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      if (!use.has(String(i))) continue;
      const kind = String(form[`k${i}`] ?? ""); const day = String(form[`d${i}`] ?? ""); const raw = form[`v${i}`];
      if (!isIsoDate(day) || day > today || day < addDays(today, -7)) continue;
      const ci = checkins.get(day) ?? {}; checkins.set(day, ci);
      const metricFor: Record<string, string> = { weight: "body_mass", waist: "waist_circumference", water: "water" };
      if (metricFor[kind]) {
        const spec = QUICK_METRICS[metricFor[kind]!]!; const v = numIn(raw, spec.min, spec.max);
        if (v !== null) statements.push(quickObservation(db, sourceId, metricFor[kind]!, v, day, new Date(), "sentence"));
      } else if (kind === "sleep_hours") { const v = numIn(raw, 0.5, 16); if (v !== null) ci.sleep_hours_self = v; }
      else if (kind === "bedtime") { const v = clock(raw); if (v) ci.bedtime_local = v; }
      else if (kind === "waketime") { const v = clock(raw); if (v) ci.waketime_local = v; }
      else if (kind in CHECKIN_FIELDS) { const [min, max] = CHECKIN_FIELDS[kind as keyof typeof CHECKIN_FIELDS]; const v = intIn(raw, min, max); if (v !== null) ci[kind] = v; }
      else if (kind === "meal" && typeof raw === "string" && raw.trim()) {
        const slot = ["breakfast", "lunch", "dinner", "snack"].includes(String(form[`x${i}`])) ? String(form[`x${i}`]) : "snack";
        statements.push(db.prepare("INSERT INTO meals (id, local_date, slot, description, size, protein_serving, entry_method, created_at) VALUES (?, ?, ?, ?, NULL, NULL, 'sentence', ?)")
          .bind(crypto.randomUUID(), day, slot, raw.trim().slice(0, 80), new Date().toISOString()));
      }
    }
    if (statements.length) await db.batch(statements);
    for (const [day, fields] of checkins) await mergeCheckin(db, day, fields, "sentence");
    await recomputeAll(db, today);
    return c.redirect("/?saved=1", 303);
  });

  // ---------------- Trends ----------------
  app.get("/trends", async (c) => {
    const db = c.env.DB; const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
    const range = [30, 90, 365].includes(Number(c.req.query("range"))) ? Number(c.req.query("range")) : 30;
    const from = addDays(today, -(range - 1));
    const [series, load, baselines, profile] = await Promise.all([
      getSeries(db, from, SERIES_METRICS), getLoad(db, from),
      all<{ metric: string; median: number | null; mad: number | null; n: number }>(db, "SELECT metric, median, mad, n FROM baselines WHERE as_of_date = ? AND window_days = 28", today),
      getProfile(db),
    ]);
    const band = (m: string) => {
      const b = baselines.find((x) => x.metric === m);
      if (!b || b.n < BASELINE_MIN_DAYS || b.median === null) return null;
      const s = (b.mad ?? 0) * 1.4826;
      return { low: b.median - s, high: b.median + s, label: "28 天基线" };
    };
    const stat = (m: string, digits: number, unit: string) => {
      const v = (series[m] ?? []).map((p) => p.value); if (!v.length) return `<span class="muted">这段时间没有数据</span>`;
      const avg = v.reduce((a, b) => a + b, 0) / v.length;
      return `<span><b class="num">${num(avg, digits)}</b> ${unit} 平均</span><span>${v.length}/${range} 天有数据</span>`;
    };
    const empty = (why: string) => `<div class="empty">${why}</div>`;
    const deviceSleep = (series.sleep_hours_device?.length ?? 0) > 0;
    const sleepMetric = deviceSleep ? "sleep_hours_device" : "sleep_hours_self";
    const card = (id: string, title: string, sub: string, body: string, meta: string) =>
      `<section class="card" id="${id}"><div class="card-head"><div><h2>${title}</h2><p>${sub}</p></div></div>${body}<div class="chart-meta">${meta}</div></section>`;
    const tabs = `<div class="range-tabs" role="tablist">${[30, 90, 365].map((r) => `<a href="/trends?range=${r}" aria-current="${r === range}">${r === 365 ? "1 年" : `${r} 天`}</a>`).join("")}</div>`;
    const loadHas = load.some((l) => l.coachingMinutes > 0 || l.trainingMinutes > 0);
    return c.html(page("趋势", `
<div class="grid two">
${card("sleep", `${icon("moon", 18)} 睡眠`, deviceSleep ? "设备测量；自报睡眠单独保存，不混用" : "自报（签到或一句话记录）",
  (series[sleepMetric]?.length ? barChart({ points: series[sleepMetric]!, from, to: today, color: "var(--series-sleep)", label: "每晚睡眠", unit: "小时", digits: 1, band: band(sleepMetric) }) : empty("还没有睡眠数据。起床后一句话记录「昨晚睡了几小时」，或佩戴 Apple Watch 自动记录。")),
  `${stat(sleepMetric, 1, "小时")}<span><i class="legend-band"></i>灰带 = 你 28 天的平常范围</span>`)}
${card("body", `${icon("scale", 18)} 体重`, "圆点为每次称重，线为 7 天平均（平滑掉每天的水分波动）",
  (series.body_mass?.length ? trendChart({ points: series.body_mass!, from, to: today, color: "var(--series-body)", label: "体重", unit: "kg", digits: 1, target: profile?.target_weight_kg ?? null }) : empty("还没有体重数据。在「记录」里输入，或用支持 Apple Health 的智能秤自动同步。")),
  stat("body_mass", 1, "kg"))}
${card("activity", `${icon("footprints", 18)} 步数`, "iPhone 自动记录（经 Health Auto Export）",
  (series.steps?.length ? barChart({ points: series.steps!, from, to: today, color: "var(--series-activity)", label: "每日步数", unit: "步", band: band("steps") }) : empty("还没有步数。确认 Health Auto Export 自动化已配置。")),
  stat("steps", 0, "步"))}
${card("recovery", `${icon("battery", 18)} 主观恢复`, "1 很差 – 5 满血；线为 7 天平均",
  (series.readiness?.length ? trendChart({ points: series.readiness!, from, to: today, color: "var(--series-recovery)", label: "恢复感受", unit: "分", digits: 1 }) : empty("每天在「今天」页点一下恢复感受，两周后就能看到变化。")),
  stat("readiness", 1, "分"))}
</div>
${card("load", `${icon("whistle", 18)} 教学 + 训练负荷`, "柱 = 每日负荷（橙：教学时长×强度；青：训练时长×RPE），线 = 7 天平均。小圆点 = 当天有课但缺少强度",
  loadHas ? loadChart(load, from, today) : empty("还没有教学或训练数据。教学时长来自 Coachchalk 工时共享。"),
  `<span><i style="background:var(--series-load)"></i>教学</span><span><i style="background:var(--series-recovery)"></i>训练</span><span><i style="background:var(--color-brand)"></i>7 天平均</span>`)}
${(series.resting_heart_rate?.length || series.hrv_sdnn?.length) ? card("heart", `${icon("heart", 18)} 静息心率`, "来自 Apple Watch",
  trendChart({ points: series.resting_heart_rate ?? [], from, to: today, color: "var(--series-body)", label: "静息心率", unit: "bpm", digits: 0, band: band("resting_heart_rate") }), stat("resting_heart_rate", 0, "bpm"))
  : `<div class="notice">${icon("watch", 18)}<div><strong>心率、HRV 与夜间心率需要可穿戴设备</strong><br><span class="muted small">iPhone 本身测不到。系统不会估算这些数值；佩戴 Apple Watch 后会自动出现在这里。</span></div></div>`}
`, { path: "/trends", subtitle: `最近 ${range === 365 ? "1 年" : `${range} 天`}`, actions: tabs }));
  });

  // ---------------- Insights ----------------
  app.get("/insights", async (c) => {
    const db = c.env.DB; const tz = c.env.LOCAL_TIME_ZONE; const today = localDate(new Date(), tz);
    const [profile, checkin] = await Promise.all([getProfile(db), one<Record<string, unknown>>(db, "SELECT * FROM daily_checkins WHERE local_date = ?", today)]);
    const { report } = await loadReport(db, today, tz, profile, checkin);
    const history = await all<{ local_date: string; payload: string }>(db, "SELECT local_date, payload FROM insight_snapshots WHERE local_date < ? ORDER BY local_date DESC LIMIT 20", today);
    const block = (title: string, sub: string, items: Finding[], emptyText: string) =>
      `<section class="card"><div class="card-head"><div><h2>${title}</h2><p>${sub}</p></div></div>${items.length ? `<ul class="list">${items.map((f) => findingItem(f)).join("")}</ul>` : `<p class="empty">${emptyText}</p>`}</section>`;
    return c.html(page("洞察", `
<div class="notice info">${icon("info", 18)}<div><strong>怎么得出的</strong><br><span class="small">所有数字由确定性规则计算：和你自己 28 天的中位数比较、线性趋势、秩相关。数据不足时直接说明，不做结论；相关不代表因果。不是医疗诊断。</span></div></div>
${block("今天最值得关注", "最多 3 条", report.focus, "今天没有需要特别留意的事情。")}
<div class="grid two">
${block("最近的变化", "近 7 天 vs 之前 4 周", report.changes, "变化不明显，或数据还不够（需要近 7 天至少 4 天、之前至少 14 天）。")}
${block("可能的关联", "近 60 天，至少 21 天配对数据", report.links, "配对数据不足 21 天，暂不分析关联。")}
</div>
${block("数据质量", "缺失、异常、来源不一致", report.quality, "没有发现数据问题。")}
<section class="card"><div class="card-head"><div><h2>分析历史</h2><p>只在结论发生变化的日子保存一份，不会每天重复生成报告</p></div></div>
${history.length ? history.map((h) => { const p = JSON.parse(h.payload) as { focus: Finding[]; changes: Finding[] };
  return `<details class="more" style="margin-top:0"><summary>${esc(h.local_date)} · ${p.focus.length} 条重点 · ${p.changes.length} 条变化</summary><ul class="list">${[...p.focus, ...p.changes].map((f) => findingItem(f)).join("")}</ul></details>`; }).join("")
  : '<p class="empty">还没有历史记录。</p>'}</section>`, { path: "/insights", subtitle: "Health Intelligence" }));
  });

  // ---------------- Data completeness + sources ----------------
  app.get("/data", async (c) => {
    const db = c.env.DB; const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
    const profile = await getProfile(db); const goal = goalOf(profile);
    const [coverage, sources, batches, jobs, metricCoverage] = await Promise.all([
      getCoverage(db, today, profile),
      all<{ id: string; kind: string; name: string; last_seen_at: string | null; revoked_at: string | null }>(db, "SELECT id, kind, name, last_seen_at, revoked_at FROM sources ORDER BY created_at"),
      all<{ received_at: string; status: string; records_upserted: number | null; records_skipped: number | null; error: string | null; name: string }>(db,
        "SELECT b.received_at, b.status, b.records_upserted, b.records_skipped, b.error, s.name FROM ingest_batches b JOIN sources s ON s.id = b.source_id ORDER BY b.received_at DESC LIMIT 8"),
      all<{ run_key: string; status: string; detail: string | null }>(db, "SELECT run_key, status, detail FROM job_runs WHERE job = 'hourly' ORDER BY ran_at DESC LIMIT 1"),
      all<{ metric: string; d30: number; last: string }>(db, "SELECT metric, SUM(local_date >= ?) AS d30, MAX(local_date) AS last FROM daily_metrics WHERE local_date >= ? GROUP BY metric ORDER BY metric", addDays(today, -29), addDays(today, -89)),
    ]);
    const list28 = analyses(coverage, goal); const score = readinessScore(list28); const skip = notNeeded(list28);
    const hae = sources.filter((s) => s.kind === "health_auto_export" && !s.revoked_at);
    const haeLast = hae.map((s) => s.last_seen_at).filter(Boolean).sort().at(-1) ?? null;
    const job = jobs[0]; const coach = job?.detail ? (JSON.parse(job.detail) as { coachchalk?: string }).coachchalk : undefined;
    const ago = (iso: string | null) => { if (!iso) return "从未"; const h = (Date.now() - Date.parse(iso)) / 3_600_000; return h < 1 ? "1 小时内" : h < 48 ? `${Math.round(h)} 小时前` : `${Math.round(h / 24)} 天前`; };
    type Src = { name: string; ic: IconName; status: "live" | "available" | "stale" | "setup" | "device" | "planned" | "na"; detail: string };
    const catalog: Src[] = [
      { name: "iPhone 健康数据（Health Auto Export）", ic: "phone", status: !hae.length ? "setup" : haeLast && Date.now() - Date.parse(haeLast) < 48 * 3_600_000 ? "live" : "stale",
        detail: hae.length ? `最近收到：${ago(haeLast)}。步数、距离、活动能量、体重、饮水，以及任何写入 Apple Health 的饮食数据。` : "需要在数据源令牌页生成令牌，并在 iPhone 上配置自动化。" },
      { name: "Coachchalk 工时", ic: "whistle", status: coach === "ok" ? "live" : coach ? "setup" : "setup",
        detail: coach === "ok" ? `每小时自动同步教学时长（最近一次 ${esc(job!.run_key.replace("T", " "))}:07 UTC）。` : coach === "not_granted" ? "需要在 Coachchalk「工时」页打开「共享给 Coach Health」。" : "尚未运行或未配置。" },
      { name: "手动 + 一句话记录", ic: "sparkles", status: "available", detail: "体重、饮水、腰围、睡眠、恢复感受、饮食。都会先给你确认。" },
      { name: "历史文件导入", ic: "file", status: "available", detail: "Health Auto Export 手动导出的 JSON。重复上传同一文件会被识别，不会重复导入。" },
      { name: "Apple Watch：睡眠阶段、心率、HRV、血氧", ic: "watch", status: coverage.hrvDays || coverage.deviceSleepNights ? "live" : "device", detail: "需要佩戴设备。接收与解析已经就绪，戴上后在 Health Auto Export 勾选对应指标即可。" },
      { name: "智能秤 / 血压计（经 Apple Health）", ic: "scale", status: "device", detail: "任何能写入 Apple Health 的设备都会自动同步，不需要单独对接。" },
      { name: "饮食拍照识别、健康报告/截图识别", ic: "camera", status: "planned", detail: "尚未实现。需要先确定识别服务与数据保留方式，实现前不会显示上传入口。" },
      { name: "Health Connect（Android）", ic: "phone", status: "na", detail: "只在 Android 手机上可用，并且需要原生 App，你使用 iPhone，暂不适用。" },
    ];
    const SRC_BADGE: Record<Src["status"], string> = {
      live: '<span class="badge success">已连接</span>', available: '<span class="badge brand">可用</span>', stale: '<span class="badge warning">同步中断</span>', setup: '<span class="badge info">待设置</span>',
      device: '<span class="badge neutral">需要设备</span>', planned: '<span class="badge neutral">规划中</span>', na: '<span class="badge neutral">不适用</span>',
    };
    const LABELS: Record<string, string> = { steps: "步数", walking_running_distance: "步行+跑步距离", flights_climbed: "爬楼", active_energy: "活动能量", basal_energy: "静息能量",
      resting_heart_rate: "静息心率", hrv_sdnn: "HRV", heart_rate: "心率", body_mass: "体重", body_fat_pct: "体脂率", waist_circumference: "腰围", walking_speed: "步行速度",
      walking_step_length: "步长", walking_asymmetry_pct: "步行不对称", walking_double_support_pct: "双脚支撑", water: "饮水", vo2_max: "VO2 max", bp_systolic: "收缩压",
      bp_diastolic: "舒张压", sleep_hours_device: "睡眠（设备）", sleep_hours_self: "睡眠（自报）", coaching_minutes: "教学时长", work_total_minutes: "总工时",
      readiness: "恢复感受", energy: "精力", fatigue: "疲劳", sleep_quality: "睡眠质量", meals_logged: "饮食记录", dietary_energy: "饮食热量", protein: "蛋白质",
      carbohydrates: "碳水", total_fat: "脂肪", exercise_minutes: "锻炼分钟", spo2_pct: "血氧", respiratory_rate: "呼吸频率" };
    const groups: [string, Analysis[]][] = [["对你的目标最重要", list28.filter((a) => a.weight >= 3)], ["有帮助", list28.filter((a) => a.weight > 0 && a.weight < 3)]];
    return c.html(page("数据", `
<section class="card"><div class="status-row">${ring(score, "可分析")}<div style="display:grid;gap:6px">
<h2>系统现在能为你做什么</h2>
<p class="muted">按当前目标「${GOAL_LABELS[goal]}」衡量，近 28 天的数据能支持 ${score}% 的关键分析。这不是任务清单：缺少的部分只是意味着那项分析暂时给不出可靠结论。</p>
<div class="actions"><a class="btn secondary sm" href="/profile">更换目标</a><a class="btn ghost sm" href="/log">去记录</a></div></div></div></section>
${groups.map(([title, items]) => items.length ? `<section class="card"><div class="card-head"><div><h2>${title}</h2></div></div><ul class="list">${items.map((a) => `<li><span class="ico">${icon(acqIcon(a), 16)}</span>
<div><strong>${esc(a.title)}</strong><span class="sub">${esc(a.summary)}</span>${a.next ? `<span class="sub" style="color:var(--color-text);margin-top:4px">→ ${esc(a.next)}</span>` : ""}</div>
<div style="display:grid;gap:4px;justify-items:end">${statusBadge(a)}<span class="hint">${ACQ_LABEL[a.acquisition]}</span></div></li>`).join("")}</ul></section>` : "").join("")}
${skip.length ? `<div class="notice">${icon("check", 18)}<div><strong>当前目标下可以不收集</strong><br><span class="muted small">${skip.map((a) => esc(a.title)).join("、")}。有了也会使用，但不记录不会影响你的分析。</span></div></div>` : ""}
<section class="card"><div class="card-head"><div><h2>数据来源</h2><p>系统自动在处理什么，以及哪些还需要你做</p></div><a class="btn ghost sm" href="/import">${icon("upload", 14)} 导入历史</a></div>
<ul class="list">${catalog.map((s) => `<li><span class="ico">${icon(s.ic, 16)}</span><div><strong>${esc(s.name)}</strong><span class="sub">${s.detail}</span></div>${SRC_BADGE[s.status]}</li>`).join("")}</ul></section>
<div class="grid two">
<section class="card"><div class="card-head"><div><h2>各指标覆盖</h2><p>近 30 天有数据的天数 · 缺失不会被补值</p></div></div><div class="table-wrap"><table><tr><th>指标</th><th>近 30 天</th><th>最近一天</th></tr>
${metricCoverage.map((r) => `<tr><td>${esc(LABELS[r.metric] ?? r.metric)}</td><td>${r.d30}</td><td>${esc(r.last)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">还没有数据</td></tr>'}</table></div></section>
<section class="card"><div class="card-head"><div><h2>最近收到的数据包</h2><p>写入/跳过条数（跳过 = 不在白名单或格式不对）</p></div></div><div class="table-wrap"><table><tr><th>时间 (UTC)</th><th>来源</th><th>状态</th><th>写入/跳过</th></tr>
${batches.map((b) => `<tr><td>${esc(b.received_at.slice(5, 16).replace("T", " "))}</td><td>${esc(b.name)}</td><td>${b.status === "processed" ? '<span class="badge success">完成</span>' : b.status === "failed" ? `<span class="badge danger" title="${esc(b.error ?? "")}">失败</span>` : `<span class="badge neutral">${esc(b.status)}</span>`}</td><td>${b.records_upserted ?? "—"} / ${b.records_skipped ?? "—"}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">还没有收到数据</td></tr>'}
</table></div></section></div>`, { path: "/data", subtitle: "完整性 · 来源 · 质量" }));
  });

  // ---------------- Profile & goals ----------------
  app.get("/profile", async (c) => {
    const db = c.env.DB;
    const [p, goals] = await Promise.all([getProfile(db), all<{ primary_goal: string; started_on: string; ended_on: string | null; target_weight_kg: number | null }>(db,
      "SELECT primary_goal, started_on, ended_on, target_weight_kg FROM goal_history ORDER BY started_on DESC LIMIT 10")]);
    const v = (k: keyof Profile) => esc(p?.[k] ?? "");
    const opt = (name: keyof Profile, options: [string, string][], blank = "不填") => `<select name="${name}"><option value="">${blank}</option>${options.map(([k, l]) => `<option value="${k}"${p?.[name] === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    return c.html(page("档案与目标", `<form class="card" method="post" action="/profile">
<div class="card-head"><div><h2>健康目标</h2><p>决定哪些数据和分析对你最重要。可以随时更换，历史会保留。</p></div></div>
<div class="form-grid">
  <label class="field">主要目标${opt("primary_goal", Object.entries(GOAL_LABELS) as [string, string][], "整体健康（默认）")}</label>
  <label class="field">次要目标${opt("secondary_goal", Object.entries(GOAL_LABELS) as [string, string][])}</label>
  <label class="field">目标体重（kg，可选）<input name="target_weight_kg" type="number" step="0.1" inputmode="decimal" value="${v("target_weight_kg")}"></label>
  <label class="field">每日饮水目标（mL，可选）<input name="water_target_ml" type="number" step="100" inputmode="numeric" value="${v("water_target_ml")}"></label>
</div>
<h2 style="margin-top:24px">作息与运动</h2>
<div class="form-grid" style="margin-top:12px">
  <label class="field">常规入睡时间<input name="usual_bed_local" type="time" value="${v("usual_bed_local")}"></label>
  <label class="field">常规起床时间<input name="usual_wake_local" type="time" value="${v("usual_wake_local")}"></label>
  <label class="field">日常活动水平${opt("activity_level", [["low", "久坐为主"], ["moderate", "中等"], ["high", "活跃（每天站立教学）"], ["athlete", "运动员级"]])}</label>
  <label class="field">每周自己训练几天<input name="training_days_per_week" type="number" min="0" max="7" inputmode="numeric" value="${v("training_days_per_week")}"></label>
</div>
<h2 style="margin-top:24px">基础资料 <span class="badge neutral">全部可选</span></h2>
<p class="hint" style="margin-top:4px">只用于参考范围（例如 BMI、蛋白质建议）。不填不影响使用，也不会与任何人共享。</p>
<div class="form-grid" style="margin-top:12px">
  <label class="field">出生年份<input name="birth_year" type="number" min="1920" max="2020" inputmode="numeric" value="${v("birth_year")}"></label>
  <label class="field">身高（cm）<input name="height_cm" type="number" step="0.5" min="100" max="230" inputmode="decimal" value="${v("height_cm")}"></label>
  <label class="field">生理性别（用于参考范围）${opt("sex", [["male", "男"], ["female", "女"], ["unspecified", "不想说"]])}</label>
  <label class="field">每日蛋白质目标（g，可选）<input name="protein_target_g" type="number" inputmode="numeric" value="${v("protein_target_g")}"></label>
</div>
<div class="actions" style="margin-top:18px"><button class="btn primary">保存档案</button></div></form>
${goals.length ? `<section class="card"><div class="card-head"><div><h2>目标历史</h2></div></div><ul class="list">${goals.map((g) => `<li><span class="ico">${icon("today", 16)}</span><div><strong>${esc(GOAL_LABELS[g.primary_goal as Goal] ?? g.primary_goal)}${g.target_weight_kg ? ` · ${num(g.target_weight_kg, 1)} kg` : ""}</strong><span class="sub">${esc(g.started_on)} – ${esc(g.ended_on ?? "至今")}</span></div><span></span></li>`).join("")}</ul></section>` : ""}
<div class="notice">${icon("shield", 18)}<div><strong>隐私</strong><br><span class="small muted">Coach Health 的数据默认不对任何人开放，包括你的教练账号、学生和家长。未来接入 Coachchalk 共享时，需要你逐项授权，可以随时撤回。</span></div></div>`,
    { path: "/profile", subtitle: "设置" }));
  });

  app.post("/profile", async (c) => {
    const f = await c.req.parseBody(); const db = c.env.DB;
    const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
    const pick = (k: string, allowed: string[]) => typeof f[k] === "string" && allowed.includes(f[k] as string) ? f[k] as string : null;
    const goal = isGoal(f.primary_goal) ? f.primary_goal : null; const second = isGoal(f.secondary_goal) ? f.secondary_goal : null;
    const target = numIn(f.target_weight_kg, 30, 250);
    const prev = await getProfile(db);
    await db.prepare(
      `INSERT INTO profile (id, birth_year, sex, height_cm, primary_goal, secondary_goal, target_weight_kg, activity_level, usual_bed_local, usual_wake_local,
         training_days_per_week, water_target_ml, protein_target_g, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET birth_year = excluded.birth_year, sex = excluded.sex, height_cm = excluded.height_cm, primary_goal = excluded.primary_goal,
         secondary_goal = excluded.secondary_goal, target_weight_kg = excluded.target_weight_kg, activity_level = excluded.activity_level,
         usual_bed_local = excluded.usual_bed_local, usual_wake_local = excluded.usual_wake_local, training_days_per_week = excluded.training_days_per_week,
         water_target_ml = excluded.water_target_ml, protein_target_g = excluded.protein_target_g, updated_at = excluded.updated_at`,
    ).bind(intIn(f.birth_year, 1920, 2020), pick("sex", ["male", "female", "unspecified"]), numIn(f.height_cm, 100, 230), goal, second, target,
      pick("activity_level", ["low", "moderate", "high", "athlete"]), clock(f.usual_bed_local), clock(f.usual_wake_local), intIn(f.training_days_per_week, 0, 7),
      intIn(f.water_target_ml, 0, 8000), intIn(f.protein_target_g, 0, 400), new Date().toISOString()).run();
    if (goal && (goal !== prev?.primary_goal || second !== prev?.secondary_goal || target !== prev?.target_weight_kg)) {
      await db.batch([
        db.prepare("UPDATE goal_history SET ended_on = ? WHERE ended_on IS NULL").bind(today),
        db.prepare("INSERT INTO goal_history (id, primary_goal, secondary_goal, target_weight_kg, started_on) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), goal, second, target, today),
      ]);
    }
    return c.redirect("/profile", 303);
  });
}

const ACQ_LABEL: Record<Analysis["acquisition"], string> = { auto: "自动获取", auto_with_device: "需要设备", quick_manual: "一键记录", optional: "可选" };
function acqIcon(a: Analysis): IconName {
  return a.acquisition === "auto" ? "refresh" : a.acquisition === "auto_with_device" ? "watch" : "sparkles";
}
function statusBadge(a: Analysis) {
  return a.status === "ready" ? '<span class="badge success">可分析</span>' : a.status === "partial" ? '<span class="badge info">积累中</span>' : '<span class="badge neutral">还缺数据</span>';
}
function radioRow(name: string, options: [string, string][], selected: string, legend: string) {
  return `<fieldset class="scale"><legend>${legend}</legend>${options.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}"${v === selected ? " checked" : ""}><span>${l}</span></label>`).join("")}</fieldset>`;
}
