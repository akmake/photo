/* Showing a set in the state its recipe leaves it.
 *
 * The recipe is registered with the engine once and addressed by a key
 * afterwards, which is what keeps a preview a plain GET: `<img loading="lazy">`
 * then does the work of not rendering the 1,900 frames nobody scrolled to, and
 * the browser caches what it has already seen. Sending the recipe with every
 * frame would mean a POST per thumbnail and no laziness at all.
 *
 * The key is a hash of the steps, so it changes the moment the recipe does and
 * a stale proxy can never be served under it.
 */

import { useEffect, useState } from 'react';
import { previewUrl, registerRecipe } from '../api';
import { activeSteps, useRecipe } from './store';

export interface SetPreview {
  /** A frame as the set currently looks. */
  url: (path: string, width?: number) => string;
  /** True once the recipe has steps AND the engine has acknowledged them. */
  graded: boolean;
  /** Steps that will run. 0 means the set is untouched — the raw file IS the
   *  current state, and showing it is correct rather than a fallback. */
  steps: number;
  /** The engine could not be reached, so the frames below are the RAW files.
   *  Worth saying out loud: silently showing unedited frames under a screen
   *  that promises the edit is the exact confusion this model removes. */
  stale: boolean;
}

export function useSetPreview(projectId: string): SetPreview {
  const recipe = useRecipe(projectId);
  const [key, setKey] = useState('');
  const [stale, setStale] = useState(false);

  const steps = activeSteps(projectId);
  const count = steps.length;

  useEffect(() => {
    if (!count) {
      setKey('');
      setStale(false);
      return;
    }
    let alive = true;
    setStale(false);
    registerRecipe(steps)
      .then((k) => {
        if (alive) setKey(k);
      })
      .catch(() => {
        if (!alive) return;
        setKey('');
        setStale(true);
      });
    return () => {
      alive = false;
    };
    // `recipe` is the store's identity for these steps; `steps` is rebuilt on
    // every render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, recipe]);

  return {
    url: (path: string, width = 320) => previewUrl(path, width, key),
    graded: count > 0 && key !== '',
    steps: count,
    stale,
  };
}
