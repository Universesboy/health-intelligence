import { Hono } from "hono";
import type { Env, IngestMessage } from "./env";
import { requireAccess, requireSourceToken, type AppEnv } from "./lib/auth";
import { newToken, sha256Hex } from "./lib/crypto";
import { addDays, isIsoDate, localDate } from "./lib/time";
import { BASELINE_MIN_DAYS } from "./lib/stats";
import { acceptPayload, MAX_PAYLOAD_BYTES, processBatch } from "./ingest/process";
import { importCoachchalk } from "./jobs/coachchalk";
import { BASELINE_METRICS, recomputeAll } from "./jobs/derived";
import { esc, page } from "./web/html";

const app = new Hono<AppEnv>();

export const RED_FLAGS: Record<string, string> = {
  chest_pain: "胸痛或胸闷",
  severe_breathlessness: "严重呼吸困难",
  fainting: "晕厥或几乎晕倒",
  palpitations_dizzy: "心悸并伴头晕",
};
const BODY_AREAS = ["肩", "肘", "腕", "颈", "下背", "髋", "大腿", "膝", "小腿", "跟腱/踝", "足底"];

const METRIC_LABELS: Record<string, string> = {
  steps: "步数", walking_running_distance: "步行+跑步距离", flights_climbed: "爬楼层数", active_energy: "活动能量",
  basal_energy: "静息能量", resting_heart_rate: "静息心率", hrv_sdnn: "HRV（SDNN）", heart_rate: "心率",
  body_mass: "体重", body_fat_pct: "体脂率", waist_circumference: "腰围", walking_speed: "步行速度",
  walking_step_length: "步长", walking_asymmetry_pct: "步行不对称性", walking_double_support_pct: "双脚支撑时间",
  water: "饮水", vo2_max: "VO2 max", bp_systolic: "收缩压", bp_diastolic: "舒张压",
  sleep_hours_device: "睡眠（设备测量）", sleep_hours_self: "睡眠（自报）", coaching_minutes: "教学时长",
};

app.get("/healthz", (c) => c.text("ok"));

// ---------- Machine ingest (bearer token per source; no Access cookie) ----------
app.post("/ingest/hae", requireSourceToken, async (c) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_PAYLOAD_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const body = new Uint8Array(await c.req.arrayBuffer());
  if (!body.byteLength) return c.json({ error: "empty_body" }, 400);
  if (body.byteLength > MAX_PAYLOAD_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const result = await acceptPayload(c.env, c.get("sourceId"), body);
  return c.json({ ok: true, batch: result.batchId, duplicate: result.duplicate }, 202);
});

// ---------- Everything else requires Cloudflare Access ----------
app.use("*", requireAccess);

