# @cubicecho/graphql-better-auth

[better-auth](https://www.better-auth.com/)'s endpoints as a GraphQL schema extension. Hand it an auth instance and it
gives back typed SDL and resolvers. Every `auth.api` endpoint a client may call becomes a field, and the types come from
the instance itself, so a new better-auth plugin brings its endpoints along.

- A GET becomes a **query**. Everything else becomes a **mutation**. A GET that spends a one-time `token`
  (`verifyEmail`, `magicLinkVerify`) also counts as a write, so it is a mutation.
- The body's and query's top-level keys become **arguments**, typed from the endpoint's zod schemas. Sign-up and
  update-user also take your `user.additionalFields` and the fields plugins add to the user.
- Documented responses become **result types**, and better-auth's models (`#/components/schemas/User`) become
  `AuthUser`, `AuthSession` and so on, with the fields your config adds.
- Some endpoints stay on HTTP, because a browser is sent to them rather than calling them: OAuth callbacks, routes
  with path parameters, `/ok` and `/error`. Server-only endpoints are left out too.

## Install

```bash
npm install @cubicecho/graphql-better-auth better-auth graphql
```

Peer dependencies: `better-auth` `^1.7.0` and `graphql` `^16 || ^17`. Requires Node 22 or later. ESM only.

## Use

```ts
import { applyBetterAuthGraphQL, betterAuthGraphQL } from '@cubicecho/graphql-better-auth';
import { betterAuth } from 'better-auth';
import { bearer, magicLink } from 'better-auth/plugins';

const auth = betterAuth({ /* database, secret, … */ plugins: [bearer(), magicLink({ sendMagicLink })] });

const built = betterAuthGraphQL<Context>(auth, {
  headers: (ctx) => ctx.headers, // where better-auth finds the session: cookie or bearer token
  include: ['signInMagicLink', 'magicLinkVerify', 'getSession', 'listSessions', 'signOut'],
});

// Extend a graphql-js schema in place…
const schema = applyBetterAuthGraphQL(mySchema, built);

// …or hand the pieces to any other server.
built.typeDefs; // SDL: the types, then `extend type Query` / `extend type Mutation`
built.resolvers; // { Query: {…}, Mutation: {…} }
built.scalars; // { dateTime: 'DateTime', json: 'JSON' }: declare them if your schema has not
```

`applyBetterAuthGraphQL` declares the `DateTime` and `JSON` scalars if the schema doesn't have them, and creates
`Query` or `Mutation` if they are missing. It throws if a field it adds is already on the root type.

```graphql
mutation { signInMagicLink(email: "ada@example.com") { status } }
mutation { magicLinkVerify(token: "…") { token user { id email } } }
query { getSession { user { email } session { expiresAt } } }
```

## Options

`betterAuthGraphQL(auth, options)`

| Option | What it does |
| --- | --- |
| `headers(ctx)` | **Required.** The request's `Headers`, passed to every endpoint. |
| `auth(ctx)` | The auth instance that serves a request. Defaults to the one the schema was built from. Use it when the instance is rebuilt at runtime. |
| `include` | The operations to serve, by endpoint name: an array allowlist or a predicate `(operation) => boolean`. Defaults to all of them. |
| `exclude` | Operations never to serve, by endpoint name. Applied after `include`. |
| `kinds` | Overrides an operation's kind (`'query'` or `'mutation'`), by endpoint name. |
| `fieldName(operation)` | The field name for an operation. Defaults to the endpoint name (`signInEmail`). |
| `typePrefix` | Prefix for every generated type. Defaults to `Auth` (`AuthUser`, `AuthSignInEmailResult`). |
| `scalars` | `{ dateTime, json }`: the scalar names to use. Defaults to `DateTime` and `JSON`. |
| `before(call)` | Runs before every call. Throw to refuse it, for example for rate limiting, captcha, or your own rules about who may call what. |
| `onResponseHeaders(headers, call)` | Gets the headers an endpoint set (`set-cookie`, the bearer plugin's `set-auth-token`). Forward them here if you serve cookies. |
| `mapError(error, call)` | Turns what an endpoint threw into what the caller sees. Defaults to `toGraphQLError`. |
| `operations` | Per-operation changes, by endpoint name. See below. |

### Per operation

```ts
operations: {
  signInMagicLink: {
    // Arguments not to offer: ones not meant for clients, or ones `around` sets itself.
    omitArgs: ['callbackURL', 'metadata'],
    // The result type: a JSON Schema to use instead, or a function of the documented one.
    result: (documented) => ({
      ...documented,
      properties: { ...documented?.properties, sentTo: { type: 'string' } },
    }),
    // Wraps the call. Change `call.body` / `call.query` before `next()`,
    // change the result after it, or answer without calling better-auth at all.
    around: async (call, next) => {
      call.body.email = String(call.body.email).toLowerCase();
      return { ...((await next()) as object), sentTo: call.body.email };
    },
  },
},
```

`call` is `{ operation, args, context, info, body, query }`.

## Errors

`toGraphQLError` turns better-auth's `APIError` into a `GraphQLError`:

- `extensions.code` comes from the HTTP status: `BAD_USER_INPUT` (400, 422), `UNAUTHENTICATED` (401), `FORBIDDEN`
  (403), `NOT_FOUND` (404), `CONFLICT` (409) or `TOO_MANY_REQUESTS` (429).
- `extensions.authCode` is better-auth's own code (`INVALID_EMAIL_OR_PASSWORD`, `INVALID_TOKEN`). This is the one
  clients should branch on.
- Some endpoints fail by redirecting. A spent magic link, for example, redirects to `?error=INVALID_TOKEN`. That code is
  read back out of the redirect URL.

Anything else is rethrown unchanged, for your server to mask.

## Cookie sessions

With the bearer plugin, clients send `Authorization: Bearer <token>` and nothing else is needed. To use cookies
instead, pass the request's cookies in through `headers` and forward the `set-cookie` headers to the response:

```ts
import { graphql } from 'graphql';

interface Context {
  request: Request;
  responseHeaders: Headers;
}

const built = betterAuthGraphQL<Context>(auth, {
  headers: (ctx) => ctx.request.headers,
  onResponseHeaders: (headers, { context }) => {
    for (const cookie of headers.getSetCookie()) context.responseHeaders.append('set-cookie', cookie);
  },
});
const schema = applyBetterAuthGraphQL(mySchema, built);

export async function handle(request: Request): Promise<Response> {
  const { query, variables } = await request.json();
  const context: Context = { request, responseHeaders: new Headers() };
  const result = await graphql({ schema, source: query, variableValues: variables, contextValue: context });
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of context.responseHeaders.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(result), { headers });
}
```

The same goes for any server: read the cookies from the request, and copy what `onResponseHeaders` collects onto the
response.

Your GraphQL endpoint must be on the same site as better-auth's `baseURL` for the cookie to apply. Keep CSRF in mind,
since a cookie-authenticated mutation is a state-changing request.

## Patched results

In some places better-auth's documented response is not what it actually returns. The library corrects these (checked
against better-auth 1.7.10):

- `magicLinkVerify` is documented as `{ session, user }` but also returns the session `token`.
- `updateUser` is documented as `{ user }` but returns `{ status: true }`.

An `operations.<name>.result` of your own is applied after these.

## Lower-level pieces

`describeOperations(auth)` and `describeModels(auth.options)` return the operations and models the schema is built
from, if you want to generate something else from them.

## License

MIT
