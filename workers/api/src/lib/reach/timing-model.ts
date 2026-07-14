import type { OrganicPlatform } from './types';

export interface TimingEvidence {
  weekday: number;
  hour: number;
  platform: OrganicPlatform;
  mediaType: string;
  score: number;
}

export interface RankedWindow {
  weekday: number;
  startHour: number;
  endHour: number;
  platform: OrganicPlatform;
  mediaType: string;
  expectedScore: number;
  confidence: number;
  sampleSize: number;
  source: 'account' | 'archetype';
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function localWeekdayHour(
  timestamp: string,
  timezone: string,
): { weekday: number; hour: number } {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timing timestamp');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekdayText = parts.find((part) => part.type === 'weekday')?.value;
  const hourText = parts.find((part) => part.type === 'hour')?.value;
  const weekday = weekdayText == null ? undefined : WEEKDAY_INDEX[weekdayText];
  const hour = hourText == null ? Number.NaN : Number(hourText);
  if (weekday == null || !Number.isInteger(hour)) {
    throw new Error('Timezone conversion did not produce a valid local slot');
  }
  return { weekday, hour };
}

function validateEvidence(row: TimingEvidence): void {
  if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) {
    throw new Error('Timing evidence weekday must be between 0 and 6');
  }
  if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) {
    throw new Error('Timing evidence hour must be between 0 and 23');
  }
  if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) {
    throw new Error('Timing evidence score must be between 0 and 100');
  }
  if (!['facebook', 'instagram'].includes(row.platform)) {
    throw new Error('Timing evidence platform is unsupported');
  }
  if (!['image', 'video'].includes(row.mediaType)) {
    throw new Error('Timing evidence media type is unsupported');
  }
}

export function rankPostingWindows(
  evidence: TimingEvidence[],
  fallback: RankedWindow[],
): RankedWindow[] {
  for (const row of evidence) validateEvidence(row);
  if (evidence.length < 5) return fallback.map((window) => ({ ...window }));

  const grouped = new Map<string, number[]>();
  for (const row of evidence) {
    const key = `${row.weekday}:${row.hour}:${row.platform}:${row.mediaType}`;
    const scores = grouped.get(key) ?? [];
    scores.push(row.score);
    grouped.set(key, scores);
  }

  return [...grouped.entries()].map(([key, scores]) => {
    const [weekday, hour, platform, mediaType] = key.split(':');
    const sampleSize = scores.length;
    const mean = scores.reduce((sum, score) => sum + score, 0) / sampleSize;
    const confidence = Math.min(0.95, sampleSize / 10);
    return {
      weekday: Number(weekday),
      startHour: Number(hour),
      endHour: Number(hour) + 1,
      platform: platform as OrganicPlatform,
      mediaType,
      sampleSize,
      confidence,
      expectedScore: mean * confidence + 50 * (1 - confidence),
      source: 'account' as const,
    };
  }).sort((a, b) => b.expectedScore - a.expectedScore
    || b.confidence - a.confidence
    || a.weekday - b.weekday
    || a.startHour - b.startHour);
}
