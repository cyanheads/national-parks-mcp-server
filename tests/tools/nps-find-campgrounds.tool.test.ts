/**
 * @fileoverview Tests for the nps_find_campgrounds tool — site-count and amenity
 * surfacing, the empty-result notice, truncation optionality, and format().
 * @module tests/tools/nps-find-campgrounds.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindCampgrounds } from '@/mcp-server/tools/definitions/nps-find-campgrounds.tool.js';
import type { NpsCampground } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

function makeCampground(overrides?: Partial<NpsCampground>): NpsCampground {
  return {
    id: 'c1',
    name: 'Watchman Campground',
    parkCode: 'zion',
    description: 'Near the south entrance.',
    latitude: 37.2,
    longitude: -112.98,
    totalSites: 176,
    reservableSites: 176,
    firstComeSites: 0,
    reservationInfo: 'Reserve at recreation.gov.',
    reservationUrl: 'https://recreation.gov',
    fee: '30.00',
    amenities: {
      potableWater: true,
      showers: false,
      dumpStation: true,
      rvAllowed: true,
      toilets: true,
      trashCollection: true,
    },
    accessibility: 'Accessible sites available.',
    url: 'https://www.nps.gov/zion/cg',
    ...overrides,
  };
}

describe('nps_find_campgrounds', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const findCampgrounds = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsFindCampgrounds.errors });
    vi.mocked(getNpsService).mockReturnValue({ findCampgrounds } as never);
    findCampgrounds.mockReset();
  });

  it('returns campgrounds with reservable/first-come counts and amenities', async () => {
    findCampgrounds.mockResolvedValueOnce({ total: 1, data: [makeCampground()] });
    const input = npsFindCampgrounds.input.parse({ parkCode: 'zion' });
    const result = await npsFindCampgrounds.handler(input, ctx);

    expect(result.campgrounds[0].reservableSites).toBe(176);
    expect(result.campgrounds[0].amenities.rvAllowed).toBe(true);
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('emits an empty-result notice rather than an error', async () => {
    findCampgrounds.mockResolvedValueOnce({ total: 0, data: [] });
    const input = npsFindCampgrounds.input.parse({ parkCode: 'aaaa' });
    const result = await npsFindCampgrounds.handler(input, ctx);

    expect(result.campgrounds).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/No campgrounds found/);
  });

  it('discloses truncation when the page is capped', async () => {
    findCampgrounds.mockResolvedValueOnce({
      total: 5,
      data: [makeCampground({ id: 'c1' })],
    });
    const input = npsFindCampgrounds.input.parse({ stateCode: 'UT', limit: 1 });
    await npsFindCampgrounds.handler(input, ctx);

    expect(getEnrichment(ctx).truncated).toBe(true);
    expect(getEnrichment(ctx).cap).toBe(1);
  });

  it('handles a sparse campground (null counts, all amenities false)', async () => {
    findCampgrounds.mockResolvedValueOnce({
      total: 1,
      data: [
        makeCampground({
          totalSites: null,
          reservableSites: null,
          firstComeSites: null,
          fee: null,
          accessibility: null,
          url: null,
          amenities: {
            potableWater: false,
            showers: false,
            dumpStation: false,
            rvAllowed: false,
            toilets: false,
            trashCollection: false,
          },
        }),
      ],
    });
    const input = npsFindCampgrounds.input.parse({ parkCode: 'zion' });
    const result = await npsFindCampgrounds.handler(input, ctx);
    expect(result.campgrounds[0].totalSites).toBeNull();
    expect(result.campgrounds[0].amenities.rvAllowed).toBe(false);
  });

  it('format() renders the id, site split, and RV-allowed state (incl. No)', () => {
    const blocks = npsFindCampgrounds.format!({
      campgrounds: [
        makeCampground({ amenities: { ...makeCampground().amenities, rvAllowed: false } }),
      ],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('c1');
    expect(text).toContain('176 reservable');
    expect(text).toMatch(/RV allowed: No/);
  });
});
