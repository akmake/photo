/* Every tool, and every control on it, explains itself.
 *
 *   node --test tests/
 *
 * The tools panel is built from the catalogue, so a tool added there appears
 * on the photographer's screen by itself. This test is what makes it appear
 * WITH its explanation: a tool or a control without a line in toolHelp.ts
 * fails here, by name. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/toolRegistry.ts';
import { MASK_HELP, TOOL_HELP } from '../src/tour/toolHelp.ts';

test('every tool in the catalogue has an explanation', () => {
  const missing = TOOLS.filter((t) => !TOOL_HELP[t.id]).map((t) => `${t.id} (${t.label})`);
  assert.deepEqual(missing, [], `tools with no explanation:\n${missing.join('\n')}`);
});

test('every control on every tool has its line', () => {
  const missing: string[] = [];
  for (const tool of TOOLS) {
    const help = TOOL_HELP[tool.id];
    if (!help) continue;
    for (const p of tool.params) {
      if (!help.params[p.id]?.trim()) missing.push(`${tool.id} › ${p.id} (${p.label})`);
    }
  }
  assert.deepEqual(missing, [], `controls with no explanation:\n${missing.join('\n')}`);
});

test('no explanation is left for a control that no longer exists', () => {
  const stale: string[] = [];
  for (const tool of TOOLS) {
    const help = TOOL_HELP[tool.id];
    if (!help) continue;
    const ids = new Set(tool.params.map((p) => p.id));
    for (const id of Object.keys(help.params)) if (!ids.has(id)) stale.push(`${tool.id} › ${id}`);
  }
  assert.deepEqual(stale, [], `explanations for controls that are gone:\n${stale.join('\n')}`);
});

test('every tool says what it does and when to use it', () => {
  for (const tool of TOOLS) {
    const help = TOOL_HELP[tool.id];
    if (!help) continue;
    assert.ok(help.what.trim(), `${tool.id}: "what" is empty`);
    assert.ok(help.when.trim(), `${tool.id}: "when" is empty`);
  }
});

test('every region a tool can be limited to is explained', () => {
  for (const id of ['all', 'subject', 'background', 'skin', 'hair', 'fabric', 'painted', 'invert', 'feather']) {
    assert.ok(MASK_HELP[id]?.trim(), `region "${id}" has no explanation`);
  }
});
