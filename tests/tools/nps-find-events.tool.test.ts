/**
 * @fileoverview Tests for the nps_find_events tool — the date-range guard, the
 * headline path, the upstream errors[] warning fold, the empty-result notice,
 * and format().
 * @module tests/tools/nps-find-events.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindEvents } from '@/mcp-server/tools/definitions/nps-find-events.tool.js';
import type { NpsEvent, NpsEventsResult } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

function makeEvent(overrides?: Partial<NpsEvent>): NpsEvent {
  return {
    id: 'e1',
    title: 'Ranger Talk',
    parkCode: 'yell',
    description: 'Join a ranger for a talk.',
    location: 'Visitor Center',
    dateStart: '2026-07-04',
    dateEnd: '2026-07-04',
    times: [{ timeStart: '02:00 PM', timeEnd: '02:30 PM' }],
    category: 'Ranger Programs',
    isFree: true,
    feeInfo: null,
    registrationUrl: null,
    infoUrl: 'https://www.nps.gov/yell/event',
    ...overrides,
  };
}

function makeResult(overrides?: Partial<NpsEventsResult>): NpsEventsResult {
  return { total: 1, data: [makeEvent()], errors: [], ...overrides };
}

describe('nps_find_events', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const findEvents = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsFindEvents.errors });
    vi.mocked(getNpsService).mockReturnValue({ findEvents } as never);
    findEvents.mockReset();
  });

  it('returns events for a park within a date window', async () => {
    findEvents.mockResolvedValueOnce(makeResult());
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-07-04',
      dateEnd: '2026-07-06',
    });
    const result = await npsFindEvents.handler(input, ctx);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].parkCode).toBe('yell');
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('throws invalid_date when dateEnd precedes dateStart', async () => {
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-07-06',
      dateEnd: '2026-07-04',
    });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_date' },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  it('folds a non-empty upstream errors[] into the notice', async () => {
    findEvents.mockResolvedValueOnce(
      makeResult({ total: 0, data: [], errors: ['Date range too large'] }),
    );
    const input = npsFindEvents.input.parse({ parkCode: 'yell' });
    const result = await npsFindEvents.handler(input, ctx);

    expect(result.events).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/Date range too large/);
  });

  it('emits an empty-result notice when no events match', async () => {
    findEvents.mockResolvedValueOnce(makeResult({ total: 0, data: [] }));
    const input = npsFindEvents.input.parse({ parkCode: 'yell' });
    const result = await npsFindEvents.handler(input, ctx);

    expect(result.events).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/sparser than alerts/);
  });

  it('handles a sparse event (null dates, null parkCode, no times)', async () => {
    findEvents.mockResolvedValueOnce(
      makeResult({
        data: [
          makeEvent({ parkCode: null, dateStart: null, dateEnd: null, times: [], category: null }),
        ],
      }),
    );
    const input = npsFindEvents.input.parse({ stateCode: 'WY' });
    const result = await npsFindEvents.handler(input, ctx);
    expect(result.events[0].parkCode).toBeNull();
    expect(result.events[0].times).toEqual([]);
  });

  it('format() renders the id, when-line, and fee', () => {
    const blocks = npsFindEvents.format!({ events: [makeEvent()] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('e1');
    expect(text).toContain('02:00 PM');
    expect(text).toMatch(/Fee:\*\* Free/);
  });
});
