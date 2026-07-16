/**
 * @fileoverview nps_get_alerts — the time-sensitive headline tool. Current
 * alerts for park(s) or state(s) with category and recency surfaced
 * prominently, sorted most-recent-first on every client surface.
 * @module mcp-server/tools/definitions/nps-get-alerts.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';
import type { NpsAlert } from '@/services/nps/types.js';

/** Severity order for the categoryBreakdown summary — trip-affecting first. */
const CATEGORY_ORDER: Record<string, number> = {
  Danger: 0,
  'Park Closure': 1,
  Caution: 2,
  Information: 3,
};

/**
 * Upstream page size used when `category` forces local filtering. `/alerts` has
 * no category param, so the filter can only be honest if it sees the whole set
 * matched by parkCode/stateCode/q — one request covers it (651 alerts service-wide
 * as of 2026-07; the API caps nothing and returns min(limit, total)). Paired with
 * `start: 0`: an upstream offset combined with a local filter silently skips
 * records, so the two must never co-occur.
 */
const CATEGORY_FILTER_FETCH_LIMIT = 1000;

export const npsGetAlerts = tool('nps_get_alerts', {
  title: 'national-parks-mcp-server: get alerts',
  description:
    'Current alerts for a park or a whole state — closures, hazards, caution notices, and information — with category and recency surfaced first so "is anything closed at Glacier right now?" is answered at a glance. Get park codes from nps_find_parks, or pass a stateCode for a statewide "what\'s closed" sweep. Returns most-recent-first; an empty result with totalCount 0 means the park reports nothing closed or hazardous — good news, not an error. An empty page with a non-zero totalCount only means start ran past the end, so read the notice rather than the empty list. Closures and road conditions change daily — re-check before departure.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .optional()
      .describe(
        'Park code, or comma-separated list (e.g. "glac", "yose,zion") — 4-letter lowercase codes. Get codes from nps_find_parks. Provide parkCode or stateCode; with neither, returns recent alerts service-wide.',
      ),
    stateCode: z
      .string()
      .optional()
      .describe(
        'Two-letter state code, or comma-separated list (e.g. "MT", "WY,MT,ID"). Returns alerts for all NPS sites in those states — use for a statewide sweep rather than one park.',
      ),
    category: z
      .enum(['Danger', 'Caution', 'Information', 'Park Closure'])
      .optional()
      .describe(
        'Filter to one alert category. "Danger" and "Park Closure" are the high-priority ones for trip safety. Applied locally (the API has no category param) across every alert matching parkCode/stateCode/query, then paginated with start/limit — so totalCount is the true count of matching alerts, not a per-page tally. Omit to see all categories (the default — closures and hazards should not be missed).',
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Free-text search within alert titles/descriptions (e.g. "road", "wildfire", "trail").',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Maximum alerts to return (1–50), most-recent first.'),
    start: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset for pagination within the matched set. Use with limit to page through results — when totalCount exceeds what was returned, re-request with start advanced by limit.',
      ),
  }),
  output: z.object({
    alerts: z
      .array(
        z
          .object({
            id: z.string().describe('Alert ID.'),
            parkCode: z
              .string()
              .describe(
                'Park code the alert belongs to — useful when querying by state across multiple parks.',
              ),
            category: z
              .string()
              .describe(
                'Alert category: "Danger", "Park Closure", "Caution", or "Information". Treat Danger and Park Closure as trip-affecting.',
              ),
            title: z
              .string()
              .describe('Short alert headline (e.g. "Tioga Road Closed for the Season").'),
            description: z
              .string()
              .describe('Full alert text — what is affected and any guidance.'),
            url: z
              .string()
              .nullable()
              .describe('Link to more detail on NPS.gov, or null when absent.'),
            lastIndexedDate: z
              .string()
              .nullable()
              .describe(
                'When NPS last updated/indexed this alert (YYYY-MM-DD), or null. The recency signal — a stale date may mean the condition has changed; verify against the park page.',
              ),
          })
          .describe('A single alert with its category, recency, and detail.'),
      )
      .describe(
        'Current alerts, sorted most-recent first. An empty array with totalCount 0 means no active alerts — good news, not an error; with a non-zero totalCount it means start paged past the end of the matches. The notice says which.',
      ),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Total alerts matching the filter before the limit was applied.'),
    shown: z
      .number()
      .optional()
      .describe('Alerts returned in this response (populated when capped by limit).'),
    cap: z.number().optional().describe('Limit applied (populated when results were truncated).'),
    categoryBreakdown: z
      .string()
      .describe(
        'Count of returned alerts per category (e.g. "Park Closure: 3, Caution: 1, Information: 2") — gauge severity without scanning every alert.',
      ),
    appliedFilters: z.string().describe('Echo of parkCode/stateCode/category/query as applied.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Message when the page is empty — states which case it is: good news (totalCount 0, the park reports nothing closed/hazardous right now) or a paging artifact (start ran past the end of a non-empty matched set).',
      ),
  },
  enrichmentTrailer: {
    totalCount: { label: 'Total Alerts' },
    shown: { label: 'Shown' },
    cap: { label: 'Limit' },
    categoryBreakdown: { label: 'By category' },
    appliedFilters: { label: 'Filters' },
  },
  errors: [
    {
      reason: 'invalid_park_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A parkCode token isn't 4 lowercase letters.",
      recovery:
        'Provide 4-letter lowercase park codes (e.g. "glac"), comma-separated. Look them up with nps_find_parks.',
    },
    {
      reason: 'invalid_state_code',
      code: JsonRpcErrorCode.ValidationError,
      when: "A stateCode token isn't two letters.",
      recovery: 'Provide two-letter state codes (e.g. "MT"), comma-separated.',
    },
  ],

  async handler(input, ctx) {
    // Code-format validation runs HERE, not at the Zod schema edge — a schema-level
    // regex failure throws a raw ZodError before ctx.fail exists, so the declared
    // recovery hint would never reach the client (#3).
    if (input.parkCode && !input.parkCode.split(',').every((t) => /^[a-z]{4}$/.test(t))) {
      throw ctx.fail(
        'invalid_park_code',
        `parkCode "${input.parkCode}" must be 4-letter lowercase code(s), comma-separated.`,
        { ...ctx.recoveryFor('invalid_park_code') },
      );
    }
    if (input.stateCode && !input.stateCode.split(',').every((t) => /^[A-Za-z]{2}$/.test(t))) {
      throw ctx.fail(
        'invalid_state_code',
        `stateCode "${input.stateCode}" must be two-letter code(s), comma-separated.`,
        { ...ctx.recoveryFor('invalid_state_code') },
      );
    }

    // Two-mode fetch. A local filter and an upstream offset cannot compose —
    // `start` would skip records upstream before `category` ever saw them — so
    // when filtering, pull the whole matched set from offset 0 and slice here.
    // Unfiltered, `start`/`limit` pass straight through as the cheap page fetch.
    const result = await getNpsService().getAlerts(
      {
        query: input.query,
        parkCode: input.parkCode,
        stateCode: input.stateCode,
        limit: input.category ? CATEGORY_FILTER_FETCH_LIMIT : input.limit,
        start: input.category ? 0 : input.start,
      },
      ctx,
    );

    // Sort most-recent-first before slicing; the API doesn't guarantee order.
    // This is the single ordering contract — format() renders it as-is.
    let alerts = [...result.data].sort((a, b) =>
      (b.lastIndexedDate ?? '').localeCompare(a.lastIndexedDate ?? ''),
    );
    let total = result.total;
    const notices: string[] = [];

    if (input.category) {
      // The upstream total is pre-filter; a shortfall means the corpus outgrew
      // the fetch limit and the filter only saw the first slice of it.
      const scannedWholeCorpus = result.data.length >= result.total;
      const matched = alerts.filter((a) => a.category === input.category);
      total = matched.length;
      alerts = matched.slice(input.start, input.start + input.limit);
      if (!scannedWholeCorpus) {
        notices.push(
          `Only the first ${result.data.length} of ${result.total} alerts were scanned for category="${input.category}", so this is a best-effort match rather than every one — narrow with parkCode or stateCode for an exhaustive result.`,
        );
      }
    }

    const filters = [
      input.parkCode ? `parkCode=${input.parkCode}` : null,
      input.stateCode ? `stateCode=${input.stateCode}` : null,
      input.category ? `category=${input.category}` : null,
      input.query ? `query="${input.query}"` : null,
    ].filter(Boolean);

    ctx.enrich({
      appliedFilters: filters.length > 0 ? filters.join(', ') : 'none',
      categoryBreakdown: breakdown(alerts),
    });
    ctx.enrich.total(total);
    ctx.log.info('Fetched alerts', { count: alerts.length, total, start: input.start });

    if (alerts.length === 0) {
      // An empty page past the end is NOT an absence of alerts — reporting
      // "nothing closed or hazardous" alongside a non-zero totalCount would
      // reassure a trip-planning client while closures are active.
      notices.push(
        total > 0
          ? `No alerts on this page: start=${input.start} is past the end of ${total} matching alert(s). Re-request with start=0 to see them — this is a paging artifact, not an all-clear.`
          : `No active alerts for ${filters.length > 0 ? filters.join(', ') : 'this search'}. The park currently reports nothing closed or hazardous. Closures and road conditions change daily — re-check before departure.`,
      );
    }

    // Every notice source composes into ONE string: ctx.enrich.truncated()
    // writes a notice internally, so a second writer would clobber the first.
    const nextStart = input.start + alerts.length;
    if (nextStart < total) {
      notices.push(
        `Showing ${alerts.length} of ${total} matching alerts. Request the next page with start=${nextStart}.`,
      );
      ctx.enrich.truncated({ shown: alerts.length, cap: input.limit, guidance: notices.join(' ') });
    } else if (notices.length > 0) {
      ctx.enrich.notice(notices.join(' '));
    }

    return { alerts };
  },

  format: (result) => {
    if (result.alerts.length === 0) {
      // format() receives only the domain payload, never totalCount, so it cannot
      // tell an all-clear from a page past the end. The notice branches on total
      // and says which one it is; asserting either here would guess.
      return [
        { type: 'text', text: 'No alerts in this response. See the notice for what this means.' },
      ];
    }
    // Render in the handler's order (most-recent-first) — re-sorting here would
    // hand structuredContent and content[] clients different result orders.
    const lines: string[] = [`## ${result.alerts.length} active alerts`, ''];
    for (const a of result.alerts) {
      lines.push(`### [${a.category || 'Alert'}] ${a.title}`);
      lines.push(
        `**Park:** ${a.parkCode} | **Updated:** ${a.lastIndexedDate ?? 'unknown'} | **ID:** ${a.id}`,
      );
      if (a.description) lines.push(a.description);
      if (a.url) lines.push(`[Details](${a.url})`);
      lines.push('');
    }
    return [{ type: 'text', text: lines.join('\n').trimEnd() }];
  },
});

function breakdown(alerts: NpsAlert[]): string {
  if (alerts.length === 0) return 'none';
  const counts = new Map<string, number>();
  for (const a of alerts) {
    const key = a.category || 'Uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (CATEGORY_ORDER[a[0]] ?? 9) - (CATEGORY_ORDER[b[0]] ?? 9))
    .map(([cat, n]) => `${cat}: ${n}`)
    .join(', ');
}
