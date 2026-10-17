import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { bearer, magicLink } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { betterAuthGraphQL } from './index.ts';
import { describeOperations } from './operations.ts';
import { BUILT_IN_PATCHES, patchResult } from './patches.ts';

const magicTokens = new Map<string, string>();

function createAuth() {
  return betterAuth({
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: 'a-test-secret-that-is-long-enough-for-better-auth',
    baseURL: 'http://localhost:3000',
    emailAndPassword: { enabled: true },
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, token }) => {
          magicTokens.set(email, token);
        },
      }),
    ],
  });
}

/** The top-level keys of the result each operation is served with. */
function servedKeys(auth: ReturnType<typeof createAuth>, builtInPatches?: boolean): Record<string, string[]> {
  const { operations } = betterAuthGraphQL(auth, { headers: () => new Headers(), builtInPatches });
  return Object.fromEntries(
    operations.map((operation) => [operation.name, Object.keys(operation.result?.properties ?? {}).sort()]),
  );
}

describe('the built-in patches', () => {
  it('serve exactly the fields each patched endpoint returns', async () => {
    const auth = createAuth();
    const served = servedKeys(auth);

    await auth.api.signInMagicLink({ body: { email: 'bo@example.com' }, headers: new Headers() });
    const verified = await auth.api.magicLinkVerify({
      query: { token: magicTokens.get('bo@example.com') ?? '' },
      headers: new Headers(),
    });
    expect(served.magicLinkVerify).toEqual(Object.keys(verified ?? {}).sort());

    const { token } = await auth.api.signUpEmail({
      body: { email: 'ada@example.com', password: 'correct horse battery', name: 'Ada' },
    });
    const updated = await auth.api.updateUser({
      body: { name: 'Ada L.' },
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    expect(served.updateUser).toEqual(Object.keys(updated).sort());
  });

  it('cover only endpoints that exist', () => {
    const names = new Set(describeOperations(createAuth()).map((operation) => operation.name));
    for (const name of Object.keys(BUILT_IN_PATCHES)) {
      expect(names).toContain(name);
    }
  });

  it('step aside once the documented response is right', () => {
    const right = {
      type: 'object' as const,
      properties: { token: { type: 'string' as const }, session: {}, user: {} },
      required: ['token'],
    };
    expect(patchResult('magicLinkVerify', right)).toBe(right);

    const status = { type: 'object' as const, properties: { status: { type: 'boolean' as const } } };
    expect(patchResult('updateUser', status)).toBe(status);
  });

  it('leave an endpoint without a patch alone', () => {
    const documented = { type: 'object' as const, properties: { user: {} } };
    expect(patchResult('getSession', documented)).toBe(documented);
    expect(patchResult('toString', documented)).toBe(documented);
  });

  it('can be turned off, serving what better-auth documents', () => {
    const served = servedKeys(createAuth(), false);
    expect(served.updateUser).toEqual(['user']);
    expect(served.magicLinkVerify).toEqual(['session', 'user']);
  });
});
