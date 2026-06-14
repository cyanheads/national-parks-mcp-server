/**
 * @fileoverview nps_find_events — scheduled events at a park within a date range
 * (ranger programs, festivals, tours): title, dates/times, location, category,
 * fee, registration links. Backed by /events, which uses a distinct envelope and
 * page-based pagination. A non-empty envelope errors[] folds into the notice.
 * @module mcp-server/tools/definitions/nps-find-events.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';

export const npsFindEvents = tool('nps_find_events', {
  title: 'national-parks-mcp-server: find events',
  description:
    'Scheduled events at a park within a date range — ranger programs, festivals, tours, interpretive events — answering "what\'s happening at Yellowstone this weekend?" with title, dates and times, location, category, fee, and registration links. Get park codes from nps_find_parks. Paginates by page number, not offset. The events feed is sparser and less consistent than alerts or campgrounds; many parks list few or no events, and an empty result is not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .regex(/^[a-z]{4}(,[a-z]{4})*$/)
      .optional()
      .describe(
        'Park code, or comma-separated list (e.g. "yell"). Get codes from nps_find_parks. Provide parkCode or stateCode.',
      ),
    stateCode: z
      .string()
      .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
      .optional()
      .describe(
        'Two-letter state code, or comma-separated list. Returns events across NPS sites in those states.',
      ),
    dateStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        'Start of the date window (YYYY-MM-DD). Combine with dateEnd to bound the search (e.g. a weekend). Omit for upcoming events from today.',
      ),
    dateEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('End of the date window (YYYY-MM-DD). Use with dateStart.'),
    query: z
      .string()
      .optional()
      .describe(
        'Free-text search across event titles/descriptions (e.g. "ranger", "astronomy", "guided").',
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(15)
      .describe(
        'Maximum events to return per page (1–50). Paginates by page number, not offset — use with pageNumber to walk through results.',
      ),
    pageNumber: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-based page number. Increment to page through results beyond the first page.'),
  }),
  output: z.object({
    events: z
      .array(
        z
          .object({
            id: z.string().describe('Event ID.'),
            title: z.string().describe('Event title.'),
            parkCode: z
              .string()
              .nullable()
              .describe('Park code the event belongs to, or null if absent.'),
            description: z.string().describe('Event description (HTML stripped to plain text).'),
            location: z
              .string()
              .nullable()
              .describe('Event location within the park (free text), or null.'),
            dateStart: z.string().nullable().describe('Event start date (YYYY-MM-DD), or null.'),
            dateEnd: z.string().nullable().describe('Event end date (YYYY-MM-DD), or null.'),
            times: z
              .array(
                z
                  .object({
                    timeStart: z.string().describe('Start time (e.g. "02:00 PM").'),
                    timeEnd: z.string().describe('End time (e.g. "02:30 PM").'),
                  })
                  .describe('A single scheduled time slot.'),
              )
              .describe(
                'Scheduled time slots for the event. May be empty (all-day or unspecified).',
              ),
            category: z
              .string()
              .nullable()
              .describe('Event category (e.g. "Regular Event", "Ranger Programs"), or null.'),
            isFree: z.boolean().describe('Whether the event is free.'),
            feeInfo: z
              .string()
              .nullable()
              .describe('Fee details when not free (free text), or null.'),
            registrationUrl: z
              .string()
              .nullable()
              .describe('Registration/reservation URL, or null.'),
            infoUrl: z.string().nullable().describe('More-info URL, or null.'),
          })
          .describe('A single scheduled event with dates, times, and registration links.'),
      )
      .describe('Events matching the park/state and date window.'),
  }),
  enrichment: {
    totalCount: z.number().describe('Total events matching the filter before the page limit.'),
    shown: z
      .number()
      .optional()
      .describe('Events returned on this page (populated when the page was capped by pageSize).'),
    cap: z
      .number()
      .optional()
      .describe('Page size applied (populated when results were truncated).'),
    appliedFilters: z.string().describe('Echo of parkCode/stateCode/date window/query as applied.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no events matched, or a warning when the upstream envelope reported errors.',
      ),
  },
  enrichmentTrailer: {
    totalCount: { label: 'Total Events' },
    shown: { label: 'Shown' },
    cap: { label: 'Page Size' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'invalid_date',
      code: JsonRpcErrorCode.ValidationError,
      when: 'dateStart/dateEnd not YYYY-MM-DD, or dateEnd < dateStart.',
      recovery:
        'Provide dates as YYYY-MM-DD with dateEnd on or after dateStart (e.g. dateStart "2026-07-04", dateEnd "2026-07-06").',
    },
    {
      reason: 'invalid_park_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A parkCode token isn't 4 lowercase letters.",
      recovery:
        'Provide 4-letter lowercase park codes (e.g. "yell"), comma-separated. Look them up with nps_find_parks.',
    },
  ],

  async handler(input, ctx) {
    // Cross-field date validation the regex can't express (the regex guards format).
    if (input.dateStart && input.dateEnd && input.dateEnd < input.dateStart) {
      throw ctx.fail(
        'invalid_date',
        `dateEnd ${input.dateEnd} is before dateStart ${input.dateStart}.`,
        {
          ...ctx.recoveryFor('invalid_date'),
        },
      );
    }

    const result = await getNpsService().findEvents(
      {
        query: input.query,
        parkCode: input.parkCode,
        stateCode: input.stateCode,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        pageSize: input.pageSize,
        pageNumber: input.pageNumber,
      },
      ctx,
    );

    const window =
      input.dateStart || input.dateEnd
        ? `${input.dateStart ?? 'today'} to ${input.dateEnd ?? 'open'}`
        : 'upcoming';
    const filters = [
      input.parkCode ? `parkCode=${input.parkCode}` : null,
      input.stateCode ? `stateCode=${input.stateCode}` : null,
      `dates=${window}`,
      input.query ? `query="${input.query}"` : null,
    ].filter(Boolean);

    ctx.enrich({ appliedFilters: filters.join(', ') });
    ctx.enrich.total(result.total);
    if (result.total > result.data.length) {
      ctx.enrich.truncated({ shown: result.data.length, cap: input.pageSize });
    }
    ctx.log.info('Fetched events', {
      count: result.data.length,
      total: result.total,
      upstreamErrors: result.errors.length,
    });

    // The events envelope can report errors[] even on a 200 — warn, don't throw.
    const warning =
      result.errors.length > 0 ? ` Upstream reported: ${result.errors.join('; ')}.` : '';
    if (result.data.length === 0) {
      ctx.enrich.notice(
        `No events found for ${filters.join(', ')}. Widen the date range, drop the query filter, or check the park calendar via the park page. The events feed is sparser than alerts/campgrounds.${warning}`,
      );
    } else if (warning) {
      ctx.enrich.notice(`Events returned, but the upstream feed reported issues.${warning}`);
    }

    return { events: result.data };
  },

  format: (result) => {
    if (result.events.length === 0) {
      return [
        { type: 'text', text: 'No events found. See the notice for how to widen the search.' },
      ];
    }
    const lines: string[] = [`## ${result.events.length} events`, ''];
    for (const e of result.events) {
      lines.push(`### ${e.title}`);
      lines.push(`**ID:** ${e.id} | **When:** ${whenLine(e.dateStart, e.dateEnd, e.times)}`);
      if (e.location) lines.push(`**Where:** ${e.location}`);
      if (e.category) lines.push(`**Category:** ${e.category}`);
      if (e.parkCode) lines.push(`**Park:** ${e.parkCode}`);
      if (e.description) lines.push(e.description);
      const feeLabel = e.isFree ? 'Free' : 'Not free';
      lines.push(`**Fee:** ${feeLabel}${e.feeInfo ? ` — ${e.feeInfo}` : ''}`);
      if (e.registrationUrl) lines.push(`[Register](${e.registrationUrl})`);
      if (e.infoUrl) lines.push(`[Info](${e.infoUrl})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});

function whenLine(
  dateStart: string | null,
  dateEnd: string | null,
  times: { timeStart: string; timeEnd: string }[],
): string {
  const dateRange =
    dateStart && dateEnd && dateStart !== dateEnd
      ? `${dateStart}–${dateEnd}`
      : (dateStart ?? dateEnd ?? 'date TBD');
  const slots = times.map((t) => `${t.timeStart}–${t.timeEnd}`).join(', ');
  return slots ? `${dateRange}, ${slots}` : dateRange;
}
