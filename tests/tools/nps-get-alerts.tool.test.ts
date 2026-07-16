/**
 * @fileoverview Tests for the nps_get_alerts tool — recency sort, category
 * breakdown, the local category filter, the empty-is-good-news notice, and format().
 * Also locks the two-mode fetch: a local `category` filter forces a whole-corpus
 * pull sliced locally, because an upstream `start` would skip records before the
 * filter ever saw them.
 * @module tests/tools/nps-get-alerts.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsGetAlerts } from '@/mcp-server/tools/definitions/nps-get-alerts.tool.js';
import type { NpsAlert } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

function makeAlert(overrides?: Partial<NpsAlert>): NpsAlert {
  return {
    id: 'a1',
    parkCode: 'glac',
    category: 'Park Closure',
    title: 'Road closed',
    description: 'Seasonal closure.',
    url: 'https://www.nps.gov/glac/alert',
    lastIndexedDate: '2026-05-30',
    ...overrides,
  };
}

describe('nps_get_alerts', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const getAlerts = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsGetAlerts.errors });
    vi.mocked(getNpsService).mockReturnValue({ getAlerts } as never);
    getAlerts.mockReset();
  });

  it('returns alerts sorted most-recent-first with a category breakdown', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 2,
      data: [
        makeAlert({ id: 'old', lastIndexedDate: '2026-01-01', category: 'Caution' }),
        makeAlert({ id: 'new', lastIndexedDate: '2026-06-01', category: 'Park Closure' }),
      ],
    });
    const input = npsGetAlerts.input.parse({ parkCode: 'glac' });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts.map((a) => a.id)).toEqual(['new', 'old']);
    expect(getEnrichment(ctx).categoryBreakdown).toMatch(/Park Closure: 1/);
    expect(getEnrichment(ctx).categoryBreakdown).toMatch(/Caution: 1/);
  });

  it('filters by category locally', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 2,
      data: [
        makeAlert({ id: 'closure', category: 'Park Closure' }),
        makeAlert({ id: 'info', category: 'Information' }),
      ],
    });
    const input = npsGetAlerts.input.parse({ parkCode: 'glac', category: 'Park Closure' });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts.map((a) => a.id)).toEqual(['closure']);
  });

  it('frames an empty result as good news, not an error', async () => {
    getAlerts.mockResolvedValueOnce({ total: 0, data: [] });
    const input = npsGetAlerts.input.parse({ parkCode: 'glac' });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts).toEqual([]);
    expect(getEnrichment(ctx).notice).toMatch(/nothing closed or hazardous/);
  });

  it('does not set truncation fields on a full (non-capped) result', async () => {
    getAlerts.mockResolvedValueOnce({ total: 1, data: [makeAlert()] });
    const input = npsGetAlerts.input.parse({ parkCode: 'glac', limit: 20 });
    await npsGetAlerts.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1);
    expect(enrichment.shown).toBeUndefined();
  });

  it('handles a sparse alert (null url, null date)', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 1,
      data: [makeAlert({ url: null, lastIndexedDate: null })],
    });
    const input = npsGetAlerts.input.parse({ parkCode: 'glac' });
    const result = await npsGetAlerts.handler(input, ctx);
    expect(result.alerts[0].url).toBeNull();
    expect(result.alerts[0].lastIndexedDate).toBeNull();
  });

  it('format() leads with category and renders recency', () => {
    const blocks = npsGetAlerts.format!({ alerts: [makeAlert()] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('[Park Closure]');
    expect(text).toContain('2026-05-30');
  });

  it('format() defers an empty result to the notice instead of declaring an all-clear', () => {
    // format() is handed the domain payload alone, so totalCount is out of reach
    // and an empty array could be a genuine all-clear or a page past the end.
    // Guessing wrong here puts a safety all-clear above active closures.
    const blocks = npsGetAlerts.format!({ alerts: [] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).not.toMatch(/closed or hazardous/);
    expect(text).toMatch(/See the notice/);
  });

  /* ----------------------------------------------------------------------- *
   * #6 — start pagination
   * ----------------------------------------------------------------------- */

  it('passes start/limit straight upstream when no local filter is active', async () => {
    getAlerts.mockResolvedValueOnce({ total: 58, data: [makeAlert({ id: 'page2' })] });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA', limit: 20, start: 40 });
    await npsGetAlerts.handler(input, ctx);

    expect(getAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ stateCode: 'CA', limit: 20, start: 40 }),
      ctx,
    );
  });

  it('names the next start in the truncation guidance', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 58,
      data: Array.from({ length: 20 }, (_, i) => makeAlert({ id: `a${i}` })),
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA', limit: 20, start: 20 });
    await npsGetAlerts.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('start=40');
  });

  it('does not claim a next page when the last page lands exactly on the total', async () => {
    // start=50 + 8 returned === total 58: nothing follows, so no truncation and
    // no "next page" guidance. The pre-start-aware test (total > shown) misfired here.
    getAlerts.mockResolvedValueOnce({
      total: 58,
      data: Array.from({ length: 8 }, (_, i) => makeAlert({ id: `tail${i}` })),
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA', limit: 20, start: 50 });
    await npsGetAlerts.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.shown).toBeUndefined();
    expect(enrichment.notice).toBeUndefined();
  });

  /* ----------------------------------------------------------------------- *
   * #1 — local filter vs. pagination
   * ----------------------------------------------------------------------- */

  it('fetches the whole corpus from offset 0 when category filtering', async () => {
    getAlerts.mockResolvedValueOnce({ total: 3, data: [makeAlert()] });
    const input = npsGetAlerts.input.parse({
      stateCode: 'CA',
      category: 'Park Closure',
      limit: 1,
      start: 0,
    });
    await npsGetAlerts.handler(input, ctx);

    // Never the caller's limit, never a non-zero start: an upstream offset would
    // skip records the local filter never gets to see.
    expect(getAlerts).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000, start: 0 }), ctx);
  });

  it('finds a match that a small limit would have hidden behind non-matching records', async () => {
    // Mirrors the live CA/"Park Closure" shape: the newest record is a Caution,
    // so a limit:1 upstream page contained no closure at all and the tool
    // reported "nothing closed or hazardous" while closures were active.
    getAlerts.mockResolvedValueOnce({
      total: 3,
      data: [
        makeAlert({ id: 'caution', category: 'Caution', lastIndexedDate: '2026-06-03' }),
        makeAlert({
          id: 'closure-hidden',
          category: 'Park Closure',
          lastIndexedDate: '2026-06-02',
        }),
        makeAlert({ id: 'info', category: 'Information', lastIndexedDate: '2026-06-01' }),
      ],
    });
    const input = npsGetAlerts.input.parse({
      stateCode: 'CA',
      category: 'Park Closure',
      limit: 1,
    });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts.map((a) => a.id)).toEqual(['closure-hidden']);
    // The whole point: no reassuring "nothing closed" notice while a closure is active.
    expect(getEnrichment(ctx).notice).toBeUndefined();
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('reports totalCount as the true post-filter total, not the returned page size', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 5,
      data: [
        makeAlert({ id: 'c1', category: 'Park Closure', lastIndexedDate: '2026-06-05' }),
        makeAlert({ id: 'x1', category: 'Caution', lastIndexedDate: '2026-06-04' }),
        makeAlert({ id: 'c2', category: 'Park Closure', lastIndexedDate: '2026-06-03' }),
        makeAlert({ id: 'x2', category: 'Information', lastIndexedDate: '2026-06-02' }),
        makeAlert({ id: 'c3', category: 'Park Closure', lastIndexedDate: '2026-06-01' }),
      ],
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA', category: 'Park Closure', limit: 2 });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts.map((a) => a.id)).toEqual(['c1', 'c2']);
    // 3 closures matched corpus-wide; the old code collapsed this to 2 (the page
    // size), which also made the truncation disclosure unreachable.
    expect(getEnrichment(ctx).totalCount).toBe(3);
    expect(getEnrichment(ctx).notice).toContain('start=2');
  });

  it('slices the filtered set locally so start pages within the matches', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 5,
      data: [
        makeAlert({ id: 'c1', category: 'Park Closure', lastIndexedDate: '2026-06-05' }),
        makeAlert({ id: 'x1', category: 'Caution', lastIndexedDate: '2026-06-04' }),
        makeAlert({ id: 'c2', category: 'Park Closure', lastIndexedDate: '2026-06-03' }),
        makeAlert({ id: 'x2', category: 'Information', lastIndexedDate: '2026-06-02' }),
        makeAlert({ id: 'c3', category: 'Park Closure', lastIndexedDate: '2026-06-01' }),
      ],
    });
    const input = npsGetAlerts.input.parse({
      stateCode: 'CA',
      category: 'Park Closure',
      limit: 1,
      start: 1,
    });
    const result = await npsGetAlerts.handler(input, ctx);

    // start=1 is the 2nd *closure*, not the 2nd raw record (which is a Caution).
    expect(result.alerts.map((a) => a.id)).toEqual(['c2']);
    expect(getEnrichment(ctx).totalCount).toBe(3);
  });

  it('discloses a best-effort match when the corpus outgrew the fetch limit', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 5000,
      data: Array.from({ length: 1000 }, (_, i) =>
        makeAlert({ id: `a${i}`, category: i === 0 ? 'Park Closure' : 'Caution' }),
      ),
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA', category: 'Park Closure' });
    await npsGetAlerts.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('first 1000 of 5000');
    expect(notice).toContain('best-effort');
  });

  /* ----------------------------------------------------------------------- *
   * #7 — one ordering contract across both client surfaces
   * ----------------------------------------------------------------------- */

  it('renders format() rows in the handler order (recency), not category order', async () => {
    getAlerts.mockResolvedValueOnce({
      total: 3,
      data: [
        makeAlert({
          id: 'old-closure',
          category: 'Park Closure',
          title: 'Old closure',
          lastIndexedDate: '2026-01-01',
        }),
        makeAlert({
          id: 'new-caution',
          category: 'Caution',
          title: 'New caution',
          lastIndexedDate: '2026-06-01',
        }),
        makeAlert({
          id: 'mid-info',
          category: 'Information',
          title: 'Mid info',
          lastIndexedDate: '2026-03-01',
        }),
      ],
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA' });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts.map((a) => a.id)).toEqual(['new-caution', 'mid-info', 'old-closure']);

    const text = npsGetAlerts.format!(result)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    const headings = [...text.matchAll(/^### \[(.+?)\] (.+)$/gm)].map((m) => `${m[1]}|${m[2]}`);

    // A CATEGORY_ORDER re-sort in format() would hoist "Old closure" to row 1,
    // handing content[] clients a different order than structuredContent.
    expect(headings).toEqual([
      'Caution|New caution',
      'Information|Mid info',
      'Park Closure|Old closure',
    ]);
  });

  it('never reports an all-clear for an empty page past the end of the matches', async () => {
    // totalCount=3 with "nothing closed or hazardous" is the same false-empty
    // reassurance the page-scoped filter used to produce — just reached by
    // over-paging instead. The notice must name the paging artifact.
    getAlerts.mockResolvedValueOnce({
      total: 3,
      data: [
        makeAlert({ id: 'c1', category: 'Park Closure', lastIndexedDate: '2026-06-03' }),
        makeAlert({ id: 'c2', category: 'Park Closure', lastIndexedDate: '2026-06-02' }),
        makeAlert({ id: 'c3', category: 'Park Closure', lastIndexedDate: '2026-06-01' }),
      ],
    });
    const input = npsGetAlerts.input.parse({
      stateCode: 'CA',
      category: 'Park Closure',
      limit: 5,
      start: 20,
    });
    const result = await npsGetAlerts.handler(input, ctx);

    expect(result.alerts).toEqual([]);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(3);
    expect(enrichment.notice).not.toMatch(/nothing closed or hazardous/);
    expect(enrichment.notice).toContain('start=20 is past the end of 3');
    expect(enrichment.notice).toContain('not an all-clear');
  });

  it('still reports a genuine absence as good news', async () => {
    getAlerts.mockResolvedValueOnce({ total: 0, data: [] });
    const input = npsGetAlerts.input.parse({ parkCode: 'jeff', category: 'Danger', start: 0 });
    await npsGetAlerts.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toMatch(/nothing closed or hazardous/);
  });

  it('reconstructs a full page from two half pages, by row identity', async () => {
    const corpus = {
      total: 5,
      data: [
        makeAlert({ id: 'c1', category: 'Park Closure', lastIndexedDate: '2026-06-05' }),
        makeAlert({ id: 'x1', category: 'Caution', lastIndexedDate: '2026-06-04' }),
        makeAlert({ id: 'c2', category: 'Park Closure', lastIndexedDate: '2026-06-03' }),
        makeAlert({ id: 'x2', category: 'Information', lastIndexedDate: '2026-06-02' }),
        makeAlert({ id: 'c3', category: 'Park Closure', lastIndexedDate: '2026-06-01' }),
      ],
    };
    getAlerts.mockResolvedValue(corpus);
    const call = async (start: number, limit: number) =>
      (
        await npsGetAlerts.handler(
          npsGetAlerts.input.parse({ stateCode: 'CA', category: 'Park Closure', start, limit }),
          createMockContext({ errors: npsGetAlerts.errors }),
        )
      ).alerts.map((a) => a.id);

    const pageA = await call(0, 1);
    const pageB = await call(1, 1);
    const full = await call(0, 2);

    expect([...pageA, ...pageB]).toEqual(full);
    expect(full).toEqual(['c1', 'c2']);
    // No record is skipped or repeated across the page boundary.
    expect(await call(0, 3)).toEqual(['c1', 'c2', 'c3']);
  });

  it('keeps the categoryBreakdown summary in severity order', async () => {
    // breakdown() has its own CATEGORY_ORDER sort — a distinct summary field,
    // deliberately severity-ordered even though the alerts listing is not.
    getAlerts.mockResolvedValueOnce({
      total: 2,
      data: [
        makeAlert({ id: 'i1', category: 'Information', lastIndexedDate: '2026-06-02' }),
        makeAlert({ id: 'c1', category: 'Park Closure', lastIndexedDate: '2026-06-01' }),
      ],
    });
    const input = npsGetAlerts.input.parse({ stateCode: 'CA' });
    await npsGetAlerts.handler(input, ctx);

    expect(getEnrichment(ctx).categoryBreakdown).toBe('Park Closure: 1, Information: 1');
  });
});
