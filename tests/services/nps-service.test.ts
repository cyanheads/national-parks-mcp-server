/**
 * @fileoverview Tests for NpsService — the coercion-heavy heart of the server.
 * The NPS API returns many numeric/boolean fields as strings, nests some values,
 * and uses a distinct envelope + lowercased field names for /events. These tests
 * mock the HTTP boundary (fetchWithTimeout) and verify every normalization the
 * tool handlers depend on, plus the retry/error-envelope/auth behavior.
 *
 * The mock fetchWithTimeout THROWS on non-OK — mirroring the real framework util,
 * which throws a classified McpError rather than resolving a non-OK Response. A
 * mock that resolved non-OK would hide the dead error-path code.
 * @module tests/services/nps-service.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NpsService } from '@/services/nps/nps-service.js';

const mockFetch = vi.fn();

vi.mock('@cyanheads/mcp-ts-core/utils', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  // Pass-through retry so a thrown error from the mock propagates immediately.
  withRetry: async (fn: () => Promise<unknown>) => fn(),
}));

/** OK JSON response. */
function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * Make the mock throw the way the real fetchWithTimeout does on a non-OK
 * response: a classified McpError, NOT a resolved non-OK Response.
 */
function throwHttp(status: number): never {
  const code =
    status === 401
      ? JsonRpcErrorCode.Unauthorized
      : status === 403
        ? JsonRpcErrorCode.Forbidden
        : status >= 500
          ? JsonRpcErrorCode.ServiceUnavailable
          : JsonRpcErrorCode.InternalError;
  throw new McpError(code, `HTTP ${status}`, { statusCode: status });
}

const CONFIG = { apiKey: 'test-key', baseUrl: 'https://developer.nps.gov/api/v1' };

