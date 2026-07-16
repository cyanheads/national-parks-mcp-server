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

  it('format() renders the full activity list, not a head-8 (structured/text parity)', () => {
    // structuredContent carries every activity; the text channel used to cap at 8
    // ("+ N more"), silently showing content[]-only clients fewer than exist.
    const activities = Array.from({ length: 13 }, (_, i) => `Activity ${i + 1}`);
    const blocks = npsFindParks.format!({ parks: [makePark({ activities })] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    for (const a of activities) expect(text).toContain(a);
    expect(text).not.toMatch(/\+ \d+ more/);
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

  /* ----------------------------------------------------------------------- *
   * #4 — relevance ranking
   * ----------------------------------------------------------------------- */

  it('fetches the whole matched set from offset 0 when a query is set (to rank it)', async () => {
    findParks.mockResolvedValueOnce({ total: 3, data: [makePark()] });
    const input = npsFindParks.input.parse({ query: 'yosemite', limit: 5, start: 0 });
    await npsFindParks.handler(input, ctx);

    // A query needs the full set ranked before the page is sliced — never the
    // caller's limit, never a non-zero start passed upstream.
    expect(findParks).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'yosemite', limit: 1000, start: 0 }),
      ctx,
    );
  });

  it('ranks the exact name match ahead of description-only matches (the "yosemite" bug)', async () => {
    // Live upstream order is alphabetical-by-code: depo, wrst, yose — only yose
    // matches in its name; the other two match on their description alone.
    findParks.mockResolvedValueOnce({
      total: 3,
      data: [
        makePark({ parkCode: 'depo', fullName: 'Devils Postpile National Monument' }),
        makePark({ parkCode: 'wrst', fullName: 'Wrangell - St Elias National Park & Preserve' }),
        makePark({ parkCode: 'yose', fullName: 'Yosemite National Park' }),
      ],
    });
    const input = npsFindParks.input.parse({ query: 'yosemite' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks.map((p) => p.parkCode)).toEqual(['yose', 'depo', 'wrst']);
  });

  it('orders by tier: exact code > exact name > name prefix > name substring > description', async () => {
    // Scrambled upstream; the ranker sorts into strict tier order, preserving
    // upstream order within a tier.
    findParks.mockResolvedValueOnce({
      total: 5,
      data: [
        makePark({ parkCode: 'zzzz', fullName: 'Nowhere National Park' }), // desc-only (tier 4)
        makePark({ parkCode: 'blca', fullName: 'Black Canyon of the Gunnison NP' }), // mid-name (tier 3)
        makePark({ parkCode: 'cany', fullName: 'Canyonlands National Park' }), // exact code (tier 0)
        makePark({ parkCode: 'cdch', fullName: 'Canyon de Chelly National Monument' }), // prefix (tier 2)
        makePark({ parkCode: 'xxxx', fullName: 'Cany' }), // exact name (tier 1)
      ],
    });
    const input = npsFindParks.input.parse({ query: 'cany', limit: 10 });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks.map((p) => p.parkCode)).toEqual(['cany', 'xxxx', 'cdch', 'blca', 'zzzz']);
  });

  it('preserves upstream order within a tier (two parks both prefixing the query)', async () => {
    // "glacier" → both Glacier Bay and Glacier start with the term; neither wins
    // on a finer signal, so NPS's order (glba before glac) is kept.
    findParks.mockResolvedValueOnce({
      total: 3,
      data: [
        makePark({ parkCode: 'cajo', fullName: 'Captain John Smith Chesapeake NHT' }), // desc-only
        makePark({ parkCode: 'glba', fullName: 'Glacier Bay National Park & Preserve' }), // prefix
        makePark({ parkCode: 'glac', fullName: 'Glacier National Park' }), // prefix
      ],
    });
    const input = npsFindParks.input.parse({ query: 'glacier' });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks.map((p) => p.parkCode)).toEqual(['glba', 'glac', 'cajo']);
  });

  it('surfaces an exact match sitting beyond the first page (ranks the full set, not the page)', async () => {
    // Mirrors "grand canyon": 12 description-only sites sort alphabetically ahead
    // of grca, so a page-scoped rank (limit 10) would never see the name match and
    // grca would land on page 2. Ranking the whole matched set surfaces it to #1.
    const descOnly = Array.from({ length: 12 }, (_, i) =>
      makePark({ parkCode: `d${String(i).padStart(3, '0')}`, fullName: `Bandelier Site ${i}` }),
    );
    const grca = makePark({ parkCode: 'grca', fullName: 'Grand Canyon National Park' });
    findParks.mockResolvedValueOnce({ total: 13, data: [...descOnly, grca] });
    const input = npsFindParks.input.parse({ query: 'grand canyon', limit: 10 });
    const result = await npsFindParks.handler(input, ctx);

    expect(result.parks).toHaveLength(10);
    expect(result.parks[0].parkCode).toBe('grca');
    expect(getEnrichment(ctx).totalCount).toBe(13);
    // A page-only ranker would have returned the 12 desc sites and hidden grca.
    expect(result.parks.map((p) => p.parkCode)).not.toContain('d011');
  });

  /* ----------------------------------------------------------------------- *
   * #3 — invalid stateCode surfaces the declared recovery hint (not raw Zod)
   * ----------------------------------------------------------------------- */

  it('rejects a non-two-letter stateCode with the declared recovery hint, before any upstream call', async () => {
    const input = npsFindParks.input.parse({ stateCode: 'California' });
    await expect(npsFindParks.handler(input, ctx)).rejects.toMatchObject({
      data: {
        reason: 'invalid_state_code',
        recovery: { hint: expect.stringContaining('two-letter') },
      },
    });
    expect(findParks).not.toHaveBeenCalled();
  });

  it('accepts a valid comma-separated stateCode list', async () => {
    findParks.mockResolvedValueOnce({ total: 1, data: [makePark()] });
    const input = npsFindParks.input.parse({ stateCode: 'WY,MT,ID' });
    await npsFindParks.handler(input, ctx);
    expect(findParks).toHaveBeenCalled();
  });
});
