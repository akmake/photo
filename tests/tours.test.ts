/* Every tour points at things that exist.
 *
 *   node --test tests/
 *
 * A tour step finds its button by name (data-tour="…"), never by position, so
 * a redesign can move a button freely. What a redesign CAN do is delete or
 * rename one — and then the step would point at nothing, silently, on a
 * photographer's machine. This test is where that fails instead. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TOURS } from '../src/tour/tours.ts';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/* Names written literally — data-tour="x", data-tour={'x'} — and names built
 * from a list — data-tour={`stage-${tab.id}`} — which count as a prefix. */
function namesInSource(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const file of sources('src')) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-tour=(?:"([^"]+)"|\{'([^']+)'\})/g)) exact.add(m[1] ?? m[2]);
    // A component that forwards its name: <Decide dataTour="viewer-decide" />.
    for (const m of text.matchAll(/dataTour="([^"]+)"/g)) exact.add(m[1]);
    for (const m of text.matchAll(/data-tour=\{[^}]*?'([^']+)'\s*:\s*'([^']+)'/g)) { exact.add(m[1]); exact.add(m[2]); }
    for (const m of text.matchAll(/data-tour=\{`([^`$]*)\$\{/g)) prefixes.push(m[1]);
  }
  return { exact, prefixes };
}

test('every step points at a name that exists in the app', () => {
  const { exact, prefixes } = namesInSource();
  const exists = (name: string) => exact.has(name) || prefixes.some((p) => p && name.startsWith(p));
  const missing: string[] = [];
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      for (const name of [step.target, step.waitFor, tour.trigger]) {
        if (name && !exists(name)) missing.push(`${tour.id} › ${step.id} › ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], `steps point at names no screen carries:\n${missing.join('\n')}`);
});

test('step ids are unique inside each tour, tour ids unique overall', () => {
  const tourIds = TOURS.map((t) => t.id);
  assert.equal(new Set(tourIds).size, tourIds.length);
  for (const tour of TOURS) {
    const ids = tour.steps.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate step id in ${tour.id}`);
  }
});

test('a doing-step says what to do', () => {
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      if (!step.waitFor) continue;
      assert.ok(step.target, `${tour.id} › ${step.id}: a doing-step needs something to press`);
      assert.ok(step.doText, `${tour.id} › ${step.id}: a doing-step needs its "לחץ על…" line`);
    }
  }
});
