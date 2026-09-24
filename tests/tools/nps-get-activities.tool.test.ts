/**
 * @fileoverview Tests for the nps_get_activities tool — the required-filter guard,
 * handler-level code validation, the headline path, the empty-result notice,
 * truncation on both client surfaces, and format().
 * @module tests/tools/nps-get-activities.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsGetActivities } from '@/mcp-server/tools/definitions/nps-get-activities.tool.js';
import type { NpsThingToDo } from '@/services/nps/types.js';

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

function makeActivity(overrides?: Partial<NpsThingToDo>): NpsThingToDo {
  return {
    id: 't1',
    title: 'Watch the Sunrise from Cadillac Mountain',
    parkCode: 'acad',
    shortDescription: 'See the first light of day.',
    location: 'Cadillac Mountain',
    latitude: 44.35,
    longitude: -68.22,
    duration: '1-3 Hours',
    reservationRequired: true,
    feeDescription: 'Vehicle reservation required.',
    petsPermitted: false,
    accessibility: 'Paved summit path.',
    season: ['Summer', 'Fall'],
    url: 'https://www.nps.gov/thingstodo/sunrise',
    ...overrides,
  };
}

describe('nps_get_activities', () => {
  let ctx: ReturnType<typeof createMockContext<typeof npsGetActivities.errors>>;
  const getThingsToDo = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsGetActivities.errors });
    vi.mocked(getNpsService).mockReturnValue({ getThingsToDo } as never);
    getThingsToDo.mockReset();
  });

  it('returns curated activities for a park', async () => {
    getThingsToDo.mockResolvedValueOnce({ total: 1, data: [makeActivity()] });
    const input = npsGetActivities.input.parse({ parkCode: 'acad' });
    const result = await npsGetActivities.handler(input, ctx);

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.title).toMatch(/Sunrise/);
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('throws missing_filter when neither parkCode nor stateCode is given', async () => {
    const input = npsGetActivities.input.parse({ query: 'sunrise' });
    await expect(npsGetActivities.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'missing_filter' },
    });
    expect(getThingsToDo).not.toHaveBeenCalled();
  });

  it('emits an empty-result notice pointing at nps_get_park', async () => {
    getThingsToDo.mockResolvedValueOnce({ total: 0, data: [] });
    const input = npsGetActivities.input.parse({ parkCode: 'aaaa' });
    const result = await npsGetActivities.handler(input, ctx);

    expect(result.activities).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/nps_get_park/);
  });

  it('handles a sparse activity (null parkCode/location/duration)', async () => {
    getThingsToDo.mockResolvedValueOnce({
      total: 1,
      data: [makeActivity({ parkCode: null, location: null, duration: null, season: [] })],
    });
    const input = npsGetActivities.input.parse({ stateCode: 'ME' });
    const result = await npsGetActivities.handler(input, ctx);
    expect(result.activities[0]!.parkCode).toBeNull();
    expect(result.activities[0]!.duration).toBeNull();
  });

  it('format() renders the id and reservation/pets flags (incl. negatives)', () => {
    const blocks = npsGetActivities.format!({
      activities: [makeActivity({ reservationRequired: false, petsPermitted: false })],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('t1');
    expect(text).toMatch(/Reservation required:\*\* No/);
    expect(text).toMatch(/Pets:\*\* Not permitted/);
  });

  /* ----------------------------------------------------------------------- *
   * #12 — a malformed code gets the declared reason and recovery, not the
   * schema's -32602 invalid_arguments. Asserted through runToolContract, which
   * runs the same argument parse the production handler factory does.
   * ----------------------------------------------------------------------- */

  describe('code validation on the client surfaces', () => {
    it.each([
      ['a mixed-case code', { parkCode: 'Yose' }],
      ['a comma list', { parkCode: 'acad,yose' }],
    ])('rejects %s as invalid_park_code with a single-code recovery', async (_, args) => {
      const result = await runToolContract(npsGetActivities, args);

      expect(result.isError).toBe(true);
      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_park_code');
      expect(error.message).toContain(args.parkCode);
      const text = contentText(result as never);
      expect(text).toMatch(/^Recovery: .*nps_find_parks/m);
      expect(text).not.toMatch(/comma-separated/);
      expect(getThingsToDo).not.toHaveBeenCalled();
    });

    it('rejects a three-letter stateCode as invalid_state_code with a single-code recovery', async () => {
      const result = await runToolContract(npsGetActivities, { stateCode: 'Cal' });

      expect(result.isError).toBe(true);
      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_state_code');
      expect(error.message).toContain('"Cal"');
      const text = contentText(result as never);
      expect(text).toMatch(/^Recovery: .*two-letter/m);
      expect(text).not.toMatch(/comma-separated/);
      expect(getThingsToDo).not.toHaveBeenCalled();
    });

    it.each([
      ['parkCode', { parkCode: '' }],
      ['stateCode', { stateCode: '' }],
    ])('treats an empty-string %s as omitted (missing_filter)', async (_, args) => {
      const result = await runToolContract(npsGetActivities, args);

      expect(result.isError).toBe(true);
      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.data?.reason).toBe('missing_filter');
      expect(getThingsToDo).not.toHaveBeenCalled();
    });

    it('queries by stateCode alone when a form client sends an empty parkCode beside it', async () => {
      getThingsToDo.mockResolvedValueOnce({ total: 1, data: [makeActivity()] });
      const result = await runToolContract(npsGetActivities, { parkCode: '', stateCode: 'ME' });

      expect(result.isError).toBeFalsy();
      expect(getThingsToDo).toHaveBeenCalledWith(
        expect.objectContaining({ parkCode: '', stateCode: 'ME' }),
        expect.anything(),
      );
      expect((result.structuredContent as { appliedFilters: string }).appliedFilters).toBe(
        'stateCode=ME',
      );
    });

    it('accepts a valid single parkCode (control)', async () => {
      getThingsToDo.mockResolvedValueOnce({ total: 1, data: [makeActivity()] });
      const result = await runToolContract(npsGetActivities, { parkCode: 'acad' });

      expect(result.isError).toBeFalsy();
      expect(getThingsToDo).toHaveBeenCalledOnce();
    });

    it('advertises the code formats in prose, not as schema patterns', () => {
      const schema = JSON.stringify(npsGetActivities.input.toJSONSchema());
      expect(schema).not.toContain('"pattern"');
      expect(schema).toContain('single 4-letter lowercase park code');
      expect(schema).toContain('single two-letter state code');
    });
  });

  /* ----------------------------------------------------------------------- *
   * #9 — the truncated flag reaches both client surfaces. Asserted on the
   * runToolContract result: getEnrichment() reads the raw store, which holds
   * truncated: true even when the output parse strips it.
   * ----------------------------------------------------------------------- */

  describe('truncated flag on the client surfaces', () => {
    it('sets structuredContent.truncated and a Truncated trailer line on a capped page', async () => {
      getThingsToDo.mockResolvedValueOnce({
        total: 89,
        data: [makeActivity({ id: 't1' }), makeActivity({ id: 't2' })],
      });
      const result = await runToolContract(npsGetActivities, { parkCode: 'acad', limit: 2 });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(true);
      expect(sc).toMatchObject({
        totalCount: 89,
        shown: 2,
        cap: 2,
        appliedFilters: 'parkCode=acad',
        notice: expect.stringContaining('start=2'),
      });
      const text = contentText(result as never);
      expect(text).toContain('**Truncated:** true');
      expect(text).toContain('**89 total**');
      expect(text).toContain('**Shown:** 2');
      expect(text).toContain('**Limit:** 2');
      expect(text).toContain('**Filters:** parkCode=acad');
      expect(text).toContain('Request the next page with start=2.');
    });

    it('omits truncated from both surfaces on a complete result — absent, never false', async () => {
      getThingsToDo.mockResolvedValueOnce({ total: 1, data: [makeActivity()] });
      const result = await runToolContract(npsGetActivities, { parkCode: 'acad', limit: 50 });

      const sc = result.structuredContent as Record<string, unknown>;
      expect('truncated' in sc).toBe(false);
      expect('shown' in sc).toBe(false);
      expect('cap' in sc).toBe(false);
      expect('notice' in sc).toBe(false);
      expect(sc.totalCount).toBe(1);
      const text = contentText(result as never);
      expect(text).not.toMatch(/truncated/i);
      expect(text).toContain('**1 total**');
    });
  });
});
