import { normalizeWorkspaceIdentity } from '../learning/types';
import {
  localWeekdayHour,
  rankPostingWindows,
  type RankedWindow,
  type TimingEvidence,
} from './timing-model';
import type { OrganicPlatform, ReachWorkspaceScope } from './types';

type TimingFactRow = {
  metadata: string | null;
  engagement_score: number | null;
};

const NAIVE_AEST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

const FALLBACK_WINDOWS: readonly RankedWindow[] = [
  {
    weekday: 5,
    startHour: 17,
    endHour: 19,
    platform: 'facebook',
    mediaType: 'image',
    expectedScore: 50,
    confidence: 0.25,
    sampleSize: 0,
    source: 'archetype',
  },
  {
    weekday: 6,
    startHour: 11,
    endHour: 13,
    platform: 'facebook',
    mediaType: 'video',
    expectedScore: 50,
    confidence: 0.2,
    sampleSize: 0,
    source: 'archetype',
  },
  {
    weekday: 4,
    startHour: 18,
    endHour: 20,
    platform: 'instagram',
    mediaType: 'image',
    expectedScore: 50,
    confidence: 0.25,
    sampleSize: 0,
    source: 'archetype',
  },
  {
    weekday: 0,
    startHour: 18,
    endHour: 20,
    platform: 'instagram',
    mediaType: 'video',
    expectedScore: 50,
    confidence: 0.2,
    sampleSize: 0,
    source: 'archetype',
  },
];

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asPlatform(value: unknown): OrganicPlatform {
  return String(value ?? '').trim().toLowerCase() === 'instagram'
    ? 'instagram'
    : 'facebook';
}

function asMediaType(value: unknown): 'image' | 'video' {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.includes('video') || normalized.includes('reel')
    ? 'video'
    : 'image';
}

function scheduleInstant(timestamp: string): Date {
  return new Date(NAIVE_AEST.test(timestamp) ? `${timestamp}+10:00` : timestamp);
}

function naiveAest(date: Date): string {
  return new Date(date.getTime() + AEST_OFFSET_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, '');
}

export function defaultReachTimingWindows(): RankedWindow[] {
  return FALLBACK_WINDOWS.map((window) => ({ ...window }));
}

export async function loadReachTimingEvidence(
  db: D1Database,
  scope: ReachWorkspaceScope,
  timezone: string,
): Promise<TimingEvidence[]> {
  const identity = normalizeWorkspaceIdentity(
    scope.userId,
    scope.clientId,
    scope.ownerKind,
    scope.ownerId,
  );
  const result = identity.ownerKind === 'shop'
    ? await db.prepare(`
        SELECT metadata, engagement_score FROM shopify_facts
        WHERE shop_domain = ? AND fact_type = 'own_post'
          AND engagement_score IS NOT NULL
        ORDER BY verified_at DESC
        LIMIT 100
      `).bind(identity.ownerId).all<TimingFactRow>()
    : await db.prepare(`
        SELECT metadata, engagement_score FROM client_facts
        WHERE user_id = ? AND COALESCE(client_id, '') = ?
          AND fact_type = 'own_post' AND engagement_score IS NOT NULL
        ORDER BY verified_at DESC
        LIMIT 100
      `).bind(identity.userId, identity.clientId ?? '').all<TimingFactRow>();

  const evidence: TimingEvidence[] = [];
  for (const row of result.results ?? []) {
    const metadata = parseMetadata(row.metadata);
    const timestamp = metadata.created_time
      ?? metadata.created
      ?? metadata.published_at;
    const score = Number(row.engagement_score);
    if (typeof timestamp !== 'string' || !Number.isFinite(score)) continue;
    try {
      const local = localWeekdayHour(timestamp, timezone);
      evidence.push({
        ...local,
        platform: asPlatform(metadata.platform ?? metadata.channel),
        mediaType: asMediaType(metadata.media_type ?? metadata.post_type ?? metadata.type),
        score: Math.max(0, Math.min(100, score)),
      });
    } catch {
      // Historical provider rows can be malformed; one bad row must not erase valid evidence.
    }
  }
  return evidence;
}

export function rankWorkspaceTiming(evidence: TimingEvidence[]): RankedWindow[] {
  return rankPostingWindows(evidence, defaultReachTimingWindows());
}

function windowsForPost(
  windows: RankedWindow[],
  platform: OrganicPlatform,
  mediaType: string,
): RankedWindow[] {
  const exact = windows.filter((window) => window.platform === platform
    && window.mediaType === mediaType);
  if (exact.length > 0) return exact;
  const samePlatform = windows.filter((window) => window.platform === platform);
  if (samePlatform.length > 0) return samePlatform;
  const fallback = defaultReachTimingWindows();
  return fallback.filter((window) => window.platform === platform
    && window.mediaType === mediaType);
}

export function isInsideRankedWindow(
  timestamp: string,
  timezone: string,
  windows: RankedWindow[],
  platform: OrganicPlatform,
  mediaType: string,
): boolean {
  try {
    const instant = scheduleInstant(timestamp);
    if (Number.isNaN(instant.getTime())) return false;
    const local = localWeekdayHour(instant.toISOString(), timezone);
    return windowsForPost(windows, platform, mediaType).some((window) =>
      window.weekday === local.weekday
      && local.hour >= window.startHour
      && local.hour < window.endHour);
  } catch {
    return false;
  }
}

export function nextRankedWindowSlot(
  timestamp: string,
  timezone: string,
  windows: RankedWindow[],
  platform: OrganicPlatform,
  mediaType: string,
): string {
  const preserveNaiveAest = NAIVE_AEST.test(timestamp);
  const start = scheduleInstant(timestamp);
  if (Number.isNaN(start.getTime())) return timestamp;
  for (let offset = 0; offset < 14 * 24; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60 * 60 * 1000);
    if (isInsideRankedWindow(
      candidate.toISOString(),
      timezone,
      windows,
      platform,
      mediaType,
    )) {
      return preserveNaiveAest ? naiveAest(candidate) : candidate.toISOString();
    }
  }
  return timestamp;
}
