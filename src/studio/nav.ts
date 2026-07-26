/* Navigation model.
 *
 * Two axes, and they are deliberately different things:
 *
 *  SECTIONS (sidebar)  — where in the business you are. Persistent.
 *  STAGES  (tabs)      — where in ONE project's lifecycle you are. Ordered,
 *                        and a project moves through them left to right.
 *
 * The stage list is the product's spine: upload -> cull -> client picks ->
 * EDIT -> album. `gallery-edit` is the stage this application actually
 * performs; the rest describe work that happens around it.
 */

export type SectionId =
  | 'home'
  | 'projects'
  | 'galleries'
  | 'culling'
  | 'editing'
  | 'lab'
  | 'compare'
  | 'albums'
  | 'clients'
  | 'orders'
  | 'reports'
  | 'settings';

export type StageId =
  | 'client-status'
  | 'gallery-upload'
  | 'gallery-cull'
  | 'gallery-picked'
  | 'gallery-edit'
  | 'album-design';

export interface SectionDef {
  id: SectionId;
  label: string;
  icon: string;
}

export const SECTIONS: SectionDef[] = [
  { id: 'home', label: 'דף הבית', icon: 'home' },
  { id: 'projects', label: 'פרויקטים', icon: 'folder' },
  { id: 'galleries', label: 'גלריות', icon: 'gallery' },
  { id: 'culling', label: 'סינון גלריה', icon: 'filter' },
  { id: 'editing', label: 'עיבוד גלריה', icon: 'sliders' },
  // Not part of a project's lifecycle: a bench for testing one tool on one
  // photo, with the engine's own report of what it did.
  { id: 'lab', label: 'מעבדה', icon: 'lab' },
  // Reads an existing edit instead of producing one.
  { id: 'compare', label: 'קריאת עריכה', icon: 'compare' },
  { id: 'albums', label: 'עיצוב אלבומים', icon: 'book' },
  { id: 'clients', label: 'לקוחות', icon: 'users' },
  { id: 'orders', label: 'הזמנות ומוצרים', icon: 'bag' },
  { id: 'reports', label: 'דוחות', icon: 'chart' },
  { id: 'settings', label: 'הגדרות', icon: 'gear' },
];

export type StageState = 'done' | 'active' | 'idle';

export interface StageDef {
  id: StageId;
  label: string;
  icon: string;
}

export const STAGES: StageDef[] = [
  { id: 'client-status', label: 'סטטוס לקוח', icon: 'users' },
  { id: 'gallery-upload', label: 'העלאת גלריה', icon: 'upload' },
  { id: 'gallery-cull', label: 'סינון גלריה', icon: 'filter' },
  { id: 'gallery-picked', label: 'תמונות שנבחרו', icon: 'heart' },
  { id: 'gallery-edit', label: 'עיבוד גלריה', icon: 'sliders' },
  { id: 'album-design', label: 'עיצוב אלבום', icon: 'book' },
];

/** The stage a sidebar section drops you into, when there is one. */
export const SECTION_TO_STAGE: Partial<Record<SectionId, StageId>> = {
  galleries: 'gallery-upload',
  culling: 'gallery-cull',
  editing: 'gallery-edit',
  albums: 'album-design',
};
