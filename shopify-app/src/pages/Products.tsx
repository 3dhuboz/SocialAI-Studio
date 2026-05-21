import { useCallback, useEffect, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Banner, Button, ResourceList,
  ResourceItem, Thumbnail, Badge, EmptyState, SkeletonBodyText, Icon,
} from '@shopify/polaris';
import {
  ProductIcon, RefreshIcon, MagicIcon,
} from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import {
  listProducts, syncProducts, ApiError, type Product,
} from '../api';

/**
 * Products browse page.
 *
 * Lifecycle:
 *   1. mount → listProducts() fetches the cached catalog from D1
 *   2. merchant clicks "Sync now" → syncProducts() pulls fresh data from
 *      the Shopify Admin GraphQL API, then we re-fetch the list to pick
 *      up new rows / refreshed images
 *   3. each row's "Compose post" action navigates to
 *      #/compose?product_id=<gid> via HashRouter
 *
 * Two independent loading flags:
 *   - `phase === 'loading'` covers the initial fetch and any subsequent
 *     re-fetch (skeleton rows)
 *   - `syncing` only covers the sync POST so the button spinner can run
 *     while the (still-rendered) old rows remain visible
 */

type Phase = 'loading' | 'ready' | 'error';

export default function Products() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [products, setProducts] = useState<Product[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Single fetch helper used both at mount and after a sync. Returns a
  // promise so callers can await before clearing their own loading flag.
  const loadProducts = useCallback(async (signal?: AbortSignal) => {
    setPhase('loading');
    setError(null);
    try {
      const res = await listProducts(signal);
      setProducts(res.products);
      setLastSyncedAt(res.last_synced_at);
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
    let cancelled = false;

    (async () => {
      try {
        const res = await listProducts(controller.signal);
        if (cancelled) return;
        setProducts(res.products);
        setLastSyncedAt(res.last_synced_at);
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
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncProducts();
      await loadProducts();
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
    } finally {
      setSyncing(false);
    }
  };

  const handleCompose = (productId: string) => {
    // HashRouter — encode the gid so the colons and slashes survive.
    navigate(`/compose?product_id=${encodeURIComponent(productId)}`);
  };

  // ── Render branches ────────────────────────────────────────────────

  if (phase === 'error' && products.length === 0) {
    return (
      <BlockStack gap="400">
        <Banner tone="critical" title="Couldn't load your products">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">{error ?? 'Unknown error.'}</Text>
            <Button onClick={() => loadProducts()}>Retry</Button>
          </BlockStack>
        </Banner>
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ProductIcon} tone="info" />
                <Text as="h2" variant="headingLg">Products</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {lastSyncedAt
                  ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
                  : 'Not synced yet'}
              </Text>
            </BlockStack>
            <Button
              variant="primary"
              icon={RefreshIcon}
              loading={syncing}
              onClick={handleSync}
            >
              Sync now
            </Button>
          </InlineStack>
          {error && phase === 'ready' && (
            <Banner tone="critical" title="Sync failed">
              <Text as="p" variant="bodyMd">{error}</Text>
            </Banner>
          )}
        </BlockStack>
      </Card>

      <Card>
        {phase === 'loading' ? (
          <BlockStack gap="400">
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={3} />
            <SkeletonBodyText lines={3} />
          </BlockStack>
        ) : products.length === 0 ? (
          <EmptyState
            heading="No products synced yet"
            action={{ content: 'Sync now', icon: RefreshIcon, onAction: handleSync, loading: syncing }}
            image=""
          >
            <Text as="p" variant="bodyMd">
              Click <strong>Sync now</strong> to pull your Shopify catalog into SocialAI Studio.
            </Text>
          </EmptyState>
        ) : (
          <ResourceList
            resourceName={{ singular: 'product', plural: 'products' }}
            items={products}
            renderItem={(p) => (
              <ProductRow product={p} onCompose={() => handleCompose(p.id)} />
            )}
          />
        )}
      </Card>
    </BlockStack>
  );
}

function ProductRow({ product, onCompose }: { product: Product; onCompose: () => void }) {
  // ResourceItem id MUST be a string. Use the gid directly — it's already
  // globally unique within Shopify's namespace.
  const media = (
    <Thumbnail
      source={product.image_url ?? ''}
      alt={product.title}
      size="medium"
    />
  );

  const priceLabel = product.price
    ? `${product.price}${product.currency ? ` ${product.currency}` : ''}`
    : '—';

  const status = (product.status ?? '').toLowerCase();
  // Map Shopify's product status → Polaris Badge tone. ACTIVE is the only
  // shippable state; DRAFT + ARCHIVED both render as subdued.
  const statusTone: 'success' | 'attention' | 'info' | undefined =
    status === 'active' ? 'success'
    : status === 'draft' ? 'attention'
    : status === 'archived' ? 'info'
    : undefined;

  return (
    <ResourceItem
      id={product.id}
      media={media}
      onClick={onCompose}
      accessibilityLabel={`Compose post for ${product.title}`}
    >
      <InlineStack align="space-between" blockAlign="center" gap="400">
        <BlockStack gap="100">
          <Text as="h3" variant="bodyMd" fontWeight="semibold">
            {product.title}
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">{priceLabel}</Text>
            {product.status && (
              <Badge tone={statusTone}>{product.status}</Badge>
            )}
            {product.product_type && (
              <Text as="span" variant="bodySm" tone="subdued">
                {product.product_type}
              </Text>
            )}
          </InlineStack>
        </BlockStack>
        {/* ResourceItem's onClick fires when the row is clicked anywhere
            inside it (including the button). Polaris doesn't pass the event
            into Button.onClick, so we can't stopPropagation here — but firing
            twice is harmless since navigate() is idempotent. */}
        <Button variant="primary" icon={MagicIcon} onClick={onCompose}>
          Compose post
        </Button>
      </InlineStack>
    </ResourceItem>
  );
}
