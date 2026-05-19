import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Banner, Button, ButtonGroup,
  TextField, Select, Spinner, Box, Badge, Modal, EmptyState, Tooltip,
} from '@shopify/polaris';
import {
  listPosters, generatePoster, deletePoster, fetchAuthImageBlob,
  ApiError, type ShopifyPoster,
} from '../api';

/**
 * Posters — AI-generated marketing graphics gallery.
 *
 * Two halves:
 *   1. Create card at the top — prompt + aspect ratio select + Generate.
 *      Image gen runs server-side (OpenRouter image modality) and lands
 *      in 5–20s; we surface a Spinner during generation.
 *   2. Gallery underneath — `InlineGrid` of poster cards. Each card pulls
 *      its image bytes via fetchAuthImageBlob (the worker's image stream
 *      route is session-token gated, so `<img src>` can't load it
 *      directly). Blob URLs are tracked + revoked on unmount.
 *
 * Delete is destructive but easily undoable on the merchant side (they
 * can regenerate with the same prompt) so a single-click confirm modal
 * is enough — no soft-delete.
 */

type Phase = 'loading' | 'ready' | 'error';
type AspectRatio = '1:1' | '9:16' | '16:9';

const ASPECT_OPTIONS = [
  { label: 'Square (1:1) — Instagram feed', value: '1:1' },
  { label: 'Portrait (9:16) — Stories / Reels', value: '9:16' },
  { label: 'Landscape (16:9) — Facebook header', value: '16:9' },
];

const PROMPT_EXAMPLES = [
  'A summer sale banner with palm leaves and tropical colours',
  'A minimalist product showcase on a soft beige background',
  'A festive Christmas promo with gold ornaments and snowflakes',
  'A bold black-friday graphic with neon accents on dark background',
];

