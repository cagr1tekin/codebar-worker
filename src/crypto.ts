// Web Crypto API — dış bağımlılık yok, Workers'da native çalışır

const enc = new TextEncoder();

// ─── Şifre Hashleme (PBKDF2) ─────────────────────────────────

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  const hash = await deriveKey(password, saltBytes);
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const saltBytes = fromHex(salt);
  const computed = await deriveKey(password, saltBytes);
  return computed === hash;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

// ─── JWT (HS256) ──────────────────────────────────────────────

export async function signJWT(payload: object, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const data   = `${header}.${body}`;
  const key    = await importHMACKey(secret);
  const sig    = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${toB64url(new Uint8Array(sig))}`;
}

export async function verifyJWT<T = Record<string, unknown>>(token: string, secret: string): Promise<T> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Geçersiz token formatı');

  const [header, payload, sigB64] = parts;
  const data = `${header}.${payload}`;
  const key  = await importHMACKey(secret);
  const sig  = fromB64url(sigB64);
  const ok   = await crypto.subtle.verify('HMAC', key, sig, enc.encode(data));
  if (!ok) throw new Error('Token imzası geçersiz');

  const parsed = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as T & { exp?: number };
  if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) throw new Error('Token süresi doldu');
  return parsed;
}

// ─── Store Claim (AES-256-GCM) ───────────────────────────────

export async function encodeStoreClaim(storeId: string, secret: string): Promise<string> {
  const key = await importAESKey(secret);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(storeId));
  const combined = new Uint8Array(iv.byteLength + enc2.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc2), iv.byteLength);
  return toB64url(combined);
}

export async function decodeStoreClaim(token: string, secret: string): Promise<string | null> {
  try {
    const combined = fromB64url(token);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await importAESKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ─── Yardımcılar ─────────────────────────────────────────────

async function importHMACKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function importAESKey(secret: string): Promise<CryptoKey> {
  const bits = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64url(str: string): string {
  return toB64url(enc.encode(str));
}

function toB64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded;
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map(b => parseInt(b, 16)));
}

// ─── UUID ─────────────────────────────────────────────────────

export function newUUID(): string {
  return crypto.randomUUID();
}
