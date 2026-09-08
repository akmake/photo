import { checkEngine, detectSpots, renderRecipe } from '../api';
import type { SpotCandidate, SpotDetection } from '../api';
import type { SpotOutline, SpotSelection } from '../types';

export type SmartCleanupSettings = Record<'redness' | 'spots', number>;

export interface SmartCleanupAnalysis {
  detection: SpotDetection;
  suggested: Set<string>;
}

export const DEFAULT_SMART_CLEANUP_SETTINGS: SmartCleanupSettings = {
  redness: 90,
  spots: 25,
};

export async function smartCleanupAvailable(): Promise<boolean> {
  return checkEngine();
}

/**
 * The UI speaks only to this feature contract. Today the implementation uses
 * TEZA's local face/skin detector; a future Qwen/SAM adapter can replace this
 * function without coupling the screen to model-specific payloads.
 */
export async function analyzeSmartCleanup(
  image: string,
  settings: SmartCleanupSettings,
): Promise<SmartCleanupAnalysis> {
  const detection = await detectSpots(image, settings);
  return {
    detection,
    suggested: new Set(
      detection.items.filter((item) => item.verdict === 'heal').map((item) => item.id),
    ),
  };
}

function outlinesFor(items: SpotCandidate[], selected: Set<string>): SpotOutline[] {
  return items.flatMap((item) => {
    if (!selected.has(item.id)) return [];
    return item.contours.map((points, index) => ({
      id: `${item.id}:${index}`,
      points,
    }));
  });
}

export async function applySmartCleanup(
  image: string,
  analysis: SpotDetection,
  selected: Set<string>,
  settings: SmartCleanupSettings,
): Promise<{ image: string; selection: SpotSelection; meta: Record<string, number | string> }> {
  const selection: SpotSelection = {
    polygons: outlinesFor(analysis.items, selected),
    spared: analysis.items.filter((item) => !selected.has(item.id)).map((item) => item.id),
  };
  const rendered = await renderRecipe(image, [{
    toolId: 'skin-cleanup',
    params: settings,
    enabled: true,
    selection,
  }]);
  return {
    image: rendered.image,
    selection,
    meta: rendered.meta.steps.find((step) => step.tool === 'skin-cleanup')?.meta ?? {},
  };
}
