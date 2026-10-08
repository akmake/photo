/* Old automatic build vs the new one, on real analysed photos. Experiment. */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildAlbumFromGroups, contextualCuts, groupsFromCuts, buildAutomaticAlbum } from '../../src/album/albumFlow.ts';
import { assessCrop } from '../../src/album/cropEngine.ts';
import { findTemplate, fittedTemplate, photoLayers } from '../../src/album/templates/library.ts';
import { faceOnFold, FOLD_CLEARANCE } from '../../src/album/autoLayout.ts';

const [input, outFile] = process.argv.slice(2);
const { photos, sessions } = JSON.parse(readFileSync(input, 'utf8'));
const pageAspect = 280 / 210;
const spreadAspect = pageAspect * 2;
const byId = new Map(photos.map((p: any) => [p.id, p]));
const ids = sessions.flatMap((s: any) => s.photoIds);

function oldBuild() {
  const groups: string[][] = []; const sids: any[] = [];
  for (const s of sessions) for (const g of groupsFromCuts(s.photoIds, contextualCuts(s.photoIds, photos))) { groups.push(g); sids.push(s.id); }
  return buildAlbumFromGroups(groups, photos, pageAspect, undefined, sids);
}

function measure(name: string, spreads: any[]) {
  let cut = 0, fold = 0, keptSum = 0, keptMin = 1, places = 0, repeats = 0;
  const counts: number[] = []; const rows: any[] = [];
  spreads.forEach((sp, i) => {
    const t = fittedTemplate(findTemplate(sp.templateInstance.templateId)!, spreadAspect);
    const layers = photoLayers(t);
    counts.push(sp.photoIds.length);
    const prev = spreads.slice(Math.max(0, i - 3), i).map((s) => s.templateInstance.templateId);
    if (prev.includes(sp.templateInstance.templateId)) repeats++;
    const placed: any[] = [];
    sp.photoIds.forEach((id: string, k: number) => {
      const l = layers[k]; const p: any = byId.get(id);
      const slot = { id: l.id, ...l.box, role: l.role, preferred: l.preferred, allowCrossGutter: l.allowCrossGutter };
      const c = assessCrop(p, slot as any, { fit: 'smart', positionX: 50, positionY: 50 }, spreadAspect);
      const kept = c.crop.width * c.crop.height;
      if (!c.safe) cut++;
      const onFold = faceOnFold(p, slot as any, c.crop, FOLD_CLEARANCE);
      if (onFold) fold++;
      keptSum += kept; keptMin = Math.min(keptMin, kept); places++;
      placed.push({ id, box: l.box, crop: c.crop, kept: +kept.toFixed(3), cut: !c.safe, fold: onFold });
    });
    rows.push({ template: sp.templateInstance.templateId, colors: sp.templateInstance.colors, session: sp.sessionId, placed });
  });
  const summary = { name, spreads: spreads.length, counts: counts.join(','), facesCut: cut, facesOnFold: fold,
    keptAvg: +(keptSum / places).toFixed(3), keptMin: +keptMin.toFixed(3), repeatsIn3: repeats };
  console.log(JSON.stringify(summary));
  return { summary, rows };
}

const t0 = performance.now();
const a = oldBuild();
const t1 = performance.now();
const b = buildAutomaticAlbum(ids, photos, pageAspect, undefined, sessions);
const t2 = performance.now();
console.log(`old ${(t1 - t0).toFixed(0)}ms new ${(t2 - t1).toFixed(0)}ms`);
const out = { old: measure('old', a), new: measure('new', b) };
writeFileSync(outFile, JSON.stringify(out));