async function getOne<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).first<T>();
}
async function getAll<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
function fmt(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
function parseJsonArray(value: string | null | undefined): unknown[] {
  try { const v = JSON.parse(value ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

app.get("/", async (c) => {
  const tz = c.env.LOCAL_TIME_ZONE;
  const today = localDate(new Date(), tz);
  const db = c.env.DB;
  const [checkin, metrics, load, baselines] = await Promise.all([
    getOne<Record<string, string | number | null>>(db, "SELECT * FROM daily_checkins WHERE local_date = ?", today),
    getAll<{ metric: string; value: number; unit: string; local_date: string }>(db,
      "SELECT metric, value, unit, local_date FROM daily_metrics WHERE local_date IN (?, ?)", today, addDays(today, -1)),
    getOne<Record<string, number | null>>(db, "SELECT * FROM daily_load WHERE local_date = ?", today),
    getAll<{ metric: string; median: number | null; n: number }>(db,
      "SELECT metric, median, n FROM baselines WHERE as_of_date = ? AND window_days = 28", today),
  ]);
  const redFlags = parseJsonArray(checkin?.red_flags as string).filter((f): f is string => typeof f === "string" && f in RED_FLAGS);
  const emergency = redFlags.length ? `<div class="card danger"><strong>请立即拨打 911 或前往最近的急诊。</strong><br>
    你今天报告了：${redFlags.map((f) => esc(RED_FLAGS[f])).join("、")}。这类症状需要马上由医疗人员评估，不要等待本系统的分析。</div>` : "";

  const m = (metric: string, day = today) => metrics.find((r) => r.metric === metric && r.local_date === day);
  const b = (metric: string) => baselines.find((r) => r.metric === metric);
  const line = (label: string, metric: string, unit: string, kind: string, day = today) => {
    const v = m(metric, day); const base = b(metric);
    const baseText = !base || base.n < BASELINE_MIN_DAYS ? `<span class="muted">基线建立中（${base?.n ?? 0}/${BASELINE_MIN_DAYS} 天）</span>`
      : `<span class="muted">28 天中位数 ${fmt(base.median, 1)}</span>`;
    return `<tr><td>${label}</td><td>${v ? `${fmt(v.value, 1)} ${unit}` : '<span class="muted">缺失</span>'}</td><td class="muted">${kind}</td><td>${baseText}</td></tr>`;
  };
  const sel = (name: string, max: number, min = 1) => {
    const current = checkin?.[name];
    return `<select name="${name}"><option value="">未填</option>${Array.from({ length: max - min + 1 }, (_, i) => i + min)
      .map((n) => `<option value="${n}"${current === n ? " selected" : ""}>${n}</option>`).join("")}</select>`;
  };
  const checks = (name: string, list: string[], selected: unknown[]) => list.map((a) =>
    `<label><input type="checkbox" name="${name}" value="${esc(a)}"${selected.includes(a) ? " checked" : ""}>${esc(a)}</label>`).join("");
  const pain = parseJsonArray(checkin?.pain_areas as string) as { area: string; severity: number }[];
  const painSeverity = pain[0]?.severity ?? "";

  return c.html(page("今天", `${emergency}
<h1>今天 · ${today}</h1>
<div class="card"><h2 style="margin-top:0">今日数据</h2><table>
<tr><th>指标</th><th>数值</th><th>类型</th><th>个人基线</th></tr>
${line("睡眠（设备）", "sleep_hours_device", "小时", "客观数据")}
${line("睡眠（自报）", "sleep_hours_self", "小时", "自报")}
${line("步数", "steps", "步", "客观数据")}
${line("教学时长", "coaching_minutes", "分钟", "Coachchalk 记录")}
${line("静息心率", "resting_heart_rate", "bpm", "客观数据")}
${line("HRV（SDNN）", "hrv_sdnn", "ms", "客观数据")}
${line("体重", "body_mass", "kg", "客观数据")}
</table>
<p class="muted">教学负荷 ${fmt(load?.coaching_load)} · 训练负荷 ${fmt(load?.training_load)} · 7 天均值 ${fmt(load?.acute_7)} · 28 天均值 ${fmt(load?.chronic_28)}
<br>负荷为空表示缺少输入（例如没有填写教学强度或训练 RPE），系统不会用 0 或估计值代替。没有 Apple Watch 时心率与 HRV 会一直显示“缺失”。</p></div>

<form class="card" method="post" action="/checkin"><h2 style="margin-top:0">20 秒签到</h2>
<input type="hidden" name="local_date" value="${today}">
<div class="row"><div><label>昨晚大概几点睡</label><input type="time" name="bedtime_local" value="${esc(checkin?.bedtime_local)}"></div>
<div><label>今早几点起</label><input type="time" name="waketime_local" value="${esc(checkin?.waketime_local)}"></div></div>
<div class="row"><div><label>睡眠质量（1 很差 – 5 很好）</label>${sel("sleep_quality", 5)}</div>
<div><label>精力（1–5）</label>${sel("energy", 5)}</div></div>
<div class="row"><div><label>今天教学强度（1 轻松 – 10 极累：喂球多/示范多/对抗多）</label>${sel("coaching_intensity", 10)}</div>
<div><label>全天整体用力程度 RPE（0–10）</label>${sel("overall_rpe", 10, 0)}</div></div>
<div class="row"><div><label>疲劳（1–5）</label>${sel("fatigue", 5)}</div>
<div><label>最后一杯咖啡/茶时间</label><input type="time" name="caffeine_last_local" value="${esc(checkin?.caffeine_last_local)}"></div></div>
<label>酸痛部位</label><div class="chips">${checks("soreness", BODY_AREAS, parseJsonArray(checkin?.soreness_areas as string))}</div>
<label>疼痛部位（不是普通酸痛）</label><div class="chips">${checks("pain", BODY_AREAS, pain.map((p) => p.area))}</div>
<label>最严重疼痛程度（0–10）</label><input type="number" min="0" max="10" name="pain_severity" value="${esc(painSeverity)}">
<label>今天是否出现以下症状</label><div class="chips">${Object.entries(RED_FLAGS).map(([k, v]) =>
    `<label><input type="checkbox" name="red_flags" value="${k}"${redFlags.includes(k) ? " checked" : ""}>${v}</label>`).join("")}</div>
<label>备注</label><textarea name="note" rows="2">${esc(checkin?.note)}</textarea>
<p><button type="submit">保存</button> <span class="muted">都可以不填，空着就是“未知”。</span></p></form>`));
});

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function clock(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : null;
}

app.post("/checkin", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
  const day = isIsoDate(form.local_date) ? form.local_date : today;
  if (day > today) return c.text("不能为未来日期签到", 400);
  const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === "string");
  const areas = list(form.pain).filter((a) => BODY_AREAS.includes(a));
  const severity = intIn(form.pain_severity, 0, 10);
  const pain = areas.map((area) => ({ area, severity }));
  const flags = list(form.red_flags).filter((f) => f in RED_FLAGS);
  await c.env.DB.prepare(
    `INSERT INTO daily_checkins (local_date, bedtime_local, waketime_local, sleep_quality, overall_rpe, coaching_intensity,
       fatigue, energy, soreness_areas, pain_areas, caffeine_last_local, red_flags, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET bedtime_local = excluded.bedtime_local, waketime_local = excluded.waketime_local,
       sleep_quality = excluded.sleep_quality, overall_rpe = excluded.overall_rpe, coaching_intensity = excluded.coaching_intensity,
       fatigue = excluded.fatigue, energy = excluded.energy, soreness_areas = excluded.soreness_areas, pain_areas = excluded.pain_areas,
       caffeine_last_local = excluded.caffeine_last_local, red_flags = excluded.red_flags, note = excluded.note, updated_at = excluded.updated_at`,
  ).bind(
    day, clock(form.bedtime_local), clock(form.waketime_local), intIn(form.sleep_quality, 1, 5), intIn(form.overall_rpe, 0, 10),
    intIn(form.coaching_intensity, 1, 10), intIn(form.fatigue, 1, 5), intIn(form.energy, 1, 5),
    JSON.stringify(list(form.soreness).filter((a) => BODY_AREAS.includes(a))), JSON.stringify(pain), clock(form.caffeine_last_local),
    JSON.stringify(flags), typeof form.note === "string" && form.note.trim() ? form.note.trim().slice(0, 1000) : null, new Date().toISOString(),
  ).run();
  await recomputeAll(c.env.DB, today);
  return c.redirect("/", 303);
});

app.get("/quality", async (c) => {
  const today = localDate(new Date(), c.env.LOCAL_TIME_ZONE);
  const db = c.env.DB;
  const [coverage, batches, jobs] = await Promise.all([
    getAll<{ metric: string; d30: number; d90: number; last: string }>(db,
      `SELECT metric, SUM(local_date >= ?) AS d30, COUNT(*) AS d90, MAX(local_date) AS last FROM daily_metrics
       WHERE local_date >= ? GROUP BY metric ORDER BY metric`, addDays(today, -29), addDays(today, -89)),
    getAll<{ received_at: string; status: string; bytes: number; records_upserted: number | null; records_skipped: number | null; error: string | null; name: string }>(db,
      `SELECT b.received_at, b.status, b.bytes, b.records_upserted, b.records_skipped, b.error, s.name FROM ingest_batches b
       JOIN sources s ON s.id = b.source_id ORDER BY b.received_at DESC LIMIT 15`),
    getAll<{ job: string; run_key: string; status: string; detail: string | null }>(db,
      "SELECT job, run_key, status, detail FROM job_runs ORDER BY ran_at DESC LIMIT 5"),
  ]);
  const covered = new Map(coverage.map((r) => [r.metric, r]));
  const metrics = [...new Set([...BASELINE_METRICS, ...coverage.map((r) => r.metric)])];
  return c.html(page("数据质量", `<h1>数据质量</h1>
<p class="muted">每个指标最近 30 天、90 天有数据的天数。缺失不会被补值。基线需要至少 ${BASELINE_MIN_DAYS} 天数据。</p>
<div class="card"><table><tr><th>指标</th><th>近 30 天</th><th>近 90 天</th><th>最近一天</th></tr>
${metrics.map((k) => { const r = covered.get(k); return `<tr><td>${esc(METRIC_LABELS[k] ?? k)}</td><td>${r?.d30 ?? 0}</td><td>${r?.d90 ?? 0}</td><td>${esc(r?.last ?? "—")}</td></tr>`; }).join("")}
</table></div>
<h2>最近收到的数据包</h2><div class="card"><table><tr><th>时间（UTC）</th><th>来源</th><th>状态</th><th>写入/跳过</th><th>说明</th></tr>
${batches.map((b) => `<tr><td>${esc(b.received_at.slice(0, 16).replace("T", " "))}</td><td>${esc(b.name)}</td><td>${esc(b.status)}</td>
<td>${b.records_upserted ?? "—"} / ${b.records_skipped ?? "—"}</td><td><code>${esc(b.error ?? "")}</code></td></tr>`).join("") || '<tr><td colspan="5" class="muted">还没有收到数据</td></tr>'}
</table></div>
<h2>后台任务</h2><div class="card"><table>${jobs.map((j) => `<tr><td>${esc(j.job)}</td><td>${esc(j.run_key)}</td><td>${esc(j.status)}</td><td><code>${esc(j.detail ?? "")}</code></td></tr>`).join("") || '<tr><td class="muted">尚未运行</td></tr>'}</table></div>`));
});

app.get("/sources", async (c) => {
  const rows = await getAll<{ id: string; kind: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }>(
    c.env.DB, "SELECT id, kind, name, created_at, last_seen_at, revoked_at FROM sources ORDER BY created_at");
  return c.html(page("数据源", `<h1>数据源</h1><div class="card"><table><tr><th>名称</th><th>类型</th><th>最后收到</th><th></th></tr>
${rows.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.kind)}</td><td>${esc(s.last_seen_at?.slice(0, 16).replace("T", " ") ?? "—")}</td>
<td>${s.revoked_at ? '<span class="muted">已停用</span>' : s.kind === "health_auto_export" ? `<form method="post" action="/sources/${esc(s.id)}/revoke"><button>停用令牌</button></form>` : ""}</td></tr>`).join("")
    || '<tr><td colspan="4" class="muted">还没有数据源</td></tr>'}</table></div>
<form class="card" method="post" action="/sources"><h2 style="margin-top:0">新建 Health Auto Export 数据源</h2>
<label>名称</label><input name="name" value="iPhone · Health Auto Export" maxlength="60"><p><button>生成令牌</button></p>
<p class="muted">令牌只显示一次。系统只保存它的哈希值。</p></form>`));
});

app.post("/sources", async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === "string" && form.name.trim() ? form.name.trim().slice(0, 60) : "Health Auto Export";
  const token = newToken();
  await c.env.DB.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at) VALUES (?, 'health_auto_export', ?, ?, ?)")
    .bind(crypto.randomUUID(), name, await sha256Hex(token), new Date().toISOString()).run();
  const origin = new URL(c.req.url).origin;
  c.header("Cache-Control", "no-store");
  return c.html(page("令牌", `<h1>令牌已生成</h1><div class="card"><p><strong>只显示这一次，请现在复制到 Health Auto Export。</strong></p>
<p>URL：<code>${esc(origin)}/ingest/hae</code></p><p>请求头：<code>Authorization: Bearer ${esc(token)}</code></p>
<p class="muted">另外两个 Cloudflare Access 服务令牌请求头（CF-Access-Client-Id / CF-Access-Client-Secret）按 docs/SETUP.md 添加。</p>
</div><p><a href="/sources">返回</a></p>`));
});

app.post("/sources/:id/revoke", async (c) => {
  await c.env.DB.prepare("UPDATE sources SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
  return c.redirect("/sources", 303);
});

async function manualSourceId(db: D1Database) {
  const row = await getOne<{ id: string }>(db, "SELECT id FROM sources WHERE kind = 'manual' AND revoked_at IS NULL LIMIT 1");
  if (row) return row.id;
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO sources (id, kind, name, created_at) VALUES (?, 'manual', '手动导入', ?)").bind(id, new Date().toISOString()).run();
  return id;
}

app.get("/import", (c) => c.html(page("导入历史", `<h1>导入历史数据</h1>
<form class="card" method="post" action="/import" enctype="multipart/form-data">
<p>在 Health Auto Export 里选择“手动导出”，格式 JSON，聚合方式选“小时”，时间范围选过去 1–2 年，然后把导出的文件上传到这里。
大文件可以按半年分几次导出。重复上传同一段时间不会产生重复数据。</p>
<input type="file" name="file" accept="application/json,.json" required><p><button>上传</button></p></form>`)));

app.post("/import", async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || !file.size) return c.text("请选择文件", 400);
  if (file.size > MAX_PAYLOAD_BYTES) return c.text("文件超过 50 MB，请缩短时间范围分次导出", 413);
  const result = await acceptPayload(c.env, await manualSourceId(c.env.DB), new Uint8Array(await file.arrayBuffer()));
  return c.html(page("已接收", `<h1>${result.duplicate ? "这份文件之前已经导入过" : "已接收，后台处理中"}</h1>
<p>处理结果会显示在 <a href="/quality">数据质量</a> 页。</p>`));
});

const EXPORT_TABLES = ["sources", "observations", "sleep_sessions", "workouts", "coaching_sessions", "daily_checkins", "daily_metrics", "baselines", "daily_load", "ingest_batches"];

app.get("/privacy", async (c) => {
  const sources = await getAll<{ id: string; name: string }>(c.env.DB, "SELECT id, name FROM sources ORDER BY created_at");
  return c.html(page("导出与删除", `<h1>导出与删除</h1>
<div class="card"><p><a href="/export.json">下载全部数据（JSON）</a></p><p class="muted">令牌哈希不会被导出。原始数据包是加密的，保存在 R2。</p></div>
<form class="card danger" method="post" action="/delete"><h2 style="margin-top:0">删除数据</h2>
<label>范围</label><select name="scope"><option value="">请选择</option><option value="all">全部数据（包括签到和原始数据包）</option>
${sources.map((s) => `<option value="source:${esc(s.id)}">只删除来自「${esc(s.name)}」的数据</option>`).join("")}</select>
<label>输入 DELETE 确认</label><input name="confirm" autocomplete="off"><p><button>永久删除</button></p></form>`));
});

app.get("/export.json", async (c) => {
  const out: Record<string, unknown[]> = {};
  for (const table of EXPORT_TABLES) {
    const rows = await getAll<Record<string, unknown>>(c.env.DB, `SELECT * FROM ${table}`);
    out[table] = table === "sources" ? rows.map(({ token_sha256: _omit, ...rest }) => rest) : rows;
  }
  c.header("Content-Disposition", `attachment; filename="health-export-${localDate(new Date(), c.env.LOCAL_TIME_ZONE)}.json"`);
  c.header("Cache-Control", "no-store");
  return c.json({ exportedAt: new Date().toISOString(), timeZone: c.env.LOCAL_TIME_ZONE, ...out });
});

async function deleteR2Prefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

app.post("/delete", async (c) => {
  const form = await c.req.parseBody();
  if (form.confirm !== "DELETE") return c.text("请输入 DELETE 确认", 400);
  const scope = typeof form.scope === "string" ? form.scope : "";
  const db = c.env.DB;
  if (scope === "all") {
    await db.batch(EXPORT_TABLES.filter((t) => t !== "sources").concat("job_runs").map((t) => db.prepare(`DELETE FROM ${t}`)));
    await deleteR2Prefix(c.env.RAW, "raw/");
  } else if (scope.startsWith("source:")) {
    const id = scope.slice(7);
    await db.batch([
      db.prepare("DELETE FROM observations WHERE source_id = ?").bind(id),
      db.prepare("DELETE FROM sleep_sessions WHERE source_id = ?").bind(id),
      db.prepare("DELETE FROM workouts WHERE source_id = ?").bind(id),
      db.prepare("DELETE FROM ingest_batches WHERE source_id = ?").bind(id),
    ]);
    await deleteR2Prefix(c.env.RAW, `raw/${id}/`);
  } else {
    return c.text("请选择删除范围", 400);
  }
  await recomputeAll(db, localDate(new Date(), c.env.LOCAL_TIME_ZONE));
  return c.html(page("已删除", `<h1>已删除</h1><p><a href="/quality">查看数据质量</a></p>`));
});

async function hourly(env: Env, now: Date) {
  const today = localDate(now, env.LOCAL_TIME_ZONE);
  const runKey = now.toISOString().slice(0, 13);
  let detail = "";
  try {
    const coach = await importCoachchalk(env, now);
    await recomputeAll(env.DB, today, now.toISOString());
    detail = JSON.stringify({ coachchalk: coach.status, imported: coach.imported, removed: coach.removed });
    await env.DB.prepare("INSERT OR REPLACE INTO job_runs (job, run_key, status, detail) VALUES ('hourly', ?, 'ok', ?)").bind(runKey, detail).run();
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown_error";
    await env.DB.prepare("INSERT OR REPLACE INTO job_runs (job, run_key, status, detail) VALUES ('hourly', ?, 'failed', ?)").bind(runKey, name).run();
    throw error;
  }
}

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<IngestMessage>, env: Env) {
    for (const message of batch.messages) {
      await processBatch(env, message.body.batchId);
      message.ack();
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(hourly(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env, IngestMessage>;
