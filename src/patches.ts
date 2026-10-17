import type { JsonSchema } from './json-schema.ts';

// Where better-auth documents a response that is not what the endpoint returns.
// The schema is built from those documents, so each mistake here would be a
// wrong GraphQL type. A patch checks for its mistake first: once better-auth
// fixes its docs, the patch steps aside and the documented schema is served.

/** A correction to one endpoint's documented 200 response. */
export interface ResultPatchFix {
  /** What better-auth documents wrongly, and what it returns instead. */
  reason: string;
  /** Whether `documented` still has the mistake. */
  applies: (documented: JsonSchema | undefined) => boolean;
  /** The corrected schema. Only called when `applies` is true. */
  fix: (documented: JsonSchema | undefined) => JsonSchema | undefined;
}

/** The built-in patches, by endpoint name. Checked against better-auth 1.7.10. */
export const BUILT_IN_PATCHES: Readonly<Record<string, ResultPatchFix>> = Object.freeze<Record<string, ResultPatchFix>>(
  {
    magicLinkVerify: {
      reason: 'Documented as `{ session, user }`. Without a `callbackURL` it also returns the session `token`.',
      applies: (documented) => documented?.properties !== undefined && documented.properties.token === undefined,
      fix: (documented) => ({
        ...documented,
        properties: { token: { type: 'string' }, ...documented?.properties },
        required: ['token', ...(documented?.required ?? [])],
      }),
    },
    updateUser: {
      reason: 'Documented as `{ user }`. It returns `{ status: true }`.',
      applies: (documented) => documented?.properties?.status === undefined,
      fix: () => ({ type: 'object', properties: { status: { type: 'boolean' } }, required: ['status'] }),
    },
  },
);

/**
 * An endpoint's documented result with the built-in patch for it applied, if it
 * has one and the mistake is still there.
 *
 * @param name - The endpoint's name on `auth.api`.
 * @param documented - The 200 response better-auth documents.
 * @param patches - The patches to use. Defaults to `BUILT_IN_PATCHES`.
 * @returns The schema to serve.
 */
export function patchResult(
  name: string,
  documented: JsonSchema | undefined,
  patches: Readonly<Record<string, ResultPatchFix>> = BUILT_IN_PATCHES,
): JsonSchema | undefined {
  const patch = Object.hasOwn(patches, name) ? patches[name] : undefined;
  return patch?.applies(documented) ? patch.fix(documented) : documented;
}
