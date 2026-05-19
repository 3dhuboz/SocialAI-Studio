import { useCallback, useEffect, useState } from 'react';
import {
  Card, BlockStack, InlineStack, Text, Banner, Button, Spinner, Modal,
  TextField, Badge, EmptyState, ResourceList, ResourceItem, Box, ButtonGroup,
} from '@shopify/polaris';
import {
  listCampaigns, createCampaign, updateCampaign, deleteCampaign,
  ApiError, type ShopifyCampaign,
} from '../api';

/**
 * Campaigns — date-ranged marketing themes that flavour every Autopilot
 * post generated during their window.
 *
 * Single-page CRUD:
 *   - List view of all campaigns (active ones tagged)
 *   - "New campaign" modal with name + goal + theme + start/end pickers
 *   - Edit + delete from each row
 *
 * The autopilot generator reads the currently-active campaign and stitches
 * its goal + theme into the LLM user prompt, so a post generated during a
 * "Black Friday" window will naturally pull the right copy and hashtags.
 */

type Phase = 'loading' | 'ready' | 'error';

interface FormState {
  id: string | null;
  name: string;
  goal: string;
  theme: string;
  startAt: string;     // local datetime string (YYYY-MM-DDTHH:mm)
  endAt: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  goal: '',
  theme: '',
  startAt: '',
  endAt: '',
};

// ── Date helpers ──────────────────────────────────────────────────────────

