import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Banner, Button,
  Spinner, Box, Badge, ChoiceList, RangeSlider, ProgressBar, Divider, Checkbox,
  Icon,
} from '@shopify/polaris';
import type { IconSource } from '@shopify/polaris';
import {
  RefreshIcon, DeleteIcon, CheckCircleIcon,
  MagicIcon, ClockIcon, StarIcon, CalendarIcon,
  WandIcon, ConfettiIcon,
} from '@shopify/polaris-icons';
import './autopilot.css';
import {
  listProducts, generateAutopilotPost, saveAutopilotBatch, getActiveCampaign,
  getFactsStatus, refreshFacts, ApiError,
  type Product, type AutopilotGeneratedPost, type ShopifyCampaign, type FactsStatus,
} from '../api';

/**
 * AI Autopilot — bulk content calendar generator with preview-then-accept flow.
 *
 * Workflow (mirrors main SocialAI Studio Smart Schedule):
 *  1. Merchant picks a vibe (Smart Schedule / 24hr Burst / Highlights /
 *     Saturation), a platform selection, and a post count.
 *  2. We expand the vibe into N timestamps in the merchant's LOCAL
 *     timezone (the browser's clock — better than guessing on the worker
 *     side where everything is UTC).
 *  3. We round-robin the synced product list into the N slots so each
 *     post features a different SKU (loops if N > product count).
 *  4. Calls /api/shopify/autopilot/generate-one with dryRun=true for each
 *     slot, concurrency-3. The worker composes caption + image but does
 *     NOT persist — we collect results into React state.
 *  5. Phase flips to 'reviewing'. Merchant sees a preview card per post:
 *     image, caption, scheduled time, platform, and a delete button.
 *  6. When the merchant clicks "Accept All & Add to Calendar", we call
 *     /api/shopify/autopilot/save-batch with the surviving posts. The
 *     worker bulk-inserts them as status='Scheduled'.
 *
 *  Why not save-on-generate?
 *  -------------------------
 *  An earlier version did. But composing 7-14 posts is a 90-180s wall-clock
 *  operation, and merchants want to scan the captions/images before they
 *  go live. Save-on-generate forced them to load the Calendar tab and
 *  delete unwanted posts one by one. The preview flow keeps everything in
 *  one screen and only writes to D1 once the merchant confirms.
 */

type Vibe = 'smart' | 'burst' | 'highlights' | 'saturation';
type Platform = 'facebook';
/**
 * Phase progression mirrors the main SocialAI Studio Smart Schedule:
 *   idle → generating → reviewing → saving → done
 *
 * 'reviewing' is the new step: posts are composed but NOT yet in the DB.
 * The merchant can edit/delete individual posts, then "Accept All" saves
 * them in one batch.
 */
type Phase = 'idle' | 'generating' | 'reviewing' | 'saving' | 'done' | 'error';

interface VibeConfig {
  id: Vibe;
  label: string;
  description: string;
  bestFor: string;
  icon: IconSource;
  defaultPosts: number;
  /** Maximum slots this vibe will produce — clamps the slider. */
  maxPosts: number;
}

const VIBES: VibeConfig[] = [
  {
    id: 'smart',
    label: 'Smart Schedule',
    description: 'One post per day at peak time, up to 2 weeks',
    bestFor: 'Consistent steady growth',
    icon: MagicIcon,
    defaultPosts: 7,
    maxPosts: 14,
  },
  {
    id: 'burst',
    label: 'Quick 24hr Burst',
    description: '3–6 posts evenly spaced over the next 24 hours',
    bestFor: 'Launch days, flash sales',
    icon: ClockIcon,
    defaultPosts: 4,
    maxPosts: 6,
  },
  {
    id: 'highlights',
    label: 'Highlights Only',
    description: 'Peak engagement slots only — one per day, evenings',
    bestFor: 'Premium / low-frequency feeds',
    icon: StarIcon,
    defaultPosts: 7,
    maxPosts: 14,
  },
  {
    id: 'saturation',
    label: 'Saturation',
    description: '4 posts/day × 7 days — maximum reach',
    bestFor: 'Black Friday, big campaigns',
    icon: CalendarIcon,
    defaultPosts: 14,
    maxPosts: 28,
  },
];

