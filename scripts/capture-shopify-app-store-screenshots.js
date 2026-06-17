async (page) => {
  const outDir = 'C:/Users/Steve/Desktop/app-store-screenshots/fresh-2026-06-18';
  const appUrl = 'https://app.socialaistudio.au';
  const context = 'shop=socialai-dev-store.myshopify.com&host=c29jaWFsYWktZGV2LXN0b3JlLm15c2hvcGlmeS5jb20vYWRtaW4';
  const now = new Date('2026-06-18T09:00:00+10:00');
  const isoInDays = (days, hour = 9) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const image = (id) => `https://picsum.photos/id/${id}/1000/700`;
  const products = [
    {
      id: 'gid://shopify/Product/1001',
      title: 'Laptop Screen Replacement',
      handle: 'laptop-screen-replacement',
      description: 'OEM-grade replacement panels with same-day turnaround when parts are in stock.',
      product_type: 'Repair service',
      vendor: 'SocialAI Dev Store',
      tags: 'repair,laptop,local service',
      price: '189.00',
      currency: 'USD',
      image_url: image(180),
      status: 'ACTIVE',
    },
    {
      id: 'gid://shopify/Product/1002',
      title: 'Website Build - Starter',
      handle: 'website-build-starter',
      description: 'A tidy starter website package for small local businesses.',
      product_type: 'Digital service',
      vendor: 'SocialAI Dev Store',
      tags: 'website,service,starter',
      price: '999.00',
      currency: 'USD',
      image_url: image(48),
      status: 'ACTIVE',
    },
    {
      id: 'gid://shopify/Product/1003',
      title: 'Business Care Plan',
      handle: 'business-care-plan',
      description: 'Monthly support for updates, monitoring, and small website improvements.',
      product_type: 'Subscription',
      vendor: 'SocialAI Dev Store',
      tags: 'support,monthly,care',
      price: '149.00',
      currency: 'USD',
      image_url: image(1062),
      status: 'ACTIVE',
    },
  ];
  const shop = {
    shop: 'socialai-dev-store.myshopify.com',
    shop_name: 'SocialAI Dev Store',
    shop_email: 'review@example.com',
    country_code: 'AU',
    currency: 'USD',
    plan_name: 'partner_test',
    scopes: 'read_products',
    installed_at: '2026-06-18T00:00:00.000Z',
    subscription_id: 'gid://shopify/AppSubscription/123',
    subscription_status: 'ACTIVE',
    trial_ends_at: '2026-06-25T00:00:00.000Z',
    current_period_end: '2026-07-18T00:00:00.000Z',
  };
  const posts = [
    {
      id: 'post-1',
      content: 'Cracked laptop screen? Book a same-day screen replacement and get a clear quote before we begin.',
      image_url: image(180),
      platform: 'facebook',
      status: 'Scheduled',
      scheduled_for: isoInDays(1, 9),
      created_at: '2026-06-18T00:00:00.000Z',
      post_type: 'image',
      video_status: null,
      image_critique_score: 8,
    },
    {
      id: 'post-2',
      content: 'Your product catalog can turn into Facebook-ready posts without leaving Shopify Admin.',
      image_url: image(48),
      platform: 'facebook',
      status: 'Draft',
      scheduled_for: null,
      created_at: '2026-06-18T00:00:00.000Z',
      post_type: 'image',
      video_status: null,
      image_critique_score: 9,
    },
    {
      id: 'post-3',
      content: 'A tidy monthly care plan keeps your website updated, monitored, and ready for customers.',
      image_url: image(1062),
      platform: 'facebook',
      status: 'Posted',
      scheduled_for: isoInDays(-1, 15),
      created_at: '2026-06-17T00:00:00.000Z',
      post_type: 'image',
      video_status: null,
      image_critique_score: 8,
    },
  ];
  let generated = 0;

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.shopify = window.shopify || {
          config: { apiKey: 'f191b1dcbd73ce52f9c4b0d27591545e', host: 'demo-host', shop: 'socialai-dev-store.myshopify.com', locale: 'en' },
          idToken: async () => 'demo-session-token',
          redirectTo: () => {}
        };
        if (!customElements.get('ui-nav-menu')) customElements.define('ui-nav-menu', class extends HTMLElement {});
        document.documentElement.appendChild(Object.assign(document.createElement('style'), { textContent: 'ui-nav-menu{display:none!important}' }));
      `,
    });
  });
  await page.addInitScript(() => {
    window.shopify = window.shopify || {
      config: { apiKey: 'f191b1dcbd73ce52f9c4b0d27591545e', host: 'demo-host', shop: 'socialai-dev-store.myshopify.com', locale: 'en' },
      idToken: async () => 'demo-session-token',
      redirectTo: () => {},
    };
    if (!customElements.get('ui-nav-menu')) customElements.define('ui-nav-menu', class extends HTMLElement {});
    document.documentElement.appendChild(Object.assign(document.createElement('style'), { textContent: 'ui-nav-menu{display:none!important}' }));
  });
  await page.route('**/api/shopify/**', async (route) => {
    const req = route.request();
    const rawUrl = req.url();
    const path = rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = req.method();
    const json = (body) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path === '/api/shopify/token-exchange') return json({
      shop: shop.shop,
      shop_name: shop.shop_name,
      plan_name: shop.plan_name,
      scope: shop.scopes,
    });
    if (path === '/api/shopify/me') return json(shop);
    if (path === '/api/shopify/setup-subscription') return json({
      already: true,
      subscription_id: shop.subscription_id,
      subscription_status: shop.subscription_status,
      is_test: true,
    });
    if (path === '/api/shopify/products') return method === 'POST'
      ? json({ synced: products.length, total_pages: 1 })
      : json({ products, last_synced_at: '2026-06-18T00:00:00.000Z' });
    if (path === '/api/shopify/compose') return json({
      caption: 'Need a product post for Facebook? SocialAI Studio turns your Shopify catalog into a polished caption and image you can review before scheduling.',
      image_url: image(180),
      model_used: 'review-demo',
      product: { id: products[0].id, title: products[0].title, price: products[0].price },
    });
    if (path === '/api/shopify/critique-image-caption') return json({
      score: 8,
      match: 'yes',
      reasoning: 'The visual and caption clearly match the selected product.',
      regenerate: false,
    });
    if (path === '/api/shopify/posts' && method === 'GET') return json({ posts });
    if (path === '/api/shopify/posts' && method === 'POST') return json({ id: 'post-new', status: 'Draft' });
    if (path.includes('/publish-now')) return json({ ok: true });
    if (path === '/api/shopify/insights') return json({
      connection: { connected: true, pageName: 'SocialAI Dev Store', instagramConnected: false },
      liveStats: {
        fanCount: 1240,
        followersCount: 1318,
        reach28d: 18420,
        engagedUsers28d: 942,
        interactions28d: 611,
        engagementRate: 5.1,
        source: 'insights',
      },
      posts: {
        total: 18,
        drafts: 3,
        scheduled: 7,
        posted: 8,
        missed: 0,
        thisWeek: 6,
        byPlatform: { facebook: 18, instagram: 0, both: 0 },
      },
      fetchedAt: '2026-06-18T00:00:00.000Z',
    });
    if (path === '/api/shopify/social/status') return json({
      connected: true,
      facebookPageName: 'SocialAI Dev Store',
      instagramConnected: false,
      connectedAt: '2026-06-18T00:00:00.000Z',
    });
    if (path === '/api/shopify/facts/status') return json({
      total: 18,
      by_type: { post: 12, engagement: 6 },
      last_verified_at: '2026-06-18T00:00:00.000Z',
      page_connected: true,
    });
    if (path === '/api/shopify/campaigns/active') return json({
      active: {
        id: 'campaign-1',
        name: 'Winter service push',
        goal: 'Book more local service jobs',
        theme: 'Helpful, timely, practical',
        startAt: '2026-06-01T00:00:00.000Z',
        endAt: '2026-06-30T00:00:00.000Z',
        createdAt: '2026-06-01T00:00:00.000Z',
        isActive: true,
      },
    });
    if (path === '/api/shopify/campaigns') return json({ items: [] });
    if (path === '/api/shopify/autopilot/generate-one') {
      generated += 1;
      const product = products[(generated - 1) % products.length];
      return json({
        id: `preview-${generated}`,
        status: 'Preview',
        caption: `${product.title}: a Facebook-ready product post drafted from your Shopify catalog, ready for review before it is scheduled.`,
        image_url: product.image_url,
        platform: 'facebook',
        scheduled_for: isoInDays(generated, 9 + (generated % 3) * 3),
        product: { id: product.id, title: product.title, price: product.price, currency: product.currency },
        campaign_used: true,
        post_type: 'image',
        video_status: null,
        motion_prompt: null,
      });
    }
    if (path === '/api/shopify/autopilot/save-batch') return json({ saved: ['post-1', 'post-2'], failed: [] });
    return json({ ok: true });
  });

  async function capture(path, file, waitForText) {
    const glue = path.includes('?') ? '&' : '?';
    await page.goto(`${appUrl}${path}${glue}${context}`, { waitUntil: 'networkidle' });
    if (waitForText) await page.getByText(waitForText, { exact: false }).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: false });
  }

  await capture('/', '01-home.png', 'Good morning');
  await capture('/products', '02-products.png', 'Laptop Screen Replacement');
  await capture(`/compose?product_id=${encodeURIComponent(products[0].id)}`, '03-compose.png', 'Need a product post');
  await capture('/calendar', '04-calendar.png', 'Scheduled');
  await capture('/insights', '05-insights.png', 'Facebook');
  await capture('/autopilot', '06-autopilot.png', 'Generate a week');
  await page.getByRole('button', { name: /Generate/i }).click();
  const reviewPanel = page.getByText('ready to preview', { exact: false });
  await reviewPanel.waitFor({ timeout: 15000 });
  await reviewPanel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outDir}/07-autopilot-review.png`, fullPage: false });
}
