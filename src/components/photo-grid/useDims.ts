/* The proportions of a set of photographs, known before any thumbnail loads
 * (engine POST /dims reads the file headers). Remembered for the session, so a
 * screen opened twice lays out at once the second time. If the engine does
 * not answer — an older engine, a failure — nothing breaks: PhotoGrid learns
 * each photograph's shape from its thumbnail instead. */

import { useEffect, useState } from 'react';

const ENGINE = 'http://127.0.0.1:8756';

const known = new Map<string, number>();

export function useDims(paths: string[]): Map<string, number> {
  const [, bump] = useState(0);
  const key = paths.length ? `${paths.length}:${paths[0]}:${paths[paths.length - 1]}` : '';
  useEffect(() => {
    const missing = paths.filter((p) => !known.has(p));
    if (!missing.length) return undefined;
    let alive = true;
    fetch(`${ENGINE}/dims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: missing }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dims?: Record<string, [number, number]> } | null) => {
        if (!j?.dims) return;
        for (const [p, [w, h]] of Object.entries(j.dims)) if (w && h) known.set(p, w / h);
        if (alive) bump((n) => n + 1);
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return known;
}
