/**
 * THE COVER OF A PROJECT CARD: a photograph from that shoot, or nothing.
 *
 * This file used to hold twelve stock photographs of strangers, fetched from
 * the internet, and hand one to every project by a hash of its name. It read as
 * a fallback — "use the project's own picture if it has one" — but the field it
 * tested (`thumb`) is written empty when a project is created and is not filled
 * anywhere in the application, so the fallback was the only path there was:
 * every card, in every project, on every launch, showed someone else's work as
 * though it were the photographer's, and the app went to the network to get it.
 *
 * What a card shows now is one of the project's OWN frames, remembered when its
 * folder is first read (studio/store.ts::rememberCover). Before the shoot is
 * imported there is no photograph to show and the answer is null — the card
 * draws an empty tile and says the shoot has not been imported. An empty tile
 * is true; a stranger's portrait is not (CLAUDE.md section 5).
 */
import { thumbUrl } from '../api';

/** The cover of a project card, or null when the shoot has no frames yet.
 *
 * `width` is the size the engine is asked to draw, so a small tile does not
 * pull a large picture: pass what the layout actually shows. */
export function getProjectCover(
  project?: { thumb?: string; cover?: string } | null,
  width = 480,
): string | null {
  // `thumb` first: nothing writes it today, but a project restored from an
  // older record may carry one, and a picture the photographer chose outranks
  // one this code picked for him.
  if (project?.thumb && project.thumb.trim() !== '') return project.thumb;
  if (project?.cover) return thumbUrl(project.cover, width);
  return null;
}
