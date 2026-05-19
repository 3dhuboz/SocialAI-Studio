import { useCallback, useEffect, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Banner, Button, ButtonGroup,
  TextField, Select, Spinner, Thumbnail, Link as PolarisLink,
} from '@shopify/polaris';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  composePost, createPost, publishPostNow, ApiError, type ComposeResponse,
} from '../api';

/**
 * AI Compose page.
 *
 * Reads `product_id` from the query string. On mount, calls composePost()
 * which runs the SocialAI generation pipeline (caption + product-aware
 * image) on the worker and returns the editable result. The merchant can
 * then tweak the caption, regenerate the image, pick a platform, and save
 * as a draft (or attempt publish — wired to the Calendar page until the
 * publish-now endpoint exists).
 *
 * Phase machine:
 *   • missing-product → no product_id in the URL; show info banner
 *   • generating      → waiting for composePost (10–20s)
 *   • ready           → editable form is showing
 *   • saving          → createPost in flight
 *   • error           → terminal — generation failed, retry available
 */

type Phase = 'missing-product' | 'generating' | 'ready' | 'saving' | 'error';
type Platform = 'facebook' | 'instagram' | 'both';

export default function Compose() {
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('product_id');
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>(productId ? 'generating' : 'missing-product');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResponse | null>(null);

  // Editable form state — initialised from `result` when generation lands.
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [platform, setPlatform] = useState<Platform>('both');
  const [regenerating, setRegenerating] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  // Pull a fresh compose result for the given product. Used both at mount
  // and when the merchant clicks "Regenerate image".
  const runCompose = useCallback(async (signal?: AbortSignal) => {
    if (!productId) return;
    try {
      const res = await composePost(
        { product_id: productId, platform: 'both', tone: 'friendly' },
        signal,
      );
      setResult(res);
      setCaption(res.caption);
      setImageUrl(res.image_url);
      setPhase('ready');
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('error');
    }
  }, [productId]);

  useEffect(() => {
    if (!productId) {
      setPhase('missing-product');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setPhase('generating');
    setError(null);

    (async () => {
      try {
        const res = await composePost(
          { product_id: productId, platform: 'both', tone: 'friendly' },
          controller.signal,
        );
        if (cancelled) return;
        setResult(res);
        setCaption(res.caption);
        setImageUrl(res.image_url);
        setPhase('ready');
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const msg = e instanceof ApiError ? e.message : String(e);
        setError(msg);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [productId]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      await runCompose();
    } finally {
      setRegenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!caption.trim()) {
      setError('Caption can\'t be empty.');
      return;
    }
    setPhase('saving');
    setError(null);
    try {
      await createPost({
        content: caption,
        image_url: imageUrl || undefined,
        platform,
        product_id: productId ?? undefined,
      });
      setSuccessNote('Draft saved. Redirecting to Calendar…');
      // Quick handoff — Calendar will pick the new draft up on its own load.
      navigate('/calendar');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('ready');
    }
  };

  // "Publish now" — create the post then immediately POST publish-now so
  // the worker bypasses the cron and pushes to FB/IG straight away.
  const handlePublishNow = async () => {
    if (!caption.trim()) {
      setError('Caption can\'t be empty.');
      return;
    }
    setPhase('saving');
    setError(null);
    try {
      const created = await createPost({
        content: caption,
        image_url: imageUrl || undefined,
        platform,
        product_id: productId ?? undefined,
      });
      await publishPostNow(created.id);
      setSuccessNote('Published! Opening Calendar…');
      navigate('/calendar');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('ready');
    }
  };

  // ── Render branches ────────────────────────────────────────────────

  if (phase === 'missing-product') {
    return (
      <Banner tone="info" title="Pick a product first">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            Compose needs a product to base the post on. Head to the{' '}
            <PolarisLink url="#/products">Products page</PolarisLink> and click
            "Compose post" on any item.
          </Text>
          <Button onClick={() => navigate('/products')}>Go to Products</Button>
        </BlockStack>
      </Banner>
    );
  }

  if (phase === 'generating') {
    return (
      <Card>
        <BlockStack gap="300" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Generating your post" />
          <Text as="p" variant="bodyMd" tone="subdued">
            Generating your post — this takes 10-20 seconds…
          </Text>
        </BlockStack>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Banner tone="critical" title="Couldn't generate your post">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">{error ?? 'Unknown error.'}</Text>
          <Button onClick={handleRegenerate} loading={regenerating}>
            Retry
          </Button>
        </BlockStack>
      </Banner>
    );
  }

  // phase === 'ready' | 'saving'
  const platformOptions = [
    { label: 'Both Facebook + Instagram', value: 'both' },
    { label: 'Facebook only', value: 'facebook' },
    { label: 'Instagram only', value: 'instagram' },
  ];

  return (
    <BlockStack gap="400">
      {result?.product && (
        <Card>
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Composing for: {result.product.title}
            </Text>
            {result.product.price && (
              <Text as="p" variant="bodySm" tone="subdued">
                Price: {result.product.price}
              </Text>
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Model: {result.model_used}
            </Text>
          </BlockStack>
        </Card>
      )}

      {successNote && (
        <Banner tone="success">
          <Text as="p" variant="bodyMd">{successNote}</Text>
        </Banner>
      )}

      {error && (
        <Banner tone="critical" title="Something went wrong">
          <Text as="p" variant="bodyMd">{error}</Text>
        </Banner>
      )}

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">Image</Text>
          {imageUrl ? (
            <InlineStack gap="400" blockAlign="start">
              <Thumbnail source={imageUrl} alt="Generated post image" size="large" />
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Not quite right? Regenerate to try another shot.
                </Text>
                <Button onClick={handleRegenerate} loading={regenerating}>
                  Regenerate image
                </Button>
              </BlockStack>
            </InlineStack>
          ) : (
            <Text as="p" variant="bodyMd" tone="subdued">
              No image generated yet.
            </Text>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">Caption</Text>
          <TextField
            label="Caption"
            labelHidden
            value={caption}
            onChange={setCaption}
            multiline={4}
            autoComplete="off"
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">Publish to</Text>
          <Select
            label="Platform"
            labelHidden
            options={platformOptions}
            value={platform}
            onChange={(v) => setPlatform(v as Platform)}
          />
          <ButtonGroup>
            <Button
              variant="primary"
              onClick={handleSaveDraft}
              loading={phase === 'saving'}
              disabled={phase === 'saving' || regenerating}
            >
              Save as draft
            </Button>
            <Button
              onClick={handlePublishNow}
              loading={phase === 'saving'}
              disabled={phase === 'saving' || regenerating}
            >
              Publish now
            </Button>
          </ButtonGroup>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
