/**
 * @fileoverview Tests for the nps_find_campgrounds tool — site-count and amenity
 * surfacing, the empty-result notice, truncation optionality, and format().
 * @module tests/tools/nps-find-campgrounds.tool.test
 */

import {
  createFetchMock,
  createMockContext,
  getEnrichment,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindCampgrounds } from '@/mcp-server/tools/definitions/nps-find-campgrounds.tool.js';
import type { NpsCampground } from '@/services/nps/types.js';

vi.mock('@/services/nps/nps-service.js', () => ({
  getNpsService: vi.fn(),
  initNpsService: vi.fn(),
}));

import { getNpsService } from '@/services/nps/nps-service.js';

/** Text of every content block, joined — the surface content[]-reading clients see. */
function contentText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

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
  let ctx: ReturnType<typeof createMockContext<typeof npsFindCampgrounds.errors>>;
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

    expect(result.campgrounds[0]!.reservableSites).toBe(176);
    expect(result.campgrounds[0]!.amenities.rvAllowed).toBe(true);
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

  it('handles a sparse campground (null counts, every amenity unknown)', async () => {
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
            potableWater: null,
            showers: null,
            dumpStation: null,
            rvAllowed: null,
            toilets: null,
            trashCollection: null,
          },
        }),
      ],
    });
    const input = npsFindCampgrounds.input.parse({ parkCode: 'zion' });
    const result = await npsFindCampgrounds.handler(input, ctx);
    expect(result.campgrounds[0]!.totalSites).toBeNull();
    expect(result.campgrounds[0]!.amenities.rvAllowed).toBeNull();
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

  it('format() renders an unknown amenity as Unknown, never No', () => {
    const blocks = npsFindCampgrounds.format!({
      campgrounds: [
        makeCampground({
          amenities: {
            potableWater: null,
            showers: false,
            dumpStation: true,
            rvAllowed: null,
            toilets: null,
            trashCollection: null,
          },
        }),
      ],
    });
    const text = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text).toContain(
      'Potable water: Unknown · Showers: No · Dump station: Yes · RV allowed: Unknown · Toilets: Unknown · Trash collection: Unknown',
    );
  });

  /* ----------------------------------------------------------------------- *
   * Amenity normalization end to end — the real NpsService behind a strict
   * fetch fake, run through the tool's public contract (schema + format()).
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

    function upstream(record: Record<string, unknown>) {
      http.route({
        match: /\/campgrounds\?/,
        respond: Response.json({ total: '1', limit: '15', start: '0', data: [record] }),
      });
    }

    it('reports every empty upstream amenity as null / Unknown on both surfaces', async () => {
      upstream({
        id: 'amme-cg',
        name: 'American Memorial Park',
        parkCode: 'amme',
        amenities: {
          potableWater: [],
          toilets: [],
          showers: [],
          dumpStation: '',
          trashRecyclingCollection: '',
        },
        accessibility: { rvAllowed: '0' },
      });

      const result = await runToolContract(npsFindCampgrounds, { parkCode: 'amme' });
      expect(result.isError).toBeFalsy();
      const cg = (result.structuredContent as { campgrounds: NpsCampground[] }).campgrounds[0]!;
      expect(cg.amenities).toEqual({
        potableWater: null,
        showers: null,
        dumpStation: null,
        rvAllowed: false,
        toilets: null,
        trashCollection: null,
      });
      const text = contentText(result as never);
      expect(text).toContain(
        'Potable water: Unknown · Showers: Unknown · Dump station: Unknown · RV allowed: No · Toilets: Unknown · Trash collection: Unknown',
      );
    });

    it('reports "Water, but not potable" and "No Toilets" as No on both surfaces', async () => {
      upstream({
        id: 'lavo-bc',
        name: "Backcountry Camping in Lassen's Wilderness",
        parkCode: 'lavo',
        amenities: {
          potableWater: ['Water', ' but not potable'],
          toilets: ['No Toilets'],
          showers: ['None'],
          dumpStation: 'No',
          trashRecyclingCollection: 'No',
        },
        accessibility: { rvAllowed: '0' },
      });

      const result = await runToolContract(npsFindCampgrounds, { parkCode: 'lavo' });
      expect(result.isError).toBeFalsy();
      const cg = (result.structuredContent as { campgrounds: NpsCampground[] }).campgrounds[0]!;
      expect(cg.amenities.potableWater).toBe(false);
      expect(cg.amenities.toilets).toBe(false);
      const text = contentText(result as never);
      expect(text).toContain('Potable water: No');
      expect(text).toContain('Toilets: No');
    });

    it('advertises each amenity as boolean-or-null and says what null means', () => {
      type Node = { properties?: Record<string, Node>; items?: Node };
      const schema = npsFindCampgrounds.output.toJSONSchema() as Node;
      const amenities =
        schema.properties?.campgrounds?.items?.properties?.amenities?.properties ?? {};
      expect(Object.keys(amenities)).toHaveLength(6);
      for (const field of Object.values(amenities)) {
        expect(JSON.stringify(field)).toContain('"null"');
        expect(JSON.stringify(field)).toContain('null when NPS published no value');
      }
    });
  });

  /* ----------------------------------------------------------------------- *
   * #3 — invalid code inputs surface the declared recovery hint (not raw Zod).
   * Asserted through runToolContract, which fills the declared hint the same
   * way the production handler factory does.
   * ----------------------------------------------------------------------- */

  it('rejects an uppercase parkCode with the declared recovery hint, before any upstream call', async () => {
    const result = await runToolContract(npsFindCampgrounds, { parkCode: 'ZION' });
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'invalid_park_code',
          recovery: { hint: expect.stringContaining('nps_find_parks') },
        },
      },
    });
    expect(findCampgrounds).not.toHaveBeenCalled();
  });

  it('rejects a non-two-letter stateCode with the declared recovery hint', async () => {
    const result = await runToolContract(npsFindCampgrounds, { stateCode: 'Utah' });
    expect(result.structuredContent).toMatchObject({
      error: {
        data: {
          reason: 'invalid_state_code',
          recovery: { hint: expect.stringContaining('two-letter') },
        },
      },
    });
    expect(findCampgrounds).not.toHaveBeenCalled();
  });

  /* ----------------------------------------------------------------------- *
   * #9 — the truncated flag reaches both client surfaces. Asserted on the
   * runToolContract result: getEnrichment() reads the raw store, which holds
   * truncated: true even when the output parse strips it.
   * ----------------------------------------------------------------------- */

  describe('truncated flag on the client surfaces', () => {
    it('sets structuredContent.truncated and a Truncated trailer line on a capped page', async () => {
      findCampgrounds.mockResolvedValueOnce({
        total: 97,
        data: [makeCampground({ id: 'c1' }), makeCampground({ id: 'c2' })],
      });
      const result = await runToolContract(npsFindCampgrounds, { stateCode: 'CA', limit: 2 });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(true);
      expect(sc).toMatchObject({
        totalCount: 97,
        shown: 2,
        cap: 2,
        appliedFilters: 'stateCode=CA',
        notice: expect.stringContaining('start=2'),
      });
      const text = contentText(result as never);
      expect(text).toContain('**Truncated:** true');
      expect(text).toContain('**97 total**');
      expect(text).toContain('**Shown:** 2');
      expect(text).toContain('**Limit:** 2');
      expect(text).toContain('**Filters:** stateCode=CA');
      expect(text).toContain('Request the next page with start=2.');
    });

    it('omits truncated from both surfaces on a complete result — absent, never false', async () => {
      findCampgrounds.mockResolvedValueOnce({ total: 1, data: [makeCampground()] });
      const result = await runToolContract(npsFindCampgrounds, { parkCode: 'zion', limit: 50 });

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
