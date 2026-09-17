/* Builds the album's open-source decoration elements from Phosphor Icons (MIT).
 *
 *   node tools/album_templates/build_icon_elements.mjs
 *
 * Picks the icons that belong in a family album — hearts, stars, flowers,
 * nature, weather, babies, celebrations — in two weights (fill, thin), keeps
 * only icons drawn purely with <path>, and writes their artwork to
 * src/album/templates/iconElements.json. Phosphor is MIT licensed:
 * https://github.com/phosphor-icons/core/blob/main/LICENSE */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { icons } from '@phosphor-icons/core';

const root = join(process.cwd(), 'node_modules', '@phosphor-icons', 'core');

const WANTED = /heart|star|sparkle|flower|leaf|tree|plant|butterfly|bird|feather|sun|moon|cloud|rainbow|snowflake|drop|baby|balloon|cake|gift|confetti|crown|diamond|camera|music|note|paw|cat|dog|fish|shell|umbrella|lightning|fire|wave|mountain|anchor|bicycle|car|house|church|synagogue|star-of-david|candle|wine|coffee|ice-cream|cookie|smiley|hand-heart|infinity|ring|bow|hourglass|clock|calendar|globe|airplane|sailboat|palette|paint|pencil|book|graduation|trophy|medal|flag|key|lock|lightbulb/i;
const SKIP = /-slash|broken|x$|minus|plus|check|warning|dashed|split/i;

const out = [];
for (const icon of icons) {
  if (!WANTED.test(icon.name) || SKIP.test(icon.name)) continue;
  for (const weight of ['fill', 'thin']) {
    let svg;
    try {
      svg = readFileSync(join(root, 'assets', weight, `${icon.name}-${weight}.svg`), 'utf8');
    } catch {
      continue;
    }
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const shapes = body.match(/<(\w+)/g) ?? [];
    if (shapes.some((tag) => tag !== '<path')) continue; // only pure path artwork scales and recolours cleanly
    const d = [...body.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]).join('');
    if (!d) continue;
    out.push({
      id: `ph-${icon.name}-${weight}`,
      name: icon.name.replace(/-/g, ' '),
      weight,
      d,
      tags: [...icon.tags.filter((tag) => !tag.startsWith('*')), ...icon.categories].slice(0, 8),
    });
  }
}

writeFileSync(
  join(process.cwd(), 'src', 'album', 'templates', 'iconElements.json'),
  JSON.stringify(out),
);
console.log(`icons written: ${out.length}`);
