import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Banner, Page } from '@shopify/polaris';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Minimal class-based ErrorBoundary. Catches render-time errors anywhere
 * inside the React tree and replaces it with a Polaris critical banner so
 * the merchant always sees a recognisable Shopify-admin surface instead of
 * a blank iframe.
 *
 * Implemented as a class (the only way to use React error-boundary lifecycle
 * hooks) rather than pulling in a new dependency.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console signal — embedded apps run in an iframe and Shopify's
    // admin DevTools is the only place this surfaces.
    // eslint-disable-next-line no-console
    console.error('SocialAI embedded app crashed:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Page title="SocialAI Studio">
          <Banner tone="critical" title="Something went wrong">
            <p>Refresh to reload the app.</p>
          </Banner>
        </Page>
      );
    }
    return this.props.children;
  }
}
