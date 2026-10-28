'use client';

import { useMemo } from 'react';
import type { GlobalEvent } from '@/lib/globalEvents';
import { MASK_H, MASK_W } from '@/lib/worldGeo';
import { useWorldGeo } from '@/lib/useWorldGeo';
import { forecastStorm, trackPointsOf, type StormForecast } from '@/lib/stormForecast';

/** Projection for a storm event (null for other events, storms without a timed track, or before the land mask is built). */
export function useStormForecast(e: GlobalEvent | null): StormForecast | null {
  const geo = useWorldGeo();
  return useMemo(() => {
    if (!e || e.type !== 'storm' || !geo) return null;
    const { track, current } = trackPointsOf(e);
    const isLand = (lon: number, lat: number) => {
      const x = Math.floor((((lon + 180) % 360) + 360) % 360 / 360 * MASK_W) % MASK_W;
      const y = Math.max(0, Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H)));
      return geo.mask[y * MASK_W + x] === 1;
    };
    return forecastStorm(track, current, isLand);
  }, [e, geo]);
}
