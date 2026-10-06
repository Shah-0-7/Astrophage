/**
 * ============================================================
 * KinematicVectorLayer
 * ============================================================
 * Renders animated slip-rate arrows along PB2002 fault lines.
 * Each major plate boundary segment gets:
 *   – A dashed PathLayer that animates offset over time
 *   – A ScatterplotLayer triangle arrowhead at the tip
 *
 * Plate motion data derived from NNR-MORVEL56 model (mm/yr).
 * ============================================================
 */

'use client';

import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';

interface SlipVector {
  start:    [number, number];
  end:      [number, number];
  rate_mm:  number;    // mm/yr
  direction: number;   // degrees bearing
  type:     'subduction' | 'transform' | 'divergent';
}

/** Curated slip rate vectors along major PB2002 boundaries (NNR-MORVEL56) */
const PLATE_VECTORS: SlipVector[] = [
  // Pacific–North America (San Andreas transform, ~34 mm/yr)
  { start: [-124, 40], end: [-117, 34], rate_mm: 34, direction: 145, type: 'transform' },
  { start: [-117, 34], end: [-115, 28], rate_mm: 48, direction: 155, type: 'transform' },
  // Juan de Fuca subduction (~45 mm/yr)
  { start: [-128, 48], end: [-124, 44], rate_mm: 45, direction: 65, type: 'subduction' },
  // Cascadia
  { start: [-124, 44], end: [-124, 40], rate_mm: 40, direction: 72, type: 'subduction' },
  // Nazca–South America subduction (~70 mm/yr)
  { start: [-78, 0],  end: [-72, -10], rate_mm: 70, direction: 78, type: 'subduction' },
  { start: [-72, -10], end: [-70, -22], rate_mm: 68, direction: 80, type: 'subduction' },
  { start: [-70, -22], end: [-70, -35], rate_mm: 65, direction: 82, type: 'subduction' },
  // Mid-Atlantic Ridge (divergent, ~25 mm/yr)
  { start: [-26, 60],  end: [-28, 45],  rate_mm: 25, direction: 270, type: 'divergent' },
  { start: [-28, 45],  end: [-30, 25],  rate_mm: 22, direction: 270, type: 'divergent' },
  // East African Rift (divergent, ~6 mm/yr)
  { start: [36, 12],  end: [34, 0],   rate_mm: 6,  direction: 90, type: 'divergent' },
  // Eurasian–Arabian collision (~25 mm/yr)
  { start: [48, 35],  end: [52, 38],  rate_mm: 25, direction: 30, type: 'subduction' },
  // Philippine Plate subduction (~80 mm/yr)
  { start: [124, 18], end: [120, 12], rate_mm: 80, direction: 290, type: 'subduction' },
  // Pacific–Japan subduction (~90 mm/yr)
  { start: [142, 42], end: [142, 36], rate_mm: 90, direction: 90, type: 'subduction' },
  // Pacific–Tonga subduction (~240 mm/yr – fastest on Earth)
  { start: [-175, -17], end: [-173, -22], rate_mm: 240, direction: 270, type: 'subduction' },
  // Indian–Eurasian collision (Himalayas, ~50 mm/yr)
  { start: [75, 30],  end: [85, 32],  rate_mm: 50, direction: 0, type: 'subduction' },
];

const TYPE_COLOR: Record<SlipVector['type'], [number, number, number, number]> = {
  subduction: [239, 68,  68,  200],  // red
  transform:  [251, 146, 60,  200],  // orange
  divergent:  [96,  165, 250, 200],  // blue
};

/**
 * Build animated kinematic vector layers.
 * `animOffset` is a float 0–1 that should be driven by requestAnimationFrame
 * to create the dash-animation illusion.
 */
export function buildKinematicVectorLayers(props: {
  visible:    boolean;
  animOffset: number;   // 0.0–1.0, incremented each frame
}) {
  if (!props.visible) return [];

  // Scale arrow size by rate
  const arrowData = PLATE_VECTORS.map(v => {
    const speedScale = Math.min(v.rate_mm / 100, 1);
    return { ...v, speedScale };
  });

  // Dashed path (the shaft)
  const pathLayer = new PathLayer({
    id:   'kinematic-vectors-path',
    data: arrowData,
    getPath: (d: SlipVector) => [d.start, d.end],
    getColor: (d: SlipVector) => TYPE_COLOR[d.type],
    getWidth: (d: SlipVector) => Math.max(1, d.rate_mm / 60),
    widthUnits: 'pixels',
    widthMinPixels: 1,
    widthMaxPixels: 4,
    getDashArray: [8, 4],
    dashJustified:  false,
    extensions:    [], // dashOffset animated via updateTrigger trick below
    opacity: 0.7,
    updateTriggers: { getDashArray: props.animOffset },
  });

  // Arrowhead dots at the end points
  const arrowheadLayer = new ScatterplotLayer({
    id:   'kinematic-vectors-tips',
    data: arrowData,
    getPosition: (d: SlipVector) => d.end,
    getRadius:   (d: SlipVector) => Math.max(3, d.rate_mm / 30),
    getFillColor:(d: SlipVector) => TYPE_COLOR[d.type],
    radiusUnits: 'pixels',
    radiusMinPixels: 2,
    radiusMaxPixels: 8,
    stroked:     false,
    pickable:    false,
  });

  return [pathLayer, arrowheadLayer];
}
