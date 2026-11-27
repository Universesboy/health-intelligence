import { Hono } from "hono";
import type { Env, IngestMessage } from "./env";
import { requireAccess, requireSourceToken, type AppEnv } from "./lib/auth";
import { newToken, sha256Hex } from "./lib/crypto";
import { localDate } from "./lib/time";
import { acceptPayload, MAX_PAYLOAD_BYTES, processBatch } from "./ingest/process";
import { importCoachchalk } from "./jobs/coachchalk";
import { recomputeAll } from "./jobs/derived";
import { esc, page } from "./web/html";
import { icon } from "./web/icons";
import { registerPages } from "./web/pages";
import { registerConnect } from "./web/connect";
export { RED_FLAGS } from "./web/pages";

const app = new Hono<AppEnv>();

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

async function getAll<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}

registerPages(app);
registerConnect(app);
app.get("/quality", (c) => c.redirect("/data", 301));
app.post("/checkin", (c) => c.redirect("/", 303)); // old form; the check-in now lives on /checkin/quick

app.get("/sources", async (c) => {
  const rows = await getAll<{ id: string; kind: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }>(
    c.env.DB, "SELECT id, kind, name, created_at, last_seen_at, revoked_at FROM sources ORDER BY created_at");
  const KIND: Record<string, string> = { health_auto_export: "Health Auto Export", manual: "文件导入", quick_entry: "手动记录", coachchalk: "Coachchalk" };
  return c.html(page("数据源令牌", `<section class="card"><div class="card-head"><div><h2>已有数据源</h2><p>每个数据源有独立令牌，系统只保存哈希值</p></div></div>
<ul class="list">${rows.map((s) => `<li><span class="ico">${icon(s.kind === "health_auto_export" ? "phone" : "file", 16)}</span><div><strong>${esc(s.name)}</strong>
<span class="sub">${esc(KIND[s.kind] ?? s.kind)} · 最后收到 ${esc(s.last_seen_at?.slice(0, 16).replace("T", " ") ?? "—")} UTC</span></div>
${s.revoked_at ? '<span class="badge neutral">已停用</span>' : s.kind === "health_auto_export" ? `<form method="post" action="/sources/${esc(s.id)}/revoke"><button class="btn secondary sm">停用令牌</button></form>` : '<span class="badge success">使用中</span>'}</li>`).join("")
    || '<li><span></span><span class="muted">还没有数据源</span><span></span></li>'}</ul></section>
<div class="notice info">${icon("info", 18)}<div><strong>第一次连接 iPhone？</strong><br><span class="small muted">用 <a href="/connect">连接 Apple Health</a> 向导，一键填好所有设置。这一页用于手动管理令牌。</span></div></div>
<form class="card" method="post" action="/sources"><div class="card-head"><div><h2>新建 Health Auto Export 数据源（手动）</h2><p>令牌只显示一次</p></div></div>
<label class="field">名称<input name="name" value="iPhone · Health Auto Export" maxlength="60"></label><div class="actions" style="margin-top:12px"><button class="btn primary">生成令牌</button></div></form>`,
    { path: "/sources", subtitle: "设置" }));
});

app.post("/sources", async (c) => {
  const form = await c.req.parseBody();
  const name = typeof form.name === "string" && form.name.trim() ? form.name.trim().slice(0, 60) : "Health Auto Export";
  const token = newToken();
  await c.env.DB.prepare("INSERT INTO sources (id, kind, name, token_sha256, created_at) VALUES (?, 'health_auto_export', ?, ?, ?)")
    .bind(crypto.randomUUID(), name, await sha256Hex(token), new Date().toISOString()).run();
  const origin = new URL(c.req.url).origin;
  c.header("Cache-Control", "no-store");
  return c.html(page("令牌已生成", `<div class="card"><p><strong>只显示这一次，请现在复制到 Health Auto Export。</strong></p>
<p>URL：<code>${esc(origin)}/ingest/hae</code></p><p>请求头：<code>Authorization: Bearer ${esc(token)}</code></p>
<p class="muted">更简单的方式：用 <a href="/connect">连接 Apple Health</a> 向导一键配置。</p>
</div><p><a class="btn secondary" href="/sources">返回</a></p>`, { path: "/sources", subtitle: "设置" }));
});

