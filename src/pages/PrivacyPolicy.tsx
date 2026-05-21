import React from 'react';
import { CLIENT } from '../client.config';
import { LegalLayout } from './LegalLayout';

/**
 * Plain-English privacy policy. AU-focused (Privacy Act 1988 / APPs) with
 * GDPR coverage for EU customers. The sub-processor list MUST match the
 * services the app actually uses today — keep this in sync when we add or
 * remove a vendor. Anything marked STEVE: please review needs Steve's eyes
 * before publishing.
 */
const PrivacyPolicy: React.FC = () => {
  // Support contact is sourced from client.config so white-label deployments
  // get their own branded contact email automatically.
  const supportEmail = CLIENT.supportEmail;

  return (
    <LegalLayout
      title="Privacy Policy"
      lastUpdated="2026-05-22"
      intro={`This page explains what ${CLIENT.appName} collects, why we collect it, and what control you have over it. Plain English — no dark patterns.`}
    >
      <h2>Who we are</h2>
      <p>
        {CLIENT.appName} is operated by Steve, sole trader (ABN 16 477 079 626), based in
        Queensland, Australia. For privacy enquiries you can reach the operator at{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or{' '}
        <a href="mailto:steve@3dhub.au">steve@3dhub.au</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> your email address, display name, and authentication
          metadata (managed by our identity provider, Clerk).
        </li>
        <li>
          <strong>Business profile:</strong> the information you enter about your business —
          name, location, tone, description, brand colours, and any photos or files you upload
          for use in AI generation.
        </li>
        <li>
          <strong>Connected social tokens:</strong> when you connect a Facebook Page or
          Instagram account, we receive OAuth access tokens from Meta. We store them
          encrypted-at-rest in our database so we can publish on your behalf.
        </li>
        <li>
          <strong>Post content:</strong> the captions, hashtags, schedules, AI-generated
          images and videos, and engagement statistics we fetch from your Facebook/Instagram
          Pages to power scheduling, critique, and analytics.
        </li>
        <li>
          <strong>Billing data:</strong> we do <strong>not</strong> store full card numbers.
          Payment is processed by PayPal (and, where the PennyBuilder add-on path is used,
          Stripe). We receive a subscription identifier and status — never the card itself.
        </li>
        <li>
          <strong>Technical data:</strong> standard server logs (IP address, user agent,
          request paths, timestamps) retained for security and debugging.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To publish posts and reels to the Facebook Page or Instagram account you connect.</li>
        <li>To generate AI captions, images, video scripts, and recommendations using your business profile as context.</li>
        <li>To analyse the performance of your published posts and surface insights.</li>
        <li>To bill your subscription and respond to support requests.</li>
        <li>To detect abuse, fix bugs, and keep the service running.</li>
      </ul>
      <p>
        We do not sell your personal information. We do not use your post content to train
        third-party AI models beyond the one-off API call needed to fulfil the request you
        asked us to make.
      </p>

      <h2>Sub-processors</h2>
      <p>We rely on the following vendors to deliver the service. Each has its own privacy policy:</p>
      <ul>
        <li><strong>Cloudflare</strong> — hosting, edge network, database (D1), and object storage (R2).</li>
        <li><strong>Clerk</strong> — authentication and session management.</li>
        <li><strong>Anthropic</strong> and <strong>OpenRouter</strong> — large-language-model inference for caption and analytics generation.</li>
        <li><strong>fal.ai</strong> — image and video generation.</li>
        <li><strong>Meta (Facebook / Instagram)</strong> — the destination platforms; we send your post content to them when we publish on your behalf.</li>
        <li><strong>Postproxy</strong> — alternate posting path used by some customers.</li>
        <li><strong>Resend</strong> — transactional email (signup confirmations, alerts).</li>
        <li><strong>PayPal</strong> — primary payment processor.</li>
        <li><strong>Stripe</strong> — used only when subscribing through the PennyBuilder add-on path.</li>
      </ul>
      <p>
        Some of these vendors are based outside Australia (primarily the United States and
        the European Union). By using {CLIENT.appName} you consent to your data being
        processed in those jurisdictions for the purposes above.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We retain your account, profile, posts, and connected tokens for as long as your
        subscription is active. If you cancel, we keep your data for <strong>30 days</strong>{' '}
        after cancellation so you can reactivate without starting over, then we delete it.
        You can ask us to delete it sooner at any time.
        Standard server logs are retained for up to 90 days for security and debugging.
      </p>

      <h2>Your rights</h2>
      <p>
        You can request access to, correction of, or deletion of your personal information
        at any time. Most operations are self-serve from the Settings tab inside the app —
        for anything else, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and
        we will action it within 30 days. If you are in the EU, EEA, or UK, you also have
        rights under the GDPR including the right to object, the right to data portability,
        and the right to lodge a complaint with your local supervisory authority.
        Australian customers can complain to the Office of the Australian Information
        Commissioner (OAIC) at <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">oaic.gov.au</a>.
      </p>

      <h2>Children</h2>
      <p>
        {CLIENT.appName} is a business-to-business product. We do not knowingly collect
        information from anyone under 16. If you believe a minor has signed up, email
        us and we will delete the account.
      </p>

      <h2>Changes</h2>
      <p>
        If we materially change this policy we will update the &quot;Last updated&quot; date
        above and, where possible, notify active customers by email at least 14 days in
        advance.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions, deletion requests, or complaints:{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or{' '}
        <a href="mailto:steve@3dhub.au">steve@3dhub.au</a>.
      </p>
    </LegalLayout>
  );
};

export default PrivacyPolicy;
