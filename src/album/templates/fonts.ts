/* Fonts for text on album pages.
 *
 * The built-in set is open source (SIL Open Font License — free to use
 * commercially and to embed), bundled with the app through Fontsource so text
 * looks the same offline and in print. The photographer's own fonts are loaded
 * from files and kept on this computer (userFonts.ts). */

import '@fontsource/heebo/400.css';
import '@fontsource/heebo/700.css';
import '@fontsource/assistant/400.css';
import '@fontsource/assistant/700.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/700.css';
import '@fontsource/frank-ruhl-libre/400.css';
import '@fontsource/frank-ruhl-libre/700.css';
import '@fontsource/secular-one/400.css';
import '@fontsource/suez-one/400.css';
import '@fontsource/amatic-sc/400.css';
import '@fontsource/amatic-sc/700.css';
import '@fontsource/bellefair/400.css';
import '@fontsource/david-libre/400.css';
import '@fontsource/david-libre/700.css';
import '@fontsource/alef/400.css';
import '@fontsource/alef/700.css';
import '@fontsource/karantina/400.css';
import '@fontsource/karantina/700.css';
import '@fontsource/varela-round/400.css';
import '@fontsource/miriam-libre/400.css';
import '@fontsource/miriam-libre/700.css';
import '@fontsource/noto-serif-hebrew/400.css';
import '@fontsource/noto-serif-hebrew/700.css';
import '@fontsource/ibm-plex-sans-hebrew/400.css';
import '@fontsource/ibm-plex-sans-hebrew/700.css';
import '@fontsource/playpen-sans-hebrew/400.css';
import '@fontsource/playpen-sans-hebrew/700.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/dancing-script/400.css';
import '@fontsource/dancing-script/700.css';
import '@fontsource/parisienne/400.css';
import '@fontsource/allura/400.css';
import '@fontsource/pinyon-script/400.css';
import '@fontsource/sacramento/400.css';
import '@fontsource/alex-brush/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/700.css';

export interface FontEntry {
  family: string;
  /** What the photographer sees in the list. */
  label: string;
  group: 'hebrew' | 'script' | 'latin' | 'mine';
  bold: boolean;
}

export const FONT_GROUP_LABELS: Record<FontEntry['group'], string> = {
  hebrew: 'עברית',
  script: 'כתב יד (לועזית)',
  latin: 'לועזית',
  mine: 'הגופנים שלי',
};

export const FONT_CATALOG: FontEntry[] = [
  { family: 'Heebo', label: 'Heebo · נקי ומודרני', group: 'hebrew', bold: true },
  { family: 'Assistant', label: 'Assistant · רך וקריא', group: 'hebrew', bold: true },
  { family: 'Rubik', label: 'Rubik · מעוגל', group: 'hebrew', bold: true },
  { family: 'Frank Ruhl Libre', label: 'פרנק רוהל · קלאסי עם סריפים', group: 'hebrew', bold: true },
  { family: 'David Libre', label: 'דוד · ספרותי', group: 'hebrew', bold: true },
  { family: 'Noto Serif Hebrew', label: 'Noto Serif · עדין עם סריפים', group: 'hebrew', bold: true },
  { family: 'Bellefair', label: 'Bellefair · אלגנטי דק', group: 'hebrew', bold: false },
  { family: 'Secular One', label: 'Secular One · כותרת עבה', group: 'hebrew', bold: false },
  { family: 'Suez One', label: 'Suez One · כותרת עם סריפים', group: 'hebrew', bold: false },
  { family: 'Alef', label: 'אלף · פשוט', group: 'hebrew', bold: true },
  { family: 'Miriam Libre', label: 'מרים · שימושי', group: 'hebrew', bold: true },
  { family: 'Varela Round', label: 'Varela Round · מעוגל ורך', group: 'hebrew', bold: false },
  { family: 'IBM Plex Sans Hebrew', label: 'IBM Plex · טכני נקי', group: 'hebrew', bold: true },
  { family: 'Amatic SC', label: 'Amatic · כתב יד צר', group: 'hebrew', bold: true },
  { family: 'Karantina', label: 'Karantina · כותרת צרה', group: 'hebrew', bold: true },
  { family: 'Playpen Sans Hebrew', label: 'Playpen · כתב יד שובב', group: 'hebrew', bold: true },
  { family: 'Great Vibes', label: 'Great Vibes', group: 'script', bold: false },
  { family: 'Parisienne', label: 'Parisienne', group: 'script', bold: false },
  { family: 'Allura', label: 'Allura', group: 'script', bold: false },
  { family: 'Pinyon Script', label: 'Pinyon Script', group: 'script', bold: false },
  { family: 'Alex Brush', label: 'Alex Brush', group: 'script', bold: false },
  { family: 'Sacramento', label: 'Sacramento', group: 'script', bold: false },
  { family: 'Dancing Script', label: 'Dancing Script', group: 'script', bold: true },
  { family: 'Playfair Display', label: 'Playfair Display', group: 'latin', bold: true },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', group: 'latin', bold: true },
  { family: 'Montserrat', label: 'Montserrat', group: 'latin', bold: true },
];

/** A CSS font stack for a family, with a sensible fallback. */
export function fontStack(family: string): string {
  const entry = FONT_CATALOG.find((font) => font.family === family);
  const fallback = entry?.group === 'script' ? 'cursive' : 'sans-serif';
  return `'${family}', ${fallback}`;
}

/** The family named first in a CSS font stack. */
export function familyOf(stack: string): string {
  return stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}
