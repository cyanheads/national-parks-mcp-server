/**
 * @fileoverview Tests for the nps_get_alerts tool — recency sort, category
 * breakdown, the local category filter, the empty-is-good-news notice, and format().
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
});