describe('NpsService', () => {
  let service: NpsService;
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    service = new NpsService(CONFIG);
    ctx = createMockContext();
    mockFetch.mockReset();
    // Strict by default: a call no test layered a fake for fails loudly.
    mockFetch.mockRejectedValue(new Error('unmocked fetch'));
  });

  describe('findParks', () => {
    it('coerces string lat/lng to floats, extracts activity names, derives entranceFee', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '2',
          limit: '10',
          start: '0',
          data: [
            {
              parkCode: 'yose',
              fullName: 'Yosemite National Park',
              designation: 'National Park',
              states: 'CA',
              description: 'Granite cliffs.',
              latitude: '37.84883288',
              longitude: '-119.5571873',
              url: 'https://www.nps.gov/yose/',
              activities: [
                { id: '1', name: 'Hiking' },
                { id: '2', name: 'Camping' },
              ],
              entranceFees: [{ cost: '35.00', title: 'Vehicle', description: '7 days' }],
            },
          ],
        }),
      );

      const result = await service.findParks({ query: 'yosemite', limit: 10 }, ctx);

      expect(result.total).toBe(2);
      const park = result.data[0]!;
      expect(park.latitude).toBeCloseTo(37.84883288);
      expect(park.longitude).toBeCloseTo(-119.5571873);
      expect(park.activities).toEqual(['Hiking', 'Camping']);
      expect(park.entranceFee).toBe('35.00');
    });

    it('maps empty-string coordinates and absent fees to null (sparse payload)', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              parkCode: 'abcd',
              fullName: 'Sparse Site',
              designation: '',
              states: 'WY',
              description: '',
              latitude: '',
              longitude: '',
              url: 'https://www.nps.gov/abcd/',
              // activities and entranceFees omitted entirely
            },
          ],
        }),
      );

      const park = (await service.findParks({ limit: 10 }, ctx)).data[0]!;
      expect(park.latitude).toBeNull();
      expect(park.longitude).toBeNull();
      expect(park.activities).toEqual([]);
      expect(park.entranceFee).toBeNull();
    });
  });

  describe('getParks', () => {
    it('extracts topics/activities names, coerces detail, caps images at 5 and flags the cap, honors fields', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              parkCode: 'havo',
              fullName: 'Hawaii Volcanoes National Park',
              designation: 'National Park',
              states: 'HI',
              description: 'Active volcanoes.',
              latitude: '19.38',
              longitude: '-155.2',
              weatherInfo: 'Variable.',
              url: 'https://www.nps.gov/havo/',
              activities: [{ id: '1', name: 'Hiking' }],
              topics: [{ id: '9', name: 'Volcanoes' }],
              entranceFees: [{ cost: '30.00', title: 'Vehicle', description: '7 days' }],
              images: Array.from({ length: 8 }, (_, i) => ({
                url: `https://img/${i}.jpg`,
                altText: `alt ${i}`,
                title: `title ${i}`,
              })),
            },
          ],
        }),
      );

      const park = (await service.getParks(['havo'], undefined, ctx))[0]!;
      expect(park.activities).toEqual(['Hiking']);
      expect(park.topics).toEqual(['Volcanoes']);
      expect(park.entranceFees).toEqual([
        { cost: '30.00', title: 'Vehicle', description: '7 days' },
      ]);
      expect(park.images).toHaveLength(5);
      // 8 upstream > 5 cap → the disclosure flag is set. The first five URLs are
      // kept in order; the caller learns the rest exist via the park url.
      expect(park.imagesTruncated).toBe(true);
      expect(park.images?.map((i) => i.url)).toEqual([
        'https://img/0.jpg',
        'https://img/1.jpg',
        'https://img/2.jpg',
        'https://img/3.jpg',
        'https://img/4.jpg',
      ]);
      expect(park.weatherOverview).toBe('Variable.');
    });

    it('leaves imagesTruncated false when the upstream image list is within the cap', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              parkCode: 'zion',
              fullName: 'Zion National Park',
              designation: 'National Park',
              states: 'UT',
              description: 'Sandstone canyons.',
              url: 'https://www.nps.gov/zion/',
              images: Array.from({ length: 3 }, (_, i) => ({
                url: `https://img/${i}.jpg`,
                altText: `alt ${i}`,
                title: `title ${i}`,
              })),
            },
          ],
        }),
      );

      const park = (await service.getParks(['zion'], undefined, ctx))[0]!;
      expect(park.images).toHaveLength(3);
      expect(park.imagesTruncated).toBe(false);
    });

    it('omits sections excluded by fields', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          data: [
            {
              parkCode: 'havo',
              fullName: 'Hawaii Volcanoes',
              designation: 'National Park',
              states: 'HI',
              description: 'x',
              weatherInfo: 'Warm and humid.',
              directionsInfo: 'Take Highway 11 south from Hilo.',
              directionsUrl: 'https://www.nps.gov/havo/planyourvisit/directions.htm',
              url: 'https://www.nps.gov/havo/',
              activities: [{ id: '1', name: 'Hiking' }],
              entranceFees: [{ cost: '30.00', title: 'Vehicle', description: '7 days' }],
            },
          ],
        }),
      );

      const park = (await service.getParks(['havo'], ['hours'], ctx))[0]!;
      expect(park.activities).toBeUndefined();
      expect(park.entranceFees).toBeUndefined();
      expect(park.operatingHours).toEqual([]);
      // images excluded → neither the list nor its truncation flag is populated.
      expect(park.images).toBeUndefined();
      expect(park.imagesTruncated).toBeUndefined();
      // directions excluded → both keys absent, not null ("not requested" ≠ "NPS has none").
      expect(Object.keys(park)).not.toContain('directionsInfo');
      expect(Object.keys(park)).not.toContain('directionsUrl');
      // weatherOverview has no fields toggle — it stays in the core.
      expect(park.weatherOverview).toBe('Warm and humid.');
    });

    it.each([
      { label: 'fields omitted', fields: undefined },
      { label: 'fields including directions', fields: ['directions' as const] },
    ])(
      'returns the directions pair with $label; an empty directionsInfo is null while its URL passes through',
      async ({ fields }) => {
        mockFetch.mockResolvedValueOnce(
          okResponse({
            data: [
              {
                parkCode: 'cach',
                fullName: 'Canyon de Chelly National Monument',
                url: 'https://www.nps.gov/cach/',
                directionsInfo: '',
                directionsUrl: 'http://www.nps.gov/cach/planyourvisit/directions.htm',
              },
            ],
          }),
        );

        const park = (await service.getParks(['cach'], fields, ctx))[0]!;
        expect(Object.keys(park)).toContain('directionsInfo');
        expect(park.directionsInfo).toBeNull();
        expect(park.directionsUrl).toBe('http://www.nps.gov/cach/planyourvisit/directions.htm');
      },
    );

    it('strips markup from weatherOverview, directionsInfo, and fee/pass descriptions', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          data: [
            {
              parkCode: 'vafo',
              fullName: 'Valley Forge National Historical Park',
              description: 'Encampment of the <em>Continental Army</em>.',
              url: 'https://www.nps.gov/vafo/',
              weatherInfo:
                'Summers are hot. Find more detailed weather information on the <a href=https://example.test/w>Weather page.</a>',
              directionsInfo:
                'From I-76, see the <a href="https://example.test/d">driving directions</a> page.',
              directionsUrl: 'https://www.nps.gov/vafo/planyourvisit/directions.htm',
              entranceFees: [
                {
                  cost: '0.00',
                  title: 'Entrance - Education/Academic Groups',
                  description:
                    'Waivers are available. See additional <a href="https://example.test/e">Education Fee Waiver</a> page.',
                },
              ],
              entrancePasses: [
                {
                  cost: '80.00',
                  title: 'Annual Pass',
                  description: 'Valid for <strong>one year</strong> from purchase.',
                },
              ],
            },
          ],
        }),
      );

      const park = (await service.getParks(['vafo'], undefined, ctx))[0]!;
      expect(park.weatherOverview).toBe(
        'Summers are hot. Find more detailed weather information on the Weather page.',
      );
      expect(park.directionsInfo).toBe('From I-76, see the driving directions page.');
      expect(park.entranceFees![0]!.description).toBe(
        'Waivers are available. See additional Education Fee Waiver page.',
      );
      expect(park.entrancePasses![0]!.description).toBe('Valid for one year from purchase.');
      // Out of scope: fee cost/title and the park description are passed through untouched.
      expect(park.entranceFees![0]!.cost).toBe('0.00');
      expect(park.entranceFees![0]!.title).toBe('Entrance - Education/Academic Groups');
      expect(park.description).toBe('Encampment of the <em>Continental Army</em>.');
    });

    it('returns markup-free text unchanged — line breaks and bare angle brackets survive', async () => {
      const cleanFee = 'Per vehicle, valid 7 days.\n\nCommercial tours pay per person.';
      const cuisWeather =
        "Summer highs are in the 80's (>26 C) and winter lows in the 60's (<20 C), with rain possible.";
      mockFetch.mockResolvedValueOnce(
        okResponse({
          data: [
            {
              parkCode: 'cuis',
              fullName: 'Cumberland Island National Seashore',
              url: 'https://www.nps.gov/cuis/',
              weatherInfo: `  ${cuisWeather}  `,
              entranceFees: [
                { cost: '10.00', title: 'Entrance - Per Person', description: cleanFee },
              ],
            },
          ],
        }),
      );

      const park = (await service.getParks(['cuis'], ['fees'], ctx))[0]!;
      expect(park.weatherOverview).toBe(cuisWeather);
      expect(park.entranceFees![0]!.description).toBe(cleanFee);
    });
  });

  describe('getAlerts', () => {
    it('normalizes empty url to null and strips the time suffix off lastIndexedDate', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 'a1',
              parkCode: 'glac',
              category: 'Park Closure',
              title: 'Going-to-the-Sun Road closed',
              description: 'Seasonal closure.',
              url: '',
              lastIndexedDate: '2026-05-30 00:00:00.0',
            },
          ],
        }),
      );

      const alert = (await service.getAlerts({ parkCode: 'glac', limit: 20 }, ctx)).data[0]!;
      expect(alert.url).toBeNull();
      expect(alert.lastIndexedDate).toBe('2026-05-30');
      expect(alert.category).toBe('Park Closure');
    });

    it('sends start so alerts can paginate like the sibling list endpoints', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '58', data: [] }));
      await service.getAlerts({ stateCode: 'CA', limit: 20, start: 40 }, ctx);

      const url = mockFetch.mock.calls[0]![0]! as string;
      expect(url).toContain('start=40');
      expect(url).toContain('limit=20');
    });

    it('omits start when unset rather than sending start=undefined', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getAlerts({ parkCode: 'glac', limit: 20 }, ctx);

      const url = mockFetch.mock.calls[0]![0]! as string;
      expect(url).not.toContain('start=');
    });
  });

  describe('findCampgrounds', () => {
    it('coerces nested totalSites, string site counts, array+string amenities, accessibility.adaInfo', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 'c1',
              name: 'Watchman Campground',
              parkCode: 'zion',
              description: 'Near the entrance.',
              latitude: '37.2',
              longitude: '-112.98',
              numberOfSitesReservable: '176',
              numberOfSitesFirstComeFirstServe: '0',
              reservationUrl: 'https://recreation.gov',
              campsites: { totalSites: '176' },
              fees: [{ cost: '30.00', title: 'Standard', description: 'Per night' }],
              amenities: {
                potableWater: ['Yes - year round'],
                showers: ['None'],
                toilets: ['Yes - year round', 'Flush Toilets'],
                dumpStation: 'Yes',
                trashRecyclingCollection: 'No',
              },
              accessibility: { adaInfo: 'Accessible sites available.', rvAllowed: '1' },
              url: 'https://www.nps.gov/zion/cg',
            },
          ],
        }),
      );

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0]!;
      expect(cg.totalSites).toBe(176);
      expect(cg.reservableSites).toBe(176);
      expect(cg.firstComeSites).toBe(0);
      expect(cg.fee).toBe('30.00');
      expect(cg.amenities.potableWater).toBe(true);
      expect(cg.amenities.showers).toBe(false);
      expect(cg.amenities.toilets).toBe(true);
      expect(cg.amenities.dumpStation).toBe(true);
      expect(cg.amenities.trashCollection).toBe(false);
      expect(cg.amenities.rvAllowed).toBe(true);
      expect(cg.accessibility).toBe('Accessible sites available.');
    });

    it('treats type-described toilets/showers as present (real NPS values never start with "Yes")', async () => {
      // Mather Campground at grca: live NPS data. `toilets`/`showers` are
      // TYPE-described, not "Yes"-prefixed — a starts-with-"Yes" test would
      // wrongly report both absent (the bug this case locks out).
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 'c3',
              name: 'Mather Campground - South Rim',
              parkCode: 'grca',
              campsites: { totalSites: '327' },
              amenities: {
                potableWater: ['Yes - year round'],
                showers: ['Hot - Year Round'],
                toilets: ['Flush Toilets - year round'],
                dumpStation: 'Yes',
                trashRecyclingCollection: 'Yes - year round',
              },
              accessibility: { rvAllowed: '1' },
            },
          ],
        }),
      );

      const cg = (await service.findCampgrounds({ parkCode: 'grca', limit: 15 }, ctx)).data[0]!;
      expect(cg.amenities.showers).toBe(true);
      expect(cg.amenities.toilets).toBe(true);
      expect(cg.amenities.potableWater).toBe(true);
      expect(cg.amenities.dumpStation).toBe(true);
      expect(cg.amenities.trashCollection).toBe(true);
    });

    it('treats "None" / "No water" amenity arrays as absent', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 'c4',
              name: 'Primitive Campground',
              parkCode: 'zion',
              amenities: {
                potableWater: ['No water'],
                showers: ['None'],
                toilets: ['None'],
                dumpStation: 'No',
                trashRecyclingCollection: 'No',
              },
            },
          ],
        }),
      );

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0]!;
      expect(cg.amenities.potableWater).toBe(false);
      expect(cg.amenities.showers).toBe(false);
      expect(cg.amenities.toilets).toBe(false);
      expect(cg.amenities.dumpStation).toBe(false);
      expect(cg.amenities.trashCollection).toBe(false);
    });

    it('handles a sparse campground (no campsites object, no amenities) without inventing data', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 'c2',
              name: 'Backcountry',
              parkCode: 'zion',
              description: '',
              latitude: '',
              longitude: '',
              url: '',
            },
          ],
        }),
      );

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0]!;
      expect(cg.totalSites).toBeNull();
      expect(cg.reservableSites).toBeNull();
      expect(cg.firstComeSites).toBeNull();
      expect(cg.fee).toBeNull();
      expect(cg.accessibility).toBeNull();
      expect(cg.url).toBeNull();
      // No amenities object and no accessibility.rvAllowed → every amenity unknown.
      expect(cg.amenities).toEqual({
        potableWater: null,
        showers: null,
        dumpStation: null,
        rvAllowed: null,
        toilets: null,
        trashCollection: null,
      });
    });

    /** One campground whose `amenities` block is exactly `amenities`. */
    async function amenitiesFor(
      amenities: Record<string, unknown>,
      accessibility: Record<string, unknown> = { rvAllowed: '0' },
    ) {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [{ id: 'cx', name: 'Fixture', parkCode: 'zion', amenities, accessibility }],
        }),
      );
      return (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0]!
        .amenities;
    }

    it('reads "Water, but not potable" (split at its comma) as no potable water', async () => {
      const a = await amenitiesFor({ potableWater: ['Water', ' but not potable'] });
      expect(a.potableWater).toBe(false);
    });

    it('negates only the element a " but not potable" fragment was split from', async () => {
      const a = await amenitiesFor({
        potableWater: ['Yes - seasonal', 'Water', ' but not potable'],
      });
      expect(a.potableWater).toBe(true);
    });

    it('keeps a real positive true beside a self-contained "not potable" element', async () => {
      const a = await amenitiesFor({ potableWater: ['Yes - seasonal', 'Water, but not potable'] });
      expect(a.potableWater).toBe(true);
    });

    it.each([['Water, but not potable'], ['Not potable'], ['Non-potable water'], ['Nonpotable']])(
      'reads a self-contained %j as no potable water',
      async (value) => {
        const a = await amenitiesFor({ potableWater: [value] });
        expect(a.potableWater).toBe(false);
      },
    );

    it('reads "No Toilets" as no toilets', async () => {
      const a = await amenitiesFor({ toilets: ['No Toilets'] });
      expect(a.toilets).toBe(false);
    });

    it('keeps a field true when a real positive sits beside a negative', async () => {
      const a = await amenitiesFor({
        toilets: ['Vault Toilets - year round', 'No Toilets'],
        showers: ['Coin-Operated - Seasonal', 'None'],
      });
      expect(a.toilets).toBe(true);
      expect(a.showers).toBe(true);
    });

    it.each([
      ['Yes - seasonal', true],
      ['Yes - year round', true],
      ['Vault Toilets - seasonal', true],
      ['Hot - Year Round', true],
      ['Cold- Seasonal', true],
      ['No water', false],
      ['None', false],
      ['No', false],
    ])(
      'classifies a populated %j as %s on both array and string fields',
      async (value, expected) => {
        const a = await amenitiesFor({
          potableWater: [value],
          showers: [value],
          toilets: [value],
          dumpStation: value,
          trashRecyclingCollection: value,
        });
        expect(a).toMatchObject({
          potableWater: expected,
          showers: expected,
          toilets: expected,
          dumpStation: expected,
          trashCollection: expected,
        });
      },
    );

    it('maps each empty upstream amenity value to null without touching the populated ones', async () => {
      const a = await amenitiesFor(
        {
          potableWater: [],
          showers: ['', '  '],
          toilets: ['Flush Toilets - year round'],
          dumpStation: '',
          trashRecyclingCollection: 'No',
        },
        { rvAllowed: '1' },
      );
      expect(a).toEqual({
        potableWater: null,
        showers: null,
        toilets: true,
        dumpStation: null,
        trashCollection: false,
        rvAllowed: true,
      });
    });

    it('returns null for every empty amenity on an all-empty record (American Memorial Park shape)', async () => {
      const a = await amenitiesFor({
        potableWater: [],
        toilets: [],
        showers: [],
        dumpStation: '',
        trashRecyclingCollection: '',
      });
      expect(a).toEqual({
        potableWater: null,
        showers: null,
        toilets: null,
        dumpStation: null,
        trashCollection: null,
        // accessibility.rvAllowed is populated ("0") on the record, so it stays a real false.
        rvAllowed: false,
      });
    });

    it('maps an empty accessibility.rvAllowed to null', async () => {
      const a = await amenitiesFor({ potableWater: ['No water'] }, { rvAllowed: '' });
      expect(a.rvAllowed).toBeNull();
    });
  });

  describe('getThingsToDo', () => {
    it('extracts parkCode from relatedParks, coerces boolean strings, strips HTML, picks duration', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 't1',
              title: 'Watch the Sunrise',
              shortDescription: 'See the <b>first light</b> from the summit.',
              location: 'Cadillac Mountain',
              latitude: '44.35',
              longitude: '-68.22',
              duration: '1-3 Hours',
              durationDescription: '',
              isReservationRequired: 'true',
              feeDescription: 'Vehicle reservation required. <a href="x">Book</a>',
              arePetsPermitted: 'false',
              accessibilityInformation: 'Paved path.',
              season: ['Summer', 'Fall'],
              url: 'https://www.nps.gov/thingstodo/sunrise',
              relatedParks: [{ parkCode: 'acad' }],
            },
          ],
        }),
      );

      const t = (await service.getThingsToDo({ parkCode: 'acad', limit: 15 }, ctx)).data[0]!;
      expect(t.parkCode).toBe('acad');
      expect(t.shortDescription).toBe('See the first light from the summit.');
      expect(t.duration).toBe('1-3 Hours');
      expect(t.reservationRequired).toBe(true);
      expect(t.petsPermitted).toBe(false);
      expect(t.feeDescription).toBe('Vehicle reservation required. Book');
      expect(t.season).toEqual(['Summer', 'Fall']);
    });

    it('decodes each character reference exactly once', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 't2',
              title: 'Entity Handling',
              // An escaped entity: the source text is literally `&lt;b&gt;`, so
              // decoding must stop at `&lt;b&gt;` and not continue to `<b>`.
              shortDescription: 'Write &amp;lt;b&amp;gt; to show a bold tag.',
              feeDescription: 'Fee &amp; permit &quot;combo&quot; &#39;pass&#39;&nbsp;here.',
              accessibilityInformation: 'Double ampersand: &amp;amp;',
              season: [],
              relatedParks: [{ parkCode: 'acad' }],
            },
          ],
        }),
      );

      const t = (await service.getThingsToDo({ parkCode: 'acad', limit: 15 }, ctx)).data[0]!;
      expect(t.shortDescription).toBe('Write &lt;b&gt; to show a bold tag.');
      expect(t.feeDescription).toBe('Fee & permit "combo" \'pass\' here.');
      expect(t.accessibility).toBe('Double ampersand: &amp;');
    });

    it('maps empty relatedParks to a null parkCode', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          data: [
            {
              id: 't2',
              title: 'Orphan activity',
              shortDescription: 'No park linked.',
              isReservationRequired: 'false',
              arePetsPermitted: 'false',
              relatedParks: [],
            },
          ],
        }),
      );

      const t = (await service.getThingsToDo({ stateCode: 'ME', limit: 15 }, ctx)).data[0]!;
      expect(t.parkCode).toBeNull();
    });
  });

  describe('findEvents', () => {
    it('reads sitecode as parkCode, coerces isfree, strips HTML, normalizes the distinct envelope', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          pagenumber: '1',
          pagesize: '15',
          errors: [],
          data: [
            {
              id: 'e1',
              eventid: 'e1',
              title: 'Ranger Talk',
              sitecode: 'yell',
              description: 'Join a <strong>ranger</strong> for a talk.',
              location: 'Visitor Center',
              datestart: '2026-07-04',
              dateend: '2026-07-04',
              times: [
                { timestart: '02:00 PM', timeend: '02:30 PM', sunrisestart: '', sunsetend: '' },
              ],
              category: 'Ranger Programs',
              isfree: 'true',
              feeinfo: '',
              regresurl: '',
              infourl: 'https://www.nps.gov/yell/event',
            },
          ],
        }),
      );

      const result = await service.findEvents(
        { parkCode: 'yell', pageSize: 15, pageNumber: 1 },
        ctx,
      );
      expect(result.total).toBe(1);
      expect(result.errors).toEqual([]);
      const e = result.data[0]!;
      expect(e.parkCode).toBe('yell');
      expect(e.description).toBe('Join a ranger for a talk.');
      expect(e.isFree).toBe(true);
      expect(e.feeInfo).toBeNull();
      expect(e.registrationUrl).toBeNull();
      expect(e.infoUrl).toBe('https://www.nps.gov/yell/event');
      expect(e.times).toEqual([{ timeStart: '02:00 PM', timeEnd: '02:30 PM' }]);
      // Sparse payload: dates[]/isrecurring omitted upstream → safe defaults.
      expect(e.occurrenceDates).toEqual([]);
      expect(e.isRecurring).toBe(false);
    });

    it('intersects dates[] with the requested window and exposes isRecurring', async () => {
      // dates[] spans the full recurrence range (Jul–Sep) independent of the
      // requested window; the service keeps only the in-window occurrences.
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          pagenumber: '1',
          pagesize: '15',
          errors: [],
          data: [
            {
              id: 'e2',
              eventid: '134460',
              title: 'Old Faithful Talk',
              sitecode: 'yell',
              description: 'A recurring series.',
              isrecurring: 'true',
              datestart: '2026-05-24',
              dateend: '2026-05-24',
              recurrencedatestart: '2026-05-24',
              recurrencedateend: '2026-09-26',
              dates: ['2026-07-16', '2026-08-01', '2026-08-15', '2026-09-26'],
              isfree: 'true',
            },
          ],
        }),
      );

      const result = await service.findEvents(
        {
          parkCode: 'yell',
          dateStart: '2026-08-01',
          dateEnd: '2026-08-31',
          pageSize: 15,
          pageNumber: 1,
        },
        ctx,
      );
      const e = result.data[0]!;
      expect(e.isRecurring).toBe(true);
      expect(e.occurrenceDates).toEqual(['2026-08-01', '2026-08-15']);
      // The record's own anchor date is untouched (the field #2 is about).
      expect(e.dateStart).toBe('2026-05-24');
    });

    it('reduces occurrenceDates to the full remaining list when no window is requested', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          errors: [],
          data: [
            {
              id: 'e3',
              eventid: '134460',
              title: 'Series',
              sitecode: 'yell',
              isrecurring: 'true',
              datestart: '2026-05-24',
              dateend: '2026-05-24',
              dates: ['2026-07-16', '2026-08-01', '2026-09-26'],
              isfree: 'false',
            },
          ],
        }),
      );

      const result = await service.findEvents(
        { parkCode: 'yell', pageSize: 15, pageNumber: 1 },
        ctx,
      );
      expect(result.data[0]!.occurrenceDates).toEqual(['2026-07-16', '2026-08-01', '2026-09-26']);
      expect(result.data[0]!.isRecurring).toBe(true);
    });

    it('a non-recurring event carries isRecurring false and its single date', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          errors: [],
          data: [
            {
              id: 'e4',
              eventid: '131081',
              title: 'One-off',
              sitecode: 'inde',
              isrecurring: 'false',
              datestart: '2026-07-18',
              dateend: '2026-07-18',
              dates: ['2026-07-18'],
              isfree: 'true',
            },
          ],
        }),
      );

      const result = await service.findEvents(
        {
          parkCode: 'inde',
          dateStart: '2026-07-01',
          dateEnd: '2026-07-31',
          pageSize: 15,
          pageNumber: 1,
        },
        ctx,
      );
      expect(result.data[0]!.isRecurring).toBe(false);
      expect(result.data[0]!.occurrenceDates).toEqual(['2026-07-18']);
    });

    it('keeps prose around bare < and > while still stripping real tags', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          errors: [],
          data: [
            {
              id: 'e5',
              title: 'Stats Talk',
              sitecode: 'yell',
              description:
                '<p>Significant at p < 0.05 and x > 3.</p><p>Ages <12 ride free; groups >20 book ahead.</p><!-- internal note --><br/>Bring water.',
            },
          ],
        }),
      );

      const result = await service.findEvents(
        { parkCode: 'yell', pageSize: 15, pageNumber: 1 },
        ctx,
      );
      expect(result.data[0]!.description).toBe(
        'Significant at p < 0.05 and x > 3. Ages <12 ride free; groups >20 book ahead. Bring water.',
      );
    });

    it('removes a tag reassembled from the pieces left by an inner tag', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '1',
          errors: [],
          data: [{ id: 'e6', title: 'x', description: 'Go <scr<b>ipt>here</scr<b>ipt> now.' }],
        }),
      );

      const result = await service.findEvents(
        { parkCode: 'yell', pageSize: 15, pageNumber: 1 },
        ctx,
      );
      expect(result.data[0]!.description).not.toMatch(/<\/?[A-Za-z]/);
      expect(result.data[0]!.description).toBe('Go here now.');
    });

    it('surfaces a non-empty envelope errors[] in the result', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          total: '0',
          pagenumber: '1',
          pagesize: '15',
          errors: ['Date range too large'],
          data: [],
        }),
      );

      const result = await service.findEvents(
        { parkCode: 'yell', pageSize: 15, pageNumber: 1 },
        ctx,
      );
      expect(result.data).toEqual([]);
      expect(result.errors).toEqual(['Date range too large']);
    });
  });

  describe('markup stripping cost', () => {
    /** Best-of-5 wall time (ms) for one normalization of `text` through `run`. */
    async function bestOf(run: () => Promise<unknown>): Promise<number> {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await run();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    }

    it.each([
      { label: "repeated '<' with no closing >", make: (n: number) => '<'.repeat(n) },
      {
        label: "repeated '<a ' with no closing >",
        make: (n: number) => '<a '.repeat(Math.ceil(n / 3)).slice(0, n),
      },
      {
        // Each removed inner tag joins the pieces around it into a new tag.
        label: "nested '<a<a…>>' tags",
        make: (n: number) => '<a'.repeat(Math.floor(n / 3)) + '>'.repeat(Math.floor(n / 3)),
      },
    ])('stays linear on $label', async ({ make }) => {
      const timings: Record<number, number> = {};
      for (const size of [5_000, 20_000, 80_000]) {
        const text = make(size);
        const eventBody = okResponse({
          total: '1',
          errors: [],
          data: [{ id: 'p', description: text }],
        });
        const parkBody = okResponse({ data: [{ parkCode: 'perf', weatherInfo: text }] });
        timings[size] = await bestOf(async () => {
          mockFetch.mockResolvedValueOnce(eventBody).mockResolvedValueOnce(parkBody);
          await service.findEvents({ pageSize: 1, pageNumber: 1 }, ctx);
          await service.getParks(['perf'], ['hours'], ctx);
        });
      }
      // Linear growth is ~16x from 5k to 80k; quadratic backtracking is ~256x.
      expect(timings[80_000]! / timings[5_000]!).toBeLessThan(64);
      expect(timings[80_000]!).toBeLessThan(100);
    });
  });

  describe('query encoding', () => {
    it('sends literal commas for multi-value parkCode (NPS rejects %2C and drops all but the first)', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getParks(['yose', 'grca', 'zion'], ['activities'], ctx);

      const url = mockFetch.mock.calls[0]![0]! as string;
      expect(url).toContain('parkCode=yose,grca,zion');
      expect(url).not.toContain('%2C');
    });

    it('sends literal commas for multi-value stateCode', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getAlerts({ parkCode: 'yose,zion', stateCode: 'WY,MT', limit: 20 }, ctx);

      const url = mockFetch.mock.calls[0]![0]! as string;
      expect(url).toContain('parkCode=yose,zion');
      expect(url).toContain('stateCode=WY,MT');
      expect(url).not.toContain('%2C');
    });

    it('still percent-encodes spaces in free-text query', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.findParks({ query: 'civil war', limit: 10 }, ctx);

      const url = mockFetch.mock.calls[0]![0]! as string;
      // URLSearchParams encodes a space as '+'; the point is it stays encoded.
      expect(url).toMatch(/q=civil(\+|%20)war/);
    });
  });

  describe('error handling', () => {
    it('reframes a 403 from fetchWithTimeout as an actionable Unauthorized naming the key', async () => {
      mockFetch.mockImplementationOnce(() => throwHttp(403));
      const err = await service.findParks({ query: 'x', limit: 10 }, ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe(JsonRpcErrorCode.Unauthorized);
      expect((err as McpError).message).toMatch(/NPS_API_KEY/);
    });

    it('detects the NPS API_KEY_INVALID error envelope and throws Unauthorized', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({
          error: { code: 'API_KEY_INVALID', message: 'An invalid api_key was supplied.' },
        }),
      );
      const err = await service
        .getAlerts({ parkCode: 'glac', limit: 20 }, ctx)
        .catch((e: unknown) => e);
      expect((err as McpError).code).toBe(JsonRpcErrorCode.Unauthorized);
      expect((err as McpError).message).toMatch(/NPS_API_KEY/);
    });

    it('lets a 500 bubble as ServiceUnavailable (transient)', async () => {
      mockFetch.mockImplementationOnce(() => throwHttp(503));
      const err = await service.findParks({ query: 'x', limit: 10 }, ctx).catch((e: unknown) => e);
      expect((err as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    });
  });
});
