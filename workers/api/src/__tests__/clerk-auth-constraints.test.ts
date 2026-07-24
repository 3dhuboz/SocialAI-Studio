import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthUserId } from '../auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signedToken(authorizedParty: string): string {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    sub: 'user_staging_operator',
    azp: authorizedParty,
    iss: 'https://clerk.example.test',
    iat: now,
    nbf: now - 1,
    exp: now + 60,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey)
    .toString('base64url');
  return `${unsigned}.${signature}`;
}

function bearerRequest(token: string): Request {
  return new Request('https://staging.example.test/api/private', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Clerk authorized-party constraints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a correctly signed token from the configured browser origin', async () => {
    const userId = await getAuthUserId(
      bearerRequest(signedToken('https://socialaistudio.au')),
      undefined,
      publicPem,
      undefined,
      undefined,
      { authorizedParties: ['https://socialaistudio.au'] },
    );

    expect(userId).toBe('user_staging_operator');
  });

  it('rejects a correctly signed token from a different browser origin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const userId = await getAuthUserId(
      bearerRequest(signedToken('https://untrusted.example')),
      undefined,
      publicPem,
      undefined,
      undefined,
      { authorizedParties: ['https://socialaistudio.au'] },
    );

    expect(userId).toBeNull();
  });
});
