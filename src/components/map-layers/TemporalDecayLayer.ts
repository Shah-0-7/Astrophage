/**
 * ============================================================
 * TemporalDecayLayer
 * ============================================================
 * Renders seismic threat rings whose opacity, scale, and colour
 * intensity are bound to the active epoch (pass) scrubber index.
 *
 * Behaviour:
 *   – Event ring PULSES at its trigger pass (opacity 1.0, full scale)
 *   – Opacity and scale decay exponentially as passes advance
 *   – Events more than MAX_DECAY_PASSES old become invisible
 * ============================================================
 */

'use client';

import { ScatterplotLayer } from '@deck.gl/layers';
import type { UnifiedFeature, SeismicProperties } from '@/lib/types';

/** Number of passes after which an event fully fades to zero */
const MAX_DECAY_PASSES = 8;

/** Map of pass index → list of node/event IDs that fire at that pass */
const SEISMIC_TRIGGER_PASSES: Record<number, string[]> = {
  2:  ['TC-89'],
  5:  ['EQ-99', 'TC-44'],
  8:  ['TC-31'],
  11: ['TC-89', 'EQ-99'],
  14: ['TC-44', 'TC-31'],
  17: ['EQ-99'],
};

interface EventPoint {
  position:   [number, number];
  magnitude:  number;
  passIndex:  number;   // which pass triggered this event
  id:         string;
}

function magToColor(mag: number): [number, number, number] {
  if (mag >= 7.0) return [239, 68,  68];
  if (mag >= 6.0) return [251, 146, 60];
  if (mag >= 5.0) return [250, 204, 21];
  return                 [ 74, 222, 128];
}

/**
 * Build decay-bound threat ring layers.
 *
 * @param features   – seismic UnifiedFeature[] from SSE stream
 * @param passIndex  – current epoch index from scrubber (0-based)
 * @param visible    – layer toggle
 */
export function buildTemporalDecayLayers(props: {
  features:  UnifiedFeature[];
  passIndex: number;
  visible:   boolean;
}) {
  if (!props.visible || props.features.length === 0) return [];

  // Assign each feature a pass index based on its timestamp,
  // anchored to the event time relative to a fixed mission start.
  // If no temporal data available, use hash of event ID as fallback.
  const MISSION_START = new Date('2024-01-01T00:00:00Z').getTime();
  const PASS_INTERVAL_MS = 12 * 24 * 60 * 60 * 1000; // 12-day repeat

  const points: EventPoint[] = props.features.map((f) => {
    const p = f.properties as SeismicProperties;
    const [lng, lat] = (f.geometry as any).coordinates;
    const eventMs = new Date(p.event_time).getTime();
    const passIndex = Math.max(0, Math.floor((eventMs - MISSION_START) / PASS_INTERVAL_MS));

    return {
      position:  [lng, lat],
      magnitude: p.magnitude,
      passIndex: passIndex % 18, // clamp to scrubber range
      id:        f.id,
    };
  });

  // Filter to events visible in the current epoch window
  const visible = points.filter(p => {
    const delta = props.passIndex - p.passIndex;
    return delta >= 0 && delta <= MAX_DECAY_PASSES;
  });

  // Build concentric rings (4 per event, decaying outward)
  const layers = Array.from({ length: 4 }).map((_, ring) => {
    return new ScatterplotLayer<EventPoint>({
      id:          `temporal-decay-ring-${ring}`,
      data:        visible,
      getPosition: (d) => d.position,
      getRadius: (d) => {
        const delta      = props.passIndex - d.passIndex;
        const decayFactor = 1 - delta / MAX_DECAY_PASSES;
        const base       = Math.pow(10, (d.magnitude - 3.5) * 0.6) * 18000;
        return base * (1 - ring * 0.18) * (0.6 + decayFactor * 0.4);
      },
      getFillColor: (d) => {
        const delta       = props.passIndex - d.passIndex;
        const decayFactor = Math.max(0, 1 - delta / MAX_DECAY_PASSES);
        const [r, g, b]   = magToColor(d.magnitude);
        const isPulse     = delta === 0;
        const alpha       = isPulse
          ? 40 + ring * 20
          : Math.floor((40 + ring * 20) * decayFactor);
        return [r, g, b, alpha];
      },
      getLineColor: (d) => {
        const delta       = props.passIndex - d.passIndex;
        const decayFactor = Math.max(0, 1 - delta / MAX_DECAY_PASSES);
        const [r, g, b]   = magToColor(d.magnitude);
        const alpha       = ring === 0
          ? Math.floor(220 * decayFactor)
          : Math.floor((80 - ring * 18) * decayFactor);
        return [r, g, b, Math.max(0, alpha)];
      },
      stroked:          true,
      filled:           true,
      lineWidthMinPixels: ring === 0 ? 2 : 1,
      radiusUnits:      'meters',
      pickable:         false,
      updateTriggers: {
        getRadius:    [props.passIndex, props.features.length],
        getFillColor: [props.passIndex, props.features.length],
        getLineColor: [props.passIndex, props.features.length],
      },
    });
  });

  return layers;
}
