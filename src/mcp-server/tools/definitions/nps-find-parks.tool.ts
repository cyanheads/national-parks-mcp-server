/**
 * @fileoverview nps_find_parks — the entry-point tool. Resolves a place name,
 * state, or free-text query to NPS parks, returning the parkCode spine plus a
 * trip-planning summary. Activity is filtered locally over the full matched set
 * (no upstream param).
 * @module mcp-server/tools/definitions/nps-find-parks.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';
import type { NpsParkSummary } from '@/services/nps/types.js';

/**
 * Upstream page size used when `activity` forces local filtering. `/parks` has
 * no activity param, so the filter can only be honest if it sees the whole set
 * matched by query/stateCode — one request covers it (474 sites service-wide as
 * of 2026-07; the API caps nothing and returns min(limit, total)). query and
 * stateCode still narrow upstream first, so the full-catalog fetch is the worst
 * case, not the common one. Paired with `start: 0`: an upstream offset combined
 * with a local filter silently skips records, so the two must never co-occur.
 */
const ACTIVITY_FILTER_FETCH_LIMIT = 1000;

export const npsFindParks = tool('nps_find_parks', {
  title: 'national-parks-mcp-server: find parks',
  description:
    "Resolve a place name, US state, or free-text query to National Park Service parks — the required first step before the detail tools. Returns each park's parkCode (the key nps_get_park, nps_get_alerts, nps_find_campgrounds, nps_get_activities, and nps_find_events all use) plus a compact trip-planning summary (designation, states, description, coordinates, headline activities, entrance fee, NPS page). Coverage is US NPS sites only — national parks, monuments, historic sites, seashores — not state parks and not Forest Service or BLM land.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Free-text search across park names and descriptions (e.g. "yosemite", "civil war", "redwood"). Omit to browse by state. At least one of query or stateCode is recommended; with neither, returns the first page of all ~470 NPS sites.',
      ),
    stateCode: z
      .string()
      .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
      .optional()
      .describe(
        'Two-letter US state/territory code, or comma-separated list (e.g. "CA", "WY,MT,ID"). Filters to parks located in those states. Combine with query to narrow.',
      ),
    activity: z
      .string()
      .optional()
      .describe(
        'Filter to parks offering an activity, matched against each park\'s activities list (e.g. "hiking", "camping", "stargazing"). Case-insensitive substring match applied locally (the API has no activity param) across every site matching query/stateCode, then paginated with start/limit — so totalCount is the true count of matching parks, not a per-page tally. Use nps_get_park to see a park\'s full activity list.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe(
        'Maximum parks to return (1–50). The full set is ~470 sites; narrow with query/stateCode rather than paging through everything.',
      ),
    start: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset for pagination within the matched set. Use with limit to page through results.',
      ),
  }),
  output: z.object({
    parks: z
      .array(
        z
          .object({
            parkCode: z
              .string()
              .describe(
                'Park code — the key for nps_get_park, nps_get_alerts, nps_find_campgrounds, nps_get_activities, nps_find_events (e.g. "yose").',
              ),
            fullName: z.string().describe('Full official name (e.g. "Yosemite National Park").'),
            designation: z
              .string()
              .describe(
                'Site type (e.g. "National Park", "National Monument", "National Historic Site"). Empty string for sites without a designation.',
              ),
            states: z
              .string()
              .describe('Comma-separated state codes the park spans (e.g. "CA", "WY,MT,ID").'),
            description: z.string().describe('Short park description.'),
            latitude: z
              .number()
              .nullable()
              .describe(
                'Center latitude (decimal degrees), or null if the park record has no coordinates. Feed to nws-weather / open-meteo for a forecast.',
              ),
            longitude: z
              .number()
              .nullable()
              .describe('Center longitude (decimal degrees), or null if absent.'),
            activities: z
              .array(z.string())
              .describe(
                'Activity names available at the park (e.g. "Hiking", "Camping"). May be empty.',
              ),
            entranceFee: z
              .string()
              .nullable()
              .describe(
                'Lowest standard entrance fee as a dollar string (e.g. "35.00"), or null if the park is fee-free or lists no fee. Full fee/pass breakdown is in nps_get_park.',
              ),
            url: z
              .string()
              .describe(
                "Park's official NPS.gov page — the source for everything trimmed from this summary.",
              ),
          })
          .describe('A matching park with its parkCode and trip-planning summary.'),
      )
      .describe(
        'Matching parks, each carrying the parkCode needed to chain into the detail tools.',
      ),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Total parks matching the query/state filter before the limit was applied.'),
    shown: z
      .number()
      .optional()
      .describe(
        'Number of parks returned in this response (populated when the result set was capped by limit).',
      ),
    cap: z
      .number()
      .optional()
      .describe('The limit applied to this response (populated when results were truncated).'),
    appliedFilters: z
      .string()
      .describe(
        'Echo of the filters as the server applied them (query / stateCode / activity), so the agent can see what was searched.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no parks matched — suggests broadening the query, checking the state code, or dropping the activity filter.',
      ),
  },
  enrichmentTrailer: {
    totalCount: { label: 'Total Matches' },
    shown: { label: 'Shown' },
    cap: { label: 'Limit' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'invalid_state_code',
      code: JsonRpcErrorCode.ValidationError,
      when: 'A stateCode token is not two letters.',
      recovery:
        'Provide two-letter US state/territory codes, comma-separated (e.g. "CA" or "WY,MT,ID").',
    },
  ],

  async handler(input, ctx) {
    // Two-mode fetch. A local filter and an upstream offset cannot compose —
    // `start` would skip records upstream before `activity` ever saw them — so
    // when filtering, pull the whole matched set from offset 0 and slice here.
    // Unfiltered, `start`/`limit` pass straight through as the cheap page fetch.
    const activity = input.activity?.trim();
    const result = await getNpsService().findParks(
      {
        query: input.query,
        stateCode: input.stateCode,
        limit: activity ? ACTIVITY_FILTER_FETCH_LIMIT : input.limit,
        start: activity ? 0 : input.start,
      },
      ctx,
    );

    let parks = result.data;
    let total = result.total;
    const notices: string[] = [];

    if (activity) {
      // The upstream total is pre-filter; a shortfall means the corpus outgrew
      // the fetch limit and the filter only saw the first slice of it.
      const scannedWholeCorpus = result.data.length >= result.total;
      const needle = activity.toLowerCase();
      const matched = parks.filter((p) =>
        p.activities.some((a) => a.toLowerCase().includes(needle)),
      );
      total = matched.length;
      parks = matched.slice(input.start, input.start + input.limit);
      if (!scannedWholeCorpus) {
        notices.push(
          `Only the first ${result.data.length} of ${result.total} sites were scanned for activity="${activity}", so this is a best-effort match rather than every one — narrow with stateCode or query for an exhaustive result.`,
        );
      }
    }

    const filters = [
      input.query ? `query="${input.query}"` : null,
      input.stateCode ? `stateCode=${input.stateCode}` : null,
      activity ? `activity="${activity}"` : null,
    ].filter(Boolean);
    ctx.enrich({ appliedFilters: filters.length > 0 ? filters.join(', ') : 'none' });
    ctx.enrich.total(total);

    ctx.log.info('Resolved parks', {
      count: parks.length,
      total,
      start: input.start,
      hasActivityFilter: Boolean(activity),
    });

    if (parks.length === 0) {
      // An empty page past the end is NOT an absence of matches — pointing the
      // agent at "broaden the query" would send it to fix the wrong thing.
      notices.push(
        total > 0
          ? `No sites on this page: start=${input.start} is past the end of ${total} matching site(s). Re-request with start=0 to see them.`
          : `No NPS sites matched ${filters.length > 0 ? filters.join(', ') : 'your search'}. Broaden the query, verify the two-letter state code, or drop the activity filter. Coverage is US NPS sites only — not state parks or Forest Service / BLM land.`,
      );
    }

    // Every notice source composes into ONE string: ctx.enrich.truncated()
    // writes a notice internally, so a second writer would clobber the first.
    const nextStart = input.start + parks.length;
    if (nextStart < total) {
      notices.push(
        `Showing ${parks.length} of ${total} matching sites. Request the next page with start=${nextStart}.`,
      );
      ctx.enrich.truncated({ shown: parks.length, cap: input.limit, guidance: notices.join(' ') });
    } else if (notices.length > 0) {
      ctx.enrich.notice(notices.join(' '));
    }

    return { parks };
  },

  format: (result) => {
    if (result.parks.length === 0) {
      return [
        { type: 'text', text: 'No parks matched. See the notice for how to broaden the search.' },
      ];
    }
    const lines: string[] = [`## ${result.parks.length} parks`, ''];
    for (const p of result.parks) {
      lines.push(`### ${p.fullName}`);
      lines.push(
        `**parkCode:** ${p.parkCode} | **${p.designation || 'NPS site'}** | **States:** ${p.states || 'n/a'}`,
      );
      if (p.description) lines.push(p.description);
      lines.push(formatActivities(p));
      lines.push(
        p.entranceFee
          ? `**Entrance fee:** $${p.entranceFee}`
          : '**Entrance fee:** Fee-free / see park page',
      );
      if (p.latitude != null && p.longitude != null) {
        lines.push(`**Coordinates:** ${p.latitude}, ${p.longitude}`);
      }
      if (p.url) lines.push(`[NPS page](${p.url})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});

function formatActivities(p: NpsParkSummary): string {
  if (p.activities.length === 0) return '**Activities:** none listed';
  const head = p.activities.slice(0, 8).join(', ');
  const extra = p.activities.length > 8 ? ` + ${p.activities.length - 8} more` : '';
  return `**Activities:** ${head}${extra}`;
}
