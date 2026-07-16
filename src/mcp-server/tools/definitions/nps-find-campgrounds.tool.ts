/**
 * @fileoverview nps_find_campgrounds — campgrounds at a park or state with
 * amenities (water, showers, hookups, dump station), reservable vs. first-come
 * site counts, reservation info, accessibility, and fees flattened to what a
 * camper actually filters on.
 * @module mcp-server/tools/definitions/nps-find-campgrounds.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';
import type { NpsCampground } from '@/services/nps/types.js';

export const npsFindCampgrounds = tool('nps_find_campgrounds', {
  title: 'national-parks-mcp-server: find campgrounds',
  description:
    'Campgrounds at a park or across a state: amenities (potable water, showers, RV dump station, toilets, trash collection, RV access), reservable vs. first-come-first-served site counts, reservation guidance and booking URL, accessibility, and fees — answering "where can I camp at Zion, and can I get an RV hookup?" Get park codes from nps_find_parks. Some parks list lodging or backcountry permits instead of NPS-managed campgrounds; an empty result is not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .regex(/^[a-z]{4}(,[a-z]{4})*$/)
      .optional()
      .describe(
        'Park code, or comma-separated list (e.g. "zion"). Get codes from nps_find_parks. Provide parkCode or stateCode.',
      ),
    stateCode: z
      .string()
      .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
      .optional()
      .describe(
        'Two-letter state code, or comma-separated list. Returns campgrounds across all NPS sites in those states.',
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Free-text search across campground names/descriptions (e.g. "river", "group", "rv").',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(15)
      .describe('Maximum campgrounds to return (1–50).'),
    start: z.number().int().min(0).default(0).describe('Zero-based pagination offset.'),
  }),
  output: z.object({
    campgrounds: z
      .array(
        z
          .object({
            id: z.string().describe('Campground ID.'),
            name: z.string().describe('Campground name (e.g. "Watchman Campground").'),
            parkCode: z.string().describe('Park code the campground belongs to.'),
            description: z.string().describe('Short campground description.'),
            latitude: z.number().nullable().describe('Latitude (decimal degrees) or null.'),
            longitude: z.number().nullable().describe('Longitude (decimal degrees) or null.'),
            totalSites: z
              .number()
              .nullable()
              .describe('Total number of campsites, or null if unspecified.'),
            reservableSites: z
              .number()
              .nullable()
              .describe(
                'Number of reservable sites, or null. 0 means first-come-first-served only.',
              ),
            firstComeSites: z
              .number()
              .nullable()
              .describe('Number of first-come-first-served sites, or null.'),
            reservationInfo: z
              .string()
              .nullable()
              .describe('Free-text reservation guidance (how/where to book), or null.'),
            reservationUrl: z
              .string()
              .nullable()
              .describe('Booking URL (often recreation.gov), or null.'),
            fee: z
              .string()
              .nullable()
              .describe(
                'Lowest campground fee as a dollar string (e.g. "30.00"), or null if free / unspecified.',
              ),
            amenities: z
              .object({
                potableWater: z.boolean().describe('Drinking water available on site.'),
                showers: z.boolean().describe('Showers available.'),
                dumpStation: z.boolean().describe('RV dump station available.'),
                rvAllowed: z.boolean().describe('RVs permitted.'),
                toilets: z.boolean().describe('Toilets (flush or vault) available.'),
                trashCollection: z.boolean().describe('Trash/recycling collection on site.'),
              })
              .describe(
                "Key amenities as booleans, normalized from NPS's mixed array/string amenity fields. The campground's NPS page has the full amenity list.",
              ),
            accessibility: z
              .string()
              .nullable()
              .describe(
                'Free-text accessibility summary (from accessibility.adaInfo), or null if absent/empty.',
              ),
            url: z
              .string()
              .nullable()
              .describe(
                "Campground's NPS.gov page, or null — the source for the full amenity/site detail trimmed here.",
              ),
          })
          .describe('A single campground with amenities, site counts, and reservation info.'),
      )
      .describe('Campgrounds at the requested park(s)/state(s).'),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Total campgrounds matching the filter before the limit was applied.'),
    shown: z
      .number()
      .optional()
      .describe('Campgrounds returned in this response (populated when capped by limit).'),
    cap: z.number().optional().describe('Limit applied (populated when results were truncated).'),
    appliedFilters: z.string().describe('Echo of parkCode/stateCode/query as applied.'),
    notice: z.string().optional().describe('Guidance when no campgrounds matched.'),
  },
  enrichmentTrailer: {
    totalCount: { label: 'Total Campgrounds' },
    shown: { label: 'Shown' },
    cap: { label: 'Limit' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'invalid_park_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A parkCode token isn't 4 lowercase letters.",
      recovery:
        'Provide 4-letter lowercase park codes (e.g. "zion"), comma-separated. Look them up with nps_find_parks.',
    },
    {
      reason: 'invalid_state_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A stateCode token isn't two letters.",
      recovery: 'Provide two-letter state codes, comma-separated.',
    },
  ],

  async handler(input, ctx) {
    const result = await getNpsService().findCampgrounds(
      {
        query: input.query,
        parkCode: input.parkCode,
        stateCode: input.stateCode,
        limit: input.limit,
        start: input.start,
      },
      ctx,
    );

    const filters = [
      input.parkCode ? `parkCode=${input.parkCode}` : null,
      input.stateCode ? `stateCode=${input.stateCode}` : null,
      input.query ? `query="${input.query}"` : null,
    ].filter(Boolean);

    ctx.enrich({ appliedFilters: filters.length > 0 ? filters.join(', ') : 'none' });
    ctx.enrich.total(result.total);
    ctx.log.info('Fetched campgrounds', {
      count: result.data.length,
      total: result.total,
      start: input.start,
    });

    const notices: string[] = [];
    if (result.data.length === 0) {
      // An empty page past the end is NOT an absence of campgrounds.
      notices.push(
        result.total > 0
          ? `No campgrounds on this page: start=${input.start} is past the end of ${result.total} matching campground(s). Re-request with start=0 to see them.`
          : `No campgrounds found for ${filters.length > 0 ? filters.join(', ') : 'this search'}. The park may have no NPS-managed campgrounds, or try a broader state query. Some parks list lodging/backcountry permits instead — see the park page via nps_get_park.`,
      );
    }

    // Every notice source composes into ONE string: ctx.enrich.truncated()
    // writes a notice internally, so a second writer would clobber the first.
    const nextStart = input.start + result.data.length;
    if (nextStart < result.total) {
      notices.push(
        `Showing ${result.data.length} of ${result.total} campgrounds. Request the next page with start=${nextStart}.`,
      );
      ctx.enrich.truncated({
        shown: result.data.length,
        cap: input.limit,
        guidance: notices.join(' '),
      });
    } else if (notices.length > 0) {
      ctx.enrich.notice(notices.join(' '));
    }

    return { campgrounds: result.data };
  },

  format: (result) => {
    if (result.campgrounds.length === 0) {
      return [{ type: 'text', text: 'No campgrounds found. See the notice for next steps.' }];
    }
    const lines: string[] = [`## ${result.campgrounds.length} campgrounds`, ''];
    for (const c of result.campgrounds) {
      lines.push(`### ${c.name}`);
      lines.push(`**Park:** ${c.parkCode} | **ID:** ${c.id} | **Sites:** ${siteSummary(c)}`);
      if (c.description) lines.push(c.description);
      lines.push(`**Amenities:** ${amenityLine(c)}`);
      if (c.fee) lines.push(`**Fee:** $${c.fee}`);
      if (c.reservationInfo) lines.push(`**Reservations:** ${c.reservationInfo}`);
      if (c.reservationUrl) lines.push(`[Book](${c.reservationUrl})`);
      if (c.accessibility) lines.push(`**Accessibility:** ${c.accessibility}`);
      if (c.latitude != null && c.longitude != null) {
        lines.push(`**Coordinates:** ${c.latitude}, ${c.longitude}`);
      }
      if (c.url) lines.push(`[Campground page](${c.url})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});

function siteSummary(c: NpsCampground): string {
  const total = c.totalSites != null ? String(c.totalSites) : 'unknown';
  const reservable = c.reservableSites ?? 0;
  const firstCome = c.firstComeSites ?? 0;
  return `${total} (${reservable} reservable, ${firstCome} first-come)`;
}

/** Explicit Yes/No per amenity — a camper filtering on "no RV" needs the No, too. */
function amenityLine(c: NpsCampground): string {
  const a = c.amenities;
  const yn = (b: boolean) => (b ? 'Yes' : 'No');
  return [
    `Potable water: ${yn(a.potableWater)}`,
    `Showers: ${yn(a.showers)}`,
    `Dump station: ${yn(a.dumpStation)}`,
    `RV allowed: ${yn(a.rvAllowed)}`,
    `Toilets: ${yn(a.toilets)}`,
    `Trash collection: ${yn(a.trashCollection)}`,
  ].join(' · ');
}
