import { useEffect, useState } from 'react';
import { Link as RRLink } from 'react-router-dom';
import {
  Card, BlockStack, InlineStack, Text, Spinner, Banner, Badge, Button,
  Divider, InlineGrid, Box, Icon, ProgressBar,
} from '@shopify/polaris';
import type { IconSource } from '@shopify/polaris';
import {
  WandIcon, MagicIcon, CalendarIcon, PersonFilledIcon,
  ConfettiIcon, ArrowRightIcon, CheckCircleIcon, AlertCircleIcon,
  LinkIcon, SocialAdIcon,
} from '@shopify/polaris-icons';
import {
  fetchMe, tokenExchange, setupSubscription, topLevelRedirect, getInsights,
  ApiError, type ShopInfo, type ShopifyInsightsResponse,
} from '../api';
import './home.css';

/**
 * Embedded-app home. Two phases of lifecycle:
 *
 *   1. Boot (init) — tokenExchange + fetchMe in parallel. The token
 *      exchange is the only reliable signal the embedded shell is wired
 *      up correctly; without it the rest of the app is dead. fetchMe
 *      gives us the shop record + subscription state.
 *   2. Live (ready) — once boot lands we fire getInsights in the
 *      background to populate the stat strip + post queue. We don't
 *      block render on it; the dashboard works fine without insights
 *      data (shows skeletons / "Connect Facebook for live stats").
 *
 * Subscription handling stays separate from the dashboard:
 *   - subscription not active → top-of-page Banner with "Start trial"
 *   - subscription active → no banner, full dashboard
 *
 * The 7-day free trial is configured in workers/api/src/lib/shopify-billing.ts.
 */

type Phase = 'init' | 'ready' | 'subscribing' | 'error';