const CONCURRENCY = 3;

// ── Schedule planner (LOCAL time) ──────────────────────────────────────────
//
// Each vibe maps to a set of {dayOffset, hourOfDay} slots. We expand the
// vibe + post count by walking slots in order and skipping past timestamps.
// Returns ISO strings constructed via Date() so the times come out in the
// browser's local TZ.

interface SlotRule { dayOffset: number; hour: number; minute: number; }

function vibeSlots(vibe: Vibe, postCount: number): SlotRule[] {
  // Use times-of-day that map well to typical merchant audiences:
  //   12:00 lunchtime browse / 17:00 commute / 19:00 evening scroll.
  // Smart skips weekends-only mode because B2C runs hot at weekends too.
  switch (vibe) {
    case 'smart': {
      // Up to 14 days × 1 post/day at 19:00, going back to mid-afternoon
      // for the second pass on the same day if N > 14.
      const out: SlotRule[] = [];
      for (let d = 0; d < 14; d++) out.push({ dayOffset: d, hour: 19, minute: 0 });
      for (let d = 0; d < 14 && out.length < postCount; d++) out.push({ dayOffset: d, hour: 12, minute: 0 });
      return out;
    }
    case 'burst': {
      // Next 24 hours, evenly spaced. With postCount=4 that's roughly
      // every 6 hours; with postCount=6 every 4 hours.
      const out: SlotRule[] = [];
      const step = 24 / Math.max(1, postCount);
      for (let i = 0; i < postCount; i++) {
        const hoursFromNow = step * (i + 1);
        const total = Math.floor(hoursFromNow * 60);
        const hour = (new Date().getHours() + Math.floor(total / 60)) % 24;
        const minute = total % 60;
        out.push({
          dayOffset: Math.floor((new Date().getHours() + total / 60) / 24),
          hour, minute,
        });
      }
      return out;
    }
    case 'highlights': {
      // One post per day at peak engagement time (19:00) for 14 days.
      const out: SlotRule[] = [];
      for (let d = 0; d < 14; d++) out.push({ dayOffset: d, hour: 19, minute: 0 });
      return out;
    }
    case 'saturation': {
      // 4 posts/day × 7 days = 28 slots, in 09/12/15/18 cadence.
      const hours = [9, 12, 15, 18];
      const out: SlotRule[] = [];
      for (let d = 0; d < 7; d++) for (const h of hours) {
        out.push({ dayOffset: d, hour: h, minute: 0 });
      }
      return out;
    }
  }
}

function expandToTimestamps(vibe: Vibe, postCount: number): string[] {
  const slots = vibeSlots(vibe, postCount);
  const now = new Date();
  const out: string[] = [];
  for (const slot of slots) {
    if (out.length >= postCount) break;
    const d = new Date(now);
    d.setDate(now.getDate() + slot.dayOffset);
    d.setHours(slot.hour, slot.minute, 0, 0);
    // Skip slots in the past — push them forward by one day for the
    // 'burst' vibe (where slot.hour is current-time-based), drop them
    // for the others.
    if (d.getTime() < now.getTime() + 60_000) {
      if (vibe === 'burst') {
        d.setDate(d.getDate() + 1);
      } else {
        continue;
      }
    }
    out.push(d.toISOString());
  }
  return out;
}

