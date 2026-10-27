/**
 * Turns a GlobalEvent (directory / globe schema) into the UnifiedFeature the radar map and its side panel select on,
 * so "open in radar" shows the same callout and info panel as clicking an event on the map.
 */
import type { UnifiedFeature } from './types';
import type { GlobalEvent } from './globalEvents';
import { EVENT_TYPE_CONFIG } from './eventDirectoryTypes';
import { estimateDisplacement } from './eventPhysics';

export function globalEventToFeature(e: GlobalEvent): UnifiedFeature {
  const iso = new Date(e.time).toISOString();
  const est = estimateDisplacement(e);
  const common = {
    global_id: e.id,
    kind_label: EVENT_TYPE_CONFIG[e.type].label,
    source_name: e.sources.join(' + '),
    source_url: e.source_url,
    displacement_label: est.label,
    displacement_note: est.note,
    headline: e.magnitude != null ? (e.source === 'Smithsonian GVP' ? `VEI ${Math.round(e.magnitude)}` : `M ${e.magnitude.toFixed(1)}`) : undefined,
  };
  const geometry = { type: 'Point' as const, coordinates: [e.lon, e.lat] };

  if (e.type === 'volcanic') {
    return {
      id: e.id, source: 'volcanism', geometry,
      properties: {
        ...common, volcano_id: 0, name: e.title, country: '', aviation_color: 'GREEN',
        alert_level: e.magnitude != null ? `VEI ${Math.round(e.magnitude)}` : 'REPORTED', last_eruption: iso, activity: e.title,
      },
    } as UnifiedFeature;
  }
  if (e.type === 'tsunami') {
    return { id: e.id, source: 'tsunami', geometry, properties: { ...common, warning_id: e.id, title: e.title, severity: 'INFO', issued_at: iso } } as UnifiedFeature;
  }
  if (e.type === 'cryosphere') {
    return { id: e.id, source: 'cryosphere', geometry, properties: { ...common, title: e.title, place: e.title, date: iso, hemisphere: e.lat >= 0 ? 'N' : 'S', extent_sq_km: 0, anomaly_sq_km: 0 } } as UnifiedFeature;
  }
  // earthquakes, induced seismicity, mining events, landslides and subsidence all use the seismic-style callout
  return {
    id: e.id, source: 'seismic', geometry,
    properties: {
      ...common, magnitude: e.magnitude ?? 0, place: e.title, depth_km: e.depth ?? 0, tsunami: 0, sig: 0,
      event_time: iso, url: e.source_url,
    },
  } as UnifiedFeature;
}
