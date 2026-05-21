import React from 'react';
import { CLIENT } from '../client.config';
import { AppLogo } from '../components/AppLogo';

interface LegalLayoutProps {
  title: string;
  /** Plain-text date stamp, e.g. "2026-05-22" */
  lastUpdated: string;
  /** Plain English one-liner shown under the title — sets reader expectation */
  intro?: string;
  children: React.ReactNode;
}

/**
 * Shared visual wrapper for /privacy, /terms, /refunds, /cookies.
 *
 * Mirrors the LandingPage look-and-feel (dark theme, glass card, amber accent)
 * so legal pages don't feel like a different site. Renders a minimal top bar
 * with the app logo (← back to / on click) and a footer with cross-links to
 * the other three legal docs so a customer reviewing them can hop between
 * pages without going back to the marketing site.
 */
export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, lastUpdated, intro, children }) => {
  const legalLinks: { href: string; label: string }[] = [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/refunds', label: 'Refund Policy' },
    { href: '/cookies', label: 'Cookie Notice' },
  ];

  return (
    <div className="min-h-screen bg-[#06060a] text-white overflow-x-hidden">
      {/* Background — matches AuthScreen for visual continuity */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(245,158,11,0.10),transparent)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      {/* Top bar — minimal: logo back-link + app name */}
      <nav className="relative z-10 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition">
            <AppLogo size={44} />
            <span className="text-sm font-bold text-white/80">{CLIENT.appName}</span>
          </a>
          <a
            href="/"
            className="text-xs text-white/40 hover:text-white/70 transition font-semibold"
          >
            ← Back to site
          </a>
        </div>
      </nav>

      {/* Body — single column, narrow for readability */}
      <main className="relative z-10 max-w-3xl mx-auto px-5 py-12 md:py-16">
        <header className="mb-8 md:mb-10">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-xs text-white/40 font-semibold uppercase tracking-wider">
            Last updated: {lastUpdated}
          </p>
          {intro && (
            <p className="mt-4 text-base text-white/60 leading-relaxed">{intro}</p>
          )}
        </header>

        {/* Glass card containing the body content */}
        <article className="bg-white/[0.025] border border-white/[0.08] rounded-3xl p-6 md:p-10 space-y-6 text-white/75 leading-relaxed text-[15px] legal-prose">
          {children}
        </article>

        {/* Cross-links to the other legal docs */}
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/40">
          {legalLinks.map(l => (
            <a key={l.href} href={l.href} className="hover:text-white/70 transition">
              {l.label}
            </a>
          ))}
        </nav>

        <p className="mt-8 text-center text-[11px] text-white/20">
          Questions? Email{' '}
          <a href={`mailto:${CLIENT.supportEmail}`} className="text-amber-400/70 hover:text-amber-300 transition">
            {CLIENT.supportEmail}
          </a>
        </p>
      </main>

      {/* Minimal styles so headings/lists inside the article look readable
          without needing @tailwindcss/typography. Scoped via .legal-prose. */}
      <style>{`
        .legal-prose h2 { color: white; font-weight: 800; font-size: 1.2rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
        .legal-prose h2:first-child { margin-top: 0; }
        .legal-prose p { margin-bottom: 0.85rem; }
        .legal-prose ul { list-style: disc; padding-left: 1.4rem; margin-bottom: 0.85rem; }
        .legal-prose li { margin-bottom: 0.35rem; }
        .legal-prose a { color: rgb(251 191 36 / 0.85); text-decoration: underline; }
        .legal-prose a:hover { color: rgb(252 211 77); }
        .legal-prose strong { color: white; font-weight: 700; }
      `}</style>
    </div>
  );
};