app.post("/sources/:id/revoke", async (c) => {
  await c.env.DB.prepare("UPDATE sources SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), c.req.param("id")).run();
  return c.redirect("/sources", 303);
});

async function manualSourceId(db: D1Database) {
  const row = await db.prepare("SELECT id FROM sources WHERE kind = 'manual' AND revoked_at IS NULL LIMIT 1").first<{ id: string }>();
  if (row) return row.id;
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO sources (id, kind, name, created_at) VALUES (?, 'manual', '手动导入', ?)").bind(id, new Date().toISOString()).run();
  return id;
}

app.get("/import", async (c) => {
  const imports = await getAll<{ received_at: string; status: string; records_upserted: number | null; bytes: number }>(c.env.DB,
    "SELECT b.received_at, b.status, b.records_upserted, b.bytes FROM ingest_batches b JOIN sources s ON s.id = b.source_id WHERE s.kind = 'manual' ORDER BY b.received_at DESC LIMIT 10");
  return c.html(page("导入历史", `<form class="card" method="post" action="/import" enctype="multipart/form-data">
<div class="card-head"><div><h2>${icon("upload", 18)} 导入 Apple Health 历史</h2><p>一次导入，之后由自动化每 1–2 小时补齐最近 7 天</p></div></div>
<ol class="small" style="margin:0 0 14px;padding-left:18px;line-height:1.8"><li>Health Auto Export → 手动导出，格式 JSON，聚合选「小时」。</li><li>时间范围选过去 1–2 年；文件太大就按半年分几次。</li><li>上传到这里。系统会补算所有历史日子的每日指标和基线。</li></ol>
<input type="file" name="file" accept="application/json,.json" required>
<div class="actions" style="margin-top:12px"><button class="btn primary">上传</button><span class="hint">同一文件重复上传会被识别；重叠的时间段按「指标+时间+设备」去重，不会产生重复数据。</span></div></form>
<section class="card"><div class="card-head"><div><h2>导入记录</h2></div></div>${imports.length ? `<ul class="list">${imports.map((b) => `<li><span class="ico">${icon("file", 16)}</span>
<div><strong>${esc(b.received_at.slice(0, 16).replace("T", " "))} UTC</strong><span class="sub">${(b.bytes / 1024 / 1024).toFixed(1)} MB · 写入 ${b.records_upserted ?? "—"} 条</span></div>
${b.status === "processed" ? '<span class="badge success">完成</span>' : b.status === "failed" ? '<span class="badge danger">失败</span>' : '<span class="badge info">处理中</span>'}</li>`).join("")}</ul>` : '<p class="empty">还没有导入过文件</p>'}</section>
<div class="notice">${icon("info", 18)}<div><strong>其他导入方式</strong><br><span class="small muted">健康报告 PDF、截图识别还没有实现，所以这里不提供上传入口。智能秤、血压计等设备只要写入 Apple Health，就会通过自动化同步过来。</span></div></div>`,
    { path: "/import", subtitle: "设置" }));
});

app.post("/import", async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || !file.size) return c.text("请选择文件", 400);
  if (file.size > MAX_PAYLOAD_BYTES) return c.text("文件超过 50 MB，请缩短时间范围分次导出", 413);
  const result = await acceptPayload(c.env, await manualSourceId(c.env.DB), new Uint8Array(await file.arrayBuffer()));
  return c.html(page(result.duplicate ? "已导入过" : "已接收", `<div class="notice ${result.duplicate ? "info" : "success"}">${icon(result.duplicate ? "info" : "check", 18)}<div>
<strong>${result.duplicate ? "这份文件之前已经导入过，没有重复写入。" : "已接收，后台处理中。"}</strong><br><span class="small">处理结果会显示在 <a href="/import">导入记录</a> 和 <a href="/data">数据</a> 页。</span></div></div>`,
    { path: "/import", subtitle: "设置" }));
});

const EXPORT_TABLES = ["sources", "observations", "sleep_sessions", "workouts", "work_daily", "coaching_sessions", "daily_checkins", "meals",
  "profile", "goal_history", "insight_snapshots", "daily_metrics", "baselines", "daily_load", "ingest_batches"];

app.get("/privacy", async (c) => {
  const sources = await getAll<{ id: string; name: string }>(c.env.DB, "SELECT id, name FROM sources ORDER BY created_at");
  return c.html(page("导出与删除", `<section class="card"><div class="card-head"><div><h2>${icon("shield", 18)} 你的数据</h2><p>只有你能访问（Cloudflare Access 登录）。默认不与 Coachchalk、教练、学生或家长共享。</p></div></div>
<div class="actions"><a class="btn primary" href="/export.json">下载全部数据（JSON）</a><span class="hint">令牌哈希不会被导出。原始数据包以 AES-256-GCM 加密保存在 R2。</span></div></section>
<form class="card" method="post" action="/delete" style="border-color:var(--color-danger-border)"><div class="card-head"><div><h2>删除数据</h2><p>永久删除，无法恢复</p></div></div>
<div class="form-grid"><label class="field">范围<select name="scope"><option value="">请选择</option><option value="all">全部数据（包括签到、饮食、档案和原始数据包）</option>
${sources.map((s) => `<option value="source:${esc(s.id)}">只删除来自「${esc(s.name)}」的数据</option>`).join("")}</select></label>
<label class="field">输入 DELETE 确认<input name="confirm" autocomplete="off"></label></div>
<div class="actions" style="margin-top:12px"><button class="btn danger">永久删除</button></div></form>`, { path: "/privacy", subtitle: "设置" }));
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
      db.prepare("DELETE FROM insight_snapshots"), // derived from the deleted data
    ]);
    await deleteR2Prefix(c.env.RAW, `raw/${id}/`);
  } else {
    return c.text("请选择删除范围", 400);
  }
  await recomputeAll(db, localDate(new Date(), c.env.LOCAL_TIME_ZONE));
  return c.html(page("已删除", `<div class="notice success">${icon("check", 18)}<div><strong>已删除。</strong> <a href="/data">查看数据页</a></div></div>`, { path: "/privacy" }));
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
