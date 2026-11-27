// Receive -> encrypt -> R2 -> queue -> parse -> upsert. The HTTP request only stores and enqueues,
// so a slow or failed parse never makes Health Auto Export think the upload failed.
import type { Env } from "../env";
import { decryptBytes, encryptBytes, sha256Hex } from "../lib/crypto";
import { localDate } from "../lib/time";
import { daysBack, recomputeAll } from "../jobs/derived";
import { parseHaePayload } from "./hae";
import { storeParsed } from "./store";

export const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;

export async function acceptPayload(env: Env, sourceId: string, body: Uint8Array) {
  const now = new Date();
  const payloadSha256 = await sha256Hex(body);
  const dup = await env.DB.prepare(
    "SELECT id FROM ingest_batches WHERE source_id = ? AND payload_sha256 = ? AND status = 'processed'",
  ).bind(sourceId, payloadSha256).first<{ id: string }>();
  if (dup) return { batchId: dup.id, duplicate: true };

  const batchId = crypto.randomUUID();
  const r2Key = `raw/${sourceId}/${now.toISOString().slice(0, 10)}/${batchId}.json.enc`;
  await env.RAW.put(r2Key, await encryptBytes(body, env.RAW_ENCRYPTION_KEY));
  await env.DB.prepare(
    "INSERT INTO ingest_batches (id, source_id, received_at, payload_sha256, bytes, r2_key, status) VALUES (?, ?, ?, ?, ?, ?, 'queued')",
  ).bind(batchId, sourceId, now.toISOString(), payloadSha256, body.byteLength, r2Key).run();
  await env.DB.prepare("UPDATE sources SET last_seen_at = ? WHERE id = ?").bind(now.toISOString(), sourceId).run();
  await env.INGEST_QUEUE.send({ batchId });
  return { batchId, duplicate: false };
}

export function earliestLocalDate(parsed: ReturnType<typeof parseHaePayload>, timeZone: string): string | null {
  let min: string | null = null;
  const consider = (utc: string | null | undefined) => { if (utc && (min === null || utc < min)) min = utc; };
  for (const o of parsed.observations) consider(o.startUtc);
  for (const s of parsed.sleep) consider(s.wakeUtc);
  for (const w of parsed.workouts) consider(w.startUtc);
  return min ? localDate(min, timeZone) : null;
}

/** Error text stored on a batch: type of failure only, never payload content. */
function safeError(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && error.name === "OperationError") return "decrypt_failed";
  if (error instanceof Error && error.message === "raw_object_missing") return "raw_object_missing";
  return error instanceof Error ? error.name : "unknown_error";
}

export async function processBatch(env: Env, batchId: string) {
  const batch = await env.DB.prepare("SELECT id, source_id, r2_key, status FROM ingest_batches WHERE id = ?")
    .bind(batchId).first<{ id: string; source_id: string; r2_key: string; status: string }>();
  if (!batch || batch.status === "processed") return;
  const now = new Date().toISOString();
  try {
    const object = await env.RAW.get(batch.r2_key);
    if (!object) throw new Error("raw_object_missing");
    const plain = await decryptBytes(new Uint8Array(await object.arrayBuffer()), env.RAW_ENCRYPTION_KEY);
    const parsed = parseHaePayload(JSON.parse(new TextDecoder().decode(plain)));
    const upserted = await storeParsed({ db: env.DB, sourceId: batch.source_id, batchId, timeZone: env.LOCAL_TIME_ZONE, now }, parsed);
    const skipped = Object.values(parsed.skipped).reduce((a, b) => a + b, 0);
    await env.DB.prepare(
      "UPDATE ingest_batches SET status = 'processed', processed_at = ?, records_upserted = ?, records_skipped = ?, error = ? WHERE id = ?",
    ).bind(now, upserted, skipped, Object.keys(parsed.skipped).length ? JSON.stringify(parsed.skipped) : null, batchId).run();
    // Skip reasons contain metric names and counts only.
    console.log(JSON.stringify({ event: "batch_processed", batchId, upserted, skipped }));
    // A history import reaches back months: rebuild daily metrics from its earliest day, not just the last 10.
    const today = localDate(new Date(), env.LOCAL_TIME_ZONE);
    await recomputeAll(env.DB, today, now, daysBack(today, earliestLocalDate(parsed, env.LOCAL_TIME_ZONE)));
  } catch (error) {
    const reason = safeError(error);
    await env.DB.prepare("UPDATE ingest_batches SET status = 'failed', processed_at = ?, error = ? WHERE id = ?").bind(now, reason, batchId).run();
    console.log(JSON.stringify({ event: "batch_failed", batchId, reason }));
    throw error; // let the queue retry, then dead-letter
  }
}
