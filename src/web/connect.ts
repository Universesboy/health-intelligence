// "Connect Apple Health": a guided, mostly one-tap setup for Health Auto Export (HAE).
//
// HAE can create a REST API automation from a deep link (documented at
// https://help.healthyapps.dev/en/health-auto-export/automations/deep-links), so instead of asking
// the user to type a URL, three headers and a dozen settings, we generate a fresh source token and
// hand the phone one link that fills everything in. The page then polls for the first batch.
import type { Hono } from "hono";
import qrcode from "qrcode-generator";
import type { AppEnv } from "../lib/auth";
import { newToken, sha256Hex } from "../lib/crypto";
import { all, one } from "./data";
import { esc, page } from "./html";
import { icon } from "./icons";

export const HAE_APP_STORE = "https://apps.apple.com/app/id1115567069";

/**
 * Metric display names exactly as HAE shows them (its deep-link docs require the display name,
 * including spaces and capitalisation). Each maps to an allowlisted key in src/ingest/hae.ts.
 * Watch-only metrics are included so data appears the day a watch is paired.
 */
export const HAE_METRICS = [
  "Step Count", "Walking + Running Distance", "Flights Climbed", "Active Energy", "Basal Energy Burned",
  "Weight & Body Mass", "Body Fat Percentage", "Waist Circumference", "Walking Speed", "Walking Step Length",
  "Walking Asymmetry Percentage", "Walking Double Support Percentage", "Dietary Water", "Dietary Energy", "Protein",
  "Carbohydrates", "Total Fat", "Sleep Analysis", "Heart Rate", "Resting Heart Rate", "Heart Rate Variability",
  "VO2 Max", "Blood Pressure", "Blood Oxygen Saturation", "Respiratory Rate", "Apple Exercise Time",
];

export interface DeepLinkOptions {
  /** Absolute ingest URL, e.g. https://health.example.com/ingest/hae */
  url: string;
  token: string;
  kind: "metrics" | "workouts";
  /** Cloudflare Access service token, only when /ingest/* is still behind Service Auth. */
  access?: { id: string; secret: string };
}

/** List values are comma-separated in HAE links, so each item is encoded and the commas stay literal. */
const list = (items: string[]) => items.map(encodeURIComponent).join(",");

