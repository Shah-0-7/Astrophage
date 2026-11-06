'use client';

import { useEffect, useState } from 'react';

export type SceneCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, Record<string, unknown>>;
export interface ScenesState {
  scenes: SceneCollection | null;
  /** idle: layer off; zoom: view too large; loading; ok; error: NASA catalogue did not answer */
  status: 'idle' | 'zoom' | 'loading' | 'ok' | 'error';
  count: number;
  truncated: boolean;
}

const MAX_W = 60, MAX_H = 40;

/**
 * Real NISAR scene footprints for the area in view (last 14 days). Loads only while `enabled`, only for areas small
 * enough to be useful, and waits for the map to stop moving before asking.
 */
export function useNisarScenes(enabled: boolean, bbox: [number, number, number, number] | null, days = 14): ScenesState {
  const [state, setState] = useState<ScenesState>({ scenes: null, status: 'idle', count: 0, truncated: false });
  const key = bbox ? bbox.map(v => v.toFixed(1)).join(',') : '';

  useEffect(() => {
    if (!enabled) { setState(s => (s.status === 'idle' ? s : { scenes: null, status: 'idle', count: 0, truncated: false })); return; }
    if (!bbox) return;
    const [w, s, e, n] = bbox;
    const width = e >= w ? e - w : e + 360 - w;
    if (width > MAX_W || n - s > MAX_H) { setState(p => ({ ...p, status: 'zoom' })); return; }

    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setState(p => ({ ...p, status: 'loading' }));
      try {
        const r = await fetch(`/api/nisar/granules?bbox=${bbox.map(v => v.toFixed(2)).join(',')}&days=${days}`, { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok || j?.meta?.ok === false) { setState(p => ({ ...p, status: 'error' })); return; }
        setState({ scenes: j as SceneCollection, status: 'ok', count: j.meta?.count ?? j.features.length, truncated: !!j.meta?.truncated });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setState(p => ({ ...p, status: 'error' }));
      }
    }, 700);
    return () => { clearTimeout(t); ctl.abort(); };
    // `key` stands in for `bbox` so tiny float changes do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, days]);

  return state;
}
