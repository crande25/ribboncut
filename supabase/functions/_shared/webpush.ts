// Minimal Web Push (RFC 8030 + VAPID RFC 8292) sender for Deno.
// Uses aes128gcm content encoding (RFC 8188) — supported by all modern push services.

const encoder = new TextEncoder();

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function importVapidPrivateKey(privateKeyB64Url: string, publicKeyB64Url: string): Promise<CryptoKey> {
  const d = privateKeyB64Url;
  const pub = b64urlDecode(publicKeyB64Url);
  // Uncompressed P-256: 0x04 || X(32) || Y(32)
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("Invalid VAPID public key format");
  const x = b64urlEncode(pub.slice(1, 33));
  const y = b64urlEncode(pub.slice(33, 65));
  const jwk = { kty: "EC", crv: "P-256", d, x, y, ext: true };
  return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(audience: string, subject: string, vapidPublic: string, vapidPrivate: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 hours
  const payload = { aud: audience, exp, sub: subject };
  const encHeader = b64urlEncode(encoder.encode(JSON.stringify(header)));
  const encPayload = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await importVapidPrivateKey(vapidPrivate, vapidPublic);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

interface PushKeys {
  p256dh: string; // base64url, uncompressed P-256 public key (65 bytes)
  auth: string;   // base64url, 16-byte auth secret
}

/**
 * Encrypt payload using aes128gcm content encoding (RFC 8188).
 * Returns the encrypted body and the local public key (used as keyid).
 */
async function encryptPayload(
  payload: Uint8Array,
  recipient: PushKeys,
): Promise<{ body: Uint8Array; localPublicRaw: Uint8Array }> {
  const recipientPub = b64urlDecode(recipient.p256dh);
  const authSecret = b64urlDecode(recipient.auth);

  // 1. Generate ephemeral ECDH keypair
  const local = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));

  // 2. Import recipient public for ECDH
  const recipientKey = await crypto.subtle.importKey(
    "raw", recipientPub, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );

  // 3. Derive shared ECDH secret
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: recipientKey }, local.privateKey, 256),
  );

  // 4. PRK_key = HKDF(authSecret, shared, info="WebPush: info\0" || recipientPub || localPub, 32)
  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    recipientPub,
    localPubRaw,
  );
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  // 5. Random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 6. CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  // 7. NONCE = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  // 8. Pad: payload || 0x02 (last record marker)
  const padded = concat(payload, new Uint8Array([0x02]));

  // 9. Encrypt with AES-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );

  // 10. Build aes128gcm header: salt(16) || rs(4 BE) || idlen(1) || keyid
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const idlen = new Uint8Array([localPubRaw.length]);
  const header = concat(salt, rs, idlen, localPubRaw);
  const body = concat(header, ct);

  return { body, localPublicRaw: localPubRaw };
}

export interface SendResult {
  ok: boolean;
  status: number;
  error?: string;
  /** True if push service indicates the subscription is gone forever. */
  gone: boolean;
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: object | string,
  opts: { vapidPublic: string; vapidPrivate: string; vapidSubject: string; ttl?: number },
): Promise<SendResult> {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await signVapidJwt(audience, opts.vapidSubject, opts.vapidPublic, opts.vapidPrivate);

  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  const { body } = await encryptPayload(encoder.encode(payloadStr), {
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": String(opts.ttl ?? 86400),
      "Authorization": `vapid t=${jwt}, k=${opts.vapidPublic}`,
    },
    body,
  });

  const gone = res.status === 404 || res.status === 410;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: errText.slice(0, 300), gone };
  }
  return { ok: true, status: res.status, gone: false };
}
