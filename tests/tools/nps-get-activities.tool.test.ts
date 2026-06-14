/**
 * @fileoverview Tests for the nps_get_activities tool — the required-filter guard,
 * the headline path, the empty-result notice, and format().
 * @module tests/tools/nps-get-activities.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsGetActivities } from '@/mcp-server/tools/definitions/nps-get-activities.tool.js';
import type { NpsThingToDo } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

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
  let ctx: ReturnType<typeof createMockContext>;
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
    expect(result.activities[0].title).toMatch(/Sunrise/);
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
    expect(result.activities[0].parkCode).toBeNull();
    expect(result.activities[0].duration).toBeNull();
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
});
