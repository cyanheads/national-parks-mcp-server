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

  it('applies the activity filter locally over the full matched set', async () => {
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

  /* ----------------------------------------------------------------------- *
   * #1 — local filter vs. pagination
   * ----------------------------------------------------------------------- */

  it('passes start/limit straight upstream when no activity filter is active', async () => {
    findParks.mockResolvedValueOnce({ total: 34, data: [makePark()] });
    const input = npsFindParks.input.parse({ stateCode: 'CA', limit: 10, start: 20 });
    await npsFindParks.handler(input, ctx);

    expect(findParks).toHaveBeenCalledWith(
      expect.objectContaining({ stateCode: 'CA', limit: 10, start: 20 }),
      ctx,
    );
  });

  it('fetches the whole matched set from offset 0 when activity filtering', async () => {
    findParks.mockResolvedValueOnce({ total: 1, data: [makePark()] });
    const input = npsFindParks.input.parse({
      stateCode: 'CA',
      activity: 'Stargazing',
      limit: 1,
      start: 0,
    });
    await npsFindParks.handler(input, ctx);

    // Never the caller's limit, never a non-zero start: an upstream offset would
    // skip records the local filter never gets to see.
    expect(findParks).toHaveBeenCalledWith(
      expect.objectContaining({ stateCode: 'CA', limit: 1000, start: 0 }),
      ctx,
    );
  });

  it('finds matches a small limit would have hidden behind non-matching parks', async () => {
    // Mirrors live CA data: the first sites in upstream order (alca, buov, cabr)
    // offer no stargazing, so a limit:1 upstream page filtered to empty and the
    // tool reported no matches — while 10 CA sites actually offer it.
    findParks.mockResolvedValueOnce({
      total: 4,
      data: [
        makePark({ parkCode: 'alca', activities: ['Guided Tours'] }),
        makePark({ parkCode: 'buov', activities: ['Hiking'] }),
        makePark({ parkCode: 'jotr', activities: ['Hiking', 'Stargazing'] }),
        makePark({ parkCode: 'deva', activities: ['Stargazing'] }),
      ],
    });
    const input = npsFindParks.input.parse({
      stateCode: 'CA',
      activity: 'Stargazing',
      limit: 1,
      start: 0,
    });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks.map((p) => p.parkCode)).toEqual(['jotr']);
    // Old behavior: parks: [], totalCount: 0, "no sites matched" notice.
    expect(getEnrichment(ctx).totalCount).toBe(2);
    expect(getEnrichment(ctx).notice).toContain('start=1');
  });

  it('slices the filtered set locally so start pages within the matches', async () => {
    findParks.mockResolvedValueOnce({
      total: 4,
      data: [
        makePark({ parkCode: 'alca', activities: ['Guided Tours'] }),
        makePark({ parkCode: 'jotr', activities: ['Stargazing'] }),
        makePark({ parkCode: 'buov', activities: ['Hiking'] }),
        makePark({ parkCode: 'deva', activities: ['Stargazing'] }),
      ],
    });
    const input = npsFindParks.input.parse({
      stateCode: 'CA',
      activity: 'Stargazing',
      limit: 1,
      start: 1,
    });
    const result = await npsFindParks.handler(input, ctx);

    // start=1 is the 2nd *match*, not the 2nd raw record (which offers no stargazing).
    expect(result.parks.map((p) => p.parkCode)).toEqual(['deva']);
    expect(getEnrichment(ctx).totalCount).toBe(2);
  });

  it('discloses a best-effort match when the corpus outgrew the fetch limit', async () => {
    findParks.mockResolvedValueOnce({
      total: 5000,
      data: Array.from({ length: 1000 }, (_, i) =>
        makePark({ parkCode: `p${i}`, activities: i === 0 ? ['Stargazing'] : ['Hiking'] }),
      ),
    });
    const input = npsFindParks.input.parse({ activity: 'Stargazing' });
    await npsFindParks.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('first 1000 of 5000');
    expect(notice).toContain('best-effort');
  });

  it('does not tell the agent to broaden a search that actually matched', async () => {
    // An empty page past the end is a paging artifact; "broaden the query"
    // would send the agent to fix the wrong thing while 2 sites match.
    findParks.mockResolvedValueOnce({
      total: 2,
      data: [
        makePark({ parkCode: 'jotr', activities: ['Stargazing'] }),
        makePark({ parkCode: 'deva', activities: ['Stargazing'] }),
      ],
    });
    const input = npsFindParks.input.parse({
      stateCode: 'CA',
      activity: 'Stargazing',
      limit: 5,
      start: 50,
    });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(2);
    expect(enrichment.notice).not.toMatch(/Broaden the query/);
    expect(enrichment.notice).toContain('start=50 is past the end of 2');
  });

  it('treats a whitespace-only activity from a form client as no filter', async () => {
    findParks.mockResolvedValueOnce({ total: 34, data: [makePark()] });
    const input = npsFindParks.input.parse({ stateCode: 'CA', activity: '   ', limit: 10 });
    await npsFindParks.handler(input, ctx);

    // No corpus pull, no filter, no bogus activity echo.
    expect(findParks).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }), ctx);
    expect(getEnrichment(ctx).appliedFilters).not.toMatch(/activity/);
  });
});
