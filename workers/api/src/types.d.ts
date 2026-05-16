// Hono context-variable typings for the worker.
//
// Declares which keys may appear in `c.set(...)` / `c.get(...)`. Without this,
// every call site has to cast through `any` or accept `unknown`. Augmenting
// ContextVariableMap lets the middleware contract speak for itself — calling
// `c.get('uid')` after `requireAuth` returns a `string`, full stop.
//
// Add a new variable here whenever a middleware wants to expose state to
// downstream handlers (e.g. resolved client, parsed body, feature flags).

import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    uid: string;
    requestId: string;
  }
}
