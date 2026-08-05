/* Navigation model.
 *
 * The rail is the BUSINESS: today, projects, clients, calendar, settings. That
 * is where the photographer is between sessions.
 *
 * The work itself — import, cull, edit, album, deliver — does NOT appear here.
 * It lives inside a project, because it is only ever true of one project at a
 * time. The old model listed those stages BOTH in the rail and as tabs, so two
 * routes led to the same screen and no mental model could form. See
 * docs/UX-SKELETON.md §1.4.
 *
 * ONE item breaks that rule on purpose, and it is מעבדה. The lab is not a
 * project stage and never was: it is one photograph, one tool, and the engine's
 * own report — the room you go to when you want to know what a tool actually
 * does, on no client's work. It belongs to no project, so there is nowhere
 * inside a project to put it, and until now it had no door at all: #/lab and
 * #/compare existed and nothing in the product linked to either, so the only
 * way in was to type the URL. A screen no one can reach is a screen that is not
 * finished. It sits LAST, next to settings, because it is a workshop and not a
 * place the day passes through.
 *
 * There is deliberately no "tasks" item: a task always belongs to a project or a
 * client, so it lives in Today's queue and inside the project. A six-item rail
 * stays readable; a twelve-item one does not.
 */

export type SectionId =
  /* the business axis — what the rail shows */
  | 'today'
  | 'projects'
  | 'project'
  | 'clients'
  | 'calendar'
  | 'lab'
  | 'settings'
  /* Not rail destinations. Still reachable by hash while the screens that will
   * absorb them are built — the tools are scheduled last. */
  | 'home'
  | 'galleries'
  | 'culling'
  | 'editing'
  | 'albums'
  | 'orders'
  | 'reports';

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
  /** Pushed to the foot of the rail — settings is not a peer of the work. */
  foot?: boolean;
}

/** The rail. Four places in the business, then the workshop, then settings. */
export const SECTIONS: SectionDef[] = [
  { id: 'today', label: 'היום', icon: 'home' },
  { id: 'projects', label: 'פרויקטים', icon: 'folder' },
  { id: 'clients', label: 'לקוחות', icon: 'users' },
  { id: 'calendar', label: 'יומן', icon: 'calendar' },
  { id: 'lab', label: 'מעבדה', icon: 'lab' },
  { id: 'settings', label: 'הגדרות', icon: 'gear', foot: true },
];

export type StageState = 'done' | 'active' | 'idle';

export interface StageDef {
  id: StageId;
  label: string;
  icon: string;
}

/* The stages of one project. Rendered as the measure rail INSIDE a project —
 * never in the shell. */
export const STAGES: StageDef[] = [
  { id: 'client-status', label: 'סטטוס לקוח', icon: 'users' },
  { id: 'gallery-upload', label: 'ייבוא', icon: 'upload' },
  { id: 'gallery-cull', label: 'בחירה', icon: 'filter' },
  { id: 'gallery-picked', label: 'תמונות שנבחרו', icon: 'heart' },
  { id: 'gallery-edit', label: 'עריכה', icon: 'sliders' },
  { id: 'album-design', label: 'אלבום', icon: 'book' },
];

/** Legacy hash routes that still drop into a stage. Nothing in the rail maps
 *  here any more; kept so existing links resolve until the project screen
 *  absorbs them. */
export const SECTION_TO_STAGE: Partial<Record<SectionId, StageId>> = {
  galleries: 'gallery-upload',
  culling: 'gallery-cull',
  editing: 'gallery-edit',
  albums: 'album-design',
};
