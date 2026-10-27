'use client';

import { useEffect, useState } from 'react';
import { loadWorldGeo, type WorldGeo } from './worldGeo';

/** Bundled world geometry (coast, borders, land mask). `null` until it has been built once. */
export function useWorldGeo(): WorldGeo | null {
  const [geo, setGeo] = useState<WorldGeo | null>(null);
  useEffect(() => {
    let alive = true;
    loadWorldGeo().then(g => { if (alive) setGeo(g); }).catch(err => console.warn('[worldGeo] failed to build', err));
    return () => { alive = false; };
  }, []);
  return geo;
}
