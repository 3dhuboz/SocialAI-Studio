import type { Hono } from 'hono';
import type { Env } from '../env';
import { listDecisionReceipts } from '../lib/learning/decision-repository';
import type { WorkspaceOwnerKind } from '../lib/learning/types';
import { requireAuth } from '../middleware/auth';

type OwnedPostRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  owner_kind: string | null;
  owner_id: string | null;
};

type DecisionRow = Record<string, unknown> & {
  id: string;
  summary_json?: string | null;
};

type VerdictRow = Record<string, unknown> & {
  decision_id: string;
  evidence_json?: string | null;
  repair_json?: string | null;
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonStrings(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function registerLearningRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/learning/*', requireAuth);

  app.get('/api/learning/decisions/:postId', async (c) => {
    const userId = c.get('uid') as string;
    const postId = c.req.param('postId');
    const requestedClientId = c.req.query('clientId')?.trim() || null;
    const post = await c.env.DB.prepare(`
      SELECT id, user_id, client_id, owner_kind, owner_id
      FROM posts
      WHERE id = ? AND user_id = ?
    `).bind(postId, userId).first<OwnedPostRow>();

    if (!post) {
      return c.json({ error: 'Not found' }, 404);
    }

    const clientId = post.client_id?.trim() || null;
    if (requestedClientId !== clientId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const ownerKind: WorkspaceOwnerKind = post.owner_kind === 'shop'
      ? 'shop'
      : clientId === null ? 'user' : 'client';
    if (post.owner_kind && post.owner_kind !== ownerKind) {
      return c.json({ error: 'Not found' }, 404);
    }
    const ownerId = post.owner_id?.trim() || clientId || userId;

    try {
      const decisions = await listDecisionReceipts(
        c.env.DB,
        userId,
        clientId,
        postId,
        20,
        ownerKind,
        ownerId,
      ) as DecisionRow[];
      if (decisions.length === 0) return c.json({ decisions: [] });

      // Decision ids come only from the tenant-scoped parent query above.
      // Verdict rows therefore cannot be fetched by an arbitrary id supplied
      // by the browser.
      const decisionIds = decisions.map((decision) => decision.id);
      const placeholders = decisionIds.map(() => '?').join(',');
      const verdictResult = await c.env.DB.prepare(`
        SELECT * FROM learning_critic_verdicts
        WHERE decision_id IN (${placeholders})
        ORDER BY decision_id, attempt ASC, critic_kind ASC
      `).bind(...decisionIds).all<VerdictRow>();
      const verdictsByDecision = new Map<string, Array<Record<string, unknown>>>();
      for (const verdict of verdictResult.results ?? []) {
        const normalized = {
          ...verdict,
          evidence: parseJsonStrings(verdict.evidence_json),
          repairs: parseJsonStrings(verdict.repair_json),
        };
        const rows = verdictsByDecision.get(verdict.decision_id) ?? [];
        rows.push(normalized);
        verdictsByDecision.set(verdict.decision_id, rows);
      }

      return c.json({
        decisions: decisions.map((decision) => ({
          ...decision,
          summary: parseJsonObject(decision.summary_json),
          verdicts: verdictsByDecision.get(decision.id) ?? [],
        })),
      });
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  });
}
