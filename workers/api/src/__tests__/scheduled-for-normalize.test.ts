// Audit P0-2 (2026-05-22) — scheduled_for canonical-format helper.
//
// Smart Schedule wrote naive AEST and PostModal wrote UTC ISO; lexicographic
// compare in the publish cron published UTC-edited posts ~10 hours early.
// `normalizeScheduledFor` is the unify-at-write point.
import { describe, it, expect } from 'vitest';
import { normalizeScheduledFor } from '../routes/posts';

describe('normalizeScheduledFor', () => {
  it('returns null for null/undefined/empty', () => {
    expect(normalizeScheduledFor(null)).toBeNull();
    expect(normalizeScheduledFor(undefined)).toBeNull();
    expect(normalizeScheduledFor('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizeScheduledFor(123)).toBeNull();
    expect(normalizeScheduledFor({})).toBeNull();
    expect(normalizeScheduledFor([])).toBeNull();
  });

  it('passes through canonical naive AEST unchanged', () => {
    // Smart Schedule's existing output shape — must NOT be rewritten.
    expect(normalizeScheduledFor('2026-05-22T07:00:00')).toBe('2026-05-22T07:00:00');
    expect(normalizeScheduledFor('2026-05-22T19:30:45')).toBe('2026-05-22T19:30:45');
  });

  it('passes through naive with milliseconds unchanged', () => {
    expect(normalizeScheduledFor('2026-05-22T07:00:00.500')).toBe('2026-05-22T07:00:00.500');
  });

  it('converts UTC Z-suffixed ISO to naive AEST (+10h)', () => {
    // The exact PostModal regression: UTC midnight → AEST 10am same day.
    expect(normalizeScheduledFor('2026-05-22T00:00:00.000Z')).toBe('2026-05-22T10:00:00');
    // UTC 21:00 → AEST next-day 07:00. This was the symptom: a 9am AEST
    // post edited via PostModal would be written as UTC 23:00 prior-day,
    // and the cron would lexicographically compare that as before now → publish 10h early.
    expect(normalizeScheduledFor('2026-05-21T23:00:00.000Z')).toBe('2026-05-22T09:00:00');
  });

  it('converts UTC Z-suffixed without milliseconds', () => {
    expect(normalizeScheduledFor('2026-05-22T00:00:00Z')).toBe('2026-05-22T10:00:00');
  });

  it('converts explicit +HH:MM offset to naive AEST', () => {
    // 09:00 in UTC+05:00 = 04:00 UTC = 14:00 AEST same day.
    expect(normalizeScheduledFor('2026-05-22T09:00:00+05:00')).toBe('2026-05-22T14:00:00');
  });

  it('falls through unparseable strings unchanged', () => {
    // Never crash, never replace a value we don't understand with null.
    expect(normalizeScheduledFor('not-a-date')).toBe('not-a-date');
    expect(normalizeScheduledFor('2026-XX-XX')).toBe('2026-XX-XX');
  });

  it('handles invalid Z-suffixed ISO by passthrough', () => {
    // `new Date(input)` returns Invalid Date → don't write NaN-formatted output.
    expect(normalizeScheduledFor('2026-13-45T99:99:99Z')).toBe('2026-13-45T99:99:99Z');
  });
});
