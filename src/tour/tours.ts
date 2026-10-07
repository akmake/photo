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
import { SEND, SEND_STORAGE } from './content/send.ts';
import { EDIT, EDIT_COLORMATCH, EDIT_EXPORT, EDIT_REVIEW } from './content/edit.ts';
import { PHOTO_EDITOR } from './content/photoEditor.ts';
import {
  ALBUM, ALBUM_CREATE, ALBUM_CROP, ALBUM_DELIVERY, ALBUM_DESIGN, ALBUM_ELEMENT, ALBUM_PHOTO,
  ALBUM_PREFLIGHT, ALBUM_REVIEW, ALBUM_TEXT,
} from './content/album.ts';
import {
  CALENDAR, CLIENTS, IMPORT, IMPORT_CLOUD, PROJECT, PROJECTS, SETTINGS, TODAY,
} from './content/business.ts';

export const TOURS: Tour[] = [
  WELCOME,
  BATCHES,
  WORK, WORK_VIEWER, WORK_BURST, WORK_COMPARE,
  SEND, SEND_STORAGE,
  EDIT, EDIT_COLORMATCH, EDIT_REVIEW, EDIT_EXPORT,
  PHOTO_EDITOR,
  ALBUM, ALBUM_CREATE, ALBUM_DESIGN, ALBUM_PHOTO, ALBUM_TEXT, ALBUM_ELEMENT, ALBUM_CROP,
  ALBUM_DELIVERY, ALBUM_PREFLIGHT, ALBUM_REVIEW,
  PROJECT, IMPORT, IMPORT_CLOUD, TODAY, PROJECTS, CLIENTS, CALENDAR, SETTINGS,
];

/** The tour the "?" button plays on each screen. */
export function tourForScreen(screen: string): Tour | undefined {
  const own = TOURS.filter((t) => t.screen === screen && !t.trigger);
  return own.find((t) => t.id !== 'welcome') ?? own[0];
}

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
