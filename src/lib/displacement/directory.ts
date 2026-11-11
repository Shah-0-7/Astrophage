import type { GlobalEvent } from '@/lib/globalEvents';
import type { FieldMeta } from './field';
import { matchFields } from './match';

export interface TopoEntry {
  /** stable key for lists */
  key: string;
  /** the event the grids were processed for; a stand-in at the grid's centre when the directory holds no such event */
  event: GlobalEvent;
  /** grids that contain and span the event, shortest pair first */
  grids: FieldMeta[];
  /** true when no directory event matched and `event` was made up from the grid itself */
  orphan: boolean;
}

/** A stand-in event for a processed grid that no directory event explains, so it can still be opened. */
export function gridEvent(m: FieldMeta): GlobalEvent {
  return {
    id: `grid:${m.id}`, type: 'tectonic', cause: 'natural', title: 'Processed NISAR grid',
    lat: (m.bbox[1] + m.bbox[3]) / 2, lon: (m.bbox[0] + m.bbox[2]) / 2, time: Math.round((m.reference + m.secondary) / 2),
    magnitude: null, depth: null, displacement_cm: null, source: 'NISAR', source_url: '', sources: ['NISAR'],
  };
}

/**
 * The events that have measured NISAR ground motion: every directory event (storms excluded, they have no ground motion)
 * that a processed grid contains and whose date falls between the grid's two acquisitions. Grids that explain no event
 * still get a row of their own. Newest event first.
 */
export function buildTopoEntries(events: readonly GlobalEvent[], metas: readonly FieldMeta[]): TopoEntry[] {
  const used = new Set<string>();
  const entries: TopoEntry[] = [];
  for (const e of events) {
    if (e.type === 'storm' || !Number.isFinite(e.time)) continue;
    const grids = matchFields(metas, e);
    if (grids.length === 0) continue;
    grids.forEach(g => used.add(g.id));
    entries.push({ key: e.id, event: e, grids, orphan: false });
  }
  for (const m of metas) {
    if (used.has(m.id)) continue;
    entries.push({ key: `grid:${m.id}`, event: gridEvent(m), grids: [m], orphan: true });
  }
  return entries.sort((a, b) => b.event.time - a.event.time);
}
