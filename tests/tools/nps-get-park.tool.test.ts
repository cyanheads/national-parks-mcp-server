/**
 * @fileoverview Tests for the nps_get_park tool — batched detail, the missingCodes
 * cross-reference, the no_parks_found error, a sparse park, and format().
 * @module tests/tools/nps-get-park.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { npsGetPark } from '@/mcp-server/tools/definitions/nps-get-park.tool.js';
import type { NpsParkDetail } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

function makeDetail(overrides?: Partial<NpsParkDetail>): NpsParkDetail {
  return {
    parkCode: 'yose',
    fullName: 'Yosemite National Park',
    designation: 'National Park',
    states: 'CA',
    description: 'Granite cliffs.',
    latitude: 37.85,
    longitude: -119.56,
    weatherOverview: 'Variable by season.',
    directionsInfo: 'Via CA-140.',
    directionsUrl: 'https://www.nps.gov/yose/directions',
    url: 'https://www.nps.gov/yose/',
    activities: ['Hiking'],
    topics: ['Granite'],
    entranceFees: [{ cost: '35.00', title: 'Vehicle', description: '7 days' }],
    entrancePasses: [],
    operatingHours: [],
    contacts: {
      phoneNumbers: [{ phoneNumber: '209-555-0100', type: 'Voice' }],
      emailAddresses: [],
    },
    images: [{ url: 'https://img/1.jpg', altText: 'Valley', title: 'El Capitan' }],
    ...overrides,
  };
}

describe('nps_get_park', () => {
  let ctx: ReturnType<typeof createMockContext>;
  const getParks = vi.fn();

  beforeEach(() => {
    ctx = createMockContext({ errors: npsGetPark.errors });
    vi.mocked(getNpsService).mockReturnValue({ getParks } as never);
    getParks.mockReset();
  });

  it('returns full detail for the requested codes', async () => {
    getParks.mockResolvedValueOnce([makeDetail()]);
    const input = npsGetPark.input.parse({ parkCode: ['yose'] });
    const result = await npsGetPark.handler(input, ctx);

    expect(result.parks).toHaveLength(1);
    expect(result.parks[0].entranceFees).toEqual([
      { cost: '35.00', title: 'Vehicle', description: '7 days' },
    ]);
    expect(getEnrichment(ctx).requestedCount).toBe(1);
    expect(getEnrichment(ctx).returnedCount).toBe(1);
  });

  it('reports unresolved codes via missingCodes on partial resolution (not an error)', async () => {
    getParks.mockResolvedValueOnce([makeDetail({ parkCode: 'yose' })]);
    const input = npsGetPark.input.parse({ parkCode: ['yose', 'xxxx'] });
    const result = await npsGetPark.handler(input, ctx);

    expect(result.parks).toHaveLength(1);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.missingCodes).toEqual(['xxxx']);
    expect(enrichment.notice).toMatch(/xxxx/);
  });

  it('throws no_parks_found when nothing resolves', async () => {
    getParks.mockResolvedValueOnce([]);
    const input = npsGetPark.input.parse({ parkCode: ['zzzz'] });
    await expect(npsGetPark.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_parks_found' },
    });
  });

  it('handles a sparse park (no optional sections) without throwing', async () => {
    getParks.mockResolvedValueOnce([
      makeDetail({
        weatherOverview: null,
        directionsInfo: null,
        directionsUrl: null,
        activities: undefined,
        topics: undefined,
        entranceFees: undefined,
        entrancePasses: undefined,
        operatingHours: undefined,
        contacts: undefined,
        images: undefined,
      }),
    ]);
    const input = npsGetPark.input.parse({ parkCode: ['yose'], fields: ['hours'] });
    const result = await npsGetPark.handler(input, ctx);
    expect(result.parks[0].weatherOverview).toBeNull();
  });

  it('format() renders the park name, fees, and image title', () => {
    const blocks = npsGetPark.format!({ parks: [makeDetail()] });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('Yosemite National Park');
    expect(text).toContain('35.00');
    expect(text).toContain('El Capitan');
  });

  it('format() renders EVERY returned image and discloses the upstream cap', () => {
    // Structured content carries up to 5 images; the text channel must render all
    // of them (not just the first) and disclose that more exist upstream.
    const images = Array.from({ length: 5 }, (_, i) => ({
      url: `https://img/${i}.jpg`,
      altText: `alt ${i}`,
      title: `Image ${i}`,
    }));
    const blocks = npsGetPark.format!({
      parks: [makeDetail({ images, imagesTruncated: true })],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    for (const img of images) {
      expect(text).toContain(img.title);
      expect(text).toContain(img.url);
    }
    // The disclosure fires because imagesTruncated is true.
    expect(text).toMatch(/more images upstream/i);
  });

  it('format() renders every image but omits the disclosure when not truncated', () => {
    const images = [
      { url: 'https://img/a.jpg', altText: 'a', title: 'Image A' },
      { url: 'https://img/b.jpg', altText: 'b', title: 'Image B' },
    ];
    const blocks = npsGetPark.format!({
      parks: [makeDetail({ images, imagesTruncated: false })],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain('Image A');
    expect(text).toContain('Image B');
    expect(text).not.toMatch(/more images upstream/i);
  });
});
