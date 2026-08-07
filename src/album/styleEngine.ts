export type AlbumStyleId = 'Fine Art' | 'נקי ומודרני' | 'קלאסי';

export interface AlbumStyleProfile {
  id: AlbumStyleId;
  label: string;
  description: string;
  /** Default number of photos per spread, repeated as an album rhythm. */
  rhythm: number[];
  /** Page-relative whitespace and frame spacing used by generated layouts. */
  margin: number;
  gap: number;
  backgrounds: string[];
  /** Candidate-specific score bonuses. The highest result becomes the default. */
  layoutWeights: Record<string, number>;
  densityTarget: number;
}

export const ALBUM_STYLES: AlbumStyleProfile[] = [
  {
    id: 'Fine Art',
    label: 'Fine Art',
    description: 'מעט תמונות, הרבה אוויר ורגע מוביל ברור',
    rhythm: [1, 2, 3, 1, 2, 3],
    margin: 0.115,
    gap: 0.045,
    backgrounds: ['#f8f3eb', '#f3eadf', '#fbf8f3'],
    layoutWeights: {
      'hero-left': 13,
      'hero-right': 13,
      editorial: 10,
      balanced: 2,
      'wide-rhythm': 1,
      'portrait-rhythm': 1,
    },
    densityTarget: 2,
  },
  {
    id: 'נקי ומודרני',
    label: 'נקי ומודרני',
    description: 'רשת מדויקת, מרווחים צרים וקצב אחיד',
    rhythm: [4, 4, 6, 4, 6],
    margin: 0.055,
    gap: 0.016,
    backgrounds: ['#ffffff', '#f7f7f5', '#ececea'],
    layoutWeights: {
      balanced: 14,
      'wide-rhythm': 10,
      'portrait-rhythm': 10,
      editorial: 2,
      'hero-left': 1,
      'hero-right': 1,
    },
    densityTarget: 4.8,
  },
  {
    id: 'קלאסי',
    label: 'קלאסי',
    description: 'סימטריה, מסגרות נדיבות וקצב סיפור יציב',
    rhythm: [2, 4, 4, 2, 4],
    margin: 0.078,
    gap: 0.027,
    backgrounds: ['#eee6da', '#f7f1e8', '#ded2c3'],
    layoutWeights: {
      balanced: 15,
      'portrait-rhythm': 7,
      'wide-rhythm': 6,
      'hero-left': 3,
      'hero-right': 3,
      editorial: 0,
    },
    densityTarget: 3.2,
  },
];

export function getAlbumStyle(styleName?: string): AlbumStyleProfile {
  return ALBUM_STYLES.find((style) => style.id === styleName) ?? ALBUM_STYLES[0];
}
