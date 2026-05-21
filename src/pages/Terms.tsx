import React from 'react';
import { CLIENT } from '../client.config';
import { LegalLayout } from './LegalLayout';

/**
 * Plain-English terms of service. Conservative — we don't claim certifications
 * we don't hold and we point AI-content responsibility at the user (industry
 * standard for generative-AI products). Governing law is Queensland, AU.
 */
const Terms: React.FC = () => {
  const supportEmail = CLIENT.supportEmail;

  return (
    <LegalLayout
      title="Terms of Service"
      lastUpdated="2026-05-22"
      intro={`These terms govern your use of ${CLIENT.appName}. By signing up you agree to them.`}
    >
      <h2>The service</h2>
      <p>
        {CLIENT.appName} is a software-as-a-service product that uses AI to help you draft,
        schedule, and publish social media posts to your Facebook Page and Instagram
        account. The service is provided &quot;as is&quot; — features may change, improve,
        or be removed over time.
      </p>

      <h2>Your account</h2>
      <p>
        You must be at least 16 years old and authorised to bind the business you are using
        the service for. You are responsible for keeping your login credentials secure. We
        rely on our identity provider (Clerk) for authentication.
      </p>

      <h2>AI-generated content — your responsibility</h2>
      <p>
        {CLIENT.appName} uses large language models and image generators to draft content.
        AI output can be inaccurate, biased, out of date, or unsuitable for your business.
        <strong> You are responsible for reviewing every post before it is published.</strong>{' '}
        Once a post is published to your Page or Instagram, you — not us — are the publisher.
        Do not use the service to publish anything you have not personally reviewed.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to use {CLIENT.appName} to:</p>
      <ul>
        <li>Send unsolicited bulk messages, comment-spam, or any other behaviour that violates Meta&apos;s Platform Terms or Community Standards.</li>
        <li>Impersonate another person, business, or brand without authorisation.</li>
        <li>Publish content that is illegal in Australia or in the country of the audience you are targeting (including but not limited to defamation, harassment, hate speech, child sexual abuse material, copyright infringement, or content that incites violence).</li>
        <li>Attempt to bypass platform rate limits, scrape data outside the permissions you have granted, or reverse engineer the service.</li>
        <li>Resell or sublicense access to {CLIENT.appName} except where the Agency plan explicitly permits managing client workspaces.</li>
      </ul>

      <h2>Account suspension</h2>
      <p>
        We may suspend or terminate your account, without refund of the current billing
        period, if we reasonably believe you have breached these terms, if your payment
        method fails, if Meta revokes your Page access, or if your usage poses a security
        or legal risk to {CLIENT.appName} or other customers. Where possible we will give
        you notice and a chance to fix the issue first.
      </p>

      <h2>Payment and renewal</h2>
      <p>
        Subscriptions are billed in advance, either monthly or yearly depending on the plan
        you choose. Plans renew automatically at the end of each billing period unless you
        cancel. You can cancel at any time from your PayPal account (or your Stripe customer
        portal, if you subscribed via the PennyBuilder add-on path). Cancellation takes
        effect at the end of the current paid period — see our <a href="/refunds">Refund
        Policy</a> for details on partial periods and reel credits.
      </p>

      <h2>Reel credits</h2>
      <p>
        Some plans include a monthly allotment of AI-generated reel credits. Unused monthly
        credits do not roll over. Separately purchased credit packs do not expire while
        your account is active.
        {/* STEVE: please review — confirm this matches your actual policy (currently CreditPackModal.tsx says credits never expire on active accounts). */}
      </p>

      <h2>Intellectual property</h2>
      <p>
        You own the content you create and publish through {CLIENT.appName}, including the
        AI-generated captions and images we produce for your business at your direction.
        We retain ownership of {CLIENT.appName} itself — the codebase, prompts, models,
        and design.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by Australian law, our total liability for any
        claim arising from your use of {CLIENT.appName} is limited to the amount you have
        paid us in the 12 months preceding the claim. We are not liable for indirect,
        incidental, or consequential losses including lost profits, lost goodwill, or
        the cost of substitute services. Nothing in these terms excludes the consumer
        guarantees that apply under the Australian Consumer Law where you are a
        &quot;consumer&quot; within the meaning of that Act.
      </p>

      <h2>Third-party services</h2>
      <p>
        {CLIENT.appName} integrates with Facebook, Instagram, PayPal, Stripe, and various
        AI providers. Their terms and policies apply when you use those services through
        us. We are not responsible for changes to or outages of those third parties.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of Queensland, Australia. Any dispute will be
        resolved in the courts of Queensland, unless an applicable consumer-protection law
        gives you the right to bring proceedings in your home jurisdiction.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms from time to time. Material changes will be notified by
        email at least 14 days in advance. Continued use of the service after the effective
        date means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms? Email{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or{' '}
        <a href="mailto:steve@3dhub.au">steve@3dhub.au</a>.
      </p>
    </LegalLayout>
  );
};

export default Terms;