export default function Posters() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [posters, setPosters] = useState<ShopifyPoster[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Generation form state
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [generating, setGenerating] = useState(false);

  // Delete confirmation modal
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPosters = useCallback(async () => {
    setError(null);
    try {
      const res = await listPosters();
      setPosters(res.items);
      setPhase('ready');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('error');
    }
  }, []);

  useEffect(() => { loadPosters(); }, [loadPosters]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Add a prompt describing the poster you want.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const newPoster = await generatePoster({ prompt: prompt.trim(), aspectRatio });
      // Prepend the new poster — feels instant.
      setPosters((prev) => [newPoster, ...prev]);
      // Clear the prompt so the merchant can write a new one without
      // having to manually select-and-delete.
      setPrompt('');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deletePoster(deleteId);
      setPosters((prev) => prev.filter((p) => p.id !== deleteId));
      setDeleteId(null);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleUseExample = (example: string) => setPrompt(example);

  return (
    <BlockStack gap="400">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">Posters</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            AI-generated marketing graphics. Download to use anywhere, or
            attach when composing a post.
          </Text>
        </BlockStack>
        {posters.length > 0 && (
          <Badge tone="info">{`${posters.length} ${posters.length === 1 ? 'poster' : 'posters'}`}</Badge>
        )}
      </InlineStack>

      {error && (
        <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}

      {/* ── Create form ──────────────────────────────────────────────── */}
      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">Generate a new poster</Text>

          <TextField
            label="Prompt"
            value={prompt}
            onChange={setPrompt}
            multiline={3}
            placeholder="Describe the poster you want — colours, style, mood, subjects…"
            autoComplete="off"
            disabled={generating}
            helpText={`${prompt.length}/1000 characters`}
            maxLength={1000}
          />

          <InlineStack gap="200" wrap>
            <Text as="span" variant="bodySm" tone="subdued">Examples:</Text>
            {PROMPT_EXAMPLES.map((ex) => (
              <Tooltip key={ex} content="Click to use this example">
                <Button
                  variant="plain"
                  onClick={() => handleUseExample(ex)}
                  disabled={generating}
                >
                  {ex.slice(0, 40)}…
                </Button>
              </Tooltip>
            ))}
          </InlineStack>

          <InlineStack gap="300" blockAlign="end" wrap>
            <Box minWidth="280px">
              <Select
                label="Aspect ratio"
                options={ASPECT_OPTIONS}
                value={aspectRatio}
                onChange={(v) => setAspectRatio(v as AspectRatio)}
                disabled={generating}
              />
            </Box>
            <Button
              variant="primary"
              size="large"
              onClick={handleGenerate}
              loading={generating}
              disabled={generating || !prompt.trim()}
            >
              Generate poster
            </Button>
          </InlineStack>

          {generating && (
            <Text as="p" variant="bodySm" tone="subdued">
              Generating your poster — this takes 5-20 seconds…
            </Text>
          )}
        </BlockStack>
      </Card>

      {/* ── Gallery ──────────────────────────────────────────────────── */}
      {phase === 'loading' ? (
        <Card>
          <BlockStack gap="200" align="center" inlineAlign="center">
            <Spinner accessibilityLabel="Loading posters" />
            <Text as="p" variant="bodySm" tone="subdued">Loading your gallery…</Text>
          </BlockStack>
        </Card>
      ) : phase === 'error' && posters.length === 0 ? (
        <Banner tone="critical" title="Couldn't load posters">
          <BlockStack gap="200">
            <p>{error ?? 'Unknown error.'}</p>
            <Button onClick={loadPosters}>Retry</Button>
          </BlockStack>
        </Banner>
      ) : posters.length === 0 ? (
        <Card>
          <EmptyState
            heading="No posters yet"
            image=""
          >
            <p>Use the form above to generate your first AI poster.</p>
          </EmptyState>
        </Card>
      ) : (
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
          {posters.map((p) => (
            <PosterCard
              key={p.id}
              poster={p}
              onDelete={() => setDeleteId(p.id)}
            />
          ))}
        </InlineGrid>
      )}

      {/* ── Delete confirmation modal ────────────────────────────────── */}
      <Modal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Delete poster?"
        primaryAction={{
          content: 'Delete',
          destructive: true,
          loading: deleting,
          onAction: handleDeleteConfirm,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setDeleteId(null), disabled: deleting },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This permanently removes the poster from your gallery. You can always
            generate a new one with the same prompt.
          </Text>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

// ── PosterCard ─────────────────────────────────────────────────────────────
//
// One card per poster. Lazily fetches the auth-gated image bytes via
// fetchAuthImageBlob and wraps them in a blob URL for `<img src>`. The
// blob URL is revoked on unmount so we don't leak memory across long
// browsing sessions.

interface PosterCardProps {
  poster: ShopifyPoster;
  onDelete: () => void;
}

function PosterCard({ poster, onDelete }: PosterCardProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const blob = await fetchAuthImageBlob(poster.imageUrl, controller.signal);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setImgError(e instanceof ApiError ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [poster.imageUrl]);

  const handleDownload = () => {
    if (!blobUrl) return;
    // Trigger a download by creating a temporary anchor with the blob URL.
    // The browser uses the suggested filename (or the URL fragment if not).
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `poster-${poster.id.slice(0, 8)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const created = new Date(poster.createdAt).toLocaleDateString();

  // Map aspect ratio → CSS aspect-ratio for a consistent grid look.
  const aspectCss =
    poster.aspectRatio === '9:16' ? '9 / 16'
    : poster.aspectRatio === '16:9' ? '16 / 9'
    : '1 / 1';

  return (
    <Card padding="0">
      <BlockStack gap="0">
        <Box
          background="bg-surface-secondary"
          minHeight="180px"
        >
          {imgError ? (
            <Box padding="400">
              <Text as="p" variant="bodySm" tone="critical">{imgError}</Text>
            </Box>
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt={poster.prompt}
              style={{
                width: '100%',
                aspectRatio: aspectCss,
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <Box padding="800">
              <BlockStack gap="200" align="center" inlineAlign="center">
                <Spinner accessibilityLabel="Loading image" size="small" />
              </BlockStack>
            </Box>
          )}
        </Box>
        <Box padding="300">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" truncate>
              {poster.prompt}
            </Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">{created}</Text>
              <ButtonGroup>
                <Button
                  variant="plain"
                  onClick={handleDownload}
                  disabled={!blobUrl}
                >
                  Download
                </Button>
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={onDelete}
                >
                  Delete
                </Button>
              </ButtonGroup>
            </InlineStack>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