export function haeDeepLink(o: DeepLinkOptions): string {
  const headers = ["Authorization", `Bearer ${o.token}`];
  if (o.access) headers.push("CF-Access-Client-Id", o.access.id, "CF-Access-Client-Secret", o.access.secret);
  // Order matters to HAE: datatype before its options, format before aggregatedata.
  const params: [string, string][] = [
    ["url", encodeURIComponent(o.url)],
    ["name", encodeURIComponent(o.kind === "metrics" ? "Coach Health 健康数据" : "Coach Health 训练记录")],
    ["enabled", "true"],
    ["datatype", o.kind === "metrics" ? "healthMetrics" : "workouts"],
    ["format", "json"],
    ["exportversion", "v2"],
    // Every run resends the last 7 days: a missed run heals itself and the server dedups.
    ["period", "previous7days"],
    ["requesttimeout", "120"],
    ["batchrequests", "false"],
    ["headers", list(headers)],
  ];
  if (o.kind === "metrics") {
    // Hourly aggregation and summarised sleep are what the parser expects. Do not change later.
    params.push(["metrics", list(HAE_METRICS)], ["aggregatedata", "true"], ["interval", "hours"], ["aggregatesleep", "true"]);
  } else {
    params.push(["includeroutes", "false"], ["includeworkoutmetadata", "false"]);
  }
  params.push(["syncinterval", "hours"], ["syncquantity", "1"], ["notifywhenrun", "false"]);
  return `com.HealthExport://automation?${params.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

export function qrSvg(text: string, label: string) {
  const qr = qrcode(0, "L");
  qr.addData(text, "Byte");
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true })
    .replace("<svg ", `<svg role="img" aria-label="${esc(label)}" class="qr-svg" `);
}

export const CONNECT_LABELS: Record<string, string> = {
  steps: "步数", walking_running_distance: "步行+跑步距离", flights_climbed: "爬楼", active_energy: "活动能量", basal_energy: "静息能量",
  resting_heart_rate: "静息心率", hrv_sdnn: "HRV", heart_rate: "心率", body_mass: "体重", body_fat_pct: "体脂率", waist_circumference: "腰围",
  walking_speed: "步行速度", walking_step_length: "步长", walking_asymmetry_pct: "步行不对称", walking_double_support_pct: "双脚支撑",
  water: "饮水", vo2_max: "VO2 max", bp_systolic: "收缩压", bp_diastolic: "舒张压", dietary_energy: "饮食热量", protein: "蛋白质",
  carbohydrates: "碳水", total_fat: "脂肪", exercise_minutes: "锻炼分钟", spo2_pct: "血氧", respiratory_rate: "呼吸频率",
};

interface HaeState {
  active: { id: string; name: string; created_at: string; last_seen_at: string | null }[];
  lastSeen: string | null;
  lastProcessed: string | null;
}

export async function haeState(db: D1Database): Promise<HaeState> {
  const active = await all<HaeState["active"][number]>(db,
    "SELECT id, name, created_at, last_seen_at FROM sources WHERE kind = 'health_auto_export' AND revoked_at IS NULL ORDER BY created_at");
  const lastSeen = active.map((s) => s.last_seen_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const done = await one<{ t: string | null }>(db,
    `SELECT MAX(b.received_at) AS t FROM ingest_batches b JOIN sources s ON s.id = b.source_id
     WHERE s.kind = 'health_auto_export' AND b.status = 'processed'`);
  return { active, lastSeen, lastProcessed: done?.t ?? null };
}

/** A one-line prompt for Today / Data when Apple Health is not flowing. Empty when all is well. */
export function connectBanner(state: HaeState): string {
  if (!state.lastProcessed) {
    return `<a class="connect-banner" href="/connect">${icon("phone", 20)}<span><strong>连接 Apple Health</strong><span>步数、体重、睡眠、饮食会自动同步，约 3 分钟设置一次。</span></span>${icon("arrowRight", 18)}</a>`;
  }
  const hours = (Date.now() - Date.parse(state.lastSeen ?? state.lastProcessed)) / 3_600_000;
  if (hours < 48) return "";
  return `<a class="connect-banner warn" href="/connect">${icon("alert", 20)}<span><strong>iPhone 数据 ${Math.round(hours / 24)} 天没有同步</strong><span>通常是手机一直锁屏或开了低电量模式。点这里看怎么恢复。</span></span>${icon("arrowRight", 18)}</a>`;
}

const ago = (iso: string | null) => {
  if (!iso) return "从未";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  return h < 1 ? "1 小时内" : h < 48 ? `${Math.round(h)} 小时前` : `${Math.round(h / 24)} 天前`;
};

function step(n: number, state: "done" | "now" | "todo", title: string, body: string) {
  const mark = state === "done" ? icon("check", 16) : String(n);
  return `<li class="cstep ${state}"><span class="cstep-n" aria-hidden="true">${mark}</span><div class="cstep-body"><h3>${title}${state === "done" ? ' <span class="badge success">完成</span>' : ""}</h3>${body}</div></li>`;
}

const TROUBLESHOOT = `<details class="trouble"><summary>${icon("info", 16)} 没反应？按这个顺序排查</summary><ol>
<li>在 Health Auto Export 打开「Coach Health 健康数据」自动化，点 <b>View Activity Logs</b> 看最近一次的结果。</li>
<li>出现 <b>401</b>：链接里的令牌已停用。回到本页重新生成一次，并删除旧的自动化。</li>
<li>出现 <b>403</b>：请求被 Cloudflare Access 拦住了，接收接口还没有放行。把这个状态告诉我。</li>
<li>没有任何记录：iPhone 锁屏时 iOS 不允许读取健康数据。解锁手机，在自动化里手动运行一次。</li>
<li>提示需要升级：自动化是 Premium 功能（有 7 天免费试用）。</li>
</ol></details>`;

const HISTORY_STEPS = `<ol class="plain">
<li>在 Health Auto Export 打开「Coach Health 健康数据」自动化。</li>
<li>点 <b>Export Existing Data</b>，选 <b>Manual Upload</b>。</li>
<li>Start 选你想要的最早日期（建议一次半年，数据多时更稳），End 选今天，点 <b>Begin Export</b>。</li>
<li>每段传完后再选下一段。重复上传不会产生重复数据。</li>
</ol>
<p class="hint">也可以继续用 <a href="/import">文件导入</a>：手动导出 JSON 文件后上传。</p>`;

const KEEP_ALIVE = `<ul class="plain">
<li>设置 → 通用 → <b>后台 App 刷新</b>：打开 Health Auto Export。</li>
<li>不要长时间开 <b>低电量模式</b>，它会暂停后台同步。</li>
<li>把 Health Auto Export 的 <b>小组件</b> 加到主屏幕，iOS 会更常唤醒它；小组件上的云朵按钮可以立即同步。</li>
<li>iOS 只在手机解锁后允许读取健康数据，所以同步时间不是精确的整点。超过 2 天没收到数据时，“今天”页会提醒你。</li>
</ul>`;

function statusPoller(since: string) {
  // Polls /connect/status and replaces #first-data. Plain JS, no framework; stops once processed.
  return `<script>
(function(){
  var box=document.getElementById('first-data'); if(!box) return;
  var since=${JSON.stringify(since)}, tries=0, max=300;
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function render(s){
    var b=s.batch;
    if(!b){ box.className='first-data waiting'; box.innerHTML='<span class="pulse-dot"></span><div><strong>等待 iPhone 发送第一批数据…</strong><span>在 Health Auto Export 保存自动化后，点一次手动运行（或等它自动运行）。这个页面会自己更新。</span></div>'; return false; }
    if(b.status==='processed'){
      var items=(s.metrics||[]).map(function(m){return '<li>'+esc(m.label)+' <b>'+m.n+'</b></li>';}).join('');
      box.className='first-data ok'; box.innerHTML='<span class="ok-dot">✓</span><div><strong>连接成功，已写入 '+(b.records||0)+' 条记录</strong>'+(items?'<ul class="got">'+items+'</ul>':'<span>这批数据里没有可用指标。确认已在健康 App 中允许 Health Auto Export 读取数据。</span>')+'<div class="actions" style="margin-top:10px"><a class="btn primary sm" href="/">去看今天</a><a class="btn secondary sm" href="#history">导入历史数据</a></div></div>';
      return true;
    }
    if(b.status==='failed'){ box.className='first-data bad'; box.innerHTML='<span class="bad-dot">!</span><div><strong>收到了数据，但解析失败</strong><span>原因：'+esc(b.error||'未知')+'。系统会自动重试；如果一直失败，把这个原因告诉我。</span></div>'; return false; }
    box.className='first-data waiting'; box.innerHTML='<span class="pulse-dot"></span><div><strong>已收到数据，正在处理…</strong><span>通常几秒钟。</span></div>'; return false;
  }
  function tick(){
    tries++;
    fetch('/connect/status?since='+encodeURIComponent(since),{headers:{accept:'application/json'},cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(s){ var done=s&&render(s); if(!done&&tries<max) setTimeout(tick,4000); })
      .catch(function(){ if(tries<max) setTimeout(tick,8000); });
  }
  tick();
})();
</script>`;
}

export function registerConnect(app: Hono<AppEnv>) {
  app.get("/connect", async (c) => {
    const db = c.env.DB;
    const origin = new URL(c.req.url).origin;
    const state = await haeState(db);
    const connected = Boolean(state.lastProcessed);
    const stale = connected && (Date.now() - Date.parse(state.lastSeen ?? state.lastProcessed!)) / 3_600_000 >= 48;
    const hero = connected
      ? `<div class="notice ${stale ? "" : "success"}">${icon(stale ? "alert" : "check", 18)}<div><strong>${stale ? "Apple Health 同步中断" : "Apple Health 已连接"}</strong><br>
<span class="small muted">最近收到：${ago(state.lastSeen)}。${stale ? "按下面第 5 步检查手机设置；仍不行就重新生成链接。" : "不用再做什么，数据会每小时左右自动更新。"}</span></div></div>`
      : `<div class="notice info">${icon("info", 18)}<div><strong>只需要一次设置</strong><br><span class="small muted">之后 iPhone 会自动把健康数据发过来，不需要每天操作。全程在 iPhone 上完成最方便。</span></div></div>`;
    const createForm = `<form method="post" action="/connect/create"><button class="btn primary">${icon("link", 16)} ${connected ? "重新生成一键配置链接" : "生成一键配置链接"}</button></form>
<p class="hint">会创建一个只属于这台 iPhone 的令牌${state.active.some((s) => !s.last_seen_at) ? "，并停用之前生成但从未用过的令牌" : ""}。</p>`;
    const desktopQr = `<div class="qr-desktop"><div class="qr-box">${qrSvg(`${origin}/connect`, "在 iPhone 上打开本页的二维码")}</div>
<div><strong>正在用电脑看？</strong><p class="small muted">用 iPhone 相机扫这个码，在手机上打开本页继续。一键链接只能在装了 Health Auto Export 的手机上打开。</p></div></div>`;
    c.header("Cache-Control", "no-store");
    return c.html(page("连接 Apple Health", `${hero}
${desktopQr}
<section class="card"><ol class="csteps">
${step(1, connected ? "done" : "now", "安装 Health Auto Export", `<p>它负责从 iPhone 的健康 App 读取数据并定时发给 Coach Health。自动同步需要它的 Premium（可先免费试用 7 天）。</p>
<p><a class="btn secondary sm" href="${HAE_APP_STORE}" rel="noopener">${icon("phone", 14)} 在 App Store 打开</a></p>
<p class="hint">第一次打开时，按提示允许它读取健康数据（可以直接选“全部打开”，它只会发送下面勾选的指标）。</p>`)}
${step(2, connected ? "done" : "todo", "一键创建自动同步", `<p>点下面的按钮，系统生成专属链接，Health Auto Export 会自动填好地址、令牌、指标和同步频率，你只需要点保存。</p>${createForm}`)}
${step(3, connected ? "done" : "todo", "确认收到第一批数据", `<p>生成链接后会在同一页实时显示是否收到数据。${connected ? `已在 ${ago(state.lastProcessed)} 收到并处理。` : ""}</p>`)}
${step(4, "todo", `<span id="history">导入历史数据（可选）</span>`, HISTORY_STEPS)}
${step(5, "todo", "让它保持自动运行", KEEP_ALIVE)}
</ol></section>
${TROUBLESHOOT}
<p class="hint">高级：<a href="/sources">管理数据源令牌</a> · 设置说明见 docs/SETUP.md</p>`, { path: "/connect", subtitle: "设置" }));
  });

  app.post("/connect/create", async (c) => {
    const db = c.env.DB;
    const now = new Date().toISOString();
    const origin = new URL(c.req.url).origin;
    // Tokens that were generated but never received anything are dead weight: stop them so an
    // old screenshot of a link cannot be used later. Tokens that have delivered data are kept.
    await db.prepare("UPDATE sources SET revoked_at = ? WHERE kind = 'health_auto_export' AND revoked_at IS NULL AND last_seen_at IS NULL").bind(now).run();
    const token = newToken();
    await db.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at) VALUES (?, 'health_auto_export', ?, ?, ?)")
      .bind(crypto.randomUUID(), `iPhone · 一键连接 ${now.slice(0, 10)}`, await sha256Hex(token), now).run();
    const access = c.env.HAE_ACCESS_CLIENT_ID && c.env.HAE_ACCESS_CLIENT_SECRET
      ? { id: c.env.HAE_ACCESS_CLIENT_ID, secret: c.env.HAE_ACCESS_CLIENT_SECRET } : undefined;
    const url = `${origin}/ingest/hae`;
    const metricsLink = haeDeepLink({ url, token, kind: "metrics", access });
    const workoutsLink = haeDeepLink({ url, token, kind: "workouts", access });
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.html(page("连接 Apple Health", `
<div class="notice">${icon("shield", 18)}<div><strong>这个页面里的链接含有你的专属令牌</strong><br><span class="small muted">只在自己的 iPhone 上点。不要截图发给别人。离开本页后无法再次查看，需要时重新生成即可。</span></div></div>
<section class="card"><ol class="csteps">
${step(1, "done", "已生成专属令牌", "")}
${step(2, "now", "在 iPhone 上点这个按钮", `<p>Health Auto Export 会打开并新建一个填好的自动化。检查一眼后点右上角 <b>保存 / Done</b>。</p>
<p><a class="btn primary hae-link" href="${esc(metricsLink)}">${icon("heart", 16)} 在 Health Auto Export 中创建自动同步</a></p>
<details class="more-links"><summary>还想同步训练记录（Workouts）？</summary><p class="small muted">Health Auto Export 每个自动化只发一种数据。点下面再建一个，就会同步 iPhone 记录的体能训练。</p>
<p><a class="btn secondary sm hae-link" href="${esc(workoutsLink)}">${icon("dumbbell", 14)} 再创建训练记录同步</a></p></details>
<div class="qr-desktop"><div class="qr-box">${qrSvg(metricsLink, "一键配置链接二维码")}</div><div><strong>在电脑上打开的？</strong>
<p class="small muted">用 iPhone 相机扫码，选“在 Health Auto Export 中打开”。如果没有反应，就在手机上打开本系统的「连接 Apple Health」页重新生成。</p></div></div>`)}
${step(3, "todo", "回到这里等第一批数据", `<p>保存后，在自动化里点一次手动运行（或等几分钟让它自动运行）。</p>
<div id="first-data" class="first-data waiting" aria-live="polite"><span class="pulse-dot"></span><div><strong>等待 iPhone 发送第一批数据…</strong><span>这个页面会自己更新。</span></div></div>`)}
${step(4, "todo", `<span id="history">导入历史数据（可选）</span>`, HISTORY_STEPS)}
${step(5, "todo", "让它保持自动运行", KEEP_ALIVE)}
</ol></section>
${TROUBLESHOOT}
<details class="trouble"><summary>${icon("info", 16)} 手动填写（一键链接打不开时）</summary>
<p class="small muted">在 Health Auto Export → Automations → 新建 REST API，填写：</p>
<label class="field">URL<input readonly value="${esc(url)}" onclick="this.select()"></label>
<label class="field">Header：Authorization<input readonly value="Bearer ${esc(token)}" onclick="this.select()"></label>
${access ? '<p class="small muted">还需要 CF-Access-Client-Id 和 CF-Access-Client-Secret 两个请求头，一键链接里已包含。</p>' : ""}
<p class="small muted">Format：JSON · Export Version 2 · Summarize Data 打开 · Aggregation：Hours · Period：Previous 7 Days · Sync：每 1 小时。</p></details>
${statusPoller(now)}`, { path: "/connect", subtitle: "设置" }));
  });

  // First-data confirmation for the wizard. Returns counts only, never values.
  app.get("/connect/status", async (c) => {
    const db = c.env.DB;
    const sinceRaw = c.req.query("since") ?? "";
    const since = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(sinceRaw) ? sinceRaw : new Date(Date.now() - 3_600_000).toISOString();
    const batch = await one<{ id: string; status: string; received_at: string; records_upserted: number | null; records_skipped: number | null; error: string | null }>(db,
      `SELECT b.id, b.status, b.received_at, b.records_upserted, b.records_skipped, b.error FROM ingest_batches b
       JOIN sources s ON s.id = b.source_id WHERE s.kind = 'health_auto_export' AND b.received_at >= ?
       ORDER BY (b.status = 'processed') DESC, b.received_at DESC LIMIT 1`, since);
    const metrics = batch?.status === "processed"
      ? (await all<{ metric: string; n: number }>(db,
        `SELECT o.metric, COUNT(*) AS n FROM observations o JOIN ingest_batches b ON b.id = o.batch_id JOIN sources s ON s.id = b.source_id
         WHERE s.kind = 'health_auto_export' AND b.received_at >= ? AND b.status = 'processed' GROUP BY o.metric ORDER BY n DESC`, since))
        .map((m) => ({ metric: m.metric, label: CONNECT_LABELS[m.metric] ?? m.metric, n: m.n }))
      : [];
    c.header("Cache-Control", "no-store");
    return c.json({
      batch: batch ? { status: batch.status, receivedAt: batch.received_at, records: batch.records_upserted, skipped: batch.records_skipped, error: batch.error } : null,
      metrics,
    });
  });
}
