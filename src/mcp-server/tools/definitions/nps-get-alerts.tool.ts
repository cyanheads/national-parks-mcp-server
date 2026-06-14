/**
 * @fileoverview nps_get_alerts — the time-sensitive headline tool. Current
 * alerts for park(s) or state(s) with category and recency surfaced
 * prominently, sorted most-recent-first, Danger/Park Closure ordered first.
 * @module mcp-server/tools/definitions/nps-get-alerts.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getNpsService } from '@/services/nps/nps-service.js';
import type { NpsAlert } from '@/services/nps/types.js';

/** Severity order for grouping in format() — trip-affecting categories first. */
const CATEGORY_ORDER: Record<string, number> = {
  Danger: 0,
  'Park Closure': 1,
  Caution: 2,
  Information: 3,
};

export const npsGetAlerts = tool('nps_get_alerts', {
  title: 'national-parks-mcp-server: get alerts',
  description:
    'Current alerts for a park or a whole state — closures, hazards, caution notices, and information — with category and recency surfaced first so "is anything closed at Glacier right now?" is answered at a glance. Get park codes from nps_find_parks, or pass a stateCode for a statewide "what\'s closed" sweep. Returns most-recent-first; an empty result means the park reports nothing closed or hazardous, which is good news, not an error. Closures and road conditions change daily — re-check before departure.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    parkCode: z
      .string()
      .regex(/^[a-z]{4}(,[a-z]{4})*$/)
      .optional()
      .describe(
        'Park code, or comma-separated list (e.g. "glac", "yose,zion"). Get codes from nps_find_parks. Provide parkCode or stateCode; with neither, returns recent alerts service-wide.',
      ),
    stateCode: z
      .string()
      .regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/)
      .optional()
      .describe(
        'Two-letter state code, or comma-separated list (e.g. "MT", "WY,MT,ID"). Returns alerts for all NPS sites in those states — use for a statewide sweep rather than one park.',
      ),
    category: z
      .enum(['Danger', 'Caution', 'Information', 'Park Closure'])
      .optional()
      .describe(
        'Filter to one alert category. "Danger" and "Park Closure" are the high-priority ones for trip safety. Omit to see all categories (the default — closures and hazards should not be missed).',
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
        'Current alerts, sorted most-recent first. An empty array means no active alerts — good news, not an error.',
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
        'Message when there are no active alerts — explicitly states this is good news (the park reports nothing closed/hazardous right now).',
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
    const result = await getNpsService().getAlerts(
      {
        query: input.query,
        parkCode: input.parkCode,
        stateCode: input.stateCode,
        limit: input.limit,
      },
      ctx,
    );

    let alerts = result.data;
    let total = result.total;

    // Category filtered locally — /alerts has no category param.
    if (input.category) {
      alerts = alerts.filter((a) => a.category === input.category);
      total = alerts.length;
    }

    // Sort most-recent-first; the API doesn't guarantee order.
    alerts = [...alerts].sort((a, b) =>
      (b.lastIndexedDate ?? '').localeCompare(a.lastIndexedDate ?? ''),
    );

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
    if (total > alerts.length) {
      ctx.enrich.truncated({ shown: alerts.length, cap: input.limit });
    }
    ctx.log.info('Fetched alerts', { count: alerts.length, total });

    if (alerts.length === 0) {
      ctx.enrich.notice(
        `No active alerts for ${filters.length > 0 ? filters.join(', ') : 'this search'}. The park currently reports nothing closed or hazardous. Closures and road conditions change daily — re-check before departure.`,
      );
    }

    return { alerts };
  },

  format: (result) => {
    if (result.alerts.length === 0) {
      return [{ type: 'text', text: 'No active alerts — nothing currently closed or hazardous.' }];
    }
    const sorted = [...result.alerts].sort(
      (a, b) => (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9),
    );
    const lines: string[] = [`## ${result.alerts.length} active alerts`, ''];
    for (const a of sorted) {
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
