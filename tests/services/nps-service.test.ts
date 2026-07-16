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
  requestContextService: {
    createRequestContext: (fields: Record<string, unknown>) => ({ ...fields }),
  },
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
      const park = result.data[0];
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

      const park = (await service.findParks({ limit: 10 }, ctx)).data[0];
      expect(park.latitude).toBeNull();
      expect(park.longitude).toBeNull();
      expect(park.activities).toEqual([]);
      expect(park.entranceFee).toBeNull();
    });
  });

  describe('getParks', () => {
    it('extracts topics/activities names, coerces detail, caps images at 5, honors fields', async () => {
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

      const park = (await service.getParks(['havo'], undefined, ctx))[0];
      expect(park.activities).toEqual(['Hiking']);
      expect(park.topics).toEqual(['Volcanoes']);
      expect(park.entranceFees).toEqual([
        { cost: '30.00', title: 'Vehicle', description: '7 days' },
      ]);
      expect(park.images).toHaveLength(5);
      expect(park.weatherOverview).toBe('Variable.');
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
              url: 'https://www.nps.gov/havo/',
              activities: [{ id: '1', name: 'Hiking' }],
              entranceFees: [{ cost: '30.00', title: 'Vehicle', description: '7 days' }],
            },
          ],
        }),
      );

      const park = (await service.getParks(['havo'], ['hours'], ctx))[0];
      expect(park.activities).toBeUndefined();
      expect(park.entranceFees).toBeUndefined();
      expect(park.operatingHours).toEqual([]);
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

      const alert = (await service.getAlerts({ parkCode: 'glac', limit: 20 }, ctx)).data[0];
      expect(alert.url).toBeNull();
      expect(alert.lastIndexedDate).toBe('2026-05-30');
      expect(alert.category).toBe('Park Closure');
    });

    it('sends start so alerts can paginate like the sibling list endpoints', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '58', data: [] }));
      await service.getAlerts({ stateCode: 'CA', limit: 20, start: 40 }, ctx);

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('start=40');
      expect(url).toContain('limit=20');
    });

    it('omits start when unset rather than sending start=undefined', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getAlerts({ parkCode: 'glac', limit: 20 }, ctx);

      const url = mockFetch.mock.calls[0]?.[0] as string;
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

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0];
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

      const cg = (await service.findCampgrounds({ parkCode: 'grca', limit: 15 }, ctx)).data[0];
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

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0];
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

      const cg = (await service.findCampgrounds({ parkCode: 'zion', limit: 15 }, ctx)).data[0];
      expect(cg.totalSites).toBeNull();
      expect(cg.reservableSites).toBeNull();
      expect(cg.firstComeSites).toBeNull();
      expect(cg.fee).toBeNull();
      expect(cg.accessibility).toBeNull();
      expect(cg.url).toBeNull();
      expect(cg.amenities.rvAllowed).toBe(false);
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

      const t = (await service.getThingsToDo({ parkCode: 'acad', limit: 15 }, ctx)).data[0];
      expect(t.parkCode).toBe('acad');
      expect(t.shortDescription).toBe('See the first light from the summit.');
      expect(t.duration).toBe('1-3 Hours');
      expect(t.reservationRequired).toBe(true);
      expect(t.petsPermitted).toBe(false);
      expect(t.feeDescription).toBe('Vehicle reservation required. Book');
      expect(t.season).toEqual(['Summer', 'Fall']);
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

      const t = (await service.getThingsToDo({ stateCode: 'ME', limit: 15 }, ctx)).data[0];
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
      const e = result.data[0];
      expect(e.parkCode).toBe('yell');
      expect(e.description).toBe('Join a ranger for a talk.');
      expect(e.isFree).toBe(true);
      expect(e.feeInfo).toBeNull();
      expect(e.registrationUrl).toBeNull();
      expect(e.infoUrl).toBe('https://www.nps.gov/yell/event');
      expect(e.times).toEqual([{ timeStart: '02:00 PM', timeEnd: '02:30 PM' }]);
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

  describe('query encoding', () => {
    it('sends literal commas for multi-value parkCode (NPS rejects %2C and drops all but the first)', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getParks(['yose', 'grca', 'zion'], ['activities'], ctx);

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('parkCode=yose,grca,zion');
      expect(url).not.toContain('%2C');
    });

    it('sends literal commas for multi-value stateCode', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.getAlerts({ parkCode: 'yose,zion', stateCode: 'WY,MT', limit: 20 }, ctx);

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('parkCode=yose,zion');
      expect(url).toContain('stateCode=WY,MT');
      expect(url).not.toContain('%2C');
    });

    it('still percent-encodes spaces in free-text query', async () => {
      mockFetch.mockResolvedValueOnce(okResponse({ total: '0', data: [] }));
      await service.findParks({ query: 'civil war', limit: 10 }, ctx);

      const url = mockFetch.mock.calls[0]?.[0] as string;
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
