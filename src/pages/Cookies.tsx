import React from 'react';
import { CLIENT } from '../client.config';
import { LegalLayout } from './LegalLayout';

/**
 * Plain-English cookie notice. We currently use essential cookies only (Clerk
 * session + CSRF). When we add analytics or Meta Pixel, this page MUST be
 * updated and a consent banner added before deploy.
 */
const Cookies: React.FC = () => {
  const supportEmail = CLIENT.supportEmail;

  return (
    <LegalLayout
      title="Cookie Notice"
      lastUpdated="2026-05-22"
      intro={`We use as few cookies as possible. Here's exactly what's set in your browser when you use ${CLIENT.appName} today.`}
    >
      <h2>What we use today</h2>
      <p>
        {CLIENT.appName} currently only uses <strong>essential</strong> cookies and similar
        browser storage. These are required for the app to work and are not subject to
        consent under the EU ePrivacy Directive or the Australian Privacy Act:
      </p>
      <ul>
        <li>
          <strong>Authentication session</strong> (set by Clerk) — remembers that you are
          signed in. Cleared when you sign out.
        </li>
        <li>
          <strong>CSRF protection</strong> — a short-lived token that stops other websites
          from making requests on your behalf.
        </li>
        <li>
          <strong>Local preferences</strong> (browser <code>localStorage</code>) — caches
          your profile, your last-loaded posts, and onboarding progress so the dashboard
          renders instantly on return visits. This is stored only in your own browser; we
          do not transmit or read it server-side beyond the API calls you trigger.
        </li>
      </ul>

      <h2>What we don&apos;t use today</h2>
      <ul>
        <li>No third-party analytics (no Google Analytics, no Mixpanel, no Segment).</li>
        <li>No advertising cookies.</li>
        <li>No Meta Pixel or other social-network tracking pixels.</li>
        <li>No session replay or behavioural tracking tools.</li>
      </ul>
      <p>
        If we ever add analytics or marketing cookies, we will update this page and show
        a consent banner before any non-essential cookies are set. EU and UK visitors
        will see an opt-in banner; AU visitors will see a clear notice with the ability
        to opt out.
      </p>

      <h2>How to control cookies</h2>
      <p>
        Because we use essential cookies only, there is currently no in-app cookie banner.
        You can clear cookies and local storage for our domain at any time using your
        browser&apos;s settings — note that doing so will sign you out and reset cached
        dashboard data.
      </p>

      <h2>Third parties</h2>
      <p>
        When you connect a Facebook Page or Instagram account, Meta may set its own cookies
        on the page Meta serves to you during the OAuth flow. Those cookies are controlled
        by Meta and governed by Meta&apos;s privacy policy, not ours. Likewise PayPal and
        Stripe may set cookies on their own checkout pages. We do not embed any tracking
        scripts from those vendors inside {CLIENT.appName} itself.
      </p>

      <h2>Contact</h2>
      <p>
        Cookie or tracking questions: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>{' '}
        or <a href="mailto:steve@3dhub.au">steve@3dhub.au</a>. See also our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalLayout>
  );
};

export default Cookies;
