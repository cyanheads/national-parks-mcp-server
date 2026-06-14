/**
 * @fileoverview Tests for the nps_find_parks tool — headline resolve path, the
 * local activity filter, truncation-field optionality, the empty-result notice,
 * and format() completeness.
 * @module tests/tools/nps-find-parks.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindParks } from '@/mcp-server/tools/definitions/nps-find-parks.tool.js';
import type { NpsParkSummary } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

function makePark(overrides?: Partial<NpsParkSummary>): NpsParkSummary {
  return {
    parkCode: 'yose',
    fullName: 'Yosemite National Park',
    designation: 'National Park',
    states: 'CA',
    description: 'Granite cliffs and waterfalls.',
    latitude: 37.85,
    longitude: -119.56,
    activities: ['Hiking', 'Camping'],
    entranceFee: '35.00',
    url: 'https://www.nps.gov/yose/',
    ...overrides,
  };
}

describe('nps_find_parks', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const findParks = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsFindParks.errors });
    vi.mocked(getNpsService).mockReturnValue({ findParks } as never);
    findParks.mockReset();
  });

  it('resolves a query to parks carrying the parkCode spine', async () => {
    findParks.mockResolvedValueOnce({ total: 1, data: [makePark()] });
    const input = npsFindParks.input.parse({ query: 'yosemite' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks).toHaveLength(1);
    expect(result.parks[0].parkCode).toBe('yose');
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('leaves truncation fields unset when nothing was capped (avoids -32007)', async () => {
    findParks.mockResolvedValueOnce({ total: 1, data: [makePark()] });
    const input = npsFindParks.input.parse({ query: 'yosemite', limit: 10 });
    await npsFindParks.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1);
    expect(enrichment.shown).toBeUndefined();
    expect(enrichment.cap).toBeUndefined();
  });

  it('discloses truncation when the matched total exceeds the returned page', async () => {
    findParks.mockResolvedValueOnce({ total: 50, data: [makePark()] });
    const input = npsFindParks.input.parse({ query: 'national', limit: 1 });
    await npsFindParks.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.shown).toBe(1);
    expect(enrichment.cap).toBe(1);
  });

  it('applies the activity filter locally over the returned page', async () => {
    findParks.mockResolvedValueOnce({
      total: 2,
      data: [
        makePark({ parkCode: 'yose', activities: ['Hiking', 'Stargazing'] }),
        makePark({ parkCode: 'grca', activities: ['Rafting'] }),
      ],
    });
    const input = npsFindParks.input.parse({ query: 'parks', activity: 'stargazing' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks.map((p) => p.parkCode)).toEqual(['yose']);
    expect(getEnrichment(ctx).appliedFilters).toMatch(/activity="stargazing"/);
  });

  it('returns an empty array with a notice — not an error — when nothing matches', async () => {
    findParks.mockResolvedValueOnce({ total: 0, data: [] });
    const input = npsFindParks.input.parse({ query: 'zzznotapark' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/US NPS sites only/);
  });

  it('handles a sparse park (null coordinates, no fee) without inventing values', async () => {
    findParks.mockResolvedValueOnce({
      total: 1,
      data: [makePark({ latitude: null, longitude: null, entranceFee: null, activities: [] })],
    });
    const input = npsFindParks.input.parse({ stateCode: 'WY' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks[0].latitude).toBeNull();
    expect(result.parks[0].entranceFee).toBeNull();
  });

  it('format() renders parkCode, fee, and coordinates', () => {
    const blocks = npsFindParks.format!({ parks: [makePark()] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('yose');
    expect(text).toContain('35.00');
    expect(text).toContain('37.85');
  });
});
