/* Every tour in the product. Content only — the engine is TourProvider.
 *
 * Writing rules (docs/TOUR-TIMELINE.md):
 *  - the photographer's language, masculine, plain: what it does FOR him and
 *    when to use it — never what the code does;
 *  - a step says one thing; the photographer does the action himself wherever
 *    the action is safe to do for real;
 *  - every `target` / `waitFor` is a data-tour name that exists in src — the
 *    test fails otherwise, so a redesign cannot silently break a tour. */

import type { Tour } from './types';
import { WELCOME } from './content/welcome.ts';
import { BATCHES } from './content/batches.ts';
import { WORK, WORK_BURST, WORK_COMPARE, WORK_VIEWER } from './content/work.ts';

export const TOURS: Tour[] = [
  WELCOME,
  BATCHES,
  WORK, WORK_VIEWER, WORK_BURST, WORK_COMPARE,
];

/** The tour the "?" button plays on each screen. */
export function tourForScreen(screen: string): Tour | undefined {
  const own = TOURS.filter((t) => t.screen === screen && !t.trigger);
  return own.find((t) => t.id !== 'welcome') ?? own[0];
}

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
