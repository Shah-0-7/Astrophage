'use client';

import { useMemo } from 'react';
import { useStore } from './store';
import { PASS_EPOCHS } from './mockData';
import { eventsInPeriod, periodOf, radarEvents } from './radarEvents';
import type { GlobalEvent } from './globalEvents';

export interface RadarSelection {
  /** every event the directory holds */
  all: GlobalEvent[];
  /** inside the timeline's period, before the filter */
  inPeriod: GlobalEvent[];
  /** inside the period and passing the filter, newest first: what the map draws and the list shows */
  listed: GlobalEvent[];
  period: { start: number | null; end: number };
}

/** One place that decides which events the radar shows, so the map and both panels always agree. */
export function useRadarEvents(): RadarSelection {
  const all = useStore(s => s.directoryEvents);
  const filter = useStore(s => s.radarFilter);
  const windowId = useStore(s => s.playbackWindow);
  const anchor = useStore(s => s.playbackAnchor);
  const index = useStore(s => s.currentPassIndex);
  return useMemo(() => {
    const pb = { windowId, anchor, progress: index / Math.max(1, PASS_EPOCHS.length - 1) };
    return { all, inPeriod: eventsInPeriod(all, pb), listed: radarEvents(all, filter, pb), period: periodOf(all, pb) };
  }, [all, filter, windowId, anchor, index]);
}
