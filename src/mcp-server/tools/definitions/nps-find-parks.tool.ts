/**
 * @fileoverview nps_find_parks — the entry-point tool. Resolves a place name,
 * state, or free-text query to NPS parks, returning the parkCode spine plus a
 * trip-planning summary. Two local passes run over the full matched set (never a
 * single upstream page): an `activity` filter (the API has no activity param)
 * and a relevance re-rank for `query` (the API's `q` returns no relevance order,
 * so exact parkCode/name matches are sorted ahead of description-only matches
 * before the page is sliced).
 * @module mcp-server/tools/definitions/nps-find-parks.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';
import type { NpsParkSummary } from '@/services/nps/types.js';

/**
 * Upstream page size used when a local pass — the `activity` filter or the
 * `query` re-rank — needs the whole matched set rather than one page. `/parks`
 * has no activity param and returns no relevance order, so both passes are only
 * honest over the full set matched by query/stateCode — one request covers it
 * (474 sites service-wide as of 2026-07; the API caps nothing and returns
 * min(limit, total)). query and stateCode still narrow upstream first (NPS `q`
 * alone cuts "yosemite" to 3 matches), so the full-catalog fetch is the worst
 * case, not the common one. Paired with `start: 0`: an upstream offset combined
 * with a local pass silently skips records before the filter/ranker sees them,
 * so the two must never co-occur.
 */
const LOCAL_PROCESSING_FETCH_LIMIT = 1000;

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
        'Free-text search across park names and descriptions (e.g. "yosemite", "civil war", "redwood"). Results are re-ranked locally so an exact parkCode or name match leads: NPS returns matches in alphabetical-by-code order with no relevance ranking, so without this the obvious park can sit behind sites that only mention the term in their description. Omit to browse by state. At least one of query or stateCode is recommended; with neither, returns the first page of all ~470 NPS sites.',
      ),
    stateCode: z
      .string()
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
    // Code-format validation runs HERE, not at the Zod schema edge — a schema-level
    // regex failure throws a raw ZodError before ctx.fail exists, so the declared
    // recovery hint would never reach the client (#3).
    if (input.stateCode && !input.stateCode.split(',').every((t) => /^[A-Za-z]{2}$/.test(t))) {
      throw ctx.fail(
        'invalid_state_code',
        `stateCode "${input.stateCode}" must be two-letter code(s), comma-separated.`,
        { ...ctx.recoveryFor('invalid_state_code') },
      );
    }

    // Two-mode fetch. A local pass — the activity filter or the query re-rank —
    // cannot compose with an upstream offset: `start` would skip records upstream
    // before the pass ever saw them. So when either is active, pull the whole
    // matched set from offset 0 and slice here; with neither, `start`/`limit`
    // pass straight through as the cheap page fetch.
    const activity = input.activity?.trim();
    const query = input.query?.trim();
    const localProcessing = Boolean(activity) || Boolean(query);
    const result = await getNpsService().findParks(
      {
        query: input.query,
        stateCode: input.stateCode,
        limit: localProcessing ? LOCAL_PROCESSING_FETCH_LIMIT : input.limit,
        start: localProcessing ? 0 : input.start,
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
      parks = parks.filter((p) => p.activities.some((a) => a.toLowerCase().includes(needle)));
      total = parks.length;
      if (!scannedWholeCorpus) {
        notices.push(
          `Only the first ${result.data.length} of ${result.total} sites were scanned for activity="${activity}", so this is a best-effort match rather than every one — narrow with stateCode or query for an exhaustive result.`,
        );
      }
    }

    // Re-rank the FULL matched set (not the page) so exact parkCode/name matches
    // lead. NPS `/parks` is alphabetical-by-code with no relevance order, so an
    // exact match can sit anywhere — even past the caller's page. Ranking the
    // already-sliced page would bury it exactly as the raw upstream order does.
    if (query) parks = rankByRelevance(parks, query);

    // Slice locally when we pulled the whole set (filter and/or re-rank). The
    // plain page path already returned exactly the requested window upstream.
    if (localProcessing) parks = parks.slice(input.start, input.start + input.limit);

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
  // Render the full list — structuredContent carries every activity, so the text
  // channel must too, or content[]-only clients silently see fewer of them.
  return `**Activities:** ${p.activities.join(', ')}`;
}

/** Lowercase + strip diacritics + collapse whitespace, so a query compares
 * against parkCode/fullName without an accent or spacing mismatch. */
function normalizeForRank(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Relevance tier for a park against a normalized query — lower sorts first.
 * A stable, transparent classification (no fabricated scores): an exact code or
 * name match beats a name prefix, which beats the term elsewhere in the name,
 * which beats a description-only match (the sites NPS returns because the term
 * appears only in their description).
 */
function relevanceTier(park: NpsParkSummary, normQuery: string): number {
  const code = normalizeForRank(park.parkCode);
  const name = normalizeForRank(park.fullName);
  if (code === normQuery) return 0; // exact parkCode ("zion" → zion)
  if (name === normQuery) return 1; // exact full name
  if (name.startsWith(normQuery)) return 2; // name prefix ("yosemite" → Yosemite National Park)
  if (name.includes(normQuery)) return 3; // term elsewhere in the name ("canyon" → Bryce Canyon)
  return 4; // description-only / other
}

/**
 * Re-rank the matched set so exact code/name matches lead, preserving NPS's
 * upstream order within each tier (stable sort keyed on the original index).
 * Two parks that both start with the query (e.g. Glacier vs Glacier Bay) keep
 * NPS's order — this surfaces name matches above description-only ones, it does
 * not invent a finer relevance signal than the tiers express.
 */
function rankByRelevance(parks: NpsParkSummary[], query: string): NpsParkSummary[] {
  const normQuery = normalizeForRank(query);
  if (normQuery === '') return parks;
  return parks
    .map((park, index) => ({ park, index, tier: relevanceTier(park, normQuery) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.park);
}
