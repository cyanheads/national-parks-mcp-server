/**
 * @fileoverview Contract-boundary tests for all six tools, driven through
 * runToolContract — the same parseToolArguments + error-result builder the
 * production handler factory uses. Covers the argument-rejection envelope, the
 * declared-contract errors, the upstream-failure envelope (no url, no API key),
 * the enrichment trailer as rendered, and the advertised catalog prose.
 * @module tests/tools/tool-contract.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createFetchMock, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npsFindCampgrounds } from '@/mcp-server/tools/definitions/nps-find-campgrounds.tool.js';
import { npsFindEvents } from '@/mcp-server/tools/definitions/nps-find-events.tool.js';
import { npsFindParks } from '@/mcp-server/tools/definitions/nps-find-parks.tool.js';
import { npsGetActivities } from '@/mcp-server/tools/definitions/nps-get-activities.tool.js';
import { npsGetAlerts } from '@/mcp-server/tools/definitions/nps-get-alerts.tool.js';
import { npsGetPark } from '@/mcp-server/tools/definitions/nps-get-park.tool.js';
import { initNpsService } from '@/services/nps/nps-service.js';

const TOOLS = [
  npsFindParks,
  npsGetPark,
  npsGetAlerts,
  npsFindCampgrounds,
  npsGetActivities,
  npsFindEvents,
] as const;
type Tool = (typeof TOOLS)[number];

const BASE_URL = 'https://developer.nps.gov/api/v1';

type ToolResult = Awaited<ReturnType<typeof runToolContract>>;
type ErrorEnvelope = {
  code: number;
  message: string;
  data?: Record<string, unknown> & { reason?: string; recovery?: { hint?: string } };
};

/** Run a definition with arguments its input type may not admit — the point of these cases. */
function run(tool: Tool, args: Record<string, unknown>): Promise<ToolResult> {
  return runToolContract(tool as never, args as never);
}

function errorOf(result: ToolResult): ErrorEnvelope {
  return (result.structuredContent as { error: ErrorEnvelope }).error;
}

function firstText(result: ToolResult): string {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
}

function allText(result: ToolResult): string {
  return result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
}