export function Home() {
  const [phase, setPhase] = useState<Phase>('init');
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [insights, setInsights] = useState<ShopifyInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Two cancellation mechanisms:
    //   • AbortController.signal flows into fetch() and aborts any
    //     in-flight network request on unmount (StrictMode double-mounts
    //     trigger this in dev — without it the second mount races).
    //   • `cancelled` flag prevents state updates after the abort settles
    //     but before the catch block runs.
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        // Step 1 — refresh the expiring offline token. This is the only
        // reliable signal that the embedded app is properly wired to the
        // backend. If this fails the rest of the flow is dead.
        await tokenExchange(controller.signal);
        if (cancelled) return;

        const me = await fetchMe(controller.signal);
        if (cancelled) return;
        setShop(me);
        setPhase('ready');

        // Step 2 — fire insights in the background. Don't await; the
        // dashboard renders fine without it (stat strip falls back to
        // a connect-prompt). Failures are swallowed silently — Insights
        // tab will surface the error if it persists.
        getInsights(controller.signal)
          .then((d) => { if (!cancelled) setInsights(d); })
          .catch(() => { /* swallow — non-fatal */ });
      } catch (e: unknown) {
        if (cancelled) return;
        // Swallow native fetch AbortError — that's our own cleanup talking.
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
  }, []);

  const handleStartTrial = async () => {
    setPhase('subscribing');
    setError(null);
    try {
      const result = await setupSubscription();
      if (result.confirmation_url) {
        topLevelRedirect(result.confirmation_url);
        // Page will navigate; no further state needed.
      } else if (result.already) {
        // Subscription already exists; re-fetch shop state to update UI.
        const me = await fetchMe();
        setShop(me);
        setPhase('ready');
      } else {
        throw new Error('Billing setup returned no confirmation URL.');
      }
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('ready');
    }
  };

  // ── Render branches ──────────────────────────────────────────────────

  if (phase === 'init') {
    return (
      <Card>
        <BlockStack gap="200" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Connecting to your shop" />
          <Text as="p" variant="bodySm" tone="subdued">Connecting to your shop…</Text>
        </BlockStack>
      </Card>
    );
  }

  if (phase === 'error' || !shop) {
    return (
      <Banner tone="critical" title="Couldn't connect to your shop">
        <p>{error ?? 'Unknown error.'}</p>
      </Banner>
    );
  }

  const subStatus = shop.subscription_status;
  const needsSubscribe = !subStatus || subStatus === 'CANCELLED' || subStatus === 'DECLINED' || subStatus === 'EXPIRED';
  const onTrial = subStatus === 'ACTIVE' && shop.trial_ends_at && Date.parse(shop.trial_ends_at) > Date.now();

  // ── Next-best-action — drives the hero CTA ───────────────────────────
  //
  // Walks the merchant down a priority ladder. The first incomplete step
  // wins. Once everything's set up we just point them at /products to
  // compose the next post.
  const nextAction = computeNextAction({
    needsSubscribe,
    subStatus,
    insights,
  });

  // ── Setup checklist ──────────────────────────────────────────────────
  //
  // Only rendered when at least one item is incomplete. Each item is a
  // RouterLink so the user can jump straight to the page that fixes it.
  const checklist: ChecklistItem[] = [
    {
      id: 'subscription',
      label: 'Activate your subscription',
      description: 'Start the 7-day free trial — no charge today.',
      done: !needsSubscribe && subStatus === 'ACTIVE',
      href: null, // The banner above handles this — no separate route.
    },
    {
      id: 'facebook',
      label: 'Connect Facebook Page',
      description: 'Required to publish AI-generated posts to your audience.',
      done: insights?.connection.connected === true,
      href: '/settings',
    },
    {
      id: 'first-post',
      label: 'Generate your first post',
      description: 'Use Autopilot to fill a week of content in two clicks.',
      done: (insights?.posts.total ?? 0) > 0,
      href: '/autopilot',
    },
  ];
  const checklistIncomplete = checklist.some((c) => !c.done);
  const checklistDone = checklist.filter((c) => c.done).length;

  const shopDisplay = shop.shop_name?.trim() || shop.shop.split('.')[0];

  return (
    <BlockStack gap="500">
      {/* ── Billing banners (preserved from original) ───────────────── */}
      {needsSubscribe && (
        <Banner tone="info" title="Start your 7-day free trial">
          <BlockStack gap="300">
            <p>SocialAI Studio for Shopify is $29 USD / month after a 7-day free trial. No charge today.</p>
            <Button
              variant="primary"
              loading={phase === 'subscribing'}
              onClick={handleStartTrial}
            >
              Start free trial
            </Button>
            {error && (
              <Text as="p" variant="bodyMd" tone="critical">{error}</Text>
            )}
          </BlockStack>
        </Banner>
      )}

      {subStatus === 'PENDING' && (
        <Banner tone="warning" title="Waiting for billing approval">
          <BlockStack gap="300">
            <p>Shopify is waiting for you to approve the charge. If you closed that tab, click below to reopen it.</p>
            <Button onClick={handleStartTrial} loading={phase === 'subscribing'}>
              Reopen approval flow
            </Button>
          </BlockStack>
        </Banner>
      )}

      {subStatus === 'FROZEN' && (
        <Banner tone="critical" title="Payment failed">
          <p>Your most recent charge didn't go through. Update your payment method in Shopify Admin → Settings → Billing.</p>
        </Banner>
      )}

      {/* ── Hero — greeting + next-best-action ───────────────────────── */}
      <div className="home-hero">
        <Box padding="500">
          <InlineGrid columns={{ xs: 1, md: ['twoThirds', 'oneThird'] }} gap="400" alignItems="center">
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={WandIcon} tone="magic" />
                <Text as="span" variant="bodyMd" tone="subdued" fontWeight="medium">
                  SocialAI Studio
                </Text>
                {onTrial && shop.trial_ends_at && (
                  <Badge tone="info">
                    {`Trial ends ${new Date(shop.trial_ends_at).toLocaleDateString()}`}
                  </Badge>
                )}
                {!onTrial && subStatus === 'ACTIVE' && (
                  <Badge tone="success">Subscription active</Badge>
                )}
              </InlineStack>
              <Text as="h1" variant="heading2xl">
                {greetingFor(shopDisplay)}
              </Text>
              <Text as="p" variant="bodyLg" tone="subdued">
                {nextAction.subtitle}
              </Text>
            </BlockStack>

            <InlineStack align="end" blockAlign="center">
              <RRLink to={nextAction.href} style={{ textDecoration: 'none' }}>
                <Button variant="primary" size="large" icon={nextAction.icon}>
                  {nextAction.label}
                </Button>
              </RRLink>
            </InlineStack>
          </InlineGrid>
        </Box>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────────── */}
      <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
        <StatTile
          label="Followers"
          icon={PersonFilledIcon}
          tone="info"
          value={insights?.liveStats?.followersCount}
          hint={insights?.connection.connected ? insights.connection.pageName ?? 'Facebook' : 'Connect Facebook'}
          loading={!insights}
        />
        <StatTile
          label="Engagement"
          icon={ConfettiIcon}
          tone="success"
          value={insights?.liveStats?.engagementRate}
          suffix="%"
          hint="Industry avg 1–3%"
          loading={!insights}
        />
        <StatTile
          label="Scheduled"
          icon={CalendarIcon}
          tone="magic"
          value={insights?.posts.scheduled}
          hint={insights ? `${insights.posts.thisWeek} this week` : '—'}
          loading={!insights}
        />
        <StatTile
          label="Published"
          icon={SocialAdIcon}
          tone="info"
          value={insights?.posts.posted}
          hint={insights ? `${insights.posts.drafts} drafts` : '—'}
          loading={!insights}
        />
      </InlineGrid>

      {/* ── Quick actions — 3-up grid ────────────────────────────────── */}
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Quick actions</Text>
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <QuickActionCard
            href="/autopilot"
            icon={WandIcon}
            tinted
            title="Autopilot"
            description="Generate a week of posts in two clicks. Pick a vibe, hit go."
            cta="Launch Autopilot"
          />
          <QuickActionCard
            href="/products"
            icon={MagicIcon}
            title="Compose a post"
            description="Pick any product. AI writes the caption and generates the image."
            cta="Pick a product"
          />
          <QuickActionCard
            href="/calendar"
            icon={CalendarIcon}
            title="View calendar"
            description="See everything scheduled. Drag to reschedule. Publish on demand."
            cta="Open calendar"
          />
        </InlineGrid>
      </BlockStack>

      {/* ── Setup checklist (only when incomplete) ─────────────────── */}
      {checklistIncomplete && (
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Finish setting up</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {checklistDone} of {checklist.length} done — knock these out to get the most out of SocialAI.
                </Text>
              </BlockStack>
              <Box minWidth="120px">
                <ProgressBar
                  progress={Math.round((checklistDone / checklist.length) * 100)}
                  size="small"
                  tone="primary"
                />
              </Box>
            </InlineStack>
            <BlockStack gap="100">
              {checklist.map((item) => (
                <ChecklistRow key={item.id} item={item} />
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      )}

      {/* ── Shop details (collapsed footer) ────────────────────────── */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingSm">Shop details</Text>
            {shop.plan_name && <Badge>{`Shopify ${shop.plan_name}`}</Badge>}
          </InlineStack>
          <Divider />
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
            <InfoRow label="Shop domain" value={shop.shop} />
            {shop.shop_email && <InfoRow label="Email" value={shop.shop_email} />}
            {shop.country_code && <InfoRow label="Country" value={shop.country_code} />}
            {shop.currency && <InfoRow label="Currency" value={shop.currency} />}
            <InfoRow label="Installed" value={new Date(shop.installed_at).toLocaleDateString()} />
          </InlineGrid>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string | null;
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const inner = (
    <InlineStack gap="300" blockAlign="center" wrap={false} align="start">
      <Box>
        <Icon
          source={item.done ? CheckCircleIcon : AlertCircleIcon}
          tone={item.done ? 'success' : 'subdued'}
        />
      </Box>
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd" fontWeight={item.done ? 'regular' : 'semibold'}
          tone={item.done ? 'subdued' : 'base'}>
          {item.label}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {item.description}
        </Text>
      </BlockStack>
      {!item.done && item.href && (
        <Box>
          <Icon source={ArrowRightIcon} tone="subdued" />
        </Box>
      )}
    </InlineStack>
  );

  // Completed rows or items without an href just render as static rows;
  // incomplete actionable rows wrap in a Router link with hover state.
  if (item.done || !item.href) {
    return (
      <Box padding="200" borderRadius="200">
        {inner}
      </Box>
    );
  }
  return (
    <RRLink to={item.href} className="home-checklist-row">
      {inner}
    </RRLink>
  );
}

function StatTile({
  label, icon, tone, value, suffix, hint, loading,
}: {
  label: string;
  icon: IconSource;
  tone: 'info' | 'success' | 'warning' | 'critical' | 'magic' | 'base' | 'subdued';
  value: number | undefined;
  suffix?: string;
  hint?: string;
  loading?: boolean;
}) {
  const display = value == null
    ? '—'
    : `${value.toLocaleString()}${suffix ?? ''}`;
  return (
    <div className="home-stat-card">
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={icon} tone={tone} />
            <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
          </InlineStack>
          {loading ? (
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">Loading…</Text>
            </InlineStack>
          ) : (
            <Text as="p" variant="heading2xl">{display}</Text>
          )}
          {hint && (
            <Text as="span" variant="bodySm" tone="subdued">{hint}</Text>
          )}
        </BlockStack>
      </Card>
    </div>
  );
}

function QuickActionCard({
  href, icon, title, description, cta, tinted,
}: {
  href: string;
  icon: IconSource;
  title: string;
  description: string;
  cta: string;
  tinted?: boolean;
}) {
  return (
    <RRLink to={href} className="home-quick-action">
      <div className={tinted ? 'home-tint-magic' : undefined} style={{ height: '100%' }}>
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={icon} tone={tinted ? 'magic' : 'info'} />
              <Text as="h3" variant="headingMd">{title}</Text>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              {description}
            </Text>
            <InlineStack gap="100" blockAlign="center">
              <Text as="span" variant="bodyMd" fontWeight="semibold"
                tone={tinted ? 'magic' : 'base'}>
                {cta}
              </Text>
              <Icon source={ArrowRightIcon} tone={tinted ? 'magic' : 'subdued'} />
            </InlineStack>
          </BlockStack>
        </Card>
      </div>
    </RRLink>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack gap="200" align="space-between">
      <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="span" variant="bodySm">{value}</Text>
    </InlineStack>
  );
}

// ── Pure helpers ───────────────────────────────────────────────────────

interface NextAction {
  label: string;
  subtitle: string;
  href: string;
  icon: IconSource;
}

function computeNextAction({
  needsSubscribe, subStatus, insights,
}: {
  needsSubscribe: boolean;
  subStatus: string | null;
  insights: ShopifyInsightsResponse | null;
}): NextAction {
  // Ladder: first incomplete step wins.
  if (needsSubscribe || subStatus === 'PENDING' || subStatus === 'FROZEN') {
    // Trial banner handles its own CTA — we still want a graceful
    // hero state, so point at Autopilot which is the highest-value
    // page they'll land on once billing's done.
    return {
      label: 'Explore Autopilot',
      subtitle: "Once your subscription's active, Autopilot will fill a week of posts in two clicks.",
      href: '/autopilot',
      icon: WandIcon,
    };
  }
  if (insights && !insights.connection.connected) {
    return {
      label: 'Connect Facebook',
      subtitle: "Connect your Facebook Page so SocialAI can publish posts and pull live engagement stats.",
      href: '/settings',
      icon: LinkIcon,
    };
  }
  const totalPosts = insights?.posts.total ?? 0;
  if (totalPosts === 0) {
    return {
      label: 'Launch Autopilot',
      subtitle: 'No posts yet — Autopilot can generate a week of on-brand content in about a minute.',
      href: '/autopilot',
      icon: WandIcon,
    };
  }
  const scheduledOrThisWeek = (insights?.posts.scheduled ?? 0) + (insights?.posts.thisWeek ?? 0);
  if (scheduledOrThisWeek === 0) {
    return {
      label: 'Schedule next week',
      subtitle: 'Nothing in the queue. Autopilot will line up your next batch of posts in minutes.',
      href: '/autopilot',
      icon: CalendarIcon,
    };
  }
  return {
    label: 'Compose another',
    subtitle: 'Looking good. Pick a product to compose a one-off post, or check your calendar.',
    href: '/products',
    icon: MagicIcon,
  };
}

function greetingFor(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 18) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}
