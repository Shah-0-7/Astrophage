/**
 * Which events the radar shows. The map and both side panels read the same list, so what is drawn is what is listed.
 *
 * The events come from the same directory as the Events page. The timeline picks the period (its replay window and the
 * scrubber position), and a small filter narrows it the way the Events page filter does.
 */

import type { EventType, GlobalEvent } from './globalEvents';
import { cutoffInRange, filterByPlayback, windowRange, type PlaybackWindowId } from './playbackFilter';

export interface RadarFilter {
  /** empty = every type */
  types: EventType[];
  /** hide events below this magnitude; events with no magnitude are hidden once this is above 0 (same rule as the Events page) */
  magMin: number;
  search: string;
}

export const DEFAULT_RADAR_FILTER: RadarFilter = { types: [], magMin: 0, search: '' };

export interface Playback {
  windowId: PlaybackWindowId;
  anchor: number;
  /** 0–1 scrubber position */
  progress: number;
}

/** The period the timeline currently selects: from `start` (null = the oldest event) up to `end`, the scrubber's time. */
export function periodOf(events: readonly GlobalEvent[], pb: Playback): { start: number | null; end: number } {
  const range = windowRange(pb.windowId, pb.anchor);
  if (range) return { start: range.start, end: cutoffInRange(range, pb.progress) };
  let min = Infinity, max = -Infinity;
  for (const e of events) { if (!Number.isFinite(e.time)) continue; if (e.time < min) min = e.time; if (e.time > max) max = e.time; }
  if (!Number.isFinite(min)) return { start: null, end: 0 };
  return { start: min, end: min + (max - min) * Math.max(0, Math.min(1, pb.progress)) };
}

/** Events inside the timeline's period. Same rule the replay uses everywhere else. */
export function eventsInPeriod(events: GlobalEvent[], pb: Playback): GlobalEvent[] {
  return filterByPlayback(events, e => e.time, pb.progress, windowRange(pb.windowId, pb.anchor));
}

export function applyRadarFilter(events: GlobalEvent[], f: RadarFilter): GlobalEvent[] {
  const q = f.search.trim().toLowerCase();
  return events.filter(e => {
    if (f.types.length > 0 && !f.types.includes(e.type)) return false;
    if (f.magMin > 0 && (e.magnitude === null || e.magnitude < f.magMin)) return false;
    if (q && !(e.title.toLowerCase().includes(q) || e.type.includes(q) || e.source.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** What the map draws and the right panel lists, newest first. */
export function radarEvents(events: GlobalEvent[], f: RadarFilter, pb: Playback): GlobalEvent[] {
  return applyRadarFilter(eventsInPeriod(events, pb), f).sort((a, b) => b.time - a.time);
}

/** True when the event would be drawn if nothing but the period were applied. */
export function inPeriod(e: GlobalEvent, events: GlobalEvent[], pb: Playback): boolean {
  return eventsInPeriod(events, pb).some(x => x.id === e.id);
}
