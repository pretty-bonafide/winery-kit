import { describe, expect, it } from 'vitest';
import { sealSession, unsealSession } from './session-seal';
import type { TokenBundle } from './token-bundle';

const SECRET = 'pgsk_test_secret_value';

const BUNDLE: TokenBundle = {
  accessToken: 'access.jwt.token',
  refreshToken: 'refresh-credential',
  expiresAt: 1_000_000_060_000,
  customer: { id: 'cust_1', firstName: 'Ada', email: 'ada@example.com' },
};

describe('sealSession / unsealSession', () => {
  it('round-trips a bundle through the same secret', async () => {
    const sealed = await sealSession(BUNDLE, SECRET);
    expect(sealed).toContain('.');
    expect(sealed).not.toContain('access.jwt.token');
    expect(await unsealSession(sealed, SECRET)).toEqual(BUNDLE);
  });

  it('produces a fresh IV each seal (non-deterministic ciphertext)', async () => {
    const a = await sealSession(BUNDLE, SECRET);
    const b = await sealSession(BUNDLE, SECRET);
    expect(a).not.toBe(b);
  });

  it('rejects a bundle sealed with a different secret', async () => {
    const sealed = await sealSession(BUNDLE, SECRET);
    expect(await unsealSession(sealed, 'a-different-secret')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const sealed = await sealSession(BUNDLE, SECRET);
    const [iv, data] = sealed.split('.');
    const tampered = `${iv}.${data.slice(0, -2)}XY`;
    expect(await unsealSession(tampered, SECRET)).toBeNull();
  });

  it('returns null for empty or malformed input', async () => {
    expect(await unsealSession(null, SECRET)).toBeNull();
    expect(await unsealSession('', SECRET)).toBeNull();
    expect(await unsealSession('no-dot', SECRET)).toBeNull();
  });
});
