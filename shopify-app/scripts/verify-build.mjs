#!/usr/bin/env node
// Post-build sanity check for the shopify-app bundle.
//
// Greps dist/index.html for any literal `%VITE_*%` placeholder strings. A
// match means a `VITE_*` env var was unset at build time and Vite shipped
// the unresolved placeholder as a string into the HTML. App Bridge sees
// garbage where the API key should be, breaks silently, and every merchant
// sees a frozen "Connecting to your shop…" spinner.
//
// Belt-and-braces with the vite.config.ts guard: that one catches
// VITE_SHOPIFY_API_KEY specifically before the build runs; this one catches
// any future VITE_* placeholder that gets templated into HTML and ships
// without substitution. (Caught the 2026-05-21 production outage.)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexPath = resolve(process.cwd(), 'dist/index.html');
let html;
try {
  html = readFileSync(indexPath, 'utf8');
} catch (e) {
  console.error(`[verify-build] cannot read ${indexPath}: ${e.message}`);
  process.exit(1);
}

const matches = html.match(/%VITE_[A-Z0-9_]+%/g);
if (matches && matches.length > 0) {
  const unique = [...new Set(matches)];
  console.error('\n[verify-build] BUILD ARTIFACT IS BROKEN — unresolved Vite placeholders in dist/index.html:');
  for (const placeholder of unique) {
    console.error(`  - ${placeholder}`);
  }
  console.error(
    '\nThese should have been substituted at build time. Set the corresponding env var(s) ' +
    'and re-run `npm run build`. See shopify-app/.env.example for the list of required vars.\n',
  );
  process.exit(1);
}

console.log('[verify-build] dist/index.html OK — no unresolved Vite placeholders');
