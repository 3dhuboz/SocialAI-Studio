import { useEffect, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Spinner, Banner, Badge, Button, Divider,
} from '@shopify/polaris';
import {
  fetchMe, tokenExchange, setupSubscription, topLevelRedirect,
  ApiError, type ShopInfo,
} from '../api';

/**
 * Embedded-app home. The full lifecycle:
 *   1. mount → tokenExchange() refreshes the offline access token
 *   2. fetchMe() returns the shop record + subscription state
 *   3. if subscription_status is missing / cancelled, render the "Start trial"
 *      banner with a button that calls setupSubscription() and redirects
 *      the top-level browser frame to Shopify's billing-approval URL
 *   4. once back from approval, the same page re-mounts and lands on the
 *      ACTIVE branch — shop is fully connected.
 *
 * The 14-day free trial is configured in workers/api/src/lib/shopify-billing.ts.
 */

type Phase = 'init' | 'ready' | 'subscribing' | 'error';

export function Home() {
  const [phase, setPhase] = useState<Phase>('init');
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Two cancellation mechanisms:
    //   • AbortController.signal flows down into fetch() and aborts any
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

  if (phase === 'init') {
    return (
      <Card>
        <BlockStack gap="200" align="center">
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

  return (
    <BlockStack gap="400">
      {needsSubscribe && (
        <Banner tone="info" title="Start your 14-day free trial">
          <BlockStack gap="300">
            <p>SocialAI Studio for Shopify is $29 USD / month after a 14-day free trial. No charge today.</p>
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
            <p>Shopify is waiting for you to approve the charge. If you closed that tab, click "Start free trial" again to reopen it.</p>
            <Button onClick={handleStartTrial} loading={phase === 'subscribing'}>
              Reopen approval flow
            </Button>
          </BlockStack>
        </Banner>
      )}

      {subStatus === 'ACTIVE' && (
        <Banner tone="success" title={onTrial ? 'Free trial active' : 'Subscription active'}>
          <p>
            {onTrial
              ? `Your free trial runs until ${new Date(shop.trial_ends_at!).toLocaleDateString()}.`
              : 'You are subscribed to SocialAI Studio for Shopify.'}
          </p>
        </Banner>
      )}

      {subStatus === 'FROZEN' && (
        <Banner tone="critical" title="Payment failed">
          <p>Your most recent charge didn't go through. Update your payment method in Shopify Admin → Settings → Billing.</p>
        </Banner>
      )}

      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">
              {shop.shop_name || shop.shop}
            </Text>
            {shop.plan_name && <Badge tone="info">{`Shopify ${shop.plan_name}`}</Badge>}
          </InlineStack>

          <Divider />

          <BlockStack gap="200">
            <InfoRow label="Shop domain" value={shop.shop} />
            {shop.shop_email && <InfoRow label="Email" value={shop.shop_email} />}
            {shop.country_code && <InfoRow label="Country" value={shop.country_code} />}
            {shop.currency && <InfoRow label="Currency" value={shop.currency} />}
            <InfoRow label="Scopes" value={shop.scopes} />
            <InfoRow label="Installed" value={new Date(shop.installed_at).toLocaleString()} />
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="h3" variant="headingMd">What's next</Text>
          <Text as="p" variant="bodyMd">
            Coming soon — generate AI social posts featuring your products and
            schedule them to Facebook &amp; Instagram, all from inside this admin panel.
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack gap="400" align="space-between">
      <Text as="span" variant="bodyMd" tone="subdued">{label}</Text>
      <Text as="span" variant="bodyMd">{value}</Text>
    </InlineStack>
  );
}
