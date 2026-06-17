import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Spinner,
  Banner,
  Badge,
  Button,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Modal,
  TextField,
  EmptyState,
  Box,
  ButtonGroup,
  Tooltip,
  Icon,
} from '@shopify/polaris';
import {
  CalendarIcon, ChevronLeftIcon, ChevronRightIcon, WandIcon,
} from '@shopify/polaris-icons';
import {
  listPosts,
  updatePost,
  deletePost,
  publishPostNow,
  ApiError,
  type Post,
} from '../api';
import './calendar.css';

/**
 * Calendar — the shop's posting schedule, with two views:
 *
 *   • Month grid   (NEW) — 7-column calendar, posts as draggable chips
 *                          on the day they're scheduled for. Drag a chip
 *                          to a different day to reschedule (preserves
 *                          time-of-day).
 *   • List         (legacy) — flat ResourceList with status filter.
 *
 * Mutations route through the api.ts helpers, optimistic-update the
 * local cache where safe, and refetch on completion so the row reflects
 * the worker's authoritative state.
 *
 * Drag-to-reschedule uses HTML5 DnD (no extra dependency). Status-filter
 * applies to both views. Drafts (no scheduled_for) land in the inline
 * "Drafts & untimed" tray that floats at the top of the grid.
 */

type Phase = 'loading' | 'ready' | 'error';
type FilterValue = 'All' | Post['status'];
type ViewMode = 'month' | 'list';

const FILTERS: FilterValue[] = ['All', 'Draft', 'Scheduled', 'Posted', 'Missed'];

interface ConfirmDialog {
  kind: 'delete' | 'publish';
  postId: string;
}

interface EditState {
  postId: string;
  content: string;
}

// Day-of-week labels — Monday-first matches the AEST audience norm and
// most Shopify merchants outside the US.
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Date helpers ──────────────────────────────────────────────────────────
// Calendar maths is all done in LOCAL time so a post scheduled for "9am
// Friday" lands on Friday's cell regardless of timezone offset.

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isoDay(d: Date): string {
  // YYYY-MM-DD — used as the bucket key so we don't have to do Date
  // comparisons in the render loop.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

/** Build the 6-week (42-cell) grid for a given month, Monday-first. */
function monthGridDays(monthStart: Date): Date[] {
  const out: Date[] = [];
  const firstDayWeekday = (monthStart.getDay() + 6) % 7; // Mon=0, Sun=6
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - firstDayWeekday);
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    out.push(d);
  }
  return out;
}

