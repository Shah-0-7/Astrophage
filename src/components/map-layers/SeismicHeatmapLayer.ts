/**
 * ============================================================
 * SeismicHeatmapLayer
 * ============================================================
 * Renders a WebGL heatmap of seismic event density at global
 * zoom, resolving into discrete impact rings on zoom-in.
 * Uses @deck.gl/aggregation-layers HeatmapLayer for the
 * continent-scale view.
 * ============================================================
 */

'use client';

import { useMemo } from 'react';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { UnifiedFeature, SeismicProperties } from '@/lib/types';

interface Props {
  features: UnifiedFeature[];
  visible:  boolean;
  zoom:     number;           // current map zoom – controls layer switch-over
}

// Heatmap resolves to rings below this zoom
const HEATMAP_MAX_ZOOM = 4;

// RGBA colour ramp: blue → orange → red
const COLOR_RANGE: [number, number, number, number][] = [
  [  0,   0, 255,  40],
  [  0, 180, 255,  80],
  [  0, 255, 128, 120],
  [255, 200,   0, 160],
  [255, 120,   0, 200],
  [239,  68,  68, 240],
];

export function buildSeismicHeatmapLayer(props: Props) {
  if (!props.visible || props.zoom > HEATMAP_MAX_ZOOM) return null;

  const data = props.features.map(f => {
    const p = f.properties as SeismicProperties;
    const [lng, lat] = (f.geometry as any).coordinates;
    return { position: [lng, lat] as [number, number], weight: p.magnitude ?? 1 };
  });

  return new HeatmapLayer({
    id:           'seismic-heatmap',
    data,
    getPosition:  (d: any) => d.position,
    getWeight:    (d: any) => Math.pow(10, (d.weight - 3) * 0.3), // log-scale weight
    radiusPixels: 60,
    intensity:    1.5,
    threshold:    0.05,
    colorRange:   COLOR_RANGE,
    opacity:      0.85,
    updateTriggers: { getWeight: props.features.length },
  });
}
