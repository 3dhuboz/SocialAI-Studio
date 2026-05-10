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
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${options.method || 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res;
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
  fal_api_key?: string | null;
  paypal_subscription_id?: string | null;
  profile?: string | object;
  stats?: string | object;
  insight_report?: string | object | null;
  /** v5 — single reel credits balance. Plan grants + purchased credits both
   *  accrue here. Reel generation decrements by 1. Never expires. */
  reel_credits?: number;
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
  // v5 — scheduled reels pipeline. video_url populated by prewarm cron; the
  // rest track lifecycle so polling resumes across cron ticks.
  video_url?: string | null;
  video_status?: 'pending' | 'generating' | 'ready' | 'failed' | null;
  video_request_id?: string | null;
  video_started_at?: string | null;
  video_error?: string | null;
  r2_video_key?: string | null;
  audio_mixed_url?: string | null;
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
  client_slug?: string | null;
  /** v5 — per-client reel credits (Agency workspaces). Same semantics as users.reel_credits. */
  reel_credits?: number;
}

export interface DbCampaign {
  id: string;
  user_id?: string;
  client_id?: string | null;
  name: string;
  type?: string;
  start_date?: string | null;
  end_date?: string | null;
  rules?: string;
  posts_per_day?: number;
  enabled?: number;
  created_at?: string;
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
      await f('/api/db/posts/delete-all', j({ clientId: clientId || null }));
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

    // ── Campaigns ────────────────────────────────────────────────────────────
    async getCampaigns(clientId?: string | null): Promise<DbCampaign[]> {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await f(`/api/db/campaigns${qs}`);
      const data = await res.json() as { campaigns: DbCampaign[] };
      return data.campaigns ?? [];
    },

    async createCampaign(campaign: { name: string; type?: string; startDate?: string; endDate?: string; rules?: string; postsPerDay?: number; enabled?: boolean; clientId?: string | null }): Promise<string> {
      const res = await f('/api/db/campaigns', j(campaign));
      const data = await res.json() as { id: string };
      return data.id;
    },

    async updateCampaign(id: string, fields: Partial<{ name: string; type: string; startDate: string; endDate: string; rules: string; postsPerDay: number; enabled: boolean }>): Promise<void> {
      await f(`/api/db/campaigns/${id}`, put(fields));
    },

    async deleteCampaign(id: string): Promise<void> {
      await f(`/api/db/campaigns/${id}`, del());
    },

    // ── Portal ────────────────────────────────────────────────────────────────
    async getPortal(slug: string): Promise<{ email: string; password: string } | null> {
      try {
        const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`);
        if (!res.ok) return null;
        const data = await res.json() as { portal: { email: string; password: string } | null };
        return data.portal;
      } catch {
        return null;
      }
    },

    async setPortal(slug: string, email: string, password: string): Promise<void> {
      await f(`/api/db/portal/${encodeURIComponent(slug.toLowerCase())}`, put({ email, password }));
    },

    async getPortalContent(slug: string): Promise<{ hero_title: string; hero_subtitle: string; hero_cta_text: string }> {
      try {
        const res = await fetch(`${BASE}/api/db/portal/${encodeURIComponent(slug.toLowerCase())}/content`);
        if (!res.ok) return { hero_title: '', hero_subtitle: '', hero_cta_text: '' };
        const data = await res.json() as { content: { hero_title: string; hero_subtitle: string; hero_cta_text: string } };
        return data.content;
      } catch { return { hero_title: '', hero_subtitle: '', hero_cta_text: '' }; }
    },

    async setPortalContent(slug: string, content: { hero_title?: string; hero_subtitle?: string; hero_cta_text?: string }): Promise<void> {
      await f(`/api/db/portal/${encodeURIComponent(slug.toLowerCase())}/content`, put(content));
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

    // ── Admin: Customers dashboard ────────────────────────────────────────────
    // All endpoints below require users.is_admin=1 in D1. Calls fail with 403
    // for non-admin signed-in users.

    async getAdminStats(): Promise<AdminStats> {
      const res = await f('/api/admin/stats');
      return res.json() as Promise<AdminStats>;
    },

    async getAdminCustomers(
      filter: 'all' | 'trial' | 'paid' | 'cancelled' = 'all',
      limit = 50,
      offset = 0,
    ): Promise<{ customers: AdminCustomer[]; total: number; limit: number; offset: number; filter: string }> {
      const qs = `?filter=${filter}&limit=${limit}&offset=${offset}`;
      const res = await f(`/api/admin/customers${qs}`);
      return res.json() as Promise<{ customers: AdminCustomer[]; total: number; limit: number; offset: number; filter: string }>;
    },

    async getAdminPayments(email?: string, limit = 20): Promise<{ payments: PaymentEvent[] }> {
      const parts: string[] = [];
      if (email) parts.push(`email=${encodeURIComponent(email)}`);
      parts.push(`limit=${limit}`);
      const res = await f(`/api/admin/payments?${parts.join('&')}`);
      return res.json() as Promise<{ payments: PaymentEvent[] }>;
    },

    // ── Customer: Billing screen ──────────────────────────────────────────────
    // Returns the SIGNED-IN user's plan + their own payment history.

    async getBilling(): Promise<BillingInfo> {
      const res = await f('/api/billing');
      return res.json() as Promise<BillingInfo>;
    },
  };
}

// ── Admin / billing types ─────────────────────────────────────────────────────

export interface AdminStats {
  signups_total: number;
  signups_7d: number;
  signups_30d: number;
  active_subs: number;
  mrr_cents: number;
  revenue_30d_cents: number;
  churn_30d: number;
  trial_users: number;
}

export interface AdminCustomer {
  id: string;
  email: string | null;
  plan: string | null;
  setup_status: string | null;
  is_admin: number;
  paypal_subscription_id: string | null;
  created_at: string | null;
  onboarding_done: number;
  last_post_at: string | null;
  post_count: number;
  total_paid_cents: number;
  total_refunded_cents: number;
}

export interface PaymentEvent {
  id?: string;
  email?: string | null;
  event_type: string;
  amount_cents: number | null;
  currency: string | null;
  status: 'completed' | 'cancelled' | 'refunded' | 'failed' | string;
  plan: string | null;
  paypal_subscription_id?: string | null;
  paypal_capture_id?: string | null;
  created_at: string;
}

export interface BillingInfo {
  email: string | null;
  plan: string | null;
  plan_price_aud: number | null;
  subscription_id: string | null;
  member_since: string | null;
  payments: PaymentEvent[];
}

export type DbClient_ = ReturnType<typeof createDb>;
