import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Spinner,
  Banner,
  Button,
  Box,
  Divider,
  Thumbnail,
  Badge,
  Bleed,
  Icon,
  TextField,
  Tag,
  InlineGrid,
} from '@shopify/polaris';
import {
  SocialPostIcon, LinkIcon, LockIcon, TextIcon, ImageIcon, ClockIcon,
  SocialAdIcon, CheckCircleIcon, AlertTriangleIcon,
} from '@shopify/polaris-icons';
import {
  getSocialStatus,
  disconnectSocial,
  exchangeFacebookToken,
  connectSocial,
  getDenylist,
  updateDenylist,
  getShopifyLearningSettings,
  getShopifyLearningReadiness,
  updateShopifyLearningSettings,
  ApiError,
  type SocialStatus,
  type FacebookPageOption,
  type ShopifyLearningReadiness,
  type ShopifyLearningSettingsResponse,
} from '../api';
import { OrganicReachCard } from '../components/OrganicReachCard';
import { initFB, loginFB } from '../fb-sdk';
import './settings.css';

/**
 * Settings — Facebook + Instagram connect for the current Shopify shop.
 *
 * Full flow (v2 of this page):
 *   1. GET /api/shopify/social/status — render Connected or Connect view
 *   2. Click "Connect Facebook" → initFB() lazy-loads the FB JS SDK
 *   3. FB.login() opens the popup (MUST be from a user gesture — onClick)
 *   4. Short-lived token → POST /api/shopify/social/facebook-exchange-token
 *   5. Page list → Polaris page picker
 *   6. Picked page → POST /api/shopify/social/connect → reload status
 *
 * Once connected, the merchant can disconnect (NULLs out social_tokens) or
 * switch pages (same Connect flow — the connect endpoint UPDATEs, so a
 * second connect just overwrites the previous tokens).
 *
 * Note on iframe popups: FB.login uses window.open. Modern browsers allow
 * this only when the user clicks a button directly (no async indirection
 * before FB.login). We structure the click handler so initFB happens, then
 * loginFB runs in the SAME tick — Chrome counts both as "user-activated."
 * If the SDK has been pre-loaded by a previous click attempt, the second
 * attempt is even cleaner.
 */

// Top-level phases for the page state machine. We don't try to compress them
// into one enum + sub-states; flat names make the if/else cascade readable.
type Phase = 'loading' | 'ready' | 'error';
type ConnectStep =
  | 'idle'          // showing the Connect button
  | 'logging_in'    // FB popup is open
  | 'exchanging'   // exchanging short-lived → long-lived + fetching pages
  | 'picking_page' // multiple pages — show picker
  | 'connecting'   // POSTing the chosen page to the worker
  | 'error';       // showed a connect error; reset on retry