beforeEach(() => {
  // No test here should reach the network; an unmocked call fails loudly.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- *
 * Arguments that fail the input schema — -32602 invalid_arguments
 * ------------------------------------------------------------------------- */

describe('argument rejection', () => {
  const cases: {
    name: string;
    tool: Tool;
    args: Record<string, unknown>;
    field: string;
    /** The hint is not already in the message, so the text carries a `Recovery:` line. */
    recoveryLine: boolean;
  }[] = [
    {
      name: 'nps_find_parks limit below range',
      tool: npsFindParks,
      args: { query: 'yosemite', limit: 0 },
      field: 'limit',
      recoveryLine: false,
    },
    {
      name: 'nps_find_parks limit sent as a string',
      tool: npsFindParks,
      args: { query: 'yosemite', limit: '3' },
      field: 'limit',
      recoveryLine: true,
    },
    {
      name: 'nps_get_park missing parkCode',
      tool: npsGetPark,
      args: {},
      field: 'parkCode',
      recoveryLine: true,
    },
    {
      name: 'nps_get_park unrecognized key',
      tool: npsGetPark,
      args: { parkCode: ['yose'], bogusKey: 1 },
      field: 'bogusKey',
      recoveryLine: true,
    },
    {
      name: 'nps_get_alerts category outside the enum',
      tool: npsGetAlerts,
      args: { parkCode: 'yose', category: 'Closure' },
      field: 'category',
      recoveryLine: false,
    },
    {
      name: 'nps_find_campgrounds limit above range',
      tool: npsFindCampgrounds,
      args: { parkCode: 'zion', limit: 100 },
      field: 'limit',
      recoveryLine: false,
    },
    {
      name: 'nps_get_activities negative start',
      tool: npsGetActivities,
      args: { parkCode: 'acad', start: -1 },
      field: 'start',
      recoveryLine: false,
    },
    {
      name: 'nps_find_events pageNumber below range',
      tool: npsFindEvents,
      args: { parkCode: 'yell', pageNumber: 0 },
      field: 'pageNumber',
      recoveryLine: false,
    },
  ];

  it('covers every tool', () => {
    expect(new Set(cases.map((c) => c.tool.name))).toEqual(new Set(TOOLS.map((t) => t.name)));
  });

  it.each(cases)(
    '$name → InvalidParams / invalid_arguments',
    async ({ tool, args, field, recoveryLine }) => {
      const result = await run(tool, args);

      expect(result.isError).toBe(true);
      const error = errorOf(result);
      expect(error.code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(error.message).toContain(tool.name);
      expect(error.message).toContain(field);
      expect(error.data?.reason).toBe('invalid_arguments');

      const hint = error.data?.recovery?.hint ?? '';
      expect(hint.length).toBeGreaterThan(0);

      const text = firstText(result);
      expect(text).toContain('reason invalid_arguments');
      expect(text).not.toContain('not retryable');

      // The framework mirrors the hint only when the message does not already say it.
      expect(error.message.includes(hint)).toBe(!recoveryLine);
      if (recoveryLine) expect(text).toContain(`Recovery: ${hint}`);
    },
  );
});

/* ------------------------------------------------------------------------- *
 * Declared-contract errors — thrown by the handler through ctx.fail
 * ------------------------------------------------------------------------- */

describe('declared-contract errors', () => {
  const cases: { name: string; tool: Tool; args: Record<string, unknown>; reason: string }[] = [
    {
      name: 'nps_find_parks stateCode "Cal"',
      tool: npsFindParks,
      args: { stateCode: 'Cal' },
      reason: 'invalid_state_code',
    },
    {
      name: 'nps_get_park mixed-case code',
      tool: npsGetPark,
      args: { parkCode: ['Yose'] },
      reason: 'invalid_park_code',
    },
    {
      name: 'nps_get_alerts malformed parkCode token',
      tool: npsGetAlerts,
      args: { parkCode: 'glac,Yosemite' },
      reason: 'invalid_park_code',
    },
    {
      name: 'nps_get_alerts full state name',
      tool: npsGetAlerts,
      args: { stateCode: 'Montana' },
      reason: 'invalid_state_code',
    },
    {
      name: 'nps_find_campgrounds uppercase parkCode',
      tool: npsFindCampgrounds,
      args: { parkCode: 'ZION' },
      reason: 'invalid_park_code',
    },
    {
      name: 'nps_find_campgrounds one-letter stateCode',
      tool: npsFindCampgrounds,
      args: { stateCode: 'U' },
      reason: 'invalid_state_code',
    },
    {
      name: 'nps_get_activities no location filter',
      tool: npsGetActivities,
      args: { query: 'sunrise' },
      reason: 'missing_filter',
    },
    {
      name: 'nps_get_activities park code list',
      tool: npsGetActivities,
      args: { parkCode: 'acad,yose' },
      reason: 'invalid_park_code',
    },
    {
      name: 'nps_get_activities state code list',
      tool: npsGetActivities,
      args: { stateCode: 'ME,NH' },
      reason: 'invalid_state_code',
    },
    {
      name: 'nps_find_events non-ISO date',
      tool: npsFindEvents,
      args: { parkCode: 'yell', dateStart: '07/04/2026' },
      reason: 'invalid_date',
    },
    {
      name: 'nps_find_events uppercase parkCode',
      tool: npsFindEvents,
      args: { parkCode: 'YELL' },
      reason: 'invalid_park_code',
    },
    {
      name: 'nps_find_events three-letter stateCode',
      tool: npsFindEvents,
      args: { stateCode: 'Wyo' },
      reason: 'invalid_state_code',
    },
  ];

  it('covers every handler-validated reason each tool declares', () => {
    const declared = TOOLS.flatMap((t) =>
      (t.errors ?? [])
        // no_parks_found needs an upstream answer; it is not an input check.
        .filter((e) => e.reason !== 'no_parks_found')
        .map((e) => `${t.name}:${e.reason}`),
    );
    expect(new Set(cases.map((c) => `${c.tool.name}:${c.reason}`))).toEqual(new Set(declared));
  });

  it.each(cases)('$name → $reason with its declared recovery', async ({ tool, args, reason }) => {
    const result = await run(tool, args);

    expect(result.isError).toBe(true);
    const error = errorOf(result);
    expect(error.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(error.data?.reason).toBe(reason);

    const declared = tool.errors?.find((e) => e.reason === reason)?.recovery;
    expect(declared).toBeTruthy();
    expect(error.data?.recovery?.hint).toBe(declared);

    const text = firstText(result);
    expect(error.message).not.toContain(declared);
    expect(text).toContain(`Recovery: ${declared}`);
    expect(text).toContain(`(reason ${reason})`);
  });
});

/* ------------------------------------------------------------------------- *
 * Upstream failure — the real NpsService behind a strict fetch fake
 * ------------------------------------------------------------------------- */

describe('upstream failure', () => {
  const SENTINEL = 'SENTINEL-KEY-0123456789';
  const http = createFetchMock([
    {
      match: (req) => req.url.startsWith(`${BASE_URL}/`),
      respond: () =>
        new Response('<html>Not Found</html>', { status: 404, statusText: 'Not Found' }),
    },
  ]);

  beforeEach(() => {
    initNpsService({ apiKey: SENTINEL, baseUrl: BASE_URL });
    http.install();
  });

  afterEach(() => {
    http.restore();
  });

  it('exposes neither a url nor the API key on a 404', async () => {
    const result = await run(npsFindParks, { query: 'yosemite', limit: 1 });

    // The fake saw the key where the service sends it — the header, never the URL.
    expect(http.calls).toHaveLength(1);
    const request = http.calls[0]!.request;
    expect(request.headers.get('x-api-key')).toBe(SENTINEL);
    expect(request.url).not.toContain(SENTINEL);

    expect(result.isError).toBe(true);
    const data = errorOf(result).data ?? {};
    expect(data.status).toBe(404);
    expect(Object.keys(data).length).toBeGreaterThan(0);
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
});

/* ------------------------------------------------------------------------- *
 * Enrichment trailer as rendered in content[]
 * ------------------------------------------------------------------------- */

describe('enrichment trailer', () => {
  const http = createFetchMock();

  beforeEach(() => {
    initNpsService({ apiKey: 'test-key', baseUrl: BASE_URL });
    http.install();
  });

  afterEach(() => {
    http.reset();
    http.restore();
  });

  it('renders totalCount as "N total" beside the labeled truncation fields', async () => {
    const alert = (id: string) => ({
      id,
      parkCode: 'yose',
      category: 'Caution',
      title: `Alert ${id}`,
      description: 'Trail work.',
      url: '',
      lastIndexedDate: '2026-09-01 00:00:00.0',
    });
    http.route({
      match: /\/alerts\?/,
      respond: Response.json({
        total: '53',
        limit: '2',
        start: '0',
        data: [alert('a1'), alert('a2')],
      }),
    });

    const result = await run(npsGetAlerts, { stateCode: 'CA', limit: 2 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ totalCount: 53, truncated: true, shown: 2 });
    const text = allText(result);
    expect(text).toContain('**53 total**');
    expect(text).toContain('**Truncated:** true');
    expect(text).toContain('**Shown:** 2');
    expect(text).toContain('**Limit:** 2');
    expect(text).not.toContain('Total Alerts');
  });
});

/* ------------------------------------------------------------------------- *
 * Advertised catalog prose — caller-facing contract, not implementation
 * ------------------------------------------------------------------------- */

describe('catalog prose', () => {
  /** Implementation, upstream-mechanics, and agent-coaching phrasing kept out of tools/list. */
  const MECHANICS =
    /locally|the API|re-ranked|alphabetical|mixed array|adaInfo|HTML stripped|single request|upstream|the agent|trimmed|nws-weather|open-meteo|good news|Trust this|Explains why|sparser|Treat Danger|verify against|gauge severity/i;

  function collectDescriptions(node: unknown, path: string, out: [string, string][]): void {
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        collectDescriptions(n, `${path}[${i}]`, out);
      });
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'description' && typeof value === 'string') out.push([path, value]);
        else collectDescriptions(value, `${path}.${key}`, out);
      }
    }
  }

  /** Every string a tool contributes to tools/list: its description, both schemas' field describes, enrichment describes, and error `when` text. */
  function advertisedStrings(tool: Tool): [string, string][] {
    const out: [string, string][] = [['description', tool.description ?? '']];
    collectDescriptions(tool.input.toJSONSchema(), 'input', out);
    collectDescriptions(tool.output.toJSONSchema(), 'output', out);
    for (const [key, schema] of Object.entries(tool.enrichment ?? {})) {
      out.push([`enrichment.${key}`, (schema as { description?: string }).description ?? '']);
    }
    for (const e of tool.errors ?? []) out.push([`errors.${e.reason}.when`, e.when]);
    return out;
  }

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    '%s describes the contract, not the implementation',
    (_name, tool) => {
      const offending = advertisedStrings(tool)
        .filter(([, text]) => MECHANICS.test(text))
        .map(([path, text]) => `${path}: ${text.match(MECHANICS)![0]}`);
      expect(offending).toEqual([]);
    },
  );
});
