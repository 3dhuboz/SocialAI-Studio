import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider as PolarisProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';

import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';

// PolarisProvider wraps the whole tree so every Polaris component picks up
// the i18n strings + theme. App Bridge has already initialised by the time
// this runs (it's the inline <script> in index.html that loads first) —
// React components access it cleanly via the useAppBridge() hook from
// @shopify/app-bridge-react.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <PolarisProvider i18n={enTranslations}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </PolarisProvider>
  </StrictMode>,
);
