export type AlbumStyleId = 'Fine Art' | 'נקי ומודרני' | 'קלאסי';

export interface AlbumStyleProfile {
  id: AlbumStyleId;
  label: string;
  description: string;
  /** Legacy fallback when photographs are unavailable; contextual building does
   * not repeat this sequence as a design rule. */
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
    description: 'שוליים נדיבים, היררכיה ברורה וגמישות לפי הרגע',
    /* A complete story needs an establishing frame, then denser narrative
     * beats, and a quiet close. This 32-photo cycle produces the same 11-spread
     * pace as the validated family-session proof instead of stretching it to
     * sixteen sparse spreads. */
    rhythm: [1, 2, 3, 3, 4, 3, 3, 4, 3, 4, 2],
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
      'story-opener': 22,
      'story-duet': 20,
      'story-focus': 18,
      'story-hero-left': 22,
      'story-hero-right': 22,
      'story-grid': 18,
    },
    densityTarget: 2,
  },
  {
    id: 'נקי ומודרני',
    label: 'נקי ומודרני',
    description: 'רשת מדויקת, קווים נקיים וקצב שמגיב לרצף',
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
    description: 'סימטריה, מסגרות נדיבות והיררכיה מאופקת',
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
