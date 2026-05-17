# Middleware migration punch list

The middleware foundation (`src/middleware/auth.ts`, `src/middleware/request-id.ts`)
landed in PR `claude/workers-middleware-foundation`, along with three route
files migrated as proof of pattern:

- `src/routes/user.ts`     — 3 endpoints, 1 `app.use('/api/db/user', requireAuth)`
- `src/routes/clients.ts`  — 5 endpoints, 2 `app.use(...)` (bare + wildcard)
- `src/routes/posts.ts`    — 8 endpoints, 2 `app.use(...)` (bare + wildcard)

The remaining 39 callsites listed below still inline:

```ts
const uid = await getAuthUserId(c.req.raw, c.env.CLERK_SECRET_KEY, c.env.CLERK_JWT_KEY, c.env.DB);
if (!uid) return c.json({ error: 'Unauthorized' }, 401);
```

A follow-up sweep will convert each of these to either:

1. **Group migration** (preferred when every handler in the file uses Clerk
   auth identically) — drop one `app.use('/api/<prefix>', requireAuth)` plus
   a wildcard variant at the top of the `register…Routes` function, then
   replace the inline 2-liner with `const uid = c.get('uid');`.
2. **Per-route middleware** (when some handlers in the same file are public
   or use a different auth mechanism like the bootstrap secret or portal
   token) — pass `requireAuth` as the second argument to the route
   registration: `app.get('/path', requireAuth, async (c) => { ... })`.

After the sweep lands, `getAuthUserId` should only be called from
`src/middleware/auth.ts` and the existing `requireAdmin` helper in
`src/auth.ts`.

---

## Punch list (39 callsites across 15 files)

### `src/routes/activations.ts` — 4 callsites
- [ ] line 35
- [ ] line 45
- [ ] line 53
- [ ] line 63

### `src/routes/admin-actions.ts` — 1 callsite
- [ ] line 33  (note: `requireAdmin` is still the canonical admin gate; this
  one route uses raw `getAuthUserId` for a non-admin operation)

### `src/routes/ai.ts` — 2 callsites
- [ ] line 36
- [ ] line 202

### `src/routes/archetypes.ts` — 3 callsites
- [ ] line 31
- [ ] line 78
- [ ] line 161

### `src/routes/billing.ts` — 1 callsite
- [ ] line 21

### `src/routes/campaigns.ts` — 5 callsites
- [ ] line 58
- [ ] line 68
- [ ] line 80
- [ ] line 106
- [ ] line 131

### `src/routes/facebook.ts` — 1 callsite
- [ ] line 78

### `src/routes/facts.ts` — 3 callsites
- [ ] line 20
- [ ] line 27
- [ ] line 36

### `src/routes/onboarding.ts` — 1 callsite
- [ ] line 32

### `src/routes/paypal.ts` — 1 callsite
- [ ] line 106

### `src/routes/portal.ts` — 2 callsites
- [ ] line 47
- [ ] line 76  (note: some endpoints in this file accept `X-Portal-Secret`
  instead of Clerk auth — confirm which ones before applying the wildcard)

### `src/routes/post-quality.ts` — 2 callsites
- [ ] line 43
- [ ] line 136

### `src/routes/posters.ts` — 9 callsites
- [ ] line 150
- [ ] line 180
- [ ] line 198
- [ ] line 345
- [ ] line 372
- [ ] line 414
- [ ] line 436
- [ ] line 465
- [ ] line 517

### `src/routes/proxies.ts` — 2 callsites
- [ ] line 40
- [ ] line 197

### `src/routes/social-tokens.ts` — 2 callsites
- [ ] line 20
- [ ] line 31

---

## After the sweep

- [ ] `grep -rn 'await getAuthUserId(' src/routes/` returns zero matches.
- [ ] `getAuthUserId` is no longer exported from `src/auth.ts` (made
      module-private) so future routes can't re-introduce the pattern.
- [ ] All inline `{ error: 'Unauthorized' }` 401 responses are replaced with
      the middleware's `{ error: 'unauthorized', requestId }` shape, which
      lets the frontend toast the request id on auth failures.