export default function Calendar() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<FilterValue>('All');
  const [view, setView] = useState<ViewMode>('month');
  const [monthStart, setMonthStart] = useState<Date>(startOfMonth(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const res = await listPosts(undefined, signal);
      setPosts(res.posts);
      setPhase('ready');
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'All') return posts;
    return posts.filter((p) => p.status === filter);
  }, [posts, filter]);

  // Bucket posts by ISO day key for fast grid lookups.
  const postsByDay = useMemo(() => {
    const map: Record<string, Post[]> = {};
    for (const p of filtered) {
      if (!p.scheduled_for) continue;
      const d = new Date(p.scheduled_for);
      const key = isoDay(d);
      (map[key] ||= []).push(p);
    }
    // Sort within each day by scheduled time so the chip order is stable.
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => Date.parse(a.scheduled_for!) - Date.parse(b.scheduled_for!));
    }
    return map;
  }, [filtered]);

  // Drafts + untimed posts go into a tray above the grid (the grid only
  // shows posts WITH a scheduled_for date).
  const untimedPosts = useMemo(
    () => filtered.filter((p) => !p.scheduled_for),
    [filtered],
  );

  const handlePublishNow = async (id: string) => {
    setBusyId(id);
    try {
      await publishPostNow(id);
      setConfirm(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await deletePost(id);
      setConfirm(null);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!edit) return;
    setBusyId(edit.postId);
    try {
      await updatePost(edit.postId, { content: edit.content });
      setEdit(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  /** Drag a chip onto a different day cell — preserve time-of-day, update
   *  the date only. PATCH the post with the new ISO timestamp, refetch
   *  on success so the cache catches any server-side normalisation. */
  const handleReschedule = useCallback(async (postId: string, newDay: Date) => {
    const post = posts.find((p) => p.id === postId);
    if (!post || (post.status !== 'Draft' && post.status !== 'Scheduled')) return;

    const current = post.scheduled_for ? new Date(post.scheduled_for) : null;
    if (current && sameDay(current, newDay)) return; // no-op drag onto same cell

    // Build the new datetime: new day, same time-of-day.
    const next = new Date(newDay);
    if (current) {
      next.setHours(current.getHours(), current.getMinutes(), 0, 0);
    } else {
      // Drafts from the unscheduled tray don't have a time yet. Land them at
      // a predictable business-hours default so the merchant can fine-tune later.
      next.setHours(9, 0, 0, 0);
    }
    const iso = next.toISOString();
    const patch = post.status === 'Draft'
      ? { scheduled_for: iso, status: 'Scheduled' as const }
      : { scheduled_for: iso };

    // Optimistic update so the chip moves immediately.
    setPosts((prev) => prev.map((p) => (
      p.id === postId
        ? { ...p, scheduled_for: iso, status: p.status === 'Draft' ? 'Scheduled' : p.status }
        : p
    )));
    setBusyId(postId);
    try {
      await updatePost(postId, patch);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(`Couldn't reschedule: ${msg}`);
      // Roll back the optimistic move on failure.
      load();
    } finally {
      setBusyId(null);
    }
  }, [posts, load]);

  if (phase === 'loading') {
    return (
      <Card>
        <BlockStack gap="200" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Loading posts" />
          <Text as="p" variant="bodySm" tone="subdued">Loading posts…</Text>
        </BlockStack>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Banner tone="critical" title="Couldn't load posts">
        <BlockStack gap="200">
          <p>{error ?? 'Unknown error.'}</p>
          <Button onClick={() => { setPhase('loading'); load(); }}>Try again</Button>
        </BlockStack>
      </Banner>
    );
  }

  const confirmedPost = confirm ? posts.find((p) => p.id === confirm.postId) ?? null : null;

  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const today = new Date();

  return (
    <BlockStack gap="400">
      {error && (
        <Banner tone="warning" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}

      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <InlineStack gap="200" blockAlign="center">
              <Icon source={CalendarIcon} tone="info" />
              <Text as="h2" variant="headingLg">Calendar</Text>
            </InlineStack>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodySm" tone="subdued">
                {filtered.length} of {posts.length}
              </Text>
              <ButtonGroup variant="segmented">
                <Button
                  pressed={view === 'month'}
                  onClick={() => setView('month')}
                  icon={CalendarIcon}
                >
                  Month
                </Button>
                <Button
                  pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  List
                </Button>
              </ButtonGroup>
            </InlineStack>
          </InlineStack>

          <ButtonGroup variant="segmented">
            {FILTERS.map((f) => (
              <Button
                key={f}
                pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </Button>
            ))}
          </ButtonGroup>

          {view === 'month' ? (
            <>
              {/* Month navigation */}
              <InlineStack align="space-between" blockAlign="center">
                <Button
                  icon={ChevronLeftIcon}
                  onClick={() => setMonthStart((m) => addMonths(m, -1))}
                  accessibilityLabel="Previous month"
                />
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingMd">{monthLabel}</Text>
                  <Button
                    variant="plain"
                    onClick={() => setMonthStart(startOfMonth(new Date()))}
                  >
                    Today
                  </Button>
                </InlineStack>
                <Button
                  icon={ChevronRightIcon}
                  onClick={() => setMonthStart((m) => addMonths(m, 1))}
                  accessibilityLabel="Next month"
                />
              </InlineStack>

              {/* Drafts & untimed tray — visible above the grid when present.
                  Surfaces drafts that have no scheduled date so the merchant
                  can drag them onto a day to schedule them in one move. */}
              {untimedPosts.length > 0 && (
                <Box
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" fontWeight="bold">
                      Unscheduled ({untimedPosts.length})
                    </Text>
                    <InlineStack gap="200" wrap>
                      {untimedPosts.map((p) => (
                        <PostChip
                          key={p.id}
                          post={p}
                          busy={busyId === p.id}
                          onClick={() => p.status === 'Draft' || p.status === 'Scheduled'
                            ? setEdit({ postId: p.id, content: p.content })
                            : undefined}
                          isDragging={false}
                          draggable={p.status === 'Draft' || p.status === 'Scheduled'}
                        />
                      ))}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Drag a draft onto a day to schedule it.
                    </Text>
                  </BlockStack>
                </Box>
              )}

              {/* The 6-week grid */}
              <MonthGrid
                monthStart={monthStart}
                today={today}
                postsByDay={postsByDay}
                busyId={busyId}
                dragOverKey={dragOverKey}
                onDayDragOver={setDragOverKey}
                onDayDrop={handleReschedule}
                onChipClick={(post) => {
                  if (post.status === 'Draft' || post.status === 'Scheduled') {
                    setEdit({ postId: post.id, content: post.content });
                  }
                }}
              />

              {posts.length === 0 && (
                <div className="calendar-empty">
                  <EmptyState
                    heading="Nothing scheduled yet"
                    image=""
                    action={{
                      content: 'Launch Autopilot',
                      icon: WandIcon,
                      url: '/autopilot',
                    }}
                    secondaryAction={{
                      content: 'Compose a single post',
                      url: '/products',
                    }}
                  >
                    <p>
                      Autopilot fills your calendar with a week of on-brand posts
                      in two clicks. Or compose one product at a time.
                    </p>
                  </EmptyState>
                </div>
              )}
            </>
          ) : (
            // ── List view (legacy) ───────────────────────────────────────
            filtered.length === 0 ? (
              <div className="calendar-empty">
                <EmptyState
                  heading={posts.length === 0 ? 'Nothing scheduled yet' : 'No posts match this filter'}
                  action={posts.length === 0
                    ? { content: 'Launch Autopilot', icon: WandIcon, url: '/autopilot' }
                    : { content: 'Show all', onAction: () => setFilter('All') }}
                  secondaryAction={posts.length === 0
                    ? { content: 'Compose a single post', url: '/products' }
                    : undefined}
                  image=""
                >
                  <p>
                    {posts.length === 0
                      ? 'Autopilot fills your calendar with a week of on-brand posts in two clicks.'
                      : 'Try a different status filter.'}
                  </p>
                </EmptyState>
              </div>
            ) : (
              <ResourceList
                resourceName={{ singular: 'post', plural: 'posts' }}
                items={filtered}
                renderItem={(post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    busy={busyId === post.id}
                    onPublishNow={() => setConfirm({ kind: 'publish', postId: post.id })}
                    onEdit={() => setEdit({ postId: post.id, content: post.content })}
                    onDelete={() => setConfirm({ kind: 'delete', postId: post.id })}
                  />
                )}
              />
            )
          )}
        </BlockStack>
      </Card>

      {/* Confirm — Publish now */}
      <Modal
        open={confirm?.kind === 'publish'}
        title="Publish this post now?"
        onClose={() => busyId ? undefined : setConfirm(null)}
        primaryAction={{
          content: 'Publish now',
          onAction: () => confirm && handlePublishNow(confirm.postId),
          loading: busyId === confirm?.postId,
          destructive: false,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setConfirm(null),
          disabled: busyId === confirm?.postId,
        }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              This will skip the schedule and push the post to Facebook
              immediately. You can't undo a live publish.
            </Text>
            {confirmedPost && (
              <Text as="p" variant="bodySm" tone="subdued">
                "{truncate(confirmedPost.content, 120)}"
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Confirm — Delete */}
      <Modal
        open={confirm?.kind === 'delete'}
        title="Delete this post?"
        onClose={() => busyId ? undefined : setConfirm(null)}
        primaryAction={{
          content: 'Delete',
          onAction: () => confirm && handleDelete(confirm.postId),
          loading: busyId === confirm?.postId,
          destructive: true,
        }}
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setConfirm(null),
          disabled: busyId === confirm?.postId,
        }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              The post will be permanently removed. This can't be undone.
            </Text>
            {confirmedPost && (
              <Text as="p" variant="bodySm" tone="subdued">
                "{truncate(confirmedPost.content, 120)}"
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Inline edit (full-featured — content + actions) */}
      <Modal
        open={edit !== null}
        title="Edit post"
        onClose={() => busyId ? undefined : setEdit(null)}
        primaryAction={{
          content: 'Save',
          onAction: handleSaveEdit,
          loading: busyId === edit?.postId,
          disabled: !edit || edit.content.trim().length === 0,
        }}
        secondaryActions={edit ? [
          { content: 'Cancel', onAction: () => setEdit(null), disabled: busyId === edit.postId },
          ...(posts.find((p) => p.id === edit.postId)?.status === 'Draft'
            ? [{
                content: 'Publish now',
                onAction: () => { setConfirm({ kind: 'publish', postId: edit.postId }); setEdit(null); },
                disabled: busyId === edit.postId,
              }]
            : []),
          {
            content: 'Delete',
            destructive: true,
            onAction: () => { setConfirm({ kind: 'delete', postId: edit.postId }); setEdit(null); },
            disabled: busyId === edit.postId,
          },
        ] : []}
      >
        <Modal.Section>
          <TextField
            label="Caption"
            value={edit?.content ?? ''}
            onChange={(v) => setEdit((s) => s ? { ...s, content: v } : s)}
            multiline={6}
            autoComplete="off"
            maxLength={2200}
            showCharacterCount
          />
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

// ── MonthGrid ────────────────────────────────────────────────────────────

interface MonthGridProps {
  monthStart: Date;
  today: Date;
  postsByDay: Record<string, Post[]>;
  busyId: string | null;
  dragOverKey: string | null;
  onDayDragOver: (key: string | null) => void;
  onDayDrop: (postId: string, day: Date) => void;
  onChipClick: (post: Post) => void;
}

function MonthGrid({
  monthStart, today, postsByDay, busyId,
  dragOverKey, onDayDragOver, onDayDrop, onChipClick,
}: MonthGridProps) {
  const days = monthGridDays(monthStart);
  const currentMonth = monthStart.getMonth();

  return (
    <Box>
      {/* Day-of-week header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '2px',
          marginBottom: '4px',
        }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <Box key={label} padding="100">
            <Text as="span" variant="bodySm" tone="subdued" alignment="center">{label}</Text>
          </Box>
        ))}
      </div>

      {/* 6-row x 7-col day grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '2px',
        }}
      >
        {days.map((d) => {
          const key = isoDay(d);
          const inMonth = d.getMonth() === currentMonth;
          const isToday = sameDay(d, today);
          const isPast = d < today && !isToday;
          const dayPosts = postsByDay[key] || [];
          const isDragOver = dragOverKey === key;

          return (
            <div
              key={key}
              className="calendar-day-cell"
              onDragOver={(e) => {
                // Allow drop: default behaviour is to reject.
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverKey !== key) onDayDragOver(key);
              }}
              onDragLeave={() => {
                if (dragOverKey === key) onDayDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const postId = e.dataTransfer.getData('text/plain');
                onDayDragOver(null);
                if (postId) onDayDrop(postId, d);
              }}
              style={{
                background: isDragOver
                  ? 'var(--p-color-bg-fill-info-selected, #b9e1ff)'
                  : !inMonth
                    ? 'var(--p-color-bg-surface-disabled, #f6f6f7)'
                    : 'var(--p-color-bg-surface, #ffffff)',
                border: isToday
                  ? '2px solid var(--p-color-border-info, #006eff)'
                  : '1px solid var(--p-color-border, #e3e3e3)',
                borderRadius: '6px',
                padding: '4px',
                minHeight: '108px',
                opacity: !inMonth ? 0.55 : 1,
                transition: 'background 0.1s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <Text
                  as="span"
                  variant="bodySm"
                  fontWeight={isToday ? 'bold' : 'regular'}
                  tone={isPast && !isToday ? 'subdued' : 'base'}
                >
                  {d.getDate()}
                </Text>
                {dayPosts.length > 2 && (
                  <Text as="span" variant="bodySm" tone="subdued">+{dayPosts.length - 2}</Text>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {dayPosts.slice(0, 3).map((p) => (
                  <PostChip
                    key={p.id}
                    post={p}
                    busy={busyId === p.id}
                    onClick={() => onChipClick(p)}
                    isDragging={false}
                    draggable={p.status === 'Draft' || p.status === 'Scheduled'}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Box>
  );
}

// ── PostChip — draggable status pill ─────────────────────────────────────

interface PostChipProps {
  post: Post;
  busy: boolean;
  onClick?: () => void;
  isDragging: boolean;
  draggable: boolean;
}

function PostChip({ post, busy, onClick, draggable }: PostChipProps) {
  const tone = post.status === 'Posted' ? 'bg-fill-success'
    : post.status === 'Scheduled' ? 'bg-fill-info'
    : post.status === 'Missed' ? 'bg-fill-critical'
    : 'bg-fill-warning';

  const labelTime = post.scheduled_for
    ? new Date(post.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const platformChar = post.platform === 'facebook' ? 'fb' : 'legacy';

  // Reel indicator — the autopilot can schedule video Reels; without this
  // chip merchants can't tell at a glance which posts will publish as video
  // and which as a still image. ▶ glyph (U+25B6) is a universally-recognised
  // play arrow and reads well at the chip's tiny font size.
  const isReel = post.post_type === 'video' || post.post_type === 'reel';
  const reelPending = isReel && post.video_status === 'pending';
  const reelFailed = isReel && post.video_status === 'failed';

  // AI critique score — only show if populated (Compose page or critique cron
  // wrote it). 0-10 scale. Below 5 we tint the badge so low-quality posts
  // visually stand out and the merchant can swap before publish.
  const score = typeof post.image_critique_score === 'number'
    ? post.image_critique_score
    : null;
  const scoreLow = score !== null && score < 5;

  return (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label={`${post.status} post${isReel ? ' (Reel)' : ''} at ${labelTime || 'unscheduled'}: ${post.content.slice(0, 60)}`}
      draggable={draggable && !busy}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData('text/plain', post.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        // Keyboard activation — Enter or Space opens the post (Polaris convention).
        // Drag-to-reschedule is mouse-only for now; keyboard users edit via the
        // modal's date/time field. See Calendar a11y notes for the longer fix.
        if ((e.key === 'Enter' || e.key === ' ') && onClick && !busy) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: draggable && !busy ? 'grab' : onClick ? 'pointer' : 'default',
        opacity: busy ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <Box
        background={tone as any}
        padding="100"
        borderRadius="100"
      >
        <InlineStack gap="100" blockAlign="center" wrap={false}>
          {labelTime && (
            <Text as="span" variant="bodySm" fontWeight="bold" tone="text-inverse">
              {labelTime}
            </Text>
          )}
          {isReel && (
            <Text
              as="span"
              variant="bodySm"
              tone="text-inverse"
              fontWeight="bold"
              // Wrapped tooltip-style title via native attribute; Polaris's
              // Tooltip is heavier than chip rendering can absorb at scale.
            >
              {reelFailed ? '⚠▶' : reelPending ? '⏳▶' : '▶'}
            </Text>
          )}
          {score !== null && (
            <Text
              as="span"
              variant="bodySm"
              tone="text-inverse"
              fontWeight={scoreLow ? 'bold' : 'medium'}
            >
              {scoreLow ? '⚠' : ''}{score}/10
            </Text>
          )}
          <Text as="span" variant="bodySm" tone="text-inverse" truncate>
            {truncate(post.content, isReel || score !== null ? 16 : 22)}
          </Text>
          <Text as="span" variant="bodySm" tone="text-inverse">{platformChar}</Text>
        </InlineStack>
      </Box>
    </div>
  );
}

// ── PostRow — list view (legacy) ─────────────────────────────────────────

interface PostRowProps {
  post: Post;
  busy: boolean;
  onPublishNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PostRow({ post, busy, onPublishNow, onEdit, onDelete }: PostRowProps) {
  const canPublishNow = post.status === 'Draft';
  // Missed posts come from cron failures (token expired, FB outage, image
  // gen timeout, etc.) — once the upstream issue is resolved the merchant
  // expects a one-click recovery. Same publish-now endpoint, just a
  // different button label so the intent reads correctly.
  const canRetry = post.status === 'Missed';
  const canEdit = post.status === 'Draft' || post.status === 'Scheduled';
  const canDelete = post.status === 'Draft' || post.status === 'Scheduled' || post.status === 'Missed';
  const isReel = post.post_type === 'video' || post.post_type === 'reel';

  const media = post.image_url
    ? <Thumbnail source={post.image_url} alt="" size="medium" />
    : <Thumbnail source="" alt="" size="medium" />;

  return (
    <ResourceItem
      id={post.id}
      media={media}
      accessibilityLabel={`Post ${post.id}`}
      onClick={() => { /* row click is a no-op — explicit action buttons drive UX */ }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" align="space-between" blockAlign="start" wrap>
          <Box maxWidth="65%">
            <Text as="p" variant="bodyMd" breakWord>
              {truncate(post.content, 100)}
            </Text>
          </Box>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            {isReel && (
              <Badge tone={post.video_status === 'failed' ? 'critical' : post.video_status === 'pending' ? 'attention' : 'magic'}>
                {post.video_status === 'failed' ? 'Reel failed' : post.video_status === 'pending' ? 'Reel rendering' : 'Reel'}
              </Badge>
            )}
            {typeof post.image_critique_score === 'number' && (
              <Badge tone={post.image_critique_score >= 7 ? 'success' : post.image_critique_score >= 5 ? 'info' : 'warning'}>
                {`AI ${post.image_critique_score}/10`}
              </Badge>
            )}
            <PlatformBadge platform={post.platform} />
            <StatusBadge status={post.status} />
          </InlineStack>
        </InlineStack>

        <InlineStack gap="200" align="space-between" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            {timeLabel(post)}
          </Text>
          <ButtonGroup>
            {canPublishNow && (
              <Tooltip content="Skip the schedule and publish immediately">
                <Button size="slim" onClick={onPublishNow} loading={busy} variant="primary">
                  Publish now
                </Button>
              </Tooltip>
            )}
            {canRetry && (
              <Tooltip content="This post was missed by the publish cron. Click to retry — works as long as the upstream issue (e.g. Facebook token) is resolved.">
                <Button size="slim" onClick={onPublishNow} loading={busy} variant="primary" tone="success">
                  Retry publish
                </Button>
              </Tooltip>
            )}
            {canEdit && (
              <Button size="slim" onClick={onEdit} disabled={busy}>Edit</Button>
            )}
            {canDelete && (
              <Button size="slim" tone="critical" onClick={onDelete} disabled={busy}>
                Delete
              </Button>
            )}
          </ButtonGroup>
        </InlineStack>
      </BlockStack>
    </ResourceItem>
  );
}

function PlatformBadge({ platform }: { platform: Post['platform'] }) {
  const label = platform === 'facebook' ? 'Facebook' : 'Legacy post';
  return <Badge>{label}</Badge>;
}

function StatusBadge({ status }: { status: Post['status'] }) {
  switch (status) {
    case 'Draft':
      return <Badge tone="info-strong" progress="incomplete">Draft</Badge>;
    case 'Scheduled':
      return <Badge tone="info" progress="partiallyComplete">Scheduled</Badge>;
    case 'Posted':
      return <Badge tone="success" progress="complete">Posted</Badge>;
    case 'Missed':
      return <Badge tone="critical" progress="incomplete">Missed</Badge>;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function timeLabel(post: Post): string {
  if ((post.status === 'Scheduled' || post.status === 'Posted') && post.scheduled_for) {
    const d = new Date(post.scheduled_for);
    const verb = post.status === 'Posted' ? 'Posted' : 'Scheduled for';
    return `${verb} ${d.toLocaleString()}`;
  }
  return `Created ${new Date(post.created_at).toLocaleString()}`;
}
