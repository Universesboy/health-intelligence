// Web Crypto only (works in Workers and Node 22).

const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("RAW_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  return Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function aesKey(hexKey: string) {
  return crypto.subtle.importKey("raw", fromHex(hexKey), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output = 12-byte IV followed by ciphertext+tag. */
export async function encryptBytes(plain: Uint8Array, hexKey: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(hexKey), plain));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

export async function decryptBytes(sealed: Uint8Array, hexKey: string): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(hexKey), sealed.slice(12)));
}

/** Random bearer token for a new data source (shown once, only its hash is stored). */
export function newToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
