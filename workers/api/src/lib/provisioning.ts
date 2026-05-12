// Best-effort external-service provisioning for new whitelabel portals.
//
// Two helpers, both never throw — they return { created/projectCreated, error? }
// so the caller can surface partial successes in the response and tell the
// human which manual steps remain.
//
//   tryCreateClerkUser       — POST /v1/users on Clerk Backend API
//   tryCreateCFPagesProject  — POST /pages/projects + POST /domains on CF
//
// Both are gated on the necessary env vars being present; if not, they
// return early with a descriptive error. Used by POST
// /api/admin/portals/provision in routes/admin-actions.ts.
//
// Extracted from src/index.ts as Phase B step 21 of the route-module split.

import type { Env } from '../env';

/**
 * Create a Clerk user via the Backend API. Returns { created, userId?, error? }.
 * Never throws — caller decides how to handle failures.
 *
 * Clerk's instance settings determine whether passwords or email-only signups
 * are allowed; if the instance disallows passwords, this fails gracefully and
 * the caller falls back to printing a manual-create instruction.
 */
export async function tryCreateClerkUser(
  secretKey: string,
  email: string,
  password: string,
  publicMetadata: Record<string, unknown>,
): Promise<{ created: boolean; userId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: [email],
        password,
        skip_password_checks: true,    // we generate a 24-byte base64url password, well above any sane minimum
        skip_password_requirement: false,
        public_metadata: publicMetadata,
      }),
    });
    if (res.ok) {
      const data = await res.json() as { id?: string };
      return { created: true, userId: data.id };
    }
    // Clerk returns 422 with a structured `errors` array on validation failures
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json() as { errors?: Array<{ message?: string; code?: string; long_message?: string }> };
      if (data.errors && data.errors[0]) {
        const e = data.errors[0];
        errMsg = e.long_message || e.message || e.code || errMsg;
      }
    } catch { /* keep HTTP fallback */ }
    return { created: false, error: errMsg };
  } catch (e: any) {
    return { created: false, error: e?.message || 'fetch failed' };
  }
}

/**
 * Create a Cloudflare Pages project pointing at the SocialAI-Studio repo,
 * with build command + env vars baked in, then attach the custom domain.
 *
 * Gated on CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID being present —
 * if either is missing the function returns { projectCreated: false,
 * error: 'CLOUDFLARE_API_TOKEN not configured' } and the caller falls
 * back to manual instructions.
 *
 * IMPORTANT prerequisite: the Cloudflare account must already have
 * authorized GitHub access to the repo (one-time OAuth grant in the
 * dashboard). The CF Pages REST API can't bootstrap that authorization
 * itself — once it's granted, this function works for every subsequent
 * portal.
 *
 * Two API calls happen:
 *   1. POST .../pages/projects        — create the project
 *   2. POST .../pages/projects/{name}/domains — attach the custom domain
 *
 * If step 1 fails the function returns early; step 2 only runs if step 1
 * succeeded. Both successes/failures surface as separate booleans on the
 * return value so the caller can build a precise manualSteps list.
 */
export async function tryCreateCFPagesProject(
  env: Env,
  args: { projectName: string; slug: string; customDomain: string; envVars: Record<string, string> },
): Promise<{
  projectCreated: boolean;
  domainAttached: boolean;
  projectName?: string;
  error?: string;
}> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: !token ? 'CLOUDFLARE_API_TOKEN not configured' : 'CLOUDFLARE_ACCOUNT_ID not configured',
    };
  }

  const repoOwner = env.GITHUB_REPO_OWNER || '3dhuboz';
  const repoName  = env.GITHUB_REPO_NAME  || 'SocialAI-Studio';
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // CF Pages env_vars take a { value, type } shape per key. "plain_text" is
  // the default; "secret_text" encrypts at rest. We use "plain_text" for
  // VITE_* (they're baked into the public bundle anyway) and "secret_text"
  // for the auto-login password + portal secret + FB secrets which should
  // not appear in the dashboard plaintext.
  const SECRETS = new Set(['VITE_AUTO_LOGIN_PASSWORD', 'VITE_PORTAL_SECRET', 'FACEBOOK_APP_SECRET']);
  const envForCF: Record<string, { value: string; type: string }> = {};
  for (const [k, v] of Object.entries(args.envVars)) {
    envForCF[k] = { value: v, type: SECRETS.has(k) ? 'secret_text' : 'plain_text' };
  }

  // Step 1 — create the project
  let createOk = false;
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: args.projectName,
        production_branch: 'main',
        source: {
          type: 'github',
          config: {
            owner: repoOwner,
            repo_name: repoName,
            production_branch: 'main',
            pr_comments_enabled: false,
            deployments_enabled: true,
            production_deployment_enabled: true,
            preview_deployment_setting: 'none',
          },
        },
        build_config: {
          build_command: `cp src/client.configs/${args.slug}.ts src/client.config.ts && npm run build`,
          destination_dir: 'dist',
          root_dir: '/',
        },
        deployment_configs: {
          production: { env_vars: envForCF },
        },
      }),
    });
    if (res.ok) {
      createOk = true;
    } else {
      let errMsg = `HTTP ${res.status}`;
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        if (data.errors && data.errors[0]?.message) errMsg = data.errors[0].message;
      } catch { /* keep HTTP fallback */ }
      return {
        projectCreated: false,
        domainAttached: false,
        error: `CF Pages project create failed: ${errMsg}`,
      };
    }
  } catch (e: any) {
    return {
      projectCreated: false,
      domainAttached: false,
      error: `CF Pages project create error: ${e?.message || 'fetch failed'}`,
    };
  }

  // Step 2 — attach the custom domain. SSL provisioning is async; this call
  // returns immediately with the domain in pending status. CF will issue
  // the cert in the background (~5 min).
  let domainOk = false;
  let domainErr: string | undefined;
  try {
    const domainUrl = `${baseUrl}/${encodeURIComponent(args.projectName)}/domains`;
    const res = await fetch(domainUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: args.customDomain }),
    });
    if (res.ok) {
      domainOk = true;
    } else {
      try {
        const data = await res.json() as { errors?: Array<{ message?: string }> };
        domainErr = data.errors?.[0]?.message || `HTTP ${res.status}`;
      } catch { domainErr = `HTTP ${res.status}`; }
    }
  } catch (e: any) {
    domainErr = e?.message || 'fetch failed';
  }

  return {
    projectCreated: createOk,
    domainAttached: domainOk,
    projectName: createOk ? args.projectName : undefined,
    error: domainErr ? `Custom domain attach failed: ${domainErr}` : undefined,
  };
}
