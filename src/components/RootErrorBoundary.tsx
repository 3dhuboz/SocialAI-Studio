import { Component, ErrorInfo, ReactNode } from 'react';

/**
 * RootErrorBoundary — top-level safety net. Without this, a single uncaught
 * throw anywhere in the React tree white-screens the whole app. We render a
 * recoverable shell (reload button + details) and fire a best-effort beacon
 * to /api/client-error. The endpoint may 404 — the catch suppresses that so
 * the boundary never breaks on its own reporting.
 *
 * Note: this is *only* the last resort. Component-level boundaries (per tab
 * / per modal) can still be added later for partial recovery; this one
 * exists so we stop shipping white screens to production users.
 */
interface State {
  error: Error | null;
}

interface Props {
  children: ReactNode;
}

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log locally so devs in DevTools can see the original stack.
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', error, info);

    // Best-effort beacon. The endpoint isn't wired yet — that's intentional;
    // shipping the boundary is more urgent than the server piece. When the
    // route exists, no client change is needed.
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          url: typeof location !== 'undefined' ? location.href : '',
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          ts: Date.now(),
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // never let the boundary itself throw
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: '2rem',
            maxWidth: 560,
            margin: '4rem auto',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: 12,
            color: 'rgba(255,255,255,0.85)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--muted, rgba(255,255,255,0.55))' }}>
            The page hit an error. We've been notified — try reloading.
          </p>
          <button
            onClick={() => {
              if (typeof location !== 'undefined') location.reload();
            }}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6,
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <details
            style={{
              marginTop: '1rem',
              color: 'var(--muted, rgba(255,255,255,0.55))',
              fontSize: '0.85rem',
            }}
          >
            <summary>Error details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>
              {this.state.error.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
