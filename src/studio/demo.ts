/* Demo content for the surrounding screens.
 *
 * The editor stage runs on the photographer's REAL files through the Python
 * engine. Everything else describes work this build does not perform yet, so it
 * is filled with representative data and labelled as such in the UI — a screen
 * that silently shows invented numbers as if they were real is worse than an
 * empty one.
 */

import type { StageId, StageState } from './nav';

export interface StageStatus {
  id: StageId;
  state: StageState;
  date?: string;
  note?: string;
}

export interface ProjectSummary {
  id: string;
  client: string;
  title: string;
  email: string;
  phone: string;
  shootDate: string;
  shootType: string;
  originals: number;
  afterCull: number;
  clientPicked: number;
  inEditing: number;
  finished: number;
  galleryUrl: string;
  progress: number;
  stages: StageStatus[];
}

export const PROJECT: ProjectSummary = {
  id: 'prj-1',
  client: 'מלי כץ',
  title: 'מלי כץ – בת מצווה',
  email: 'mali.katz@email.com',
  phone: '050-1234567',
  shootDate: '10.05.2024',
  shootType: 'בת מצווה',
  originals: 1842,
  afterCull: 1246,
  clientPicked: 214,
  inEditing: 214,
  finished: 0,
  galleryUrl: 'https://teza.ai/gallery/malikatz',
  progress: 75,
  stages: [
    { id: 'gallery-upload', state: 'done', date: '11.05.2024' },
    { id: 'gallery-cull', state: 'done', date: '11.05.2024' },
    { id: 'gallery-picked', state: 'done', date: '12.05.2024' },
    { id: 'gallery-edit', state: 'active', note: '50%' },
    { id: 'album-design', state: 'idle' },
  ],
};

export interface ActivityItem {
  icon: string;
  title: string;
  detail: string;
  date: string;
  time: string;
  state: StageState;
}

export const ACTIVITY: ActivityItem[] = [
  {
    icon: 'heart',
    title: 'ההעלאה הושלמה',
    detail: 'הועלו 1,842 תמונות',
    date: '11.05.2024',
    time: '14:30',
    state: 'done',
  },
  {
    icon: 'filter',
    title: 'סינון אוטומטי הושלם',
    detail: 'נותרו 1,246 תמונות',
    date: '11.05.2024',
    time: '15:10',
    state: 'done',
  },
  {
    icon: 'gallery',
    title: 'הלקוחה בחרה תמונות',
    detail: 'נבחרו 214 תמונות',
    date: '12.05.2024',
    time: '10:25',
    state: 'done',
  },
  {
    icon: 'sliders',
    title: 'עיבוד גלריה התחיל',
    detail: 'בתהליך…',
    date: '12.05.2024',
    time: '11:00',
    state: 'active',
  },
];

export const STORAGE = { usedGb: 782, totalGb: 2048 };

export const MESSAGE_TEMPLATES = [
  'הגלריה שלך מוכנה לצפייה 🌸',
  'תזכורת — נשמח לבחירת התמונות עד סוף השבוע',
  'העיבוד הסתיים, התמונות בדרך אליך',
];

export interface ClientRow {
  name: string;
  event: string;
  date: string;
  photos: number;
  stage: string;
  state: StageState;
}

export const CLIENTS: ClientRow[] = [
  { name: 'מלי כץ', event: 'בת מצווה', date: '10.05.2024', photos: 1842, stage: 'עיבוד גלריה', state: 'active' },
  { name: 'רבקי פרידמן', event: 'אירוע נשים', date: '02.05.2024', photos: 960, stage: 'עיצוב אלבום', state: 'active' },
  { name: 'שרה לוי', event: 'משפחה', date: '28.04.2024', photos: 412, stage: 'הושלם', state: 'done' },
  { name: 'חני רוזנברג', event: 'ילדים', date: '21.04.2024', photos: 288, stage: 'הושלם', state: 'done' },
  { name: 'אסתי גולד', event: 'מגזין', date: '14.04.2024', photos: 156, stage: 'הושלם', state: 'done' },
];