export default function Settings() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Connect sub-state. Lives at the parent so ConnectCard re-renders are
  // tightly scoped without prop-drilling everything through.
  const [connectStep, setConnectStep] = useState<ConnectStep>('idle');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [longLivedToken, setLongLivedToken] = useState<string | null>(null);
  const [pages, setPages] = useState<FacebookPageOption[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const s = await getSocialStatus(signal);
      setStatus(s);
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

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectSocial();
      // Reset connect sub-state too — otherwise the picker would stick around
      // after disconnect → reconnect.
      setConnectStep('idle');
      setPages([]);
      setLongLivedToken(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setDisconnecting(false);
    }
  };

  // ── The connect flow ──────────────────────────────────────────────────
  // Must be invoked from a user gesture (button onClick) so the FB.login
  // popup isn't blocked. We initFB() inside the handler; the SDK caches its
  // own init Promise so subsequent attempts are instant.
  const handleConnect = async () => {
    setConnectStep('logging_in');
    setConnectError(null);
    try {
      await initFB();
      const auth = await loginFB();
      const shortLivedToken = auth.accessToken;

      setConnectStep('exchanging');
      const result = await exchangeFacebookToken(shortLivedToken);
      setLongLivedToken(result.longLivedUserToken);

      if (!result.pages || result.pages.length === 0) {
        // Use a sentinel string so the ConnectCard can render a richer
        // "Create a Page" CTA. Plain text would render as a generic
        // critical Banner — fine, but the largest conversion cliff in the
        // onboarding flow is solo merchants who only have a Personal FB
        // profile and don't realise Pages are a separate thing.
        setConnectError('__NO_FB_PAGES__');
        setConnectStep('error');
        return;
      }

      // Single page — skip the picker, just connect.
      if (result.pages.length === 1) {
        const page = result.pages[0];
        await connectChosenPage(page, result.longLivedUserToken);
        return;
      }

      setPages(result.pages);
      setConnectStep('picking_page');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      setConnectError(msg);
      setConnectStep('error');
    }
  };

  const connectChosenPage = async (page: FacebookPageOption, llt: string | null) => {
    setConnectStep('connecting');
    try {
      await connectSocial({
        facebookUserToken: llt ?? undefined,
        facebookPageId: page.id,
        facebookPageAccessToken: page.access_token,
        facebookPageName: page.name,
        instagramBusinessAccountId: page.instagramBusinessAccountId ?? null,
      });
      // Reset picker state, refresh status. The Connected card will render
      // on the next tick.
      setPages([]);
      setLongLivedToken(null);
      setConnectStep('idle');
      await load();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : String(e));
      setConnectError(msg);
      setConnectStep('error');
    }
  };

  const handleResetConnect = () => {
    setConnectStep('idle');
    setConnectError(null);
    setPages([]);
    setLongLivedToken(null);
  };

  if (phase === 'loading') {
    return (
      <Card>
        <BlockStack gap="200" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Loading settings" />
          <Text as="p" variant="bodySm" tone="subdued">Loading settings…</Text>
        </BlockStack>
      </Card>
    );
  }

  if (phase === 'error' || !status) {
    return (
      <Banner tone="critical" title="Couldn't load settings">
        <BlockStack gap="200">
          <p>{error ?? 'Unknown error.'}</p>
          <Button onClick={() => { setPhase('loading'); load(); }}>Try again</Button>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <BlockStack gap="500">
      {error && (
        <Banner tone="warning" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}

      {/* ── Hero — connection status at a glance ───────────────────── */}
      <SettingsHero status={status} />

      {status.connected ? (
        <ConnectedCard
          status={status}
          disconnecting={disconnecting}
          onDisconnect={handleDisconnect}
          onSwitchPage={handleConnect}
          switching={connectStep === 'logging_in' || connectStep === 'exchanging'}
        />
      ) : connectStep === 'picking_page' ? (
        <PickPageCard
          pages={pages}
          connecting={connectStep !== 'picking_page'}
          onPick={(p) => connectChosenPage(p, longLivedToken)}
          onCancel={handleResetConnect}
        />
      ) : (
        <ConnectCard
          step={connectStep}
          error={connectError}
          onConnect={handleConnect}
          onResetError={handleResetConnect}
        />
      )}

      <BrandSafetyCard />

      <OrganicReachCard />

      <ProtectedAutopilotSettingsCard />

      <WhatWePublishCard />
    </BlockStack>
  );
}

// ── Hero — connection status badge ───────────────────────────────────────

function SettingsHero({ status }: { status: SocialStatus }) {
  const connected = status.connected;
  return (
    <div className={connected ? 'settings-hero-success' : 'settings-hero'}>
      <Box padding="500">
        <InlineStack gap="400" blockAlign="center" wrap={false}>
          <Box>
            <Icon
              source={connected ? CheckCircleIcon : SocialPostIcon}
              tone={connected ? 'success' : 'info'}
            />
          </Box>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingXl">
                {connected ? 'Facebook connected' : 'Connect Facebook Page'}
              </Text>
              {connected && (
                <Badge tone="success">Live</Badge>
              )}
              {!connected && (
                <Badge tone="attention">Setup required</Badge>
              )}
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              {connected
                ? `Publishing through ${status.facebookPageName ?? 'your Page'}.`
                : 'Link a Facebook Page so SocialAI can publish posts and pull engagement stats.'}
            </Text>
          </BlockStack>
        </InlineStack>
      </Box>
    </div>
  );
}

// ── Disconnected state ───────────────────────────────────────────────────

interface ConnectCardProps {
  step: ConnectStep;
  error: string | null;
  onConnect: () => void;
  onResetError: () => void;
}

function ConnectCard({ step, error, onConnect, onResetError }: ConnectCardProps) {
  const loading = step === 'logging_in' || step === 'exchanging' || step === 'connecting';
  const buttonLabel =
    step === 'logging_in'  ? 'Opening Facebook…'
    : step === 'exchanging' ? 'Fetching your Pages…'
    : step === 'connecting' ? 'Connecting…'
    : 'Connect Facebook Page';

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={LinkIcon} tone="info" />
            <Text as="h2" variant="headingLg">Link your Page</Text>
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            Connect your Facebook Page so SocialAI can publish scheduled posts directly from this app.
            If that Page already has an Instagram Business account linked, we'll detect it during setup.
          </Text>
        </BlockStack>

        {step === 'error' && error === '__NO_FB_PAGES__' && (
          // The single biggest abandonment cliff in onboarding: solo merchants
          // who logged in successfully but have only a Personal FB profile.
          // Facebook only lets apps publish on Pages, so we surface a clear
          // recovery path: create a Page (most merchants finish that in
          // 2 minutes), then retry. This replaces the previous dead-end
          // "No Facebook Pages found on your account" critical Banner.
          <Banner tone="warning" title="You need a Facebook Page (not a personal profile)" onDismiss={onResetError}>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Your Facebook account doesn't have any Business Pages yet.
                Facebook only lets apps publish on Pages — your personal
                profile isn't enough.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Most Shopify merchants create one in under 2 minutes. Once
                it's set up, click <strong>Retry</strong> below — Facebook
                will remember your login so you won't have to re-enter
                credentials.
              </Text>
              <InlineStack gap="200" wrap>
                <Button
                  variant="primary"
                  url="https://www.facebook.com/pages/create"
                  external
                >
                  Create a Facebook Page
                </Button>
                <Button onClick={onResetError}>Retry connection</Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
        {step === 'error' && error && error !== '__NO_FB_PAGES__' && (
          <Banner tone="critical" title="Connection failed" onDismiss={onResetError}>
            <BlockStack gap="200">
              <p>{error}</p>
              <InlineStack gap="200">
                <Button onClick={onResetError}>Try again</Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}

        <InlineStack gap="200" blockAlign="center" wrap>
          <Button
            variant="primary"
            tone="success"
            size="large"
            icon={LinkIcon}
            loading={loading}
            disabled={loading}
            onClick={onConnect}
            accessibilityLabel="Connect Facebook"
          >
            {buttonLabel}
          </Button>
          <InlineStack gap="100" blockAlign="center">
            <Icon source={LockIcon} tone="subdued" />
            <Text as="span" variant="bodySm" tone="subdued">
              We never store passwords — only a scoped access token from Facebook.
            </Text>
          </InlineStack>
        </InlineStack>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              <b>You'll need to be an Admin of a Facebook Page.</b> Personal profiles aren't enough — Facebook only lets apps publish on Pages.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Once you click Connect, a real Facebook popup will open. Tick all the requested permissions and choose the Page you want to publish from. You can switch Pages or disconnect anytime.
            </Text>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}

// ── Page picker (multiple pages found) ──────────────────────────────────

interface PickPageCardProps {
  pages: FacebookPageOption[];
  connecting: boolean;
  onPick: (page: FacebookPageOption) => void;
  onCancel: () => void;
}

function PickPageCard({ pages, connecting, onPick, onCancel }: PickPageCardProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">Choose a Facebook Page</Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            You admin {pages.length} Pages. Pick the one this shop should publish to.
            You can switch later.
          </Text>
        </BlockStack>

        <Bleed marginInline="400">
          <BlockStack gap="0">
            {pages.map((page, idx) => (
              <PageRow
                key={page.id}
                page={page}
                disabled={connecting}
                onClick={() => onPick(page)}
                isLast={idx === pages.length - 1}
              />
            ))}
          </BlockStack>
        </Bleed>

        <Box>
          <Button onClick={onCancel} disabled={connecting}>Cancel</Button>
        </Box>
      </BlockStack>
    </Card>
  );
}

function PageRow({
  page, disabled, onClick, isLast,
}: { page: FacebookPageOption; disabled: boolean; onClick: () => void; isLast: boolean }) {
  return (
    <div className="settings-page-row">
      <Box
        paddingBlock="300"
        paddingInline="400"
        borderBlockEndWidth={isLast ? '0' : '025'}
        borderColor="border"
      >
        <InlineStack align="space-between" blockAlign="center" wrap={false} gap="400">
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {page.picture?.data?.url ? (
              <Thumbnail source={page.picture.data.url} alt={page.name} size="small" />
            ) : (
              <Thumbnail source="" alt={page.name} size="small" />
            )}
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="semibold">{page.name}</Text>
              <InlineStack gap="200">
                {page.category && (
                  <Text as="span" variant="bodySm" tone="subdued">{page.category}</Text>
                )}
                {page.instagramBusinessAccountId && (
                  <Badge tone="info">Instagram linked</Badge>
                )}
              </InlineStack>
            </BlockStack>
          </InlineStack>
          <Button onClick={onClick} disabled={disabled} accessibilityLabel={`Connect to ${page.name}`}>
            Connect
          </Button>
        </InlineStack>
      </Box>
    </div>
  );
}

// ── Connected state ──────────────────────────────────────────────────────

interface ConnectedCardProps {
  status: SocialStatus;
  disconnecting: boolean;
  onDisconnect: () => void;
  onSwitchPage: () => void;
  switching: boolean;
}

function ConnectedCard({ status, disconnecting, onDisconnect, onSwitchPage, switching }: ConnectedCardProps) {
  const pageLabel = status.facebookPageName ?? 'your Facebook Page';
  return (
    <Card>
      <BlockStack gap="400">
        <Banner tone="success" title={`Connected to ${pageLabel}`}>
          <BlockStack gap="100">
            <p>
              {status.instagramConnected
                ? 'Instagram is linked through this Page and has been detected, but Shopify scheduled publishing in this release still sends posts to Facebook only.'
                : 'Instagram is not linked to this Page yet. Facebook Page delivery works fine without it.'}
            </p>
            {status.connectedAt && (
              <Text as="span" variant="bodySm" tone="subdued">
                Connected on {new Date(status.connectedAt).toLocaleString()}
              </Text>
            )}
          </BlockStack>
        </Banner>

        <Divider />

        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">Switch Page</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Connect a different Facebook Page. If you later link an
              Instagram Business account on facebook.com, switching here will refresh the stored page details.
            </Text>
          </BlockStack>
          <Button onClick={onSwitchPage} loading={switching} disabled={switching || disconnecting}>
            Switch Page
          </Button>
        </InlineStack>

        <Divider />

        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">Disconnect</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Revoke this app's access to your Page. Scheduled posts will stop
              publishing until you reconnect.
            </Text>
          </BlockStack>
          <Button
            tone="critical"
            onClick={onDisconnect}
            loading={disconnecting}
            disabled={disconnecting || switching}
          >
            Disconnect
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

// ── What we'll publish ──────────────────────────────────────────────────

function formatLearningMoney(cents: number | null): string {
  return cents == null ? 'Unavailable' : `$${(cents / 100).toFixed(2)} USD`;
}

function learningBudgetCents(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function ProtectedAutopilotSettingsCard() {
  const [settings, setSettings] = useState<ShopifyLearningSettingsResponse | null>(null);
  const [readiness, setReadiness] = useState<ShopifyLearningReadiness | null>(null);
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLearning = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const [nextSettings, nextReadiness] = await Promise.all([
        getShopifyLearningSettings(signal),
        getShopifyLearningReadiness(signal),
      ]);
      setSettings(nextSettings);
      setReadiness(nextReadiness);
      setBudget(nextSettings.settings.monthlyAiBudgetUsdCents == null
        ? ''
        : (nextSettings.settings.monthlyAiBudgetUsdCents / 100).toFixed(2));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setLoadError(reason instanceof ApiError ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLearning(controller.signal);
    return () => controller.abort();
  }, [loadLearning]);

  const saveMode = async (mode: 'approval' | 'protected_autopilot') => {
    const cents = learningBudgetCents(budget);
    if (mode === 'protected_autopilot' && cents == null) {
      setLoadError('Enter a positive monthly AI ceiling with no more than two decimal places.');
      return;
    }
    setSaving(true);
    setLoadError(null);
    try {
      await updateShopifyLearningSettings({
        mode,
        consent: mode === 'protected_autopilot' ? true : undefined,
        monthlyAiBudgetUsdCents: mode === 'protected_autopilot' ? cents : undefined,
      });
      await loadLearning();
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" accessibilityLabel="Checking Protected Autopilot gates" />
          <Text as="span" variant="bodyMd" tone="subdued">Checking permanent safety gates...</Text>
        </InlineStack>
      </Card>
    );
  }

  if (!settings || !readiness) {
    return (
      <Banner tone="warning" title="Protected Autopilot status unavailable">
        <BlockStack gap="200">
          <p>{loadError ?? 'No readiness response was returned.'}</p>
          <Button onClick={() => { setLoading(true); void loadLearning(); }}>Try again</Button>
        </BlockStack>
      </Banner>
    );
  }

  const requested = settings.settings.mode === 'protected_autopilot'
    && settings.settings.autopublishConsentAt != null
    && settings.settings.autopublishPolicyVersion === readiness.policyVersion;
  const active = requested
    && settings.effectiveMode === 'protected_autopilot'
    && readiness.effectiveMode === 'protected_autopilot'
    && readiness.ready
    && !readiness.stale
    && readiness.globalSwitches.learningBrain
    && readiness.globalSwitches.releaseEnforcement
    && readiness.globalSwitches.protectedAutopilot;
  const blockers = [
    !readiness.globalSwitches.learningBrain ? 'Learning Brain is globally disabled.' : null,
    !readiness.globalSwitches.releaseEnforcement ? 'Release enforcement is not enabled.' : null,
    !readiness.globalSwitches.protectedAutopilot ? 'Protected Autopilot is globally disabled.' : null,
    readiness.stale ? 'Readiness evidence is stale.' : null,
    !readiness.ready ? 'The release-readiness policy has not passed.' : null,
    readiness.cost.monthlyAiSpendUsdCents == null ? 'Spend telemetry is unavailable, so activation fails closed.' : null,
    readiness.cost.monthlyAiSpendUsdCents != null && !readiness.cost.withinBudget
      ? 'AI spend is not proven below the monthly ceiling.'
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  const tenancy = readiness.checks.tenancyProofs;
  const tenancyPassed = typeof tenancy === 'object'
    && tenancy.user === true && tenancy.client === true && tenancy.shop === true;
  const gates = [
    ['Pilot decisions', readiness.checks.pilot === true],
    ['Adjudicated decisions', readiness.checks.adjudications === true],
    ['No severe false passes', readiness.checks.severeFalsePasses === true],
    ['False-hold rate', readiness.checks.falseHolds === true],
    ['Critic availability', readiness.checks.availability === true],
    ['Decision receipt coverage', readiness.checks.receipts === true],
    ['Prediction lift', readiness.checks.predictionLift === true],
    ['Rank correlation', readiness.checks.rankCorrelation === true],
    ['No critical bypasses', readiness.checks.criticalBypasses === true],
    ['No publishing regressions', readiness.checks.publishingRegressions === true],
    ['Cost ceiling', readiness.checks.cost === true],
    ['Kill-switch proof', readiness.checks.killSwitch === true],
    ['Replay and red-team proof', readiness.checks.replayRedTeam === true],
    ['Publish regression proof', readiness.checks.publishRegression === true],
    ['Tenant isolation proofs', tenancyPassed],
  ] as const;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={LockIcon} tone={active ? 'success' : 'caution'} />
              <Text as="h3" variant="headingMd">
                {active ? 'Protected Autopilot active' : requested ? 'Protected Autopilot pending' : 'Approval mode'}
              </Text>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">
              {active
                ? 'Safe posts can publish unattended. Uncertain posts are held automatically.'
                : 'Protected publishing stays off until every independent release gate passes.'}
            </Text>
          </BlockStack>
          <Badge tone={active ? 'success' : requested ? 'attention' : 'info'}>
            {active ? 'Green' : requested ? 'Pending' : 'Protected off'}
          </Badge>
        </InlineStack>

        {blockers.length > 0 && !active && (
          <Banner tone="warning" title="Why it cannot activate yet">
            <BlockStack gap="100">
              {blockers.map((reason) => <Text key={reason} as="p" variant="bodySm">{reason}</Text>)}
            </BlockStack>
          </Banner>
        )}
        {loadError && <Banner tone="critical"><p>{loadError}</p></Banner>}

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Current month AI spend</Text>
              <Text as="p" variant="headingLg">{formatLearningMoney(readiness.cost.monthlyAiSpendUsdCents)}</Text>
              <Text as="p" variant="bodyXs" tone="subdued">
                {readiness.cost.telemetryCount} metered event{readiness.cost.telemetryCount === 1 ? '' : 's'}
              </Text>
            </BlockStack>
          </Box>
          <TextField
            label="Monthly AI ceiling (USD)"
            prefix="$"
            value={budget}
            onChange={setBudget}
            inputMode="decimal"
            autoComplete="off"
            disabled={saving || active}
            helpText="Protected mode cannot activate without a positive metered-spend ceiling."
          />
        </InlineGrid>

        <Divider />

        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h4" variant="headingSm">Permanent release gates</Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {gates.filter(([, passed]) => passed).length} of {gates.length} passed
            </Text>
          </InlineStack>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="200">
            {gates.map(([label, passed]) => (
              <Box key={label} background="bg-surface-secondary" padding="200" borderRadius="200">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <Icon source={passed ? CheckCircleIcon : AlertTriangleIcon} tone={passed ? 'success' : 'caution'} />
                  <Text as="span" variant="bodySm">{label}</Text>
                </InlineStack>
              </Box>
            ))}
          </InlineGrid>
        </BlockStack>

        <Divider />

        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="p" variant="bodySm" tone="subdued">
            A request will not activate until every gate passes. This is one workspace-level consent, not per-post approval.
          </Text>
          {requested ? (
            <Button loading={saving} disabled={saving} onClick={() => { void saveMode('approval'); }}>
              Switch to Approval mode
            </Button>
          ) : (
            <Button
              variant="primary"
              tone="success"
              loading={saving}
              disabled={saving || learningBudgetCents(budget) == null}
              onClick={() => { void saveMode('protected_autopilot'); }}
            >
              Consent and request Protected Autopilot
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function WhatWePublishCard() {
  const items = [
    {
      icon: TextIcon,
      title: 'Caption',
      desc: 'The text you wrote or generated.',
    },
    {
      icon: ImageIcon,
      title: 'Image',
      desc: 'The product photo or AI-generated graphic attached to the post.',
    },
    {
      icon: ClockIcon,
      title: 'Scheduled time',
      desc: 'The exact moment you picked — no surprises.',
    },
    {
      icon: SocialAdIcon,
      title: 'Target platforms',
      desc: 'Facebook Page delivery for Shopify scheduled posts in this release.',
    },
  ];
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">What we'll publish</Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            Every post is composed by you (or AI-assisted) and reviewed before
            it goes anywhere. SocialAI Studio only publishes the fields you
            saw at compose time:
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          {items.map((it) => (
            <div key={it.title} className="settings-publish-row">
              <InlineStack gap="300" blockAlign="center" wrap={false} align="start">
                <Box>
                  {/* tone="base" gives ~#5c5f62 — strong enough to read against
                      the white card. tone="subdued" was rendering as near-white. */}
                  <Icon source={it.icon} tone="base" />
                </Box>
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">{it.title}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{it.desc}</Text>
                </BlockStack>
              </InlineStack>
            </div>
          ))}
        </BlockStack>
        {/* Privacy callout — tinted background so it visually anchors as a
            "your safety net" footer, not a 5th list item disguised as white.
            settings-privacy-callout is defined in settings.css and gives us
            a subtle green tint that matches the success-toned lock icon. */}
        <div className="settings-privacy-callout">
          <InlineStack gap="200" blockAlign="center" align="start" wrap={false}>
            <Box>
              <Icon source={LockIcon} tone="success" />
            </Box>
            <Text as="p" variant="bodySm">
              We never publish without your explicit save. You can edit or delete
              any Draft or Scheduled post from the Calendar.
            </Text>
          </InlineStack>
        </div>
      </BlockStack>
    </Card>
  );
}

// ── Brand safety / forbidden-subjects denylist ──────────────────────────
//
// Backed by GET/PUT /api/shopify/profile/denylist → shopify_stores.profile.
// The worker's content-safety pipeline (lib/profile-guards.ts) scans
// captions, image prompts, and poster prompts against this list at compose,
// critique, poster, and pre-publish time. Without populated entries the
// pipeline runs unconstrained — so this card is the merchant's only path
// to declare what should NEVER appear in AI-generated content for their
// brand.
//
// UX:
//   - Textarea holds the raw input (comma- OR newline-separated).
//   - Submit splits/trims/lowercases/dedupes, sends to the worker, and
//     receives the canonical list back. Chips below the input show that
//     canonical form so the merchant sees exactly what the pipeline will
//     scan against.
//   - "Saved" state is sticky-but-resettable: visible toast for 4s, then
//     reverts to a neutral state. Errors surface inline in a Banner.

function normaliseDenylistInput(raw: string): string[] {
  // Mirror the worker-side parseForbiddenSubjects tokeniser exactly.
  // Diverging here would surprise merchants ("why did 'Alcohol' become
  // 'alcohol' on save?" is a less-fun question than "why isn't my list
  // applying?", but both are avoidable).
  const out = new Set<string>();
  for (const piece of raw.split(/[,\n]+/)) {
    const trimmed = piece.trim().toLowerCase();
    if (trimmed) out.add(trimmed);
  }
  return [...out];
}

function BrandSafetyCard() {
  // load* = initial GET, save* = PUT round-trip. Separate flags so a slow
  // save doesn't visually re-blank the chips while the merchant is reading.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [chips, setChips] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Initial fetch. We deliberately swallow ApiError(401) into a generic
  // error message — a 401 here means the session expired between the page
  // mount and the card render, which is recoverable via the host App
  // Bridge token refresh; the merchant doesn't need the raw status code.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await getDenylist(ctrl.signal);
        setChips(res.forbiddenSubjects);
        // Render existing entries as a comma-separated string. Newlines
        // would be technically valid but the comma form survives copy/paste
        // through more contexts (Slack threads, email replies, etc).
        setRaw(res.forbiddenSubjects.join(', '));
        setLoaded(true);
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return;
        const msg = err instanceof ApiError ? err.message : 'Could not load denylist.';
        setLoadError(msg);
        setLoaded(true);
      }
    })();
    return () => ctrl.abort();
  }, []);

  // Auto-dismiss the "Saved" badge after a few seconds so it doesn't stick
  // around as visual noise — but only while the user hasn't started a new
  // edit, which clears savedAt anyway.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Preview chips reflect what the textarea would tokenise to right now.
  // Recomputed every render — cheap because the cap is 100 items and the
  // regex split is O(n).
  const previewChips = normaliseDenylistInput(raw);

  // "Dirty" = preview differs from the most recently-saved canonical list.
  // We compare on the previewChips → chips set rather than raw text so
  // whitespace-only edits don't enable the Save button.
  const isDirty = (() => {
    if (previewChips.length !== chips.length) return true;
    const set = new Set(chips);
    for (const v of previewChips) if (!set.has(v)) return true;
    return false;
  })();

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const res = await updateDenylist(previewChips);
      setChips(res.forbiddenSubjects);
      // Rewrite the raw input to the canonical form — visually confirms
      // the normalisation and prevents the chip list from drifting if the
      // user keeps editing.
      setRaw(res.forbiddenSubjects.join(', '));
      setSavedAt(Date.now());
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not save denylist.';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [previewChips]);

  if (!loaded) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Brand safety</Text>
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" />
            <Text as="span" variant="bodyMd" tone="subdued">Loading your denylist…</Text>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Icon source={AlertTriangleIcon} tone="caution" />
            <Text as="h3" variant="headingMd">Brand safety</Text>
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            Words or phrases that should NEVER appear in your AI-generated
            captions, images, or posters. Scanned at compose, critique, and
            pre-publish — anything that matches is blocked before it goes
            live.
          </Text>
        </BlockStack>

        {loadError && (
          <Banner tone="warning">
            <p>{loadError}</p>
          </Banner>
        )}
        {saveError && (
          <Banner tone="critical" onDismiss={() => setSaveError(null)}>
            <p>{saveError}</p>
          </Banner>
        )}

        <TextField
          label="Denylist"
          labelHidden
          value={raw}
          onChange={(v) => {
            setRaw(v);
            // Clear stale "Saved" badge as soon as the user starts editing —
            // otherwise the green dot would lie about the state.
            if (savedAt) setSavedAt(null);
          }}
          multiline={3}
          autoComplete="off"
          placeholder="e.g. alcohol, weapons, competitor brand names"
          helpText="Separate entries with commas or new lines. Matching is case-insensitive and includes partial-word matches."
        />

        {previewChips.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              The pipeline will scan against {previewChips.length} {previewChips.length === 1 ? 'entry' : 'entries'}:
            </Text>
            <InlineStack gap="100" wrap>
              {previewChips.map((c) => (
                <Tag key={c}>{c}</Tag>
              ))}
            </InlineStack>
          </BlockStack>
        )}

        <InlineStack gap="200" blockAlign="center">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!isDirty || saving}
          >
            Save denylist
          </Button>
          {savedAt && (
            <InlineStack gap="100" blockAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="span" variant="bodyMd" tone="success">Saved</Text>
            </InlineStack>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
