/**
 * @fileoverview Tests for the nps_find_events tool — the date guards, the
 * headline path, the upstream errors[] warning fold, the empty-result notice,
 * truncation on both client surfaces, and format().
 * @module tests/tools/nps-find-events.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindEvents } from '@/mcp-server/tools/definitions/nps-find-events.tool.js';
import type { NpsEvent, NpsEventsResult } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

/** The `structuredContent.error` envelope of a failed call. */
type ContractError = { code: number; message: string; data?: { reason?: string } };

/** Text of every content block, joined — the surface content[]-reading clients see. */
function contentText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

function makeEvent(overrides?: Partial<NpsEvent>): NpsEvent {
  return {
    id: 'e1',
    title: 'Ranger Talk',
    parkCode: 'yell',
    description: 'Join a ranger for a talk.',
    location: 'Visitor Center',
    dateStart: '2026-07-04',
    dateEnd: '2026-07-04',
    occurrenceDates: ['2026-07-04'],
    isRecurring: false,
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
  let ctx: ReturnType<typeof createMockContext<typeof npsFindEvents.errors>>;
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
    expect(result.events[0]!.parkCode).toBe('yell');
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
    expect(getEnrichment(ctx).notice).toMatch(/Many parks list few or no events/);
  });

  it.each([
    ['an empty result', makeResult({ total: 0, data: [], errors: ['Date range too large'] })],
    ['a non-empty result', makeResult({ errors: ['Date range too large'] })],
  ])('words the NPS errors[] warning on %s as a caller-facing fact', async (_, upstream) => {
    findEvents.mockResolvedValueOnce(upstream);
    const result = await runToolContract(npsFindEvents, { parkCode: 'yell' });

    const notice = (result.structuredContent as { notice?: string }).notice ?? '';
    expect(notice).toContain('NPS reported: Date range too large.');
    expect(notice).not.toMatch(/upstream|sparser|feed/i);
    expect(contentText(result as never)).toContain('NPS reported: Date range too large.');
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
    expect(result.events[0]!.parkCode).toBeNull();
    expect(result.events[0]!.times).toEqual([]);
  });

  it('format() renders the id, when-line, and fee', () => {
    const blocks = npsFindEvents.format!({ events: [makeEvent()] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('e1');
    expect(text).toContain('02:00 PM');
    expect(text).toMatch(/Fee:\*\* Free/);
  });

  /* ----------------------------------------------------------------------- *
   * #8 — impossible calendar dates rejected client-side (never reach upstream)
   * ----------------------------------------------------------------------- */

  it('rejects an impossible calendar date (Feb 31) with the invalid_date recovery hint', async () => {
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-02-31',
      dateEnd: '2026-03-02',
    });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'invalid_date',
        recovery: { hint: expect.stringContaining('calendar date') },
      },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  it('rejects a month-13 date (2026-13-01) before any upstream call', async () => {
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-13-01',
      dateEnd: '2026-13-02',
    });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_date' },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  it('rejects Feb 29 in a non-leap year (2026-02-29)', async () => {
    const input = npsFindEvents.input.parse({ parkCode: 'yell', dateStart: '2026-02-29' });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_date' },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  it('accepts a real boundary date (2026-02-28) and calls upstream', async () => {
    findEvents.mockResolvedValueOnce(makeResult());
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-02-28',
      dateEnd: '2026-03-02',
    });
    await npsFindEvents.handler(input, ctx);
    expect(findEvents).toHaveBeenCalled();
  });

  /* ----------------------------------------------------------------------- *
   * #3 — invalid code inputs surface the declared recovery hint (not raw Zod)
   * ----------------------------------------------------------------------- */

  it('rejects a malformed parkCode with the declared recovery hint, before any upstream call', async () => {
    const input = npsFindEvents.input.parse({ parkCode: 'Yellowstone' });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'invalid_park_code',
        recovery: { hint: expect.stringContaining('nps_find_parks') },
      },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  it('rejects a malformed stateCode with the newly-declared invalid_state_code hint', async () => {
    const input = npsFindEvents.input.parse({ stateCode: 'California' });
    await expect(npsFindEvents.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'invalid_state_code',
        recovery: { hint: expect.stringContaining('two-letter') },
      },
    });
    expect(findEvents).not.toHaveBeenCalled();
  });

  /* ----------------------------------------------------------------------- *
   * #2 — recurring events expose window-intersected occurrenceDates + isRecurring
   * ----------------------------------------------------------------------- */

  it('passes occurrenceDates and isRecurring through, leaving the stale anchor date intact', async () => {
    findEvents.mockResolvedValueOnce(
      makeResult({
        data: [
          makeEvent({
            isRecurring: true,
            occurrenceDates: ['2026-08-01', '2026-08-08'],
            dateStart: '2026-05-24',
            dateEnd: '2026-05-24',
          }),
        ],
      }),
    );
    const input = npsFindEvents.input.parse({
      parkCode: 'yell',
      dateStart: '2026-08-01',
      dateEnd: '2026-08-31',
    });
    const result = await npsFindEvents.handler(input, ctx);
    expect(result.events[0]!.isRecurring).toBe(true);
    expect(result.events[0]!.occurrenceDates).toEqual(['2026-08-01', '2026-08-08']);
    // dateStart stays the record's anchor (the misleading May value #2 is about).
    expect(result.events[0]!.dateStart).toBe('2026-05-24');
  });

  it('format() renders the recurring marker and the occurrence dates', () => {
    const blocks = npsFindEvents.format!({
      events: [makeEvent({ isRecurring: true, occurrenceDates: ['2026-08-01', '2026-08-08'] })],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toMatch(/Recurring event/);
    expect(text).toContain('2026-08-01');
    expect(text).toContain('2026-08-08');
  });

  /* ----------------------------------------------------------------------- *
   * #12 — a date in the wrong shape gets invalid_date and its declared
   * recovery, the same answer as an impossible calendar date, instead of the
   * schema's -32602 invalid_arguments. Asserted through runToolContract, which
   * runs the same argument parse the production handler factory does.
   * ----------------------------------------------------------------------- */

  describe('date validation on the client surfaces', () => {
    it.each([
      ['dateStart', { parkCode: 'yell', dateStart: '08/01/2026' }, '08/01/2026'],
      [
        'dateEnd',
        { parkCode: 'yell', dateStart: '2026-08-01', dateEnd: '2026/08/03' },
        '2026/08/03',
      ],
    ])('rejects a non-YYYY-MM-DD %s as invalid_date', async (field, args, value) => {
      const result = await runToolContract(npsFindEvents, args);

      expect(result.isError).toBe(true);
      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_date');
      expect(error.message).toBe(`${field} "${value}" is not in YYYY-MM-DD format.`);
      expect(contentText(result as never)).toMatch(
        /^Recovery: Provide dates as real YYYY-MM-DD calendar dates/m,
      );
      expect(findEvents).not.toHaveBeenCalled();
    });

    it.each([
      ['an impossible calendar date', { parkCode: 'yell', dateStart: '2026-02-31' }],
      [
        'dateEnd before dateStart',
        { parkCode: 'yell', dateStart: '2026-07-06', dateEnd: '2026-07-04' },
      ],
    ])('still rejects %s as invalid_date', async (_, args) => {
      const result = await runToolContract(npsFindEvents, args);

      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_date');
      expect(contentText(result as never)).toMatch(/^Recovery: /m);
      expect(findEvents).not.toHaveBeenCalled();
    });

    it('treats an empty-string dateStart from a form client as omitted', async () => {
      findEvents.mockResolvedValueOnce(makeResult());
      const result = await runToolContract(npsFindEvents, {
        parkCode: 'yell',
        dateStart: '',
        dateEnd: '2026-08-03',
      });

      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { appliedFilters: string }).appliedFilters).toBe(
        'parkCode=yell, dates=today to 2026-08-03',
      );
    });

    it('accepts a valid date window (control)', async () => {
      findEvents.mockResolvedValueOnce(makeResult());
      const result = await runToolContract(npsFindEvents, {
        parkCode: 'yell',
        dateStart: '2026-08-01',
        dateEnd: '2026-08-03',
      });

      expect(result.isError).toBeFalsy();
      expect(findEvents).toHaveBeenCalledWith(
        expect.objectContaining({ dateStart: '2026-08-01', dateEnd: '2026-08-03' }),
        expect.anything(),
      );
    });

    it('advertises the date and code formats in prose, not as schema patterns', () => {
      const schema = JSON.stringify(npsFindEvents.input.toJSONSchema());
      expect(schema).not.toContain('"pattern"');
      expect(schema).toContain('(YYYY-MM-DD)');
    });
  });

  /* ----------------------------------------------------------------------- *
   * #9 — the truncated flag reaches both client surfaces. Asserted on the
   * runToolContract result: getEnrichment() reads the raw store, which holds
   * truncated: true even when the output parse strips it.
   * ----------------------------------------------------------------------- */

  describe('truncated flag on the client surfaces', () => {
    it.each([
      [1, 2],
      [2, 3],
    ])('sets truncated on page %i of 3 and names pageNumber=%i', async (pageNumber, next) => {
      findEvents.mockResolvedValueOnce(makeResult({ total: 3, data: [makeEvent()] }));
      const result = await runToolContract(npsFindEvents, {
        parkCode: 'yell',
        pageSize: 1,
        pageNumber,
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(true);
      expect(sc).toMatchObject({
        totalCount: 3,
        shown: 1,
        cap: 1,
        appliedFilters: 'parkCode=yell, dates=upcoming',
        notice: expect.stringContaining(`pageNumber=${next}`),
      });
      const text = contentText(result as never);
      expect(text).toContain('**Truncated:** true');
      expect(text).toContain('**3 total**');
      expect(text).toContain('**Shown:** 1');
      expect(text).toContain('**Page Size:** 1');
      expect(text).toContain('**Filters:** parkCode=yell, dates=upcoming');
      expect(text).toContain(`Request the next page with pageNumber=${next}.`);
    });

    it.each([
      ['the last page', { parkCode: 'yell', pageSize: 1, pageNumber: 3 }, 3],
      ['a single complete page', { parkCode: 'yell', pageSize: 50 }, 1],
    ])('omits truncated from both surfaces on %s — absent, never false', async (_, args, total) => {
      findEvents.mockResolvedValueOnce(makeResult({ total, data: [makeEvent()] }));
      const result = await runToolContract(npsFindEvents, args);

      const sc = result.structuredContent as Record<string, unknown>;
      expect('truncated' in sc).toBe(false);
      expect('shown' in sc).toBe(false);
      expect('cap' in sc).toBe(false);
      expect('notice' in sc).toBe(false);
      expect(sc.totalCount).toBe(total);
      const text = contentText(result as never);
      expect(text).not.toMatch(/truncated/i);
      expect(text).toContain(`**${total} total**`);
    });
  });
});
