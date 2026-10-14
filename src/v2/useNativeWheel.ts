import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** A wheel handler that can actually call preventDefault().
 *
 * React attaches `wheel` as a PASSIVE listener, so preventDefault() inside an
 * onWheel prop is ignored: the browser still scrolls, and with Ctrl held (or a
 * touchpad pinch, which arrives as Ctrl+wheel) it zooms the whole interface
 * instead of the photo. This attaches the listener natively, non-passive, and
 * always calls the latest handler, so the caller can close over fresh state. */
export function useNativeWheel(
  ref: RefObject<HTMLElement | null>,
  handler: (e: WheelEvent) => void,
) {
  const latest = useRef(handler);
  latest.current = handler;
  const attached = useRef<{ el: HTMLElement; off: () => void } | null>(null);
  // Checked after every render: the element may mount later or be replaced
  // (a canvas that only exists once a photo is open).
  useEffect(() => {
    const el = ref.current;
    if (attached.current?.el === el) return;
    attached.current?.off();
    attached.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => latest.current(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    attached.current = { el, off: () => el.removeEventListener('wheel', onWheel) };
  });
  useEffect(() => () => { attached.current?.off(); attached.current = null; }, []);
}
