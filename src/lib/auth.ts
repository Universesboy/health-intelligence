import type { Context, Next } from "hono";
import type { Env } from "../env";
import { verifyAccessJwt } from "./access-jwt";
import { sha256Hex } from "./crypto";

export type AppEnv = { Bindings: Env; Variables: { email: string; sourceId: string } };

/** Browser pages: require a valid Cloudflare Access token (signature, audience, issuer, expiry). */
export async function requireAccess(c: Context<AppEnv>, next: Next) {
  if (c.env.AUTH_MODE === "dev-insecure") {
    const host = new URL(c.req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return c.text("dev-insecure mode is only allowed on localhost", 403);
    c.set("email", "dev@localhost");
    return next();
  }
  const token = c.req.header("cf-access-jwt-assertion");
  const { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud } = c.env;
  if (!token || !team || !aud) return c.text("Unauthorized", 401);
  const identity = await verifyAccessJwt(token, team, aud);
  if (!identity) return c.text("Unauthorized", 401);
  c.set("email", identity.email);
  return next();
}

/** Machine ingest: per-source bearer token. Only the SHA-256 of a token is stored. */
export async function requireSourceToken(c: Context<AppEnv>, next: Next) {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return c.json({ error: "unauthorized" }, 401);
  const hash = await sha256Hex(match[1]!.toLowerCase());
  const row = await c.env.DB.prepare("SELECT id FROM sources WHERE token_sha256 = ? AND revoked_at IS NULL").bind(hash).first<{ id: string }>();
  if (!row) return c.json({ error: "unauthorized" }, 401);
  c.set("sourceId", row.id);
  return next();
}