function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function Campaigns() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [campaigns, setCampaigns] = useState<ShopifyCampaign[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listCampaigns();
      setCampaigns(res.items);
      setPhase('ready');
    } catch (e: unknown) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      setPhase('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => setForm({ ...EMPTY_FORM });
  const openEdit = (c: ShopifyCampaign) => setForm({
    id: c.id,
    name: c.name,
    goal: c.goal ?? '',
    theme: c.theme ?? '',
    startAt: isoToLocalInput(c.startAt),
    endAt: isoToLocalInput(c.endAt),
  });

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setError('Campaign name is required.');
      return;
    }
    const startIso = localInputToIso(form.startAt);
    if (!startIso) {
      setError('Pick a start date.');
      return;
    }
    const endIso = form.endAt ? localInputToIso(form.endAt) : null;
    if (form.endAt && !endIso) {
      setError('End date is invalid.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        await updateCampaign(form.id, {
          name: form.name.trim(),
          goal: form.goal.trim() || null,
          theme: form.theme.trim() || null,
          startAt: startIso,
          endAt: endIso,
        });
      } else {
        await createCampaign({
          name: form.name.trim(),
          goal: form.goal.trim() || null,
          theme: form.theme.trim() || null,
          startAt: startIso,
          endAt: endIso,
        });
      }
      setForm(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteCampaign(deleteId);
      setCampaigns((prev) => prev.filter((c) => c.id !== deleteId));
      setDeleteId(null);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const activeCount = campaigns.filter((c) => c.isActive).length;

  if (phase === 'loading') {
    return (
      <Card>
        <BlockStack gap="200" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Loading campaigns" />
          <Text as="p" variant="bodySm" tone="subdued">Loading campaigns…</Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text as="h2" variant="headingLg">Campaigns</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Set a date range, goal, and theme. The AI weaves them into every
            post Autopilot generates during the window.
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          {activeCount > 0 && <Badge tone="success">{`${activeCount} active`}</Badge>}
          <Button variant="primary" onClick={openCreate}>New campaign</Button>
        </InlineStack>
      </InlineStack>

      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      )}

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            heading="No campaigns yet"
            action={{ content: 'New campaign', onAction: openCreate }}
            image=""
          >
            <p>
              Create your first campaign to give Autopilot a theme to write toward.
              Examples: "Black Friday 2026", "Spring Collection Launch", "Summer Sale".
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <ResourceList
            resourceName={{ singular: 'campaign', plural: 'campaigns' }}
            items={campaigns}
            renderItem={(c) => (
              <ResourceItem
                id={c.id}
                accessibilityLabel={`Campaign ${c.name}`}
                onClick={() => openEdit(c)}
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">{c.name}</Text>
                      {c.isActive && <Badge tone="success">Active</Badge>}
                      {!c.isActive && new Date(c.startAt) > new Date() && (
                        <Badge tone="info">Upcoming</Badge>
                      )}
                      {!c.isActive && c.endAt && new Date(c.endAt) < new Date() && (
                        <Badge>Ended</Badge>
                      )}
                    </InlineStack>
                    <ButtonGroup>
                      <Button onClick={() => openEdit(c)} size="slim">Edit</Button>
                      <Button onClick={() => setDeleteId(c.id)} size="slim" tone="critical">Delete</Button>
                    </ButtonGroup>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    {new Date(c.startAt).toLocaleDateString()}
                    {' → '}
                    {c.endAt ? new Date(c.endAt).toLocaleDateString() : 'Open-ended'}
                  </Text>

                  {c.goal && (
                    <Text as="p" variant="bodyMd">
                      <strong>Goal:</strong> {c.goal}
                    </Text>
                  )}
                  {c.theme && (
                    <Text as="p" variant="bodyMd">
                      <strong>Theme:</strong> {c.theme}
                    </Text>
                  )}
                </BlockStack>
              </ResourceItem>
            )}
          />
        </Card>
      )}

      {/* ── Create / Edit modal ──────────────────────────────────────── */}
      <Modal
        open={form !== null}
        title={form?.id ? 'Edit campaign' : 'New campaign'}
        onClose={() => (saving ? undefined : setForm(null))}
        primaryAction={{
          content: form?.id ? 'Save changes' : 'Create campaign',
          onAction: handleSave,
          loading: saving,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setForm(null), disabled: saving },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Name"
              value={form?.name ?? ''}
              onChange={(v) => setForm((s) => s ? { ...s, name: v } : s)}
              autoComplete="off"
              placeholder="Black Friday 2026"
              disabled={saving}
            />
            <TextField
              label="Goal"
              helpText="What outcome are you driving? Optional."
              value={form?.goal ?? ''}
              onChange={(v) => setForm((s) => s ? { ...s, goal: v } : s)}
              multiline={2}
              autoComplete="off"
              placeholder="Drive 30% sales spike across hero SKUs"
              disabled={saving}
            />
            <TextField
              label="Theme / vibe"
              helpText="Visual + copy direction. Optional."
              value={form?.theme ?? ''}
              onChange={(v) => setForm((s) => s ? { ...s, theme: v } : s)}
              multiline={2}
              autoComplete="off"
              placeholder="Bold neon urgency, dark backgrounds, countdown language"
              disabled={saving}
            />
            <InlineStack gap="300">
              <Box minWidth="200px">
                <NativeDateTimeField
                  label="Start"
                  value={form?.startAt ?? ''}
                  onChange={(v) => setForm((s) => s ? { ...s, startAt: v } : s)}
                  disabled={saving}
                />
              </Box>
              <Box minWidth="200px">
                <NativeDateTimeField
                  label="End (optional)"
                  value={form?.endAt ?? ''}
                  onChange={(v) => setForm((s) => s ? { ...s, endAt: v } : s)}
                  disabled={saving}
                />
              </Box>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <Modal
        open={deleteId !== null}
        title="Delete campaign?"
        onClose={() => (deleting ? undefined : setDeleteId(null))}
        primaryAction={{
          content: 'Delete',
          destructive: true,
          onAction: handleDelete,
          loading: deleting,
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setDeleteId(null), disabled: deleting },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Posts already generated with this campaign theme are unaffected;
            only future Autopilot runs stop using it.
          </Text>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

// ── NativeDateTimeField — Polaris doesn't ship a datetime-local picker,
// so we drop a plain <input> in with the Polaris label styling on top.
// Good enough for a CRUD modal; if we ever want a full Polaris-styled
// picker we can swap in DatePicker + TimePicker manually.

function NativeDateTimeField({
  label, value, onChange, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodyMd" fontWeight="medium">{label}</Text>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          padding: '8px 12px',
          borderRadius: '8px',
          border: '1px solid var(--p-color-border, #c9cccf)',
          fontSize: '14px',
          width: '100%',
          boxSizing: 'border-box',
          background: disabled ? 'var(--p-color-bg-surface-disabled, #f6f6f7)' : 'var(--p-color-bg-surface, #ffffff)',
        }}
      />
    </BlockStack>
  );
}
