/* My automatic build vs a designer's album on the same photos. Experiment. */
import { readFileSync } from 'node:fs';
import { buildAutomaticAlbum } from '../../src/album/albumFlow.ts';
import { designOf, findTemplate, fittedTemplate, photoLayers } from '../../src/album/templates/library.ts';

const { photos, sessions, designer } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pageAspect = 280 / 210;
const mine = buildAutomaticAlbum(sessions.flatMap((s: any) => s.photoIds), photos, pageAspect, process.argv[3], sessions);

const cutsOf = (groups: string[][]) => { const s = new Set<string>(); let n = 0; groups.forEach((g) => { n += g.length; s.add(String(n)); }); return s; };
const D = cutsOf(designer.map((s: any) => s.photos)); const M = cutsOf(mine.map((s) => s.photoIds));
const both = [...D].filter((c) => M.has(c)).length;
const key = (g: string[]) => [...g].sort().join('|');
const dByGroup = new Map(designer.map((s: any) => [key(s.photos), s]));
let sameGroup = 0, samePage = 0, sameDesign = 0, sameHero = 0, heroComparable = 0;
for (const s of mine) {
  const d: any = dByGroup.get(key(s.photoIds));
  if (!d) continue;
  sameGroup++;
  const id = s.templateInstance!.templateId;
  if (id === d.vault) samePage++;
  if (designOf(id) === designOf(d.vault)) sameDesign++;
  const t = photoLayers(fittedTemplate(findTemplate(id)!, pageAspect * 2));
  const areas = t.map((l) => l.box.width * l.box.height);
  if (s.photoIds.length > 1) { heroComparable++; if (s.photoIds[areas.indexOf(Math.max(...areas))] === d.hero) sameHero++; }
}
console.log('designer spreads', designer.length, 'counts', designer.map((s: any) => s.photos.length).join(''));
console.log('mine     spreads', mine.length, 'counts', mine.map((s) => s.photoIds.length).join(''));
console.log(`cut agreement: ${both} of designer ${D.size} / mine ${M.size}`);
console.log(`identical groups: ${sameGroup}/${designer.length}; same page there: ${samePage}, same design (incl. mirror): ${sameDesign}; same hero: ${sameHero}/${heroComparable}`);
console.log('mine pages:', mine.map((s) => s.templateInstance!.templateId.replace('vault-', '')).join(' '));
console.log('designer  :', designer.map((s: any) => s.vault.replace('vault-', '')).join(' '));
