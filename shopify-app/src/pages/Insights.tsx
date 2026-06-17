import { useCallback, useEffect, useState } from 'react';
import { Link as RRLink } from 'react-router-dom';
import {
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Spinner,
  Banner,
  Badge,
  Button,
  Box,
  Divider,
  ProgressBar,
  Tooltip,
  Icon,
} from '@shopify/polaris';
import {
  RefreshIcon,
  ChartLineIcon,
  PersonFilledIcon,
  CalendarIcon,
  SocialAdIcon,
  ConfettiIcon,
} from '@shopify/polaris-icons';
import { getInsights, ApiError, type ShopifyInsightsResponse } from '../api';

/**
 * Insights — read-only page summarising the shop's social performance.
 *
 * Two data sources, one render:
 *   1. /api/shopify/insights returns Facebook Page stats (followers, 28-day
 *      reach or interactions, engagement rate) AND the D1 post queue summary
 *      (drafts/scheduled/posted/missed + platform split).
 *   2. When the merchant hasn't connected a Facebook Page yet, `liveStats`
 *      comes back null — we show a connect-prompt Banner instead of the
 *      page-stat tiles, but still render the post queue.
 *
 * Mirrors the engagement bar from the main SocialAI Studio app
 * (DashboardStats.tsx) so the visual story is consistent — but in Polaris
 * primitives, since this is an embedded Shopify surface.
 */

type Phase = 'loading' | 'ready' | 'error';

