/**
 * LoadingShell — minimal Suspense fallback for lazy-loaded routes/modals.
 *
 * Intentionally tiny: this renders inside Suspense boundaries while a
 * code-split chunk (AdminCustomers, OnboardingWizard, etc.) downloads, so
 * we want zero deps and a neutral look. Inline styles avoid pulling in
 * Tailwind during the fallback paint.
 */
export function LoadingShell() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '2rem',
        color: 'var(--muted, rgba(255,255,255,0.5))',
        textAlign: 'center',
        fontSize: '0.875rem',
      }}
    >
      Loading…
    </div>
  );
}
