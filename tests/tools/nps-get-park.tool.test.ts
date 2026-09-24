/**
 * @fileoverview Tests for the nps_get_park tool — batched detail, the missingCodes
 * cross-reference, handler-level code validation, the no_parks_found error, a
 * sparse park, and format().
 * @module tests/tools/nps-get-park.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createMockContext,
  getEnrichment,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npsGetPark } from '@/mcp-server/tools/definitions/nps-get-park.tool.js';
import type { NpsParkDetail } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

/** Text of every content block, joined — the surface content[]-reading clients see. */
function contentText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

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
  let ctx: ReturnType<typeof createMockContext<typeof npsGetPark.errors>>;
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
    expect(result.parks[0]!.entranceFees).toEqual([
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
    const sparse = makeDetail({ weatherOverview: null });
    // fields ['hours'] excludes directions, so the pair is absent — not null.
    delete sparse.directionsInfo;
    delete sparse.directionsUrl;
    delete sparse.activities;
    delete sparse.topics;
    delete sparse.entranceFees;
    delete sparse.entrancePasses;
    delete sparse.operatingHours;
    delete sparse.contacts;
    delete sparse.images;
    getParks.mockResolvedValueOnce([sparse]);
    const input = npsGetPark.input.parse({ parkCode: ['yose'], fields: ['hours'] });
    const result = await npsGetPark.handler(input, ctx);
    expect(result.parks[0]!.weatherOverview).toBeNull();
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
    expect(text).toContain('This park has more images than the 5 shown here — see the park page.');
    expect(text).not.toMatch(/upstream/i);
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
    expect(text).not.toMatch(/more images/i);
  });

  /* ----------------------------------------------------------------------- *
   * #12 — a malformed code gets invalid_park_code and its declared recovery,
   * not the schema's -32602 invalid_arguments. Asserted through
   * runToolContract, which runs the same argument parse the production
   * handler factory does.
   * ----------------------------------------------------------------------- */

  describe('code validation on the client surfaces', () => {
    type ContractError = { code: number; message: string; data?: { reason?: string } };

    it('rejects a mixed-case code as invalid_park_code with a recovery naming nps_find_parks', async () => {
      const result = await runToolContract(npsGetPark, { parkCode: ['Yose'] });

      expect(result.isError).toBe(true);
      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
      expect(error.data?.reason).toBe('invalid_park_code');
      expect(contentText(result as never)).toMatch(/^Recovery: .*nps_find_parks/m);
      expect(getParks).not.toHaveBeenCalled();
    });

    it('names only the offending codes in the message', async () => {
      const result = await runToolContract(npsGetPark, { parkCode: ['yose', 'Grand Canyon'] });

      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.data?.reason).toBe('invalid_park_code');
      expect(error.message).toContain('"Grand Canyon"');
      expect(error.message).not.toContain('yose');
      expect(getParks).not.toHaveBeenCalled();
    });

    it('still answers codes that are well-formed but unknown with no_parks_found', async () => {
      getParks.mockResolvedValueOnce([]);
      const result = await runToolContract(npsGetPark, { parkCode: ['zzzz'] });

      const error = (result.structuredContent as { error: ContractError }).error;
      expect(error.code).toBe(JsonRpcErrorCode.NotFound);
      expect(error.data?.reason).toBe('no_parks_found');
    });

    it('accepts well-formed codes (control)', async () => {
      getParks.mockResolvedValueOnce([makeDetail()]);
      const result = await runToolContract(npsGetPark, { parkCode: ['yose'] });

      expect(result.isError).toBeFalsy();
      expect(getParks).toHaveBeenCalledWith(['yose'], undefined, expect.anything());
    });

    it('advertises the code format in prose, not as a schema pattern', () => {
      const schema = JSON.stringify(npsGetPark.input.toJSONSchema());
      expect(schema).not.toContain('"pattern"');
      expect(schema).toContain('4-letter lowercase code');
    });
  });

  /* ----------------------------------------------------------------------- *
   * Park-detail normalization end to end — the real NpsService behind a
   * strict fetch fake, run through the tool's public contract.
   * ----------------------------------------------------------------------- */

  describe('through the real service', () => {
    const http = createFetchMock();

    beforeEach(async () => {
      const { NpsService } = await vi.importActual<typeof import('@/services/nps/nps-service.js')>(
        '@/services/nps/nps-service.js',
      );
      vi.mocked(getNpsService).mockReturnValue(
        new NpsService({ apiKey: 'test-key', baseUrl: 'https://developer.nps.gov/api/v1' }),
      );
      http.install();
    });

    afterEach(() => {
      http.reset();
      http.restore();
    });

    function upstream(...records: Record<string, unknown>[]) {
      http.route({
        match: /\/parks\?/,
        respond: Response.json({ total: String(records.length), data: records }),
      });
    }

    const yose = {
      parkCode: 'yose',
      fullName: 'Yosemite National Park',
      designation: 'National Park',
      states: 'CA',
      description: 'Granite cliffs.',
      url: 'https://www.nps.gov/yose/',
      weatherInfo: 'Variable by season.',
      directionsInfo: 'Via CA-140 from Merced.',
      directionsUrl: 'https://www.nps.gov/yose/planyourvisit/directions.htm',
      operatingHours: [],
    };

    it('omits the directions pair on both surfaces when fields excludes directions', async () => {
      upstream(yose);

      const result = await runToolContract(npsGetPark, { parkCode: ['yose'], fields: ['hours'] });
      expect(result.isError).toBeFalsy();
      const park = (result.structuredContent as { parks: Record<string, unknown>[] }).parks[0]!;
      expect(Object.keys(park)).not.toContain('directionsInfo');
      expect(Object.keys(park)).not.toContain('directionsUrl');
      expect(park.weatherOverview).toBe('Variable by season.');
      const text = contentText(result as never);
      expect(text).not.toContain('Directions');
      expect(text).toContain('**Weather:** Variable by season.');
    });

    it('returns the directions pair when fields is omitted', async () => {
      upstream(yose);

      const result = await runToolContract(npsGetPark, { parkCode: ['yose'] });
      const park = (result.structuredContent as { parks: Record<string, unknown>[] }).parks[0]!;
      expect(park.directionsInfo).toBe('Via CA-140 from Merced.');
      expect(park.directionsUrl).toBe('https://www.nps.gov/yose/planyourvisit/directions.htm');
      expect(contentText(result as never)).toContain('**Directions:** Via CA-140 from Merced.');
    });

    it('strips markup from weather and fee descriptions on both surfaces', async () => {
      upstream(
        {
          parkCode: 'vafo',
          fullName: 'Valley Forge National Historical Park',
          url: 'https://www.nps.gov/vafo/',
          weatherInfo:
            'Find more detailed weather information on the <a href=https://www.nps.gov/vafo/planyourvisit/weather.htm>Weather page.</a>',
          entranceFees: [],
          entrancePasses: [],
        },
        {
          parkCode: 'grte',
          fullName: 'Grand Teton National Park',
          url: 'https://www.nps.gov/grte/',
          entranceFees: [
            {
              cost: '0.00',
              title: 'Entrance - Education/Academic Groups',
              description:
                'See additional <a href="https://www.nps.gov/grte/planyourvisit/eduwaiver.htm">Education Fee Waiver</a> page.',
            },
          ],
          entrancePasses: [],
        },
      );

      const result = await runToolContract(npsGetPark, {
        parkCode: ['vafo', 'grte'],
        fields: ['fees'],
      });
      const parks = (
        result.structuredContent as {
          parks: { weatherOverview: string | null; entranceFees: { description: string }[] }[];
        }
      ).parks;
      expect(parks[0]!.weatherOverview).toBe(
        'Find more detailed weather information on the Weather page.',
      );
      expect(parks[1]!.entranceFees[0]!.description).toBe(
        'See additional Education Fee Waiver page.',
      );
      const text = contentText(result as never);
      expect(text).not.toContain('<a');
      expect(text).toContain('on the Weather page.');
      expect(text).toContain('See additional Education Fee Waiver page.');
    });

    it('advertises the directions pair as optional and nullable', () => {
      type Node = { properties?: Record<string, Node>; items?: Node; required?: string[] };
      const item = (npsGetPark.output.toJSONSchema() as Node).properties?.parks?.items;
      expect(item?.required).toContain('weatherOverview');
      expect(item?.required).not.toContain('directionsInfo');
      expect(item?.required).not.toContain('directionsUrl');
      for (const key of ['directionsInfo', 'directionsUrl']) {
        expect(JSON.stringify(item?.properties?.[key])).toContain('"null"');
        expect(JSON.stringify(item?.properties?.[key])).toContain(
          'included unless fields excludes \\"directions\\"',
        );
      }
    });
  });
});
