// Imperative shell: seal a TokenBundle into an opaque, tamper-evident string for
// the site's own HttpOnly session cookie, and reverse it. AES-256-GCM via Web
// Crypto (available on Cloudflare Workers and modern Node); the symmetric key is
// derived from a site secret so the browser can never read or forge the bundle.
// The base64url framing is pure; the encrypt/decrypt are the only side effects.
import { z } from 'zod';
import type { TokenBundle } from './token-bundle';

const bundleSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  customer: z.object({
    id: z.string().min(1),
    firstName: z.string().optional(),
    email: z.string().optional(),
  }),
});

const IV_BYTES = 12;

export async function sealSession(bundle: TokenBundle, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encodeUtf8(JSON.stringify(bundle));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function unsealSession(
  sealed: string | null | undefined,
  secret: string,
): Promise<TokenBundle | null> {
  if (!sealed) return null;

  const [ivPart, dataPart] = sealed.split('.');
  const iv = fromBase64Url(ivPart);
  const ciphertext = fromBase64Url(dataPart);
  if (!iv || !ciphertext) return null;

  try {
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const parsed = bundleSchema.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
    return parsed.success ? parsed.data : null;
  } catch {
    // Tampered payload, wrong/rotated secret, or malformed JSON → treat as no
    // session (fail closed to anonymous). Never throw at the cookie boundary.
    return null;
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encodeUtf8(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ArrayBuffer-backed views: Web Crypto's BufferSource requires an ArrayBuffer
// backing store, which the TextEncoder/typed-array generics don't guarantee.
function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!value) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
