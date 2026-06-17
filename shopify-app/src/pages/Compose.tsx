import { useCallback, useEffect, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Banner, Button, ButtonGroup,
  TextField, Select, Spinner, Thumbnail, Link as PolarisLink,
  Badge, InlineGrid, Box, Tooltip, ProgressBar,
  Icon,
} from '@shopify/polaris';
import {
  WandIcon, ImageIcon, TextIcon, SocialAdIcon, ViewIcon,
  RefreshIcon, SendIcon, SaveIcon, StarFilledIcon,
} from '@shopify/polaris-icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  composePost, createPost, publishPostNow, critiqueImageCaption, fetchMe,
  ApiError, type ComposeResponse, type CritiqueResponse, type ShopInfo,
} from '../api';
import { LivePostPreview } from '../components/LivePostPreview';
import './compose.css';

/**
 * AI Compose page.
 *
 * Flow:
 *  1. Read `product_id` from the URL.
 *  2. composePost() → caption + product-aware image (10–20s).
 *  3. The moment compose lands, fire critiqueImageCaption() in the background
 *     so the merchant gets a quality score + verdict alongside the editor.
 *     We don't block the editor on the critique — the merchant can edit
 *     and save before it lands.
 *  4. Live preview pane on the right renders the post the same way it'll
 *     appear on Facebook, matching the current Shopify publish path.
 *  5. Save Draft / Publish Now route through createPost + publishPostNow.
 *
 * Phase machine:
 *   • missing-product → no product_id in the URL; show info banner
 *   • generating      → waiting for composePost (10–20s)
 *   • ready           → editable form + preview is showing
 *   • saving          → createPost in flight
 *   • error           → terminal — generation failed, retry available
 */

type Phase = 'missing-product' | 'generating' | 'ready' | 'saving' | 'error';
type Platform = 'facebook';

