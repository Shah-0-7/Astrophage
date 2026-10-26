'use client';

import dynamic from 'next/dynamic';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/ThemeProvider';
import { useGlobalEvents } from '@/lib/useGlobalEvents';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import type { ViewMode } from '@/lib/types';
import type { GlobalEvent } from '@/lib/globalEvents';
import { Iris, type IrisHandle } from './iris';
import { Loader } from './loader';
import { Ledger } from './ledger';
import { TopBar, Timeline, type ObView } from './chrome';
import './observatory.css';

const GlobalSchematicGlobe = dynamic(() => import('@/components/GlobalSchematicGlobe'), { ssr: false });
const EventRadar2D = dynamic(() => import('@/components/EventRadar2D'), { ssr: false });
const TopoCore3D = dynamic(() => import('@/components/TopoCore3D'), { ssr: false });

const TO_STORE: Record<Exclude<ObView, 'events'>, ViewMode> = {
  globe: 'GLOBAL_SCHEMATIC', radar: 'EVENT_RADAR_2D', topo: 'TOPO_CORE_3D',
};
const FROM_STORE: Record<ViewMode, Exclude<ObView, 'events'>> = {
  GLOBAL_SCHEMATIC: 'globe', EVENT_RADAR_2D: 'radar', TOPO_CORE_3D: 'topo',
};

const noop = () => { /* the app is already mounted underneath; the reveal just opens the veil */ };

function Inner({ initialView }: { initialView: ObView }) {
  const iris = useRef<IrisHandle>(null);
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const setFlyToCoords = useStore(s => s.setFlyToCoords);
  const [eventsOpen, setEventsOpen] = useState(initialView === 'events');
  const [globeFocus, setGlobeFocus] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();
  const { events, sourceHealth } = useGlobalEvents();

  // Honour the deep-linked view on first mount.
  useEffect(() => {
    if (initialView !== 'events') setViewMode(TO_STORE[initialView]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The observatory look is dark-only.
  useEffect(() => { if (theme === 'light') setTheme('dark'); }, [theme, setTheme]);

  const view: ObView = eventsOpen ? 'events' : FROM_STORE[viewMode];

  const goTo = useCallback((next: ObView, x: number, y: number, after?: () => void) => {
    const swap = () => {
      if (next === 'events') setEventsOpen(true);
      else { setEventsOpen(false); setViewMode(TO_STORE[next]); }
      after?.();
    };
    if (next === view && !after) return;
    if (iris.current) void iris.current.transition(x, y, swap); else swap();
  }, [view, setViewMode]);

  const openFromLedger = useCallback((target: 'radar' | 'globe', e: GlobalEvent, x: number, y: number) => {
    goTo(target, x, y, () => {
      if (target === 'radar') setFlyToCoords([e.lon, e.lat]);
      else setGlobeFocus(e.id);
    });
  }, [goTo, setFlyToCoords]);

  // Density ticks on the timeline: where events fall inside the feed's time span.
  const ticks = useMemo(() => {
    if (events.length < 2) return [];
    let min = Infinity, max = -Infinity;
    for (const e of events) { if (e.time < min) min = e.time; if (e.time > max) max = e.time; }
    const span = max - min;
    if (span <= 0) return [];
    const stride = Math.max(1, Math.ceil(events.length / 90));
    return events.filter((_, i) => i % stride === 0).map(e => ({
      at: (e.time - min) / span,
      color: EVENT_TYPE_CONFIG[e.type]?.color ?? '#fff',
    }));
  }, [events]);

  return (
    <main className="ob-root" data-view={view}>
      {view === 'events' ? (
        <div className="ob-view-full" key="events">
          <Suspense fallback={null}><Ledger onOpen={openFromLedger} /></Suspense>
        </div>
      ) : (
        <div className="ob-view" key={view}>
          {view === 'globe' && <GlobalSchematicGlobe focusId={globeFocus} />}
          {view === 'radar' && <EventRadar2D />}
          {view === 'topo' && <TopoCore3D />}
        </div>
      )}

      <TopBar view={view} onView={(v, x, y) => goTo(v, x, y)} health={sourceHealth} />
      {view !== 'events' && <Timeline ticks={ticks} />}

      <Iris ref={iris} />
      <Loader onDone={noop} />
    </main>
  );
}

export function Observatory({ initialView = 'globe' }: { initialView?: ObView }) {
  return (
    <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#000' }} />}>
      <Inner initialView={initialView} />
    </Suspense>
  );
}
