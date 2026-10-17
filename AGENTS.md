# AGENTS.md

## Project

`@cubicecho/graphql-better-auth` builds a GraphQL schema extension (SDL and resolvers) from a better-auth instance.
Every `auth.api` endpoint a client may call becomes a field: GETs become queries and the rest become mutations. Body
and query schemas become arguments, and documented responses and models become types. Redirect targets (OAuth
callbacks, path-parameter routes) stay HTTP. It started inside [telos](https://github.com/cubicecho/telos), which is
still its main consumer.

## Layout

- `src/index.ts`: the public API (`betterAuthGraphQL`, `applyBetterAuthGraphQL`, options).
- `src/patches.ts`: `BUILT_IN_PATCHES`, the corrections to responses better-auth documents wrongly, and `patchResult`.
- `src/operations.ts`: reads endpoints and models off the auth instance (`describeOperations`, `describeModels`).
- `src/sdl.ts`: JSON Schema to SDL (`SdlBuilder`).
- `src/resolvers.ts`: one resolver per operation, and `toGraphQLError`.
- `src/json-schema.ts`: the slice of JSON Schema better-auth uses, and its helpers.

## Rules

- The surface is derived from the auth instance, never listed. Do not hardcode endpoint names except as exceptions
  (`HTTP_ONLY`, `REDIRECT_ARGS`, `USER_INPUT_PATHS`, `BUILT_IN_PATCHES`), each with a comment saying why.
- A resolver adds no auth checks of its own: better-auth does them. Host rules go in `before` or `around`.
- What GraphQL cannot express (open records, unions of unlike things, untyped values) becomes the JSON scalar rather
  than a guess.
- `BUILT_IN_PATCHES` fixes places where better-auth's documented response is wrong. Every patch has a `reason`, and an
  `applies` check that is false once the docs are right, so a better-auth fix makes the patch step aside rather than
  double-patch. A new patch also gets a case in `src/patches.test.ts`, which compares the served fields with what the
  endpoint really returns. When better-auth has fixed one across the whole peer range, delete it.

## Stack

- TypeScript, strict, ESM only. Source uses `.ts` import specifiers, which `tsc` rewrites to `.js` (`dist/`).
- Tests: vitest, against a real better-auth with the memory adapter (`src/*.test.ts`).
- Biome for lint and format.
- Peer dependencies: `better-auth` `^1.7.0`, `graphql` `^16 || ^17`. CI runs the suite against the lowest and latest
  of each.

## Scripts

```bash
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run check      # biome check, then typecheck
npm run build      # tsc -> dist/
```

## Releases

semantic-release on `main`, from Conventional Commits (`feat:` minor, `fix:` patch, `feat!:` major). The release
workflow runs after the Test workflow passes, publishes to npm and tags `v<version>`.
