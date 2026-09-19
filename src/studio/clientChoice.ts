/* The client's selection is a view of the shoot, never a replacement for its
 * editing structure. Keeping this as a pure transition makes the invariant
 * testable: importing a choice may update `gallery`, but it cannot touch the
 * original batches, assignments or recipes. */

import type { GalleryLink, ProjectMemory } from '../api';

export interface ClientChoicePlan {
  matched: string[];
  missing: string[];
  albums: GalleryLink['albums'];
  groups?: GalleryLink['selectionGroups'];
}

export function withClientChoice(
  current: ProjectMemory,
  link: GalleryLink,
  plan: ClientChoicePlan,
  importedAt = Date.now(),
): ProjectMemory {
  return {
    ...current,
    gallery: {
      ...link,
      importedAt,
      selectedFrames: [...new Set(plan.matched)],
      selectionGroups: plan.groups,
      missing: plan.missing,
      albums: plan.albums,
    },
  };
}
