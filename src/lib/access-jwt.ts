// Copied from Coachchalk (lib/access-jwt.ts) so both apps verify Access tokens the same way.
// Cloudflare Access application token verification. Pure Web Crypto, no framework imports.

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null;

function base64UrlBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function base64UrlJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;
}

async function accessKeys(teamDomain: string, forceRefresh = false) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (!forceRefresh && jwksCache?.url === url && Date.now() - jwksCache.fetchedAt < 60 * 60_000) return jwksCache.keys;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Cloudflare Access signing keys are unavailable.");
  const body = (await response.json()) as { keys?: Jwk[] };
  jwksCache = { url, keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

/** Verifies the Cloudflare Access application token (RS256) before trusting any identity claim. */
export async function verifyAccessJwt(token: string, teamDomain: string, audience: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = parts;
  const header = base64UrlJson<{ alg?: string; kid?: string }>(encodedHeader);
  if (header.alg !== "RS256" || !header.kid) return null;
  let key = (await accessKeys(teamDomain)).find((candidate) => candidate.kid === header.kid);
  if (!key) key = (await accessKeys(teamDomain, true)).find((candidate) => candidate.kid === header.kid);
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    base64UrlBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) return null;
  const claims = base64UrlJson<{ aud?: string | string[]; exp?: number; nbf?: number; iss?: string; sub?: string; email?: string }>(encodedPayload);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return null;
  if (claims.iss !== `https://${teamDomain}`) return null;
  const seconds = Math.floor(now / 1000);
  if (!claims.exp || claims.exp < seconds || (claims.nbf && claims.nbf > seconds + 60)) return null;
  if (!claims.sub || !claims.email) return null;
  return { userId: claims.sub, email: claims.email.toLowerCase() };
}
