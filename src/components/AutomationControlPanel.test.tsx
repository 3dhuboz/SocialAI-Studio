import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutomationControl, type ClientAutomationState } from './AutomationControlPanel';

const paused: ClientAutomationState = {
  status: 'on_hold',
  paused: true,
  draftCount: 16,
  scheduledCount: 2,
  postedCount: 7,
  overdueScheduledCount: 1,
  undatedScheduledCount: 1,
  staleScheduledCount: 2,
  canResume: false,
};

describe('AutomationControl', () => {
  it('shows a paused workspace, queue counts, and the stale queue blocker', () => {
    const html = renderToStaticMarkup(
      <AutomationControl
        state={paused}
        saving={false}
        onPause={() => undefined}
        onResume={() => undefined}
        onReturnStaleToDraft={() => undefined}
      />,
    );

    expect(html).toContain('Automation paused');
    expect(html).toContain('16 drafts');
    expect(html).toContain('2 scheduled');
    expect(html).toContain('7 posted');
    expect(html).toContain('2 old queued posts need review');
    expect(html).toContain('Move old queue to Draft');
    expect(html).toContain('Resume automation');
    expect(html).toContain('disabled=""');
  });

  it('allows an explicit resume only when the queue is safe', () => {
    const html = renderToStaticMarkup(
      <AutomationControl
        state={{ ...paused, scheduledCount: 3, overdueScheduledCount: 0, undatedScheduledCount: 0, staleScheduledCount: 0, canResume: true }}
        saving={false}
        onPause={() => undefined}
        onResume={() => undefined}
        onReturnStaleToDraft={() => undefined}
      />,
    );

    expect(html).toContain('Ready to resume');
    expect(html).toContain('Resume automation');
    expect(html).not.toContain('Move old queue to Draft');
    expect(html).not.toContain('disabled=""');
  });

  it('shows a direct pause action while automation is active', () => {
    const html = renderToStaticMarkup(
      <AutomationControl
        state={{ ...paused, status: 'active', paused: false, staleScheduledCount: 0, canResume: true }}
        saving={false}
        onPause={() => undefined}
        onResume={() => undefined}
        onReturnStaleToDraft={() => undefined}
      />,
    );

    expect(html).toContain('Automation active');
    expect(html).toContain('Pause automation');
    expect(html).not.toContain('Resume automation');
  });
});
