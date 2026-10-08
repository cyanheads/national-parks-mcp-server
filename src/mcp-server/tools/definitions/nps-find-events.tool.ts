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
    'Scheduled events at a park within a date range — ranger programs, festivals, tours, interpretive events — answering "what\'s happening at Yellowstone this weekend?" with title, dates and times, location, category, fee, and registration links. Get park codes from nps_find_parks. Paginates by page number, not offset. Many parks list few or no events; an empty result is not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .optional()
      .describe(
        'Park code, or comma-separated list (e.g. "yell") — 4-letter lowercase codes. Get codes from nps_find_parks. Provide parkCode or stateCode.',
      ),
    stateCode: z
      .string()
      .optional()
      .describe(
        'Two-letter state code, or comma-separated list (e.g. "WY", "WY,MT,ID"). Returns events across NPS sites in those states.',
      ),
    dateStart: z
      .string()
      .optional()
      .describe(
        'Start of the date window (YYYY-MM-DD). Combine with dateEnd to bound the search (e.g. a weekend). Omit for upcoming events from today.',
      ),
    dateEnd: z
      .string()
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
            description: z.string().describe('Event description as plain text.'),
            location: z
              .string()
              .nullable()
              .describe('Event location within the park (free text), or null.'),
            dateStart: z
              .string()
              .nullable()
              .describe(
                'Event start date (YYYY-MM-DD), or null. For a recurring event this is the series anchor (its original first date), which can predate your requested window — use occurrenceDates for the dates that actually fall in the window.',
              ),
            dateEnd: z
              .string()
              .nullable()
              .describe(
                'Event end date (YYYY-MM-DD), or null. For a recurring event this is the anchor date, not the last occurrence — see occurrenceDates and isRecurring.',
              ),
            occurrenceDates: z
              .array(z.string())
              .describe(
                'Dates (YYYY-MM-DD) the event actually occurs within the requested dateStart/dateEnd window; with no window, every remaining occurrence from today through the series end. Empty when the window matches no occurrence. For a recurring series, dateStart/dateEnd hold the series anchor instead.',
              ),
            isRecurring: z
              .boolean()
              .describe(
                'True when this is a recurring series (multiple occurrence dates); dateStart/dateEnd then hold the series anchor and occurrenceDates the actual dates.',
              ),
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
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when more matching events follow this page; absent on the last page of the result.',
      ),
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
        'Guidance on the result set: how to widen a search that matched nothing, the pageNumber for the next page when more events matched, the way back when pageNumber ran past the end, and a warning when NPS reports errors for the request.',
      ),
  },
  enrichmentTrailer: {
    truncated: { label: 'Truncated' },
    shown: { label: 'Shown' },
    cap: { label: 'Page Size' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'invalid_date',
      code: JsonRpcErrorCode.ValidationError,
      when: 'dateStart/dateEnd not YYYY-MM-DD, not a real calendar date (e.g. 2026-02-31), or dateEnd < dateStart.',
      recovery:
        'Provide dates as real YYYY-MM-DD calendar dates with dateEnd on or after dateStart (e.g. dateStart "2026-07-04", dateEnd "2026-07-06").',
    },
    {
      reason: 'invalid_park_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A parkCode token isn't 4 lowercase letters.",
      recovery:
        'Provide 4-letter lowercase park codes (e.g. "yell"), comma-separated. Look them up with nps_find_parks.',
    },
    {
      reason: 'invalid_state_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A stateCode token isn't two letters.",
      recovery: 'Provide two-letter state codes (e.g. "WY"), comma-separated.',
    },
  ],

  async handler(input, ctx) {
    // Code and date validation runs HERE, not as a schema .regex()/.refine(): a
    // schema rejection reaches the client as -32602 invalid_arguments with only
    // the pattern as its hint, so the declared reasons and recoveries never
    // would (#3, #8, #12).
    if (input.parkCode && !input.parkCode.split(',').every((t) => /^[a-z]{4}$/.test(t))) {
      throw ctx.fail(
        'invalid_park_code',
        `parkCode "${input.parkCode}" must be 4-letter lowercase code(s), comma-separated.`,
      );
    }
    if (input.stateCode && !input.stateCode.split(',').every((t) => /^[A-Za-z]{2}$/.test(t))) {
      throw ctx.fail(
        'invalid_state_code',
        `stateCode "${input.stateCode}" must be two-letter code(s), comma-separated.`,
      );
    }
    // Shape first, then the calendar: "2026-02-31" is YYYY-MM-DD but not a real
    // date, and would otherwise reach NPS as a 400 (#8). An empty string from a
    // form client reads as omitted.
    for (const [field, value] of [
      ['dateStart', input.dateStart],
      ['dateEnd', input.dateEnd],
    ] as const) {
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw ctx.fail('invalid_date', `${field} "${value}" is not in YYYY-MM-DD format.`);
      }
      if (!isRealCalendarDate(value)) {
        throw ctx.fail('invalid_date', `${field} "${value}" is not a real calendar date.`);
      }
    }
    // Cross-field date validation.
    if (input.dateStart && input.dateEnd && input.dateEnd < input.dateStart) {
      throw ctx.fail(
        'invalid_date',
        `dateEnd ${input.dateEnd} is before dateStart ${input.dateStart}.`,
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
        ? `${input.dateStart || 'today'} to ${input.dateEnd || 'open'}`
        : 'upcoming';
    const filters = [
      input.parkCode ? `parkCode=${input.parkCode}` : null,
      input.stateCode ? `stateCode=${input.stateCode}` : null,
      `dates=${window}`,
      input.query ? `query="${input.query}"` : null,
    ].filter(Boolean);

    ctx.enrich({ appliedFilters: filters.join(', ') });
    ctx.enrich.total(result.total);
    ctx.log.info('Fetched events', {
      count: result.data.length,
      total: result.total,
      pageNumber: input.pageNumber,
      upstreamErrors: result.errors.length,
    });

    // The events envelope can report errors[] even on a 200 — warn, don't throw.
    const warning = result.errors.length > 0 ? ` NPS reported: ${result.errors.join('; ')}.` : '';
    const notices: string[] = [];
    if (result.data.length === 0) {
      // An empty page past the end is NOT an absence of events.
      notices.push(
        result.total > 0
          ? `No events on this page: pageNumber=${input.pageNumber} is past the end of ${result.total} matching event(s). Re-request with pageNumber=1 to see them.${warning}`
          : `No events found for ${filters.join(', ')}. Widen the date range, drop the query filter, or check the park calendar via the park page. Many parks list few or no events.${warning}`,
      );
    } else if (warning) {
      notices.push(`Events returned, but NPS reported errors for this request.${warning}`);
    }

    // Every notice source composes into ONE string: ctx.enrich.truncated()
    // writes a notice internally, so a second writer would clobber the first.
    // /events pages by 1-based pageNumber, not a start offset.
    const seenThroughPage = (input.pageNumber - 1) * input.pageSize + result.data.length;
    if (seenThroughPage < result.total) {
      notices.push(
        `Showing ${result.data.length} of ${result.total} events. Request the next page with pageNumber=${input.pageNumber + 1}.`,
      );
      ctx.enrich.truncated({
        shown: result.data.length,
        cap: input.pageSize,
        guidance: notices.join(' '),
      });
    } else if (notices.length > 0) {
      ctx.enrich.notice(notices.join(' '));
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
      if (e.isRecurring) {
        lines.push(
          e.occurrenceDates.length > 0
            ? `**Recurring event** — occurrence dates: ${e.occurrenceDates.join(', ')}`
            : '**Recurring event** — no listed occurrences fall in the requested window; the date above is the series anchor, not an occurrence.',
        );
      }
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

/**
 * True when a YYYY-MM-DD string is a real calendar date. JS `Date` silently rolls
 * impossible components forward (Feb 31 → Mar 3), so build the date in UTC and
 * confirm every component survives the round-trip — the standard, synchronous,
 * dependency-free validity check. The caller has already checked the YYYY-MM-DD
 * shape.
 */
function isRealCalendarDate(value: string): boolean {
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}
