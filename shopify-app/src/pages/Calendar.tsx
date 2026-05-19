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
} from '@shopify/polaris';
import {
  listPosts,
  updatePost,
  deletePost,
  publishPostNow,
  ApiError,
  type Post,
} from '../api';

/**
 * Calendar — list of every post the shop has ever created.
 *
 * Loaded once on mount (and refetched after every mutation). Status filter
 * is applied client-side so chip clicks are instant; we only refetch when
 * the data actually changed. ResourceList renders each post with the
 * standard Polaris layout: thumbnail, content snippet, platform + status
 * badges, and a per-row actions group (Publish now / Edit / Delete).
 *
 * Mutations route through the matching api.ts helper, optimistic-update
 * the local cache when safe, and refetch on completion so the row reflects
 * the worker's authoritative state.
 */

type Phase = 'loading' | 'ready' | 'error';

type FilterValue = 'All' | Post['status'];

const FILTERS: FilterValue[] = ['All', 'Draft', 'Scheduled', 'Posted', 'Missed'];

interface ConfirmDialog {
  kind: 'delete' | 'publish';
  postId: string;
}

interface EditState {
  postId: string;
  content: string;
}

export default function Calendar() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<FilterValue>('All');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);

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
      // Optimistic: drop the row immediately, then refetch in the background.
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
            <Text as="h2" variant="headingLg">Calendar</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {filtered.length} of {posts.length}
            </Text>
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

          {filtered.length === 0 ? (
            <EmptyState
              heading={posts.length === 0 ? 'No posts yet' : 'No posts match this filter'}
              action={posts.length === 0 ? undefined : { content: 'Show all', onAction: () => setFilter('All') }}
              image=""
            >
              <p>
                {posts.length === 0
                  ? 'Compose your first AI-generated post from the Products page.'
                  : 'Try a different status filter.'}
              </p>
            </EmptyState>
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
              This will skip the schedule and push the post to Facebook and
              Instagram immediately. You can't undo a live publish.
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

      {/* Inline edit */}
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
        secondaryActions={[{
          content: 'Cancel',
          onAction: () => setEdit(null),
          disabled: busyId === edit?.postId,
        }]}
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

// ── Helpers + row ────────────────────────────────────────────────────────

interface PostRowProps {
  post: Post;
  busy: boolean;
  onPublishNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PostRow({ post, busy, onPublishNow, onEdit, onDelete }: PostRowProps) {
  const canPublishNow = post.status === 'Draft';
  const canEdit = post.status === 'Draft' || post.status === 'Scheduled';
  const canDelete = post.status === 'Draft' || post.status === 'Scheduled';

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
  const label = platform === 'both' ? 'Facebook + Instagram' : platform === 'facebook' ? 'Facebook' : 'Instagram';
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