// ── Concurrency helper ─────────────────────────────────────────────────────
//
// Run async tasks with at most `limit` in flight. Calls onProgress after
// each settles so the UI can show "3 of 7 generated". Resolves once all
// tasks have completed (success or failure).

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
  onProgress: (idx: number, result: { ok: true; value: R } | { ok: false; error: string }) => void,
) {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < limit; w++) {
    workers.push((async function loop() {
      while (next < items.length) {
        const idx = next++;
        try {
          const value = await fn(items[idx], idx);
          onProgress(idx, { ok: true, value });
        } catch (err: any) {
          onProgress(idx, { ok: false, error: err instanceof ApiError ? err.message : String(err) });
        }
      }
    })());
  }
  await Promise.all(workers);
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Autopilot() {
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<ShopifyCampaign | null>(null);
  const [factsStatus, setFactsStatus] = useState<FactsStatus | null>(null);
  const [refreshingFacts, setRefreshingFacts] = useState(false);

  const [vibe, setVibe] = useState<Vibe>('smart');
  const [platform, setPlatform] = useState<Platform>('facebook');
  const [postCount, setPostCount] = useState(7);
  const [includeReels, setIncludeReels] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    succeeded: AutopilotGeneratedPost[];
    failed: { error: string; scheduledFor: string }[];
  }>({ done: 0, total: 0, succeeded: [], failed: [] });
  const [error, setError] = useState<string | null>(null);
  // Per-row "I changed my mind" state for the preview screen. Removing a
  // preview just drops it from this set — no DB roundtrip until Accept All.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // Save phase counters — drive the progress bar during Accept All.
  const [saveProgress, setSaveProgress] = useState<{ saved: number; failed: number; total: number }>({
    saved: 0, failed: 0, total: 0,
  });

  const vibeConfig = VIBES.find((v) => v.id === vibe)!;

  // Load synced products on mount — the round-robin source for autopilot.
  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const res = await listProducts();
      setProducts(res.products);
    } catch (e: unknown) {
      setProductsError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Best-effort active-campaign lookup. If it fails (table not yet
  // migrated, network error, etc.) we just don't show the banner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getActiveCampaign();
        if (!cancelled) setActiveCampaign(res.active);
      } catch {
        // silent — campaigns is optional UX context
      }
      try {
        const f = await getFactsStatus();
        if (!cancelled) setFactsStatus(f);
      } catch {
        // silent — facts indicator is optional
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRefreshFacts = async () => {
    setRefreshingFacts(true);
    try {
      await refreshFacts();
      const f = await getFactsStatus();
      setFactsStatus(f);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRefreshingFacts(false);
    }
  };

  // Clamp post count when vibe changes so the slider doesn't blow past the new max.
  useEffect(() => {
    setPostCount((c) => Math.min(c, vibeConfig.maxPosts));
  }, [vibeConfig.maxPosts]);

  const handleGenerate = async () => {
    if (products.length === 0) {
      setError('No products synced. Head to the Products tab and click "Sync products from Shopify" first.');
      return;
    }
    setError(null);
    setPhase('generating');
    setRemovedIds(new Set());
    setSaveProgress({ saved: 0, failed: 0, total: 0 });

    // Plan slots in local time, then assign products round-robin.
    const timestamps = expandToTimestamps(vibe, postCount);
    if (timestamps.length === 0) {
      setError('Couldn\'t plan any slots in the future for this vibe. Try a different option.');
      setPhase('error');
      return;
    }

    // When Reels is on, alternate image and video slots so the batch
    // doesn't melt the Kling queue (videos cost more time + credits than
    // images, and the prewarm-videos cron picks 2 per tick — sequencing
    // gives the cron breathing room).
    const plan = timestamps.map((scheduledFor, i) => ({
      scheduledFor,
      productId: products[i % products.length].id,
      productTitle: products[i % products.length].title,
      platform,
      postType: (includeReels && i % 2 === 0 ? 'video' : 'image') as 'image' | 'video',
    }));

    setProgress({ done: 0, total: plan.length, succeeded: [], failed: [] });

    await runWithConcurrency(
      plan,
      CONCURRENCY,
      async (slot) => generateAutopilotPost({
        productId: slot.productId,
        platform: slot.platform,
        scheduledFor: slot.scheduledFor,
        postType: slot.postType,
        dryRun: true,  // compose only — merchant reviews before saving
      }),
      (_idx, result) => {
        setProgress((p) => ({
          done: p.done + 1,
          total: p.total,
          succeeded: result.ok ? [...p.succeeded, result.value] : p.succeeded,
          failed: result.ok ? p.failed : [...p.failed, { error: result.error, scheduledFor: plan[_idx].scheduledFor }],
        }));
      },
    );

    // Move to review phase even if some failed — the merchant can still
    // accept the successful ones and ignore the failures.
    setPhase('reviewing');
  };

  // Survivors = succeeded posts the merchant hasn't removed in the preview.
  const survivors = progress.succeeded.filter((p) => !removedIds.has(p.id));

  const handleAcceptAll = async () => {
    if (survivors.length === 0) {
      setError('Nothing left to save — every post was removed.');
      return;
    }
    setError(null);
    setPhase('saving');
    setSaveProgress({ saved: 0, failed: 0, total: survivors.length });

    try {
      const result = await saveAutopilotBatch(
        survivors.map((p) => ({
          caption: p.caption,
          imageUrl: p.image_url,
          platform: p.platform,
          scheduledFor: p.scheduled_for,
          postType: p.post_type,
          motionPrompt: p.motion_prompt ?? null,
        })),
      );
      setSaveProgress({
        saved: result.saved.length,
        failed: result.failed.length,
        total: survivors.length,
      });
      // If everything saved, flip straight to done. If partial, leave the
      // merchant in 'done' anyway so they can choose to retry the failures
      // by running another batch.
      setPhase('done');
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
      setPhase('reviewing');  // back to review so they can retry
    }
  };

  const handleDiscardAll = () => {
    setPhase('idle');
    setProgress({ done: 0, total: 0, succeeded: [], failed: [] });
    setRemovedIds(new Set());
    setSaveProgress({ saved: 0, failed: 0, total: 0 });
  };

  const handleRemovePost = (id: string) => {
    setRemovedIds((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  };

  return (
    <BlockStack gap="500">
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <Card>
        <Box background="bg-fill-magic-secondary" padding="500" borderRadius="200">
          <InlineStack gap="400" blockAlign="center" wrap={false}>
            <Box
              background="bg-fill-magic"
              padding="300"
              borderRadius="200"
              minWidth="56px"
            >
              <Icon source={WandIcon} tone="magic" />
            </Box>
            <BlockStack gap="100">
              <Text as="h1" variant="headingXl">AI Autopilot</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Generate a week of Facebook-ready posts in one click. Pick a vibe,
                review the previews, then ship them to your calendar.
              </Text>
            </BlockStack>
          </InlineStack>
        </Box>
      </Card>

      {error && (
        <Banner tone="critical" title="Couldn't run autopilot" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}

      {activeCampaign && (
        <Banner tone="info" title={`Campaign: ${activeCampaign.name}`}>
          <BlockStack gap="100">
            <Text as="p" variant="bodyMd">
              Posts generated below will weave in this campaign's theme.
            </Text>
            {activeCampaign.theme && (
              <Text as="p" variant="bodySm" tone="subdued">{activeCampaign.theme}</Text>
            )}
          </BlockStack>
        </Banner>
      )}

      {factsStatus && factsStatus.page_connected && (
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={factsStatus.total > 0 ? 'success' : 'attention'}>
                {factsStatus.total > 0
                  ? `${factsStatus.total} facts from Facebook ready`
                  : 'No facts scraped yet'}
              </Badge>
              {factsStatus.last_verified_at && (
                <Text as="span" variant="bodySm" tone="subdued">
                  Last updated {new Date(factsStatus.last_verified_at).toLocaleString()}
                </Text>
              )}
            </InlineStack>
            <Button
              icon={RefreshIcon}
              onClick={handleRefreshFacts}
              loading={refreshingFacts}
              variant="plain"
            >
              Refresh
            </Button>
          </InlineStack>
        </Card>
      )}

      {productsLoading ? (
        <Card>
          <BlockStack gap="200" align="center" inlineAlign="center">
            <Spinner accessibilityLabel="Loading products" />
            <Text as="p" variant="bodySm" tone="subdued">Loading your product catalog…</Text>
          </BlockStack>
        </Card>
      ) : productsError ? (
        <Banner tone="critical" title="Couldn't load products">
          <BlockStack gap="200">
            <p>{productsError}</p>
            <Button onClick={loadProducts}>Retry</Button>
          </BlockStack>
        </Banner>
      ) : products.length === 0 ? (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">Sync your products first</Text>
            <Text as="p" variant="bodyMd">
              Autopilot needs at least one synced product to feature in each post. Head
              to the Products tab and click "Sync products from Shopify".
            </Text>
            <Button onClick={() => navigate('/products')}>Go to Products</Button>
          </BlockStack>
        </Card>
      ) : (
        <>
          {/* ── Vibe picker ──────────────────────────────────────────── */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">1. Choose your vibe</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  How aggressive should the schedule be? Each vibe maps to a different
                  cadence and spread.
                </Text>
              </BlockStack>
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                {VIBES.map((v) => (
                  <VibeCard
                    key={v.id}
                    config={v}
                    selected={vibe === v.id}
                    onClick={() => setVibe(v.id)}
                    disabled={phase === 'generating'}
                  />
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>

          {/* ── Settings ────────────────────────────────────────────── */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">2. Tune the schedule</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  How many Facebook posts to generate, and whether to mix in video Reels.
                </Text>
              </BlockStack>

              <ChoiceList
                title="Post to"
                choices={[
                  { label: 'Facebook Page', value: 'facebook' },
                ]}
                selected={[platform]}
                onChange={(v) => setPlatform(v[0] as Platform)}
                disabled={phase === 'generating'}
              />

              <BlockStack gap="200">
                <RangeSlider
                  label={`Posts to generate: ${postCount}`}
                  value={postCount}
                  onChange={(v) => setPostCount(Array.isArray(v) ? v[0] : v)}
                  min={1}
                  max={vibeConfig.maxPosts}
                  step={1}
                  output
                  disabled={phase === 'generating'}
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  {postCount} {postCount === 1 ? 'post' : 'posts'} from {products.length} synced{' '}
                  {products.length === 1 ? 'product' : 'products'}, scheduled by the "{vibeConfig.label}" vibe.
                </Text>
              </BlockStack>

              <Checkbox
                label="Include Reels / Videos"
                helpText={
                  includeReels
                    ? 'Every other slot becomes a Reel. Video renders ~10-20 min later via Kling i2v; image lands instantly as the thumbnail.'
                    : 'Skip Reels — image-only schedule (faster, cheaper).'
                }
                checked={includeReels}
                onChange={setIncludeReels}
                disabled={phase === 'generating'}
              />

              <Divider />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  Generation runs 3 posts at a time. Each takes 5–20s.
                </Text>
                <Button
                  variant="primary"
                  size="large"
                  loading={phase === 'generating'}
                  disabled={phase === 'generating' || products.length === 0}
                  onClick={handleGenerate}
                >
                  {`Generate ${postCount} ${postCount === 1 ? 'post' : 'posts'}`}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* ── Generation progress (while running) ──────────────────── */}
          {phase === 'generating' && (
            <Card>
              <Box background="bg-fill-magic-secondary" padding="500" borderRadius="200">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Spinner accessibilityLabel="Generating posts" size="small" />
                      <Text as="h3" variant="headingMd">Composing your batch…</Text>
                    </InlineStack>
                    <Badge tone="magic">{`${progress.done} of ${progress.total}`}</Badge>
                  </InlineStack>

                  <ProgressBar
                    progress={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                    size="medium"
                    tone="primary"
                  />

                  <Text as="p" variant="bodySm" tone="subdued">
                    Each post takes 5–20 seconds — caption + image, in parallel. Sit tight,
                    we'll show every post for your review before anything goes live.
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          )}

          {/* ── Review / preview screen (after generation) ──────────── */}
          {phase === 'reviewing' && (
            <BlockStack gap="400">
              {/* Sticky Accept All header — branded, prominent */}
              <Box
                position="sticky"
                insetBlockStart="0"
                background="bg-surface"
                zIndex="100"
                paddingBlockStart="200"
              >
                <Card>
                  <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" wrap={false} gap="400">
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <Box
                            background="bg-fill-success"
                            padding="200"
                            borderRadius="200"
                          >
                            <Icon source={CheckCircleIcon} tone="success" />
                          </Box>
                          <BlockStack gap="050">
                            <Text as="h3" variant="headingMd">
                              {survivors.length > 0
                                ? `${survivors.length} ${survivors.length === 1 ? 'post' : 'posts'} ready to preview`
                                : 'No posts to preview'}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Review the previews below, then add the Facebook-ready batch to your calendar.
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <InlineStack gap="200">
                          <Button onClick={handleDiscardAll} variant="tertiary">
                            Discard all
                          </Button>
                          <Button
                            variant="primary"
                            size="large"
                            icon={CheckCircleIcon}
                            disabled={survivors.length === 0}
                            onClick={handleAcceptAll}
                          >
                            {`Accept all ${survivors.length} & schedule`}
                          </Button>
                        </InlineStack>
                      </InlineStack>

                      <InlineStack gap="200">
                        <Badge tone="success">{`${progress.succeeded.length} generated`}</Badge>
                        {removedIds.size > 0 && (
                          <Badge>{`${removedIds.size} removed`}</Badge>
                        )}
                        {progress.failed.length > 0 && (
                          <Badge tone="warning">{`${progress.failed.length} failed`}</Badge>
                        )}
                        {activeCampaign && (
                          <Badge tone="attention">{`Campaign: ${activeCampaign.name}`}</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </Card>
              </Box>

              {progress.failed.length > 0 && (
                <Banner tone="warning" title={`${progress.failed.length} ${progress.failed.length === 1 ? 'post' : 'posts'} couldn't be generated`}>
                  <BlockStack gap="100">
                    {progress.failed.slice(0, 3).map((f, i) => (
                      <Text key={i} as="p" variant="bodySm">
                        {new Date(f.scheduledFor).toLocaleString()} — {f.error}
                      </Text>
                    ))}
                    {progress.failed.length > 3 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        …and {progress.failed.length - 3} more.
                      </Text>
                    )}
                  </BlockStack>
                </Banner>
              )}

              {/* One card per preview post */}
              {survivors.map((post, idx) => (
                <PreviewCard
                  key={post.id}
                  post={post}
                  index={idx}
                  onRemove={() => handleRemovePost(post.id)}
                />
              ))}
            </BlockStack>
          )}

          {/* ── Saving phase ─────────────────────────────────────────── */}
          {phase === 'saving' && (
            <Card>
              <Box background="bg-fill-info-secondary" padding="600" borderRadius="200">
                <BlockStack gap="400" align="center" inlineAlign="center">
                  <Spinner accessibilityLabel="Saving posts" />
                  <Text as="h3" variant="headingMd">
                    Adding {saveProgress.total} {saveProgress.total === 1 ? 'post' : 'posts'} to your calendar…
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Don't refresh — this takes a few seconds.
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          )}

          {/* ── Done — celebratory finish state ──────────────────────── */}
          {phase === 'done' && (
            <Card>
              <Box background="bg-fill-success-secondary" padding="600" borderRadius="200">
                <BlockStack gap="500" align="center" inlineAlign="center">
                  <Box
                    background="bg-fill-success"
                    padding="400"
                    borderRadius="full"
                  >
                    <Icon source={ConfettiIcon} tone="success" />
                  </Box>
                  <BlockStack gap="100" align="center" inlineAlign="center">
                    <Text as="h2" variant="headingLg" alignment="center">
                      Your batch is on the calendar!
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      {saveProgress.saved} of {saveProgress.total} {saveProgress.total === 1 ? 'post' : 'posts'} scheduled to your Facebook Page.
                    </Text>
                  </BlockStack>

                  {saveProgress.failed > 0 && (
                    <Banner tone="warning" title={`${saveProgress.failed} couldn't be saved`}>
                      <p>Run another batch to retry the failed slots.</p>
                    </Banner>
                  )}

                  <InlineStack gap="200">
                    <Button variant="primary" size="large" icon={CalendarIcon} onClick={() => navigate('/calendar')}>
                      View in Calendar
                    </Button>
                    <Button icon={RefreshIcon} onClick={handleDiscardAll}>
                      Run another batch
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Card>
          )}
        </>
      )}
    </BlockStack>
  );
}

// ── PreviewCard ────────────────────────────────────────────────────────────
//
// One generated post awaiting merchant approval. Designed to read like a
// social-media-feed mock so the merchant gets a feel for the post in context:
//   - product image (square, 200px target, fal.ai URLs are public)
//   - "Day N" pill + relative date + clock time
//   - platform + post-type badges
//   - full generated caption
//   - corner Remove button (overlay on the image, easy to scan + click)
//
// Hover state gives a subtle lift so it feels card-like and clickable.

function PreviewCard({
  post, index, onRemove,
}: {
  post: AutopilotGeneratedPost;
  index: number;
  onRemove: () => void;
}) {
  const isVideo = post.post_type === 'video';
  const date = new Date(post.scheduled_for);
  const dayLabel = describeRelativeDay(date);
  const timeLabel = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="autopilot-preview-card">
      <Card padding="0">
        <InlineGrid columns={{ xs: 1, sm: '220px 1fr' }} gap="0">
          {/* Image / thumbnail. fal.ai URLs are public so a plain <img>
              works. The Remove button is overlaid bottom-right so it
              stays in the merchant's eye-line. */}
          <Box position="relative">
            <img
              src={post.image_url}
              alt={post.product.title}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            {/* Day pill — sits top-left over the image */}
            <Box position="absolute" insetBlockStart="200" insetInlineStart="200">
              <Badge tone="info">{`#${index + 1} · ${dayLabel}`}</Badge>
            </Box>
            {isVideo && (
              <Box position="absolute" insetBlockStart="200" insetInlineEnd="200">
                <Badge tone="magic">Reel</Badge>
              </Box>
            )}
            {/* Remove button — overlay bottom-right */}
            <div style={{ position: 'absolute', bottom: 8, right: 8 }}>
              <Button
                icon={DeleteIcon}
                onClick={onRemove}
                accessibilityLabel="Remove this post"
                tone="critical"
                size="micro"
              />
            </div>
          </Box>

          {/* Right column: meta + caption */}
          <Box padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="start" wrap={false}>
                <BlockStack gap="100">
                  <Text as="h4" variant="headingSm">{post.product.title}</Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={ClockIcon} tone="subdued" />
                    <Text as="span" variant="bodySm" tone="subdued">
                      {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {timeLabel}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </InlineStack>

              <InlineStack gap="200" wrap>
                <Badge>Facebook</Badge>
                <Badge tone={isVideo ? 'magic' : undefined}>{isVideo ? 'Video Reel' : 'Image post'}</Badge>
                {post.campaign_used && (
                  <Badge tone="attention">Campaign-aware</Badge>
                )}
                {post.product.price && (
                  <Badge>{`${post.product.currency ?? ''} ${post.product.price}`.trim()}</Badge>
                )}
              </InlineStack>

              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <Text as="p" variant="bodyMd">{post.caption}</Text>
              </Box>
            </BlockStack>
          </Box>
        </InlineGrid>
      </Card>
    </div>
  );
}

/**
 * Human label for a scheduled date relative to "now":
 *   - "Today" / "Tomorrow"
 *   - "In 3 days"
 *   - "Mon Jun 2" (anything > 6 days out)
 */
function describeRelativeDay(date: Date): string {
  const now = new Date();
  // Compare calendar days, not raw ms — a post at 11pm tonight is still "Today".
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff > 1 && dayDiff <= 6) return `In ${dayDiff} days`;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── VibeCard ───────────────────────────────────────────────────────────────
//
// Visually distinct selectable card per vibe. Selected state gets a stronger
// border, a tinted background, and a subtle shadow so the merchant sees their
// choice from across the room. Hover lift comes from inline CSS since Polaris
// doesn't expose a hover state for Box.

function VibeCard({
  config, selected, onClick, disabled,
}: {
  config: VibeConfig;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="autopilot-vibe-card"
      data-selected={selected ? 'true' : 'false'}
      style={{
        all: 'unset',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'block',
        width: '100%',
        opacity: disabled ? 0.5 : 1,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        boxShadow: selected
          ? '0 0 0 2px var(--p-color-border-magic), 0 4px 12px rgba(128, 81, 255, 0.18)'
          : '0 0 0 1px var(--p-color-border)',
        borderRadius: 12,
      }}
    >
      <Box
        background={selected ? 'bg-fill-magic-secondary' : 'bg-surface'}
        borderRadius="300"
        padding="400"
        minHeight="170px"
      >
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <Box
              background={selected ? 'bg-fill-magic' : 'bg-surface-secondary'}
              padding="200"
              borderRadius="200"
            >
              <Icon source={config.icon} tone={selected ? 'magic' : 'subdued'} />
            </Box>
            {selected && <Badge tone="magic">Selected</Badge>}
          </InlineStack>
          <BlockStack gap="100">
            <Text as="span" variant="headingSm">
              {config.label}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {config.description}
            </Text>
          </BlockStack>
          <Box paddingBlockStart="100">
            <Text as="span" variant="bodyXs" tone="subdued">
              Best for: <Text as="span" variant="bodyXs" fontWeight="semibold">{config.bestFor}</Text>
            </Text>
          </Box>
        </BlockStack>
      </Box>
    </button>
  );
}
