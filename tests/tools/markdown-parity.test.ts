/**
 * @fileoverview CommonMark round-trip coverage for NPS text, links, images,
 * notices and error recovery on both tool response surfaces.
 * @module tests/tools/markdown-parity.test
 */

import { createFetchMock, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npsFindCampgrounds } from '@/mcp-server/tools/definitions/nps-find-campgrounds.tool.js';
import { npsFindEvents } from '@/mcp-server/tools/definitions/nps-find-events.tool.js';
import { npsFindParks } from '@/mcp-server/tools/definitions/nps-find-parks.tool.js';
import { npsGetActivities } from '@/mcp-server/tools/definitions/nps-get-activities.tool.js';
import { npsGetAlerts } from '@/mcp-server/tools/definitions/nps-get-alerts.tool.js';
import { npsGetPark } from '@/mcp-server/tools/definitions/nps-get-park.tool.js';
import { initNpsService } from '@/services/nps/nps-service.js';

const parser = new MarkdownIt('commonmark');
type Token = ReturnType<typeof parser.parse>[number];
const label =
  'A *wild* [place](https://example.org/forged) `trail` &amp; <b>view</b>\n- Literal title continuation';
const prose = 'Keep *stars* and [brackets].\n- Literal line, not a list.';
const url = 'https://www.nps.gov/example_(one)?a=1&b=2';
const http = createFetchMock();

/** Decode inline nodes, retaining hard breaks and image alt text as data. */
function readText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'hardbreak' || token.type === 'softbreak') return '\n';
      if (token.children) return readText(token.children);
      return token.type === 'text' || token.type === 'code_inline' ? token.content : '';
    })
    .join('');
}

function flatten(tokens: Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...flatten(token.children ?? [])]);
}

beforeEach(() => {
  initNpsService({ apiKey: 'test-key', baseUrl: 'https://developer.nps.gov/api/v1' });
  http.install();
});

afterEach(() => {
  http.reset();
  http.restore();
});

describe('CommonMark data parity', () => {
  const cases = [
    {
      tool: npsFindParks,
      args: { stateCode: 'CA' },
      key: 'parks',
      field: 'fullName',
      record: { parkCode: 'yose', fullName: label, description: prose, url },
    },
    {
      tool: npsGetPark,
      args: { parkCode: ['yose'] },
      key: 'parks',
      field: 'fullName',
      record: {
        parkCode: 'yose',
        fullName: label,
        description: prose,
        url,
        images: [{ title: label, altText: label, url }],
      },
    },
    {
      tool: npsGetAlerts,
      args: { parkCode: 'yose' },
      key: 'alerts',
      field: 'title',
      record: { parkCode: 'yose', title: label, description: prose, url },
    },
    {
      tool: npsFindCampgrounds,
      args: { parkCode: 'yose' },
      key: 'campgrounds',
      field: 'name',
      record: { parkCode: 'yose', name: label, description: prose, url },
    },
    {
      tool: npsGetActivities,
      args: { parkCode: 'yose' },
      key: 'activities',
      field: 'title',
      record: { title: label, location: prose, url },
    },
    {
      tool: npsFindEvents,
      args: { parkCode: 'yose' },
      key: 'events',
      field: 'title',
      record: { title: label, location: prose, infourl: url },
    },
  ];

  it.each(cases)(
    '$tool.name preserves text and URL destinations',
    async ({ tool, args, key, field, record }) => {
      http.route({ match: () => true, respond: Response.json({ total: '1', data: [record] }) });
      const result = await runToolContract(tool as never, args as never);
      expect(result.isError).toBeFalsy();
      const data = result.structuredContent as Record<string, Record<string, unknown>[]>;
      expect(data[key]?.[0]?.[field]).toBe(label);
      const markdown = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n\n');
      const tokens = parser.parse(markdown, {});
      const decoded = readText(tokens);
      expect(decoded).toContain(label);
      expect(decoded).toContain(prose);
      const nodes = flatten(tokens);
      const links = nodes
        .filter((token) => token.type === 'link_open')
        .map((token) => token.attrGet('href'));
      expect(links).toContain(url);
      expect(links).not.toContain('https://example.org/forged');
      if (tool === npsGetPark) {
        const image = nodes.find((token) => token.type === 'image');
        expect(image?.attrGet('src')).toBe(url);
        expect(readText(image?.children ?? [])).toBe(label);
        expect(data.parks?.[0]?.images).toEqual([{ title: label, altText: label, url }]);
      }
    },
  );

  it('preserves caller text in an empty-result notice without making a link', async () => {
    http.route({ match: () => true, respond: Response.json({ total: '0', data: [] }) });
    const query = '*wild* [query](https://example.org/forged)';
    const result = await runToolContract(npsFindParks, { query });
    const data = result.structuredContent as { notice: string; appliedFilters: string };
    expect(data.notice).toContain(query);
    expect(data.appliedFilters).toBe(`query="${query}"`);
    const tokens = parser.parse(
      result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n\n'),
      {},
    );
    expect(readText(tokens)).toContain(data.notice);
    expect(flatten(tokens).filter((token) => token.type === 'link_open')).toHaveLength(0);
  });

  it('preserves a declared failure message and recovery after CommonMark parsing', async () => {
    const result = await runToolContract(npsGetPark, { parkCode: ['*bad*'] });
    const error = (
      result.structuredContent as {
        error: { message: string; data: { reason: string; recovery: { hint: string } } };
      }
    ).error;
    expect(error.data.reason).toBe('invalid_park_code');
    expect(error.message).toContain('"*bad*"');
    const tokens = parser.parse(
      result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n\n'),
      {},
    );
    expect(readText(tokens)).toContain(error.message);
    expect(readText(tokens)).toContain(error.data.recovery.hint);
  });
});
