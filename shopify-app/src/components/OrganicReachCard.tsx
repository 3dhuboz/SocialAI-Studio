import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Spinner,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  ApiError,
  confirmShopifyReachProfile,
  confirmShopifyReachSegment,
  getShopifyReachProfile,
  proposeShopifyReachProfile,
  proposeShopifyReachSegments,
  type ShopifyReachAudienceSegment,
  type ShopifyReachPlatform,
  type ShopifyReachProfile,
  type ShopifyReachProfileDraft,
} from '../api';

const DEFAULT_DRAFT: ShopifyReachProfileDraft = {
  timezone: 'Australia/Brisbane',
  baseLocation: { country: 'Australia', region: 'Queensland', locality: '' },
  serviceArea: { radiusKm: 40, included: [] },
  excludedLocations: [],
  platforms: ['facebook', 'instagram'],
};

function parseList(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function draftFromProfile(profile: ShopifyReachProfile): ShopifyReachProfileDraft {
  return {
    timezone: profile.timezone,
    baseLocation: { ...profile.baseLocation },
    serviceArea: {
      radiusKm: profile.serviceArea.radiusKm,
      included: [...profile.serviceArea.included],
    },
    excludedLocations: [...profile.excludedLocations],
    platforms: [...profile.platforms],
    cadence: profile.cadence ? { ...profile.cadence } : undefined,
  };
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof ApiError ? reason.message : fallback;
}

export function OrganicReachCard() {
  const [profile, setProfile] = useState<ShopifyReachProfile | null>(null);
  const [segments, setSegments] = useState<ShopifyReachAudienceSegment[]>([]);
  const [draft, setDraft] = useState<ShopifyReachProfileDraft>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    getShopifyReachProfile(controller.signal)
      .then((setup) => {
        if (cancelled) return;
        setProfile(setup.profile);
        setSegments(setup.segments ?? []);
        if (setup.profile) setDraft(draftFromProfile(setup.profile));
        setEditing(!setup.profile);
      })
      .catch((reason) => {
        if (cancelled || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setError(errorMessage(reason, 'Could not load organic reach setup.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason, 'Could not save organic reach setup.'));
    } finally {
      setBusy(false);
    }
  };

  const saveProposal = () => run(async () => {
    const proposed = await proposeShopifyReachProfile(draft);
    setProfile(proposed);
    setSegments([]);
    setEditing(false);
  });

  const confirmProfile = () => profile && run(async () => {
    const confirmed = await confirmShopifyReachProfile(profile.id);
    setProfile(confirmed);
    setSegments([]);
    setDraft(draftFromProfile(confirmed));
  });

  const predictSegments = () => run(async () => {
    setSegments(await proposeShopifyReachSegments());
  });

  const confirmSegment = (segmentId: string) => run(async () => {
    await confirmShopifyReachSegment(segmentId);
    setSegments((current) => current.map((segment) => (
      segment.id === segmentId ? { ...segment, status: 'confirmed' } : segment
    )));
  });

  if (loading) {
    return (
      <Card>
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" variant="bodyMd" tone="subdued">
            Loading organic reach setup...
          </Text>
        </InlineStack>
      </Card>
    );
  }

  if (editing) {
    return (
      <ReachEditor
        draft={draft}
        busy={busy}
        error={error}
        hasExistingProfile={Boolean(profile)}
        onChange={setDraft}
        onCancel={() => {
          if (profile) setDraft(draftFromProfile(profile));
          setEditing(false);
        }}
        onSave={saveProposal}
      />
    );
  }

  if (!profile) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Organic reach profile</Text>
          <Banner tone="warning">
            <p>{error ?? 'Organic reach setup is not available yet.'}</p>
          </Banner>
        </BlockStack>
      </Card>
    );
  }
  const confirmed = profile.confirmationStatus === 'confirmed';
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <BlockStack gap="050">
            <Text as="h3" variant="headingMd">Organic reach profile</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {confirmed ? `Confirmed version ${profile.version}` : `Proposed version ${profile.version}`}
            </Text>
          </BlockStack>
          <Badge tone={confirmed ? 'success' : 'attention'}>
            {confirmed ? 'Confirmed' : 'Review required'}
          </Badge>
        </InlineStack>

        {error && <Banner tone="critical"><p>{error}</p></Banner>}
        <Banner tone="info" title="Shadow advice only">
          <p>This profile cannot change scheduling or publishing.</p>
        </Banner>

        <BlockStack gap="200">
          <ProfileLine label="Base" value={`${profile.baseLocation.locality}, ${profile.baseLocation.region}, ${profile.baseLocation.country}`} />
          <ProfileLine label="Timezone" value={profile.timezone} />
          <ProfileLine label="Radius" value={profile.serviceArea.radiusKm == null ? 'Defined areas only' : `${profile.serviceArea.radiusKm} km`} />
          <ProfileLine label="Included" value={profile.serviceArea.included.join(', ')} />
          <ProfileLine label="Excluded" value={profile.excludedLocations.join(', ') || 'None'} />
          <ProfileLine
            label="Platforms"
            value={profile.platforms.map((value) => value === 'facebook' ? 'Facebook' : 'Instagram').join(', ')}
          />
        </BlockStack>

        {confirmed && (
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center" align="space-between">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="semibold">Predicted commercial audiences</Text>
                <Text as="p" variant="bodySm" tone="subdued">Protected traits are blocked.</Text>
              </BlockStack>
              <Button onClick={predictSegments} loading={busy} disabled={busy}>
                {segments.length ? 'Refresh prediction' : 'Predict audiences'}
              </Button>
            </InlineStack>
            {segments.map((segment) => (
              <AudienceSegmentCard
                key={segment.id}
                segment={segment}
                busy={busy}
                onConfirm={() => confirmSegment(segment.id)}
              />
            ))}
          </BlockStack>
        )}

        <Divider />
        <InlineStack gap="200" align="end">
          <Button onClick={() => setEditing(true)} disabled={busy}>
            {confirmed ? 'Create updated version' : 'Edit proposal'}
          </Button>
          {!confirmed && (
            <Button variant="primary" onClick={confirmProfile} loading={busy} disabled={busy}>
              Confirm reviewed profile
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function ReachEditor({
  draft,
  busy,
  error,
  hasExistingProfile,
  onChange,
  onCancel,
  onSave,
}: {
  draft: ShopifyReachProfileDraft;
  busy: boolean;
  error: string | null;
  hasExistingProfile: boolean;
  onChange: (draft: ShopifyReachProfileDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const platforms = draft.platforms ?? [];
  const togglePlatform = (platform: ShopifyReachPlatform) => {
    onChange({
      ...draft,
      platforms: platforms.includes(platform)
        ? platforms.filter((item) => item !== platform)
        : [...platforms, platform],
    });
  };
  const complete = Boolean(
    draft.timezone.trim()
    && draft.baseLocation.country.trim()
    && draft.baseLocation.region.trim()
    && draft.baseLocation.locality.trim()
    && draft.serviceArea.included.length
    && platforms.length,
  );

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h3" variant="headingMd">Organic reach profile</Text>
            <Badge tone="attention">Review required</Badge>
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            Save a proposed version, review every location, then confirm it once.
          </Text>
        </BlockStack>
        {error && <Banner tone="critical"><p>{error}</p></Banner>}

        <InlineStack gap="300" wrap>
          <FieldBox><TextField label="Locality" value={draft.baseLocation.locality} autoComplete="off"
            onChange={(value) => onChange({ ...draft, baseLocation: { ...draft.baseLocation, locality: value } })} /></FieldBox>
          <FieldBox><TextField label="State / region" value={draft.baseLocation.region} autoComplete="off"
            onChange={(value) => onChange({ ...draft, baseLocation: { ...draft.baseLocation, region: value } })} /></FieldBox>
          <FieldBox><TextField label="Country" value={draft.baseLocation.country} autoComplete="off"
            onChange={(value) => onChange({ ...draft, baseLocation: { ...draft.baseLocation, country: value } })} /></FieldBox>
          <FieldBox><TextField label="Timezone" value={draft.timezone} autoComplete="off"
            onChange={(value) => onChange({ ...draft, timezone: value })} /></FieldBox>
          <FieldBox><TextField label="Service radius (km)" type="number"
            value={draft.serviceArea.radiusKm == null ? '' : String(draft.serviceArea.radiusKm)} autoComplete="off"
            onChange={(value) => onChange({
              ...draft,
              serviceArea: {
                ...draft.serviceArea,
                radiusKm: value === '' ? null : Math.max(0, Number(value)),
              },
            })} /></FieldBox>
        </InlineStack>

        <TextField
          label="Included service areas"
          value={draft.serviceArea.included.join(', ')}
          multiline={2}
          autoComplete="off"
          helpText="Separate towns or suburbs with commas."
          onChange={(value) => onChange({
            ...draft,
            serviceArea: { ...draft.serviceArea, included: parseList(value) },
          })}
        />
        <TextField
          label="Excluded areas"
          value={(draft.excludedLocations ?? []).join(', ')}
          multiline={2}
          autoComplete="off"
          helpText="The planner must never target these locations."
          onChange={(value) => onChange({ ...draft, excludedLocations: parseList(value) })}
        />
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">Platforms</Text>
          <InlineStack gap="200">
            <Button pressed={platforms.includes('facebook')} onClick={() => togglePlatform('facebook')}>Facebook</Button>
            <Button pressed={platforms.includes('instagram')} onClick={() => togglePlatform('instagram')}>Instagram</Button>
          </InlineStack>
        </BlockStack>

        <InlineStack gap="200" align="end">
          {hasExistingProfile && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
          <Button variant="primary" onClick={onSave} loading={busy} disabled={busy || !complete}>
            Create reviewed proposal
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function FieldBox({ children }: { children: React.ReactNode }) {
  return <Box minWidth="220px">{children}</Box>;
}

function ProfileLine({ label, value }: { label: string; value: string }) {
  return (
    <Text as="p" variant="bodyMd">
      <strong>{label}:</strong> {value}
    </Text>
  );
}

function AudienceSegmentCard({
  segment,
  busy,
  onConfirm,
}: {
  segment: ShopifyReachAudienceSegment;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="200">
        <InlineStack gap="200" align="space-between" blockAlign="start">
          <BlockStack gap="050">
            <Text as="p" variant="bodyMd" fontWeight="semibold">{segment.label}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{segment.needs.join(', ')}</Text>
          </BlockStack>
          <Badge>{`${Math.round(segment.confidence * 100)}% confidence`}</Badge>
        </InlineStack>
        {segment.status === 'confirmed' ? (
          <InlineStack><Badge tone="success">Confirmed audience</Badge></InlineStack>
        ) : (
          <InlineStack>
            <Button size="slim" onClick={onConfirm} disabled={busy}>Confirm audience</Button>
          </InlineStack>
        )}
      </BlockStack>
    </Box>
  );
}
