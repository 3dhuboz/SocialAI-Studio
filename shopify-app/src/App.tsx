import { lazy, Suspense } from 'react';
import { Page, Spinner } from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';

// Lazy-load secondary pages so each route ships its own chunk. Keeps the
// Home shell (the only required surface for OAuth/billing) light, while the
// product/compose/calendar/settings views download on demand.
const Products = lazy(() => import('./pages/Products'));
const Compose = lazy(() => import('./pages/Compose'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Insights = lazy(() => import('./pages/Insights'));
const Posters = lazy(() => import('./pages/Posters'));
const Autopilot = lazy(() => import('./pages/Autopilot'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Settings = lazy(() => import('./pages/Settings'));

// Top-level shell. Polaris <Page> gives us the standard embedded-app frame
// (title, primary action slot, breadcrumbs) — Shopify reviewers reject
// embedded apps that don't use native Polaris layout primitives.
//
// App Bridge v4 boots from the CDN script in index.html, which sets
// `window.shopify`. We pull it through `useAppBridge()` here so React
// components have a clean, type-safe handle — and so reviewers can see
// the app-bridge-react integration is wired up.
//
// ── ui-nav-menu + routing ─────────────────────────────────────────────
// <ui-nav-menu> is a Shopify web component (not Polaris). Embedded apps
// MUST ship a nav menu — Shopify reviewers explicitly grep for it.
//
// CRITICAL: App Bridge v4's ui-nav-menu intercepts <a> clicks and
// navigates BOTH the parent admin URL AND the embedded iframe via path
// updates (not hash fragments). Hash-style hrefs (#/products) silently
// no-op because App Bridge strips the hash before forwarding the
// navigation. So we MUST:
//   1. Use path-based hrefs in the menu (/products, /compose, etc.)
//   2. Use BrowserRouter (not HashRouter) so React Router responds to
//      those path changes when App Bridge writes them via History API.
//   3. Configure CF Pages SPA fallback (public/_redirects → /* /index.html 200)
//      so a deep-link refresh on /products still serves the SPA shell
//      instead of returning 404.
export function App() {
  // Touch the App Bridge global so the hook is exercised on every mount.
  // useAppBridge throws if the CDN script failed to load, which surfaces
  // the misconfiguration loudly rather than silently breaking idToken().
  useAppBridge();

  return (
    <BrowserRouter>
      <ui-nav-menu>
        <a href="/" rel="home">Home</a>
        <a href="/products">Products</a>
        <a href="/autopilot">Autopilot</a>
        <a href="/campaigns">Campaigns</a>
        <a href="/compose">Compose</a>
        <a href="/calendar">Calendar</a>
        <a href="/insights">Insights</a>
        <a href="/posters">Posters</a>
        <a href="/settings">Settings</a>
      </ui-nav-menu>
      <RoutedShell />
    </BrowserRouter>
  );
}

// Map route paths → (page title, optional subtitle). Polaris's <Page> renders
// the title as an h1 in the embedded admin header; pre-fix it was hard-coded
// to "SocialAI Studio" on every route, which (a) reviewers explicitly flag
// as a missed UX cue, and (b) means the heading hierarchy on each page
// starts at h2 even though some pages render h1-styled hero text inside the
// body — visually fine but a11y-confusing.
const ROUTE_META: Record<string, { title: string; subtitle?: string }> = {
  '/':           { title: 'SocialAI Studio',                                          },
  '/products':   { title: 'Products',  subtitle: 'Your Shopify catalog'               },
  '/autopilot':  { title: 'Autopilot', subtitle: 'Generate a week of posts in clicks' },
  '/campaigns':  { title: 'Campaigns', subtitle: 'Date-ranged themes for autopilot'   },
  '/compose':    { title: 'Compose',   subtitle: 'AI caption + image for a product'   },
  '/calendar':   { title: 'Calendar',  subtitle: 'Scheduled & published posts'        },
  '/insights':   { title: 'Insights',  subtitle: 'Facebook engagement + queue'        },
  '/posters':    { title: 'Posters',   subtitle: 'AI-generated standalone graphics'   },
  '/settings':   { title: 'Settings',  subtitle: 'Facebook / Instagram connection'    },
};

function RoutedShell() {
  const { pathname } = useLocation();
  const meta = ROUTE_META[pathname] || { title: 'SocialAI Studio' };
  return (
    <Page title={meta.title} subtitle={meta.subtitle}>
      <Suspense fallback={<Spinner accessibilityLabel="Loading page" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/autopilot" element={<Autopilot />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/posters" element={<Posters />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </Page>
  );
}
