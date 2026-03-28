/**
 * src/services/db.ts
 * Client-side API helper for the Cloudflare Worker D1 database.
 * Replaces all direct Firestore SDK calls.
 */

const BASE = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

type GetToken = () => Promise<string | null>;
type AuthMode = 'clerk' | 'portal';

// ── Fetch wrapper ─────────────────────────────────────────────────────────────

async function apiFetch(
  getToken: GetToken,
  path: string,
  options: RequestInit = {},
  authMode: AuthMode = 'clerk',
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = authMode === 'portal' ? `Portal ${token}` : `Bearer ${token}`;
  }
  return fetch(`${BASE}${path}`, { ...options, headers });
}

// ── Shared types ──────────────────────────────────────────────────────────────

export interface DbUserData {
  id?: string;
  email?: string | null;
  plan?: string | null;
  setup_status?: string | null;
  is_admin?: number;
  onboarding_done?: number;
  intake_form_done?: number;
  agency_billing_url?: string | null;
  late_profile_id?: string | null;
  late_connected_platforms?: string | string[];
  late_account_ids?: string | Record<string, string>;
  fal_api_key?: string | null;
  paypal_subscription_id?: string | null;
  profile?: string | object;
  stats?: string | object;
  insight_report?: string | object | null;
}

export interface DbPost {
  id: string;
  user_id?: string;
  client_id?: string | null;
  content: string;
  platform?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  hashtags?: string[] | string;
  image_url?: string | null;
  topic?: string | null;
  pillar?: string | null;
  late_post_id?: string | null;
  image_prompt?: string | null;
  reasoning?: string | null;
  post_type?: string | null;
  video_script?: string | null;
  video_shots?: string | null;
  video_mood?: string | null;
}

export interface DbClient {
  id: string;
  user_id?: string;
  name: string;
  business_type?: string | null;
  created_at?: string;
  plan?: string | null;
  profile?: object;
  stats?: object;
  insightReport?: object | null;
  late_profile_id?: string | null;
  lateConnectedPlatforms?: string[];
  lateAccountIds?: Record<string, string>;
  client_slug?: string | null;
}

// ── DB factory ────────────────────────────────────────────────────────────────

export function createDb(getToken: GetToken, authMode: AuthMode = 'clerk') {
  const f = (path: string, opts: RequestInit = {}) => apiFetch(getToken, path, opts, authMode);
  const j = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
  const put = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body) });
  const del = () => ({ method: 'DELETE' });

  return {
    // ── User ──────────────────────────────────────────────────────────────────
    async getUser(): Promise<DbUserData | null> {
      const res = await f('/api/db/user');
      const data = await res.json() as { user: DbUserData | null };
      return data.user;
    },

    async upsertUser(fields: Record<string, unknown>): Promise<void> {
      await f('/api/db/user', put(fields));
    },

    // ── Posts ─────────────────────────────────────────────────────────────────
    async getPosts(clientId?: string | null): Promise<DbPost[]> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/posts${qs}`);
      const data = await res.json() as { posts: DbPost[] };
      return data.posts ?? [];
    },

    async createPost(post: Omit<DbPost, 'id'> & { clientId?: string | null }): Promise<string> {
      const res = await f('/api/db/posts', j(post));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updatePost(id: string, fields: Partial<DbPost>): Promise<void> {
      await f(`/api/db/posts/${id}`, put(fields));
    },

    async deletePost(id: string): Promise<void> {
      await f(`/api/db/posts/${id}`, del());
    },

    async deleteAllPosts(clientId?: string | null): Promise<void> {
      const params = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      await f(`/api/db/posts${params}`, del());
    },

    async bulkUpdatePostStatus(ids: string[], status: string): Promise<void> {
      await f('/api/db/posts/bulk-status', j({ ids, status }));
    },

    async getClientPostHealth(clientId: string): Promise<Pick<DbPost, 'id' | 'scheduled_for' | 'status'>[]> {
      const res = await f(`/api/db/posts/client-health?clientId=${encodeURIComponent(clientId)}`);
      const data = await res.json() as { posts: Pick<DbPost, 'id' | 'scheduled_for' | 'status'>[] };
      return data.posts ?? [];
    },

    // ── Clients ───────────────────────────────────────────────────────────────
    async getClients(): Promise<DbClient[]> {
      const res = await f('/api/db/clients');
      const data = await res.json() as { clients: DbClient[] };
      return data.clients ?? [];
    },

    async getClient(id: string): Promise<DbClient | null> {
      const res = await f(`/api/db/clients/${id}`);
      const data = await res.json() as { client: DbClient | null };
      return data.client;
    },

    async createClient(client: { name: string; businessType?: string; createdAt?: string; plan?: string | null }): Promise<string> {
      const res = await f('/api/db/clients', j(client));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updateClient(id: string, fields: Record<string, unknown>): Promise<void> {
      await f(`/api/db/clients/${id}`, put(fields));
    },

    async deleteClient(id: string): Promise<void> {
      await f(`/api/db/clients/${id}`, del());
    },

    // ── Portal ────────────────────────────────────────────────────────────────
    async getPortal(slug: string): Promise<{ email: string; password: string } | null> {
      const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`);
      const data = await res.json() as { portal: { email: string; password: string } | null };
      return data.portal;
    },

    async setPortal(slug: string, email: string, password: string): Promise<void> {
      await f(`/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`, put({ email, password }));
    },

    // ── Activations / Cancellations ───────────────────────────────────────────
    async getActivation(email?: string | null): Promise<Record<string, unknown> | null> {
      const qs = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await f(`/api/db/activations${qs}`);
      const data = await res.json() as { activation: Record<string, unknown> | null };
      return data.activation;
    },

    async consumeActivation(id: string): Promise<void> {
      await f(`/api/db/activations/${id}/consume`, put({}));
    },

    async getCancellation(email?: string | null): Promise<Record<string, unknown> | null> {
      const qs = email ? `?email=${encodeURIComponent(email)}` : '';
      const res = await f(`/api/db/cancellations${qs}`);
      const data = await res.json() as { cancellation: Record<string, unknown> | null };
      return data.cancellation;
    },

    async consumeCancellation(id: string): Promise<void> {
      await f(`/api/db/cancellations/${id}/consume`, put({}));
    },

    async deleteUser(): Promise<void> {
      await f('/api/db/user', del());
    },

    // ── Social Tokens ─────────────────────────────────────────────────────────
    // Stored in dedicated D1 column — never cached in localStorage
    async getSocialTokens(clientId?: string | null): Promise<Record<string, unknown>> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/social-tokens${qs}`);
      const data = await res.json() as { tokens: Record<string, unknown> };
      return data.tokens ?? {};
    },

    async setSocialTokens(tokens: Record<string, unknown>, clientId?: string | null): Promise<void> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      await f(`/api/db/social-tokens${qs}`, put(tokens));
    },
  };
}

export type DbClient_ = ReturnType<typeof createDb>;
