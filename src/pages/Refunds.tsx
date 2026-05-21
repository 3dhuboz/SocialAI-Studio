import React from 'react';
import { CLIENT } from '../client.config';
import { LegalLayout } from './LegalLayout';

/**
 * Plain-English refund policy. Conservative defaults (no partial-month refunds,
 * cancel-anytime takes effect end-of-period) tempered with case-by-case bug/
 * outage refunds. Reel credit packs explicitly do not expire — that's the
 * commercial promise we already make in CreditPackModal.tsx.
 */
const Refunds: React.FC = () => {
  const supportEmail = CLIENT.supportEmail;

  return (
    <LegalLayout
      title="Refund Policy"
      lastUpdated="2026-05-22"
      intro={`Straightforward refund rules. If something has clearly gone wrong on our end, email us — we'll make it right.`}
    >
      <h2>Subscriptions</h2>
      <p>
        Subscriptions to {CLIENT.appName} are billed in advance for each monthly or yearly
        period. We do not offer pro-rata refunds for unused time inside a paid period.
        When you cancel, your subscription stays active until the end of the period you
        have already paid for, then it does not renew.
      </p>
      <p>
        This applies whether you cancel through PayPal, through Stripe (PennyBuilder
        add-on path), or by emailing us to request cancellation.
      </p>

      <h2>How to cancel</h2>
      <p>
        Cancel any time from your PayPal account (Profile → Settings → Payments → Manage
        automatic payments) or from your Stripe billing portal if that&apos;s how you
        subscribed. If you can&apos;t find the option, email{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will cancel for you
        within one business day. You keep full access until the end of the current period.
      </p>

      <h2>Reel credit packs</h2>
      <p>
        Reel credit packs are one-off purchases. Once a credit has been used to generate
        a reel, that credit is non-refundable. Unused credits in a pack do not expire
        while your {CLIENT.appName} account remains active. If you cancel your subscription
        the credits pause; if you reactivate within our 30-day data retention window your
        unused credits are still there.
      </p>

      <h2>Bugs and outages</h2>
      <p>
        If a fault on our end — a bug, a billing error, or an extended outage — meant you
        could not use the service you paid for, email{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with the details and we will
        handle it case by case. Typical resolutions are a service credit toward your next
        bill or, where appropriate, a partial refund. We do not offer refunds for outages
        caused by third parties (e.g. Facebook downtime, Meta revoking a Page&apos;s access,
        OAuth token expiry that you have not refreshed).
      </p>

      <h2>Australian Consumer Law</h2>
      <p>
        Nothing in this policy limits the consumer guarantees you may have under the
        Australian Consumer Law where you are a &quot;consumer&quot; within the meaning of
        that Act. If a service we provide has a major failure that cannot be remedied,
        you may be entitled to a refund regardless of this policy.
      </p>

      <h2>Chargebacks</h2>
      <p>
        Please email us first before raising a chargeback with your bank or card issuer —
        we can usually resolve any issue faster than the chargeback process. Chargebacks
        raised without contacting us, or for charges that turn out to be valid, may result
        in account suspension under our <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Contact</h2>
      <p>
        All refund and billing enquiries:{' '}
        <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or{' '}
        <a href="mailto:steve@3dhub.au">steve@3dhub.au</a>. Include the email address on
        your account and, if you have one handy, the PayPal transaction ID or Stripe
        invoice number.
      </p>
    </LegalLayout>
  );
};

export default Refunds;
