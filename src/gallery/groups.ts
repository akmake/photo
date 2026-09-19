import type { Item } from './api';

export interface GalleryGroup {
  id: string;
  name: string;
  items: Item[];
}

/** Preserve the order in which the photographer's groups first occur and the
 * capture order inside each one. Old galleries without group metadata remain
 * one honest section rather than disappearing. */
export function groupGalleryItems(items: Item[]): GalleryGroup[] {
  const groups = new Map<string, GalleryGroup>();
  for (const item of items) {
    const id = item.groupId || '__ungrouped__';
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: item.groupName?.trim() || 'תמונות נוספות',
        items: [],
      };
      groups.set(id, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
