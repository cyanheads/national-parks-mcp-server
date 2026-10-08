/**
 * @fileoverview nps_get_activities — curated things to do and points of interest
 * at a park (backed by /thingstodo): title, description, duration, location,
 * accessibility, and fee/pet/reservation flags. Single-string parkCode/stateCode;
 * at least one location filter is required.
 * @module mcp-server/tools/definitions/nps-get-activities.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';

export const npsGetActivities = tool('nps_get_activities', {
  title: 'national-parks-mcp-server: get activities',
  description:
    'Curated things to do and points of interest at a park — title, description, time commitment, location, accessibility, and fee/pet/reservation flags — answering "what should I do at Acadia?" Covers the NPS editorially-curated activity list (distinct from a park\'s raw activity tags in nps_get_park). Accepts a single 4-letter park code or a single two-letter state code, and at least one is required. Not every park has a curated list; an empty result is not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .optional()
      .describe(
        'A single 4-letter lowercase park code (e.g. "acad"). Get it from nps_find_parks. Accepts one park code, not a list. Provide parkCode or stateCode.',
      ),
    stateCode: z
      .string()
      .optional()
      .describe(
        'A single two-letter state code (e.g. "ME"). Returns curated activities across NPS sites in that state.',
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Free-text search across activity titles/descriptions (e.g. "sunrise", "hike", "tour").',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(15)
      .describe('Maximum activities to return (1–50).'),
    start: z.number().int().min(0).default(0).describe('Zero-based pagination offset.'),
  }),
  output: z.object({
    activities: z
      .array(
        z
          .object({
            id: z.string().describe('Activity ID.'),
            title: z
              .string()
              .describe('Activity title (e.g. "Watch the Sunrise from Cadillac Mountain").'),
            parkCode: z
              .string()
              .nullable()
              .describe('Park code the activity belongs to, or null if absent.'),
            shortDescription: z.string().describe('Concise description of the activity.'),
            location: z
              .string()
              .nullable()
              .describe('Where in the park this happens (free text), or null.'),
            latitude: z
              .number()
              .nullable()
              .describe('Activity latitude (decimal degrees) or null.'),
            longitude: z
              .number()
              .nullable()
              .describe('Activity longitude (decimal degrees) or null.'),
            duration: z
              .string()
              .nullable()
              .describe('Time commitment (e.g. "1-3 Hours"), or null.'),
            reservationRequired: z.boolean().describe('Whether a reservation is required.'),
            feeDescription: z
              .string()
              .nullable()
              .describe(
                'Fee info if any (free text), or null. Absence does not guarantee free — check the park page.',
              ),
            petsPermitted: z.boolean().describe('Whether pets are permitted.'),
            accessibility: z
              .string()
              .nullable()
              .describe('Accessibility information (free text), or null.'),
            season: z
              .array(z.string())
              .describe(
                'Seasons when the activity is available (e.g. ["Summer", "Fall"]). May be empty.',
              ),
            url: z.string().nullable().describe("Activity's NPS.gov page, or null."),
          })
          .describe('A single curated activity or point of interest.'),
      )
      .describe('Curated activities and points of interest for the requested park/state.'),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Total activities matching the filter before the limit was applied.'),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when more activities matched than this response returned; absent on a complete result.',
      ),
    shown: z
      .number()
      .optional()
      .describe('Activities returned in this response (populated when capped by limit).'),
    cap: z.number().optional().describe('Limit applied (populated when results were truncated).'),
    appliedFilters: z.string().describe('Echo of parkCode/stateCode/query as applied.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance on the result set: where else to look when no curated activities matched, the start value for the next page when more matched, or the way back when start ran past the end.',
      ),
  },
  enrichmentTrailer: {
    truncated: { label: 'Truncated' },
    shown: { label: 'Shown' },
    cap: { label: 'Limit' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'missing_filter',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither parkCode nor stateCode provided.',
      recovery:
        'Provide a parkCode (e.g. "acad") or stateCode (e.g. "ME"). At least one location filter is required.',
    },
    {
      reason: 'invalid_park_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "parkCode isn't a single 4-letter lowercase code.",
      recovery:
        'Provide one 4-letter lowercase park code (e.g. "acad"), not a list. Look it up with nps_find_parks.',
    },
    {
      reason: 'invalid_state_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "stateCode isn't a single two-letter code.",
      recovery: 'Provide one two-letter state code (e.g. "ME"), not a list.',
    },
  ],

  async handler(input, ctx) {
    // An empty string from a form client reads as omitted, so it falls through to
    // missing_filter rather than a format error.
    if (!input.parkCode && !input.stateCode) {
      throw ctx.fail('missing_filter');
    }
    // Code-format validation runs HERE, not as a schema .regex(): a schema
    // rejection reaches the client as -32602 invalid_arguments with only the
    // pattern as its hint, so the declared reason and recovery never would (#12).
    if (input.parkCode && !/^[a-z]{4}$/.test(input.parkCode)) {
      throw ctx.fail(
        'invalid_park_code',
        `parkCode "${input.parkCode}" must be a single 4-letter lowercase code.`,
      );
    }
    if (input.stateCode && !/^[A-Za-z]{2}$/.test(input.stateCode)) {
      throw ctx.fail(
        'invalid_state_code',
        `stateCode "${input.stateCode}" must be a single two-letter code.`,
      );
    }

    const result = await getNpsService().getThingsToDo(
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

    ctx.enrich({ appliedFilters: filters.join(', ') });
    ctx.enrich.total(result.total);
    ctx.log.info('Fetched activities', {
      count: result.data.length,
      total: result.total,
      start: input.start,
    });

    const notices: string[] = [];
    if (result.data.length === 0) {
      // An empty page past the end is NOT an absence of activities.
      notices.push(
        result.total > 0
          ? `No activities on this page: start=${input.start} is past the end of ${result.total} matching activity/activities. Re-request with start=0 to see them.`
          : `No curated activities found for ${filters.join(', ')}. Not every park has a curated things-to-do list — try nps_get_park for the park's activity tags and description.`,
      );
    }

    // Every notice source composes into ONE string: ctx.enrich.truncated()
    // writes a notice internally, so a second writer would clobber the first.
    const nextStart = input.start + result.data.length;
    if (nextStart < result.total) {
      notices.push(
        `Showing ${result.data.length} of ${result.total} activities. Request the next page with start=${nextStart}.`,
      );
      ctx.enrich.truncated({
        shown: result.data.length,
        cap: input.limit,
        guidance: notices.join(' '),
      });
    } else if (notices.length > 0) {
      ctx.enrich.notice(notices.join(' '));
    }

    return { activities: result.data };
  },

  format: (result) => {
    if (result.activities.length === 0) {
      return [
        {
          type: 'text',
          text: "No curated activities found. Try nps_get_park for the park's activity tags.",
        },
      ];
    }
    const lines: string[] = [`## ${result.activities.length} things to do`, ''];
    for (const a of result.activities) {
      lines.push(`### ${a.title}`);
      lines.push(`**ID:** ${a.id}`);
      const meta = [
        a.duration ? `**Duration:** ${a.duration}` : null,
        a.season.length > 0 ? `**Season:** ${a.season.join(', ')}` : null,
      ].filter(Boolean);
      if (meta.length > 0) lines.push(meta.join(' | '));
      if (a.shortDescription) lines.push(a.shortDescription);
      if (a.location) lines.push(`**Location:** ${a.location}`);
      lines.push(
        `**Reservation required:** ${a.reservationRequired ? 'Yes' : 'No'} · **Pets:** ${a.petsPermitted ? 'OK' : 'Not permitted'}`,
      );
      lines.push(`**Fee:** ${a.feeDescription ?? 'None listed (verify on the park page)'}`);
      if (a.accessibility) lines.push(`**Accessibility:** ${a.accessibility}`);
      if (a.latitude != null && a.longitude != null) {
        lines.push(`**Coordinates:** ${a.latitude}, ${a.longitude}`);
      }
      if (a.parkCode) lines.push(`**Park:** ${a.parkCode}`);
      if (a.url) lines.push(`[Details](${a.url})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});