export default function Compose() {
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('product_id');
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>(productId ? 'generating' : 'missing-product');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResponse | null>(null);
  const [shop, setShop] = useState<ShopInfo | null>(null);

  // Editable form state — initialised from `result` when generation lands.
  const [caption, setCaption] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [platform, setPlatform] = useState<Platform>('facebook');
  const [regenerating, setRegenerating] = useState(false);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  // Critique state — populated by a background call after compose lands.
  // Kept separate from `phase` so the editor stays interactive while
  // critique is in flight.
  const [critique, setCritique] = useState<CritiqueResponse | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [critiqueError, setCritiqueError] = useState<string | null>(null);

  // Fire a fresh critique whenever the {imageUrl, caption} pair changes
  // and is non-empty. We debounce slightly so typing doesn't burn API
  // requests — re-runs only if the merchant pauses for 1.5s OR clicks
  // Regenerate (which sets a fresh imageUrl).
  const runCritique = useCallback(async (imgUrl: string, cap: string, signal?: AbortSignal) => {
    if (!imgUrl || !cap || cap.trim().length < 5) return;
    setCritiquing(true);
    setCritiqueError(null);
    try {
      const c = await critiqueImageCaption({ imageUrl: imgUrl, caption: cap }, signal);
      setCritique(c);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof ApiError ? e.message : String(e);
      setCritiqueError(msg);
    } finally {
      setCritiquing(false);
    }
  }, []);

  // Initial compose — runs once when productId becomes available.
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
        // Fire shop info + compose in parallel — shop info is fast and we
        // need it for the live preview's "shop name" header.
        const [me, res] = await Promise.all([
          fetchMe(controller.signal).catch(() => null),
          composePost(
            { product_id: productId, platform: 'facebook', tone: 'friendly' },
            controller.signal,
          ),
        ]);
        if (cancelled) return;
        if (me) setShop(me);
        setResult(res);
        setCaption(res.caption);
        setImageUrl(res.image_url);
        setPhase('ready');
        // Kick off the critique in the background — don't await; the
        // merchant can edit before it lands.
        runCritique(res.image_url, res.caption, controller.signal);
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
  }, [productId, runCritique]);

  // Debounced re-critique when caption changes meaningfully after the
  // initial load. Skips during the initial generating phase since the
  // useEffect above already kicked one off.
  useEffect(() => {
    if (phase !== 'ready' || !imageUrl || !caption) return;
    const handle = setTimeout(() => {
      runCritique(imageUrl, caption);
    }, 1500);
    return () => clearTimeout(handle);
    // We only re-critique on caption change, not imageUrl — image change
    // is handled by handleRegenerate explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caption]);

  const handleRegenerate = async () => {
    if (!productId) return;
    setRegenerating(true);
    setError(null);
    setCritique(null);
    setCritiqueError(null);
    try {
      const res = await composePost(
        { product_id: productId, platform: 'facebook', tone: 'friendly' },
      );
      setResult(res);
      setCaption(res.caption);
      setImageUrl(res.image_url);
      // Fire critique immediately on the new image.
      runCritique(res.image_url, res.caption);
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
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
      navigate('/calendar');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('ready');
    }
  };

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
            <PolarisLink url="/products">Products page</PolarisLink> and click
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

  const platformOptions = [
    { label: 'Facebook Page', value: 'facebook' },
  ];

  // Critique → Badge mapping. 8–10 = great, 5–7 = OK, 0–4 = regenerate.
  const critiqueTone: 'success' | 'attention' | 'warning' =
    critique == null ? 'attention'
    : critique.score >= 8 ? 'success'
    : critique.score >= 5 ? 'attention'
    : 'warning';
  const critiqueLabel =
    critique == null ? '—'
    : critique.score >= 8 ? 'Great match'
    : critique.score >= 5 ? 'Decent match'
    : 'Poor match';

  const shopDisplayName = shop?.shop_name?.trim() || shop?.shop?.split('.')[0] || 'Your shop';

  return (
    <InlineGrid columns={{ xs: 1, lg: ['twoThirds', 'oneThird'] }} gap="400">
      {/* ── Left column: editor ──────────────────────────────────────────── */}
      <BlockStack gap="400">
        {result?.product && (
          <div className="compose-hero">
            <Box padding="400">
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={WandIcon} tone="magic" />
                  <Text as="span" variant="bodyMd" tone="subdued" fontWeight="medium">
                    Composing for
                  </Text>
                </InlineStack>
                <Text as="h2" variant="headingLg">
                  {result.product.title}
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  {result.product.price && (
                    <Badge tone="info">{`Price: ${result.product.price}`}</Badge>
                  )}
                  <Text as="span" variant="bodySm" tone="subdued">
                    {result.model_used}
                  </Text>
                </InlineStack>
              </BlockStack>
            </Box>
          </div>
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

        {/* ── Quality score card (only shows once we have an image+caption) ── */}
        {imageUrl && (
          <div className={
            critique == null ? undefined
            : critique.score >= 8 ? 'compose-quality-good'
            : critique.score >= 5 ? 'compose-quality-mid'
            : 'compose-quality-low'
          }>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={StarFilledIcon} tone={critiqueTone === 'success' ? 'success' : critiqueTone === 'warning' ? 'critical' : 'subdued'} />
                    <Text as="h3" variant="headingMd">Quality score</Text>
                  </InlineStack>
                  {critiquing
                    ? <InlineStack gap="100" blockAlign="center"><Spinner size="small" /><Text as="span" variant="bodySm" tone="subdued">Checking…</Text></InlineStack>
                    : critique
                      ? <Badge tone={critiqueTone}>{critiqueLabel}</Badge>
                      : null}
                </InlineStack>

                {critique && (
                  <>
                    <InlineStack gap="300" blockAlign="center">
                      <Tooltip content="Image-vs-caption match score from a vision model — higher is better.">
                        <Text as="p" variant="heading2xl">{critique.score}<Text as="span" variant="bodyLg" tone="subdued">/10</Text></Text>
                      </Tooltip>
                      <Box minWidth="100%">
                        <ProgressBar
                          progress={critique.score * 10}
                          size="small"
                          tone={critiqueTone === 'success' ? 'success' : critiqueTone === 'warning' ? 'critical' : 'primary'}
                        />
                      </Box>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">{critique.reasoning}</Text>
                    {critique.regenerate && (
                      <Banner tone="warning">
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd">
                            The image and caption don't match well. Regenerating the image usually fixes this faster than tweaking the caption.
                          </Text>
                          <Button icon={RefreshIcon} onClick={handleRegenerate} loading={regenerating}>
                            Regenerate image
                          </Button>
                        </BlockStack>
                      </Banner>
                    )}
                  </>
                )}

                {!critique && !critiquing && critiqueError && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Quality check unavailable: {critiqueError}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </div>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={ImageIcon} tone="info" />
              <Text as="h3" variant="headingMd">Image</Text>
            </InlineStack>
            {imageUrl ? (
              <InlineStack gap="400" blockAlign="start">
                <div className="compose-image-wrap">
                  <Thumbnail source={imageUrl} alt="Generated post image" size="large" />
                </div>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Not quite right? Regenerate to try another shot.
                  </Text>
                  <Button icon={RefreshIcon} onClick={handleRegenerate} loading={regenerating}>
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
            <InlineStack gap="200" blockAlign="center">
              <Icon source={TextIcon} tone="info" />
              <Text as="h3" variant="headingMd">Caption</Text>
            </InlineStack>
            <TextField
              label="Caption"
              labelHidden
              value={caption}
              onChange={setCaption}
              multiline={4}
              autoComplete="off"
              helpText={`${caption.length} characters`}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={SocialAdIcon} tone="info" />
                <Text as="h3" variant="headingMd">Publish to</Text>
              </InlineStack>
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
                icon={SaveIcon}
                onClick={handleSaveDraft}
                loading={phase === 'saving'}
                disabled={phase === 'saving' || regenerating}
              >
                Save as draft
              </Button>
              <Button
                icon={SendIcon}
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

      {/* ── Right column: live preview ─────────────────────────────────── */}
      <BlockStack gap="300">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ViewIcon} tone="info" />
                <Text as="h3" variant="headingMd">Live preview</Text>
              </InlineStack>
              <Badge tone="info">Facebook Page</Badge>
            </InlineStack>

            <Box>
              <LivePostPreview
                platform="facebook"
                caption={caption}
                imageUrl={imageUrl || null}
                shopName={shopDisplayName}
              />
            </Box>

            <Text as="p" variant="bodySm" tone="subdued">
              Preview updates as you edit the caption or regenerate the image.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </InlineGrid>
  );
}
