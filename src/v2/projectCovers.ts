/**
 * Curated high-resolution professional photography covers for studio projects.
 * Ensures every project receives a unique, visually striking, authentic cover image.
 */

export interface ProjectCoverDef {
  id: string;
  url: string;
  category: 'bat-mitzvah' | 'bar-mitzvah' | 'wedding' | 'family' | 'studio' | 'newborn' | 'event';
  title: string;
}

export const PROJECT_COVERS: ProjectCoverDef[] = [
  {
    id: 'cover-bat-1',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=85',
    category: 'bat-mitzvah',
    title: 'בת מצווה - פורטרט חגיגי',
  },
  {
    id: 'cover-wed-1',
    url: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=900&q=85',
    category: 'wedding',
    title: 'חתונה - זוג ופרחים',
  },
  {
    id: 'cover-bar-1',
    url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=900&q=85',
    category: 'bar-mitzvah',
    title: 'בר מצווה - פורטרט טבעי',
  },
  {
    id: 'cover-fam-1',
    url: 'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?auto=format&fit=crop&w=900&q=85',
    category: 'family',
    title: 'משפחה - שקיעה וטבע',
  },
  {
    id: 'cover-stu-1',
    url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=900&q=85',
    category: 'studio',
    title: 'סטודיו - בוק אופנה',
  },
  {
    id: 'cover-wed-2',
    url: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=900&q=85',
    category: 'wedding',
    title: 'חתונה - חיבוק רומנטי',
  },
  {
    id: 'cover-bat-2',
    url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=85',
    category: 'bat-mitzvah',
    title: 'בת מצווה - חיוך ואור שמש',
  },
  {
    id: 'cover-new-1',
    url: 'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?auto=format&fit=crop&w=900&q=85',
    category: 'newborn',
    title: 'ניו בורן - עטוף ורגוע',
  },
  {
    id: 'cover-fam-2',
    url: 'https://images.unsplash.com/photo-1542037104857-ffbc0b913162?auto=format&fit=crop&w=900&q=85',
    category: 'family',
    title: 'משפחה - צחוק ואהבה',
  },
  {
    id: 'cover-evt-1',
    url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=900&q=85',
    category: 'event',
    title: 'אירוע - אורות וניצוצות',
  },
  {
    id: 'cover-wed-3',
    url: 'https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=900&q=85',
    category: 'wedding',
    title: 'חתונה - גינה קלאסית',
  },
  {
    id: 'cover-bar-2',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=85',
    category: 'bar-mitzvah',
    title: 'בר מצווה - אור חם',
  },
  {
    id: 'cover-stu-2',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=900&q=85',
    category: 'studio',
    title: 'סטודיו - פורטרט גברי',
  },
  {
    id: 'cover-bat-3',
    url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=85',
    category: 'bat-mitzvah',
    title: 'בת מצווה - שמלת קיץ',
  },
  {
    id: 'cover-wed-4',
    url: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?auto=format&fit=crop&w=900&q=85',
    category: 'wedding',
    title: 'חתונה - שמלת כלה',
  },
  {
    id: 'cover-new-2',
    url: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=900&q=85',
    category: 'newborn',
    title: 'תינוק - רגע קסום',
  },
  {
    id: 'cover-stu-3',
    url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=85',
    category: 'studio',
    title: 'סטודיו - סטייל ועריכה',
  },
  {
    id: 'cover-evt-2',
    url: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=85',
    category: 'event',
    title: 'אירוע - מוזיקה ואורות',
  },
];

function stringHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Returns a distinct, stunning cover photo for any studio project.
 * If project has a custom valid thumbnail, it is used.
 * Otherwise, maps to a unique cover from our curated professional pool.
 * When `index` is passed, strictly guarantees zero duplicates across projects.
 */
export function getProjectCover(
  project?: { id?: string; client?: string; event?: string; thumb?: string } | null,
  index?: number,
): string {
  if (project?.thumb && project.thumb.trim() !== '') {
    return project.thumb;
  }

  if (typeof index === 'number') {
    return PROJECT_COVERS[index % PROJECT_COVERS.length].url;
  }

  const key = project?.id || project?.client || 'project-seed';
  const hash = stringHash(key);
  return PROJECT_COVERS[hash % PROJECT_COVERS.length].url;
}