export default function Insights() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<ShopifyInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setPhase('loading');
    setError(null);
    const controller = new AbortController();
    try {
      const result = await getInsights(controller.signal);
      setData(result);
      setPhase('ready');
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('error');
    } finally {
      setRefreshing(false);
    }
    return () => controller.abort();
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (phase === 'loading') {
    return (
      <Card>
        <BlockStack gap="200" align="center">
          <Spinner accessibilityLabel="Loading insights" />
          <Text as="p" variant="bodySm" tone="subdued">Loading insights…</Text>
        </BlockStack>
      </Card>
    );
  }

  if (phase === 'error' || !data) {
    return (
      <Banner tone="critical" title="Couldn't load insights">
        <BlockStack gap="200">
          <p>{error ?? 'Unknown error.'}</p>
          <Button onClick={() => load(false)}>Retry</Button>
        </BlockStack>
      </Banner>
    );
  }

  const { connection, liveStats, posts, fetchedAt } = data;

  // Engagement rating — same thresholds as the main app's DashboardStats so
  // a merchant moving between the two surfaces sees consistent language.
  const engagement = liveStats?.engagementRate ?? 0;
  const engagementBand: { tone: 'success' | 'attention' | 'warning' | 'critical'; label: string } =
    engagement >= 5 ? { tone: 'success',   label: 'Excellent' } :
    engagement >= 3 ? { tone: 'success',   label: 'Good' } :
    engagement >= 1 ? { tone: 'attention', label: 'Average' } :
                      { tone: 'warning',   label: 'Low' };

  // Middle stat tile flips its label depending on which calculation path
  // succeeded. 'insights' → unique reach (premium signal); 'posts' → sum
  // of like/comment/share interactions (fallback when read_insights is
  // unavailable). Tooltip explains the distinction.
  const middleStatLabel = liveStats?.source === 'insights' ? 'Reach (28d)' : 'Interactions (28d)';
  const middleStatValue = liveStats?.source === 'insights' ? liveStats.reach28d : (liveStats?.interactions28d ?? 0);
  const middleStatTooltip = liveStats?.source === 'insights'
    ? 'Unique people who saw any of your Facebook content in the last 28 days.'
    : 'Sum of likes, comments, and shares across your last 28 days of posts. Unique reach requires Facebook App Review (read_insights permission).';

  const lastUpdated = new Date(fetchedAt);
  const weeklyTarget = 7; // mirrors the main app's "5-7 posts/week" suggestion

  return (
    <BlockStack gap="400">
      {/* ── Header row: title + refresh ─────────────────────────────────── */}
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={ChartLineIcon} tone="info" />
            <Text as="h2" variant="headingLg">Insights</Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Last updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {connection.connected
              ? <>Live from <strong>{connection.pageName ?? 'connected Page'}</strong></>
              : 'Connect Facebook for live stats'}
          </Text>
        </BlockStack>
        <Button
          icon={RefreshIcon}
          onClick={() => load(true)}
          loading={refreshing}
          accessibilityLabel="Refresh insights"
        >
          Refresh
        </Button>
      </InlineStack>

      {/* ── Connect-prompt Banner (only when FB not connected) ─────────── */}
      {!connection.connected && (
        <Banner
          tone="info"
          title="Connect Facebook to see live engagement stats"
          action={{ content: 'Go to Settings', url: '/settings' }}
        >
          <p>
            Once you connect a Facebook Page, this tab will show your follower count,
            28-day reach or interactions, and engagement rate alongside your post queue.
          </p>
        </Banner>
      )}

      {/* ── Live stat tiles (FB Page metrics) ─────────────────────────── */}
      {liveStats && (
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
          {/* Followers */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={PersonFilledIcon} tone="info" />
                <Text as="span" variant="bodySm" tone="subdued">Followers</Text>
              </InlineStack>
              <Text as="p" variant="heading2xl">
                {liveStats.followersCount.toLocaleString()}
              </Text>
              {liveStats.fanCount > 0 && liveStats.fanCount !== liveStats.followersCount && (
                <Text as="span" variant="bodySm" tone="subdued">
                  {liveStats.fanCount.toLocaleString()} page likes
                </Text>
              )}
            </BlockStack>
          </Card>

          {/* Reach or Interactions (middle tile, label flips by source) */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ChartLineIcon} tone="info" />
                <Tooltip content={middleStatTooltip}>
                  <Text as="span" variant="bodySm" tone="subdued">{middleStatLabel}</Text>
                </Tooltip>
              </InlineStack>
              <Text as="p" variant="heading2xl">
                {middleStatValue.toLocaleString()}
              </Text>
              {liveStats.source === 'posts' && (
                <Text as="span" variant="bodySm" tone="subdued">From post engagement</Text>
              )}
            </BlockStack>
          </Card>

          {/* Engagement Rate */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ConfettiIcon} tone="success" />
                <Text as="span" variant="bodySm" tone="subdued">Engagement rate</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="baseline">
                <Text as="p" variant="heading2xl">{liveStats.engagementRate}%</Text>
                <Badge tone={engagementBand.tone}>{engagementBand.label}</Badge>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                Industry avg: 1–3%
              </Text>
            </BlockStack>
          </Card>

          {/* Engaged Users (28d) — only when we have insights data */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={SocialAdIcon} tone="magic" />
                <Text as="span" variant="bodySm" tone="subdued">
                  {liveStats.source === 'insights' ? 'Engaged users (28d)' : 'Posts this week'}
                </Text>
              </InlineStack>
              <Text as="p" variant="heading2xl">
                {liveStats.source === 'insights'
                  ? liveStats.engagedUsers28d.toLocaleString()
                  : posts.thisWeek.toLocaleString()}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {liveStats.source === 'insights'
                  ? 'Clicked, liked, commented, or shared'
                  : `Target: ${weeklyTarget}/week for steady growth`}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>
      )}

      {/* ── Post queue summary (always rendered) ───────────────────────── */}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Post queue</Text>
            <RRLink to="/calendar" style={{ textDecoration: 'none' }}>
              <Button variant="plain">View calendar</Button>
            </RRLink>
          </InlineStack>

          <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
            <QueueTile label="Drafts"    value={posts.drafts}    tone="info" />
            <QueueTile label="Scheduled" value={posts.scheduled} tone="attention" />
            <QueueTile label="Published" value={posts.posted}    tone="success" />
            <QueueTile label="Missed"    value={posts.missed}    tone="warning" />
          </InlineGrid>

          {posts.scheduled > 0 && (
            <BlockStack gap="200">
              <Divider />
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CalendarIcon} tone="base" />
                  <Text as="span" variant="bodyMd">
                    {posts.thisWeek} {posts.thisWeek === 1 ? 'post' : 'posts'} scheduled this week
                  </Text>
                </InlineStack>
                <Text as="span" variant="bodySm" tone="subdued">
                  Target: {weeklyTarget}/week
                </Text>
              </InlineStack>
              <ProgressBar
                progress={Math.min(100, Math.round((posts.thisWeek / weeklyTarget) * 100))}
                size="small"
                tone={posts.thisWeek >= weeklyTarget ? 'success' : 'primary'}
              />
            </BlockStack>
          )}

          {posts.total > 0 && (
            <BlockStack gap="200">
              <Divider />
              <Text as="span" variant="bodySm" tone="subdued">Platform split</Text>
              <BlockStack gap="100">
                <PlatformRow label="Facebook" count={posts.byPlatform.facebook} total={posts.total} />
                {(posts.byPlatform.instagram + posts.byPlatform.both) > 0 && (
                  <PlatformRow
                    label="Other / legacy"
                    count={posts.byPlatform.instagram + posts.byPlatform.both}
                    total={posts.total}
                  />
                )}
              </BlockStack>
            </BlockStack>
          )}

          {posts.total === 0 && (
            <Box paddingBlockStart="200">
              <Banner tone="info">
                <BlockStack gap="200">
                  <p>No posts yet. Head to <strong>Products</strong>, pick something to feature, then <strong>Compose</strong> your first AI-generated post.</p>
                  <RRLink to="/products" style={{ textDecoration: 'none' }}>
                    <Button>Go to Products</Button>
                  </RRLink>
                </BlockStack>
              </Banner>
            </Box>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function QueueTile({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: 'info' | 'success' | 'attention' | 'warning';
}) {
  return (
    <Card padding="300">
      <BlockStack gap="100">
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
        <InlineStack gap="200" blockAlign="baseline">
          <Text as="p" variant="headingLg">{value.toLocaleString()}</Text>
          {value > 0 && <Badge tone={tone}>{label}</Badge>}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function PlatformRow({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodySm">{label}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{count} ({pct}%)</Text>
      </InlineStack>
      <ProgressBar progress={pct} size="small" tone="primary" />
    </BlockStack>
  );
}
