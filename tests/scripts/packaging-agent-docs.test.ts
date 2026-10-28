/**
 * @fileoverview Package agent documentation must not remove runtime skill modules.
 * @module tests/scripts/packaging-agent-docs
 */
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

describe('dependency agent documentation cleanup', () => {
  it('preserves SDK skills runtime files while removing package-root agent trees', () => {
    const runtime = [
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.js',
      'node_modules/outer/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
      'node_modules/pkg/dist/skills/runtime.js',
      'skills/national-parks-guide/SKILL.md',
    ];
    const docs = [
      'node_modules/pkg/skills/guide/SKILL.md',
      'node_modules/@scope/pkg/framework-skills/add-tool/SKILL.md',
      'node_modules/outer/node_modules/@scope/pkg/.claude/skills/guide/SKILL.md',
      'node_modules/pkg/.agents/skills/guide/SKILL.md',
      'node_modules/pkg/docs/SKILL.md',
    ];
    expect(filterAgentDocEntries([...runtime, ...docs])).toEqual(docs);
  });

  it('keeps the lint and cleaner matchers aligned', async () => {
    // A runtime URL keeps Vite from resolving the framework-only fallback import.
    const lint = await import(new URL('../../scripts/lint-packaging.ts', import.meta.url).href);
    expect(lint.AGENT_DOC_ENTRY.source).toBe(AGENT_DOC_ENTRY.source);
  });
});
