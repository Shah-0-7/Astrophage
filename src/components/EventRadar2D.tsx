/**
 * ============================================================
 * EventRadar2D – View Mode: EVENT_RADAR_2D
 * ============================================================
 * Interactive 2D map. The map and the right-hand list show the same events: the Events directory, narrowed to the period
 * the timeline selects and to the list's filters. The left panel holds the details of the selected event (or, with nothing
 * selected, what is in view and the simulated fringe layer's controls).
 * ============================================================
 */

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { PASS_EPOCHS } from '@/lib/mockData';
import type { PhaseFilterMode } from '@/lib/types';
import { DemoBadge } from '@/components/ui/demo-badge';
import { EventDetails, EventList, InView } from '@/components/observatory/radar-panel';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import { globalEventToFeature } from '@/lib/eventFeature';
import { useRadarEvents } from '@/lib/useRadarEvents';
import type { GlobalEvent } from '@/lib/globalEvents';

// Dynamically import the Deck.gl map to avoid SSR issues
const MapComponent = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full spin" />
        <p className="font-mono text-[10px] tracking-widest text-white/40">CALIBRATING RADAR ARRAY...</p>
      </div>
    </div>
  ),
});

// The first time the radar opens, put the scrubber at the end so the whole period is showing, not just its first moment.
let seeded = false;

export default function EventRadar2D({ onOpen3D }: { onOpen3D?: (e: GlobalEvent) => void } = {}) {
  const phaseFilterMode = useStore(s => s.phaseFilterMode);
  const setPhaseFilterMode = useStore(s => s.setPhaseFilterMode);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);
  const setCoherenceThreshold = useStore(s => s.setCoherenceThreshold);
  const setFlyToCoords = useStore(s => s.setFlyToCoords);
  const mapViewBox = useStore(s => s.mapViewBox);
  const selectedGlobalEvent = useStore(s => s.selectedGlobalEvent);
  const setSelectedGlobalEvent = useStore(s => s.setSelectedGlobalEvent);
  const radarFilter = useStore(s => s.radarFilter);
  const setRadarFilter = useStore(s => s.setRadarFilter);

  const { all, inPeriod, listed, period } = useRadarEvents();

  useEffect(() => {
    if (seeded) return;
    seeded = true;
    const st = useStore.getState();
    if (st.currentPassIndex === 0 && !st.isPlaying) st.setCurrentPassIndex(PASS_EPOCHS.length - 1);
  }, []);

  const selectedId = selectedGlobalEvent ? ((selectedGlobalEvent.properties as { global_id?: string }).global_id ?? selectedGlobalEvent.id) : null;
  const full = useMemo(() => (selectedId ? all.find(e => e.id === selectedId) ?? null : null), [all, selectedId]);

  // Picking an event shows it and centres the map on it; the timeline stays where the person put it.
  function select(e: GlobalEvent) {
    setSelectedGlobalEvent(globalEventToFeature(e));
    setFlyToCoords([e.lon, e.lat]);
  }

  const details = selectedGlobalEvent && (
    <EventDetails feature={selectedGlobalEvent} full={full} onOpen3D={onOpen3D} onClose={() => setSelectedGlobalEvent(null)} />
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {/* ── Left: the selected event, or what is in view ───────────────────── */}
      <aside className="hidden lg:flex w-[280px] flex-shrink-0 border-r border-white/10 glass-sidebar flex-col overflow-y-auto pb-32" aria-label="Selected event">
        {details ?? (
          <>
            <InView events={listed} box={mapViewBox} />
            <p className="px-3 pt-3 font-mono text-[9px] leading-snug text-white/45">
              Pick an event on the map or in the list to see its details here. Real NISAR footprints are under LAYERS.
            </p>
            <div className="p-3 mt-2 border-t border-white/10 flex items-center justify-between">
              <span className="panel-label text-white">FRINGE LAYER</span>
              <DemoBadge />
            </div>
            <p className="px-3 font-mono text-[9px] leading-snug text-white/45">Controls for the simulated interferogram layer.</p>
            <div className="px-3 py-2.5 flex justify-between items-center">
              <span className="panel-label">PHASE FILTER:</span>
              <div className="flex gap-1">
                {(['RAW', 'FILTERED'] as PhaseFilterMode[]).map(mode => (
                  <button key={mode} onClick={() => setPhaseFilterMode(mode)} className={`tac-btn text-[9px] h-6 px-2 ${phaseFilterMode === mode ? 'active' : ''}`}>
                    {mode === 'RAW' ? 'Raw' : 'Filtered'}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 border-t border-white/10">
              <div className="flex justify-between items-center mb-2">
                <span className="panel-label">COHERENCE MASK (γ ≥ {coherenceThreshold.toFixed(2)})</span>
              </div>
              <input
                type="range" min={0} max={100} value={Math.round(coherenceThreshold * 100)}
                onChange={e => setCoherenceThreshold(parseInt(e.target.value) / 100)}
                className="tac-slider-crimson w-full"
                style={{ '--progress': `${coherenceThreshold * 100}%` } as React.CSSProperties}
              />
              <div className="flex justify-between mt-1"><span className="panel-label">0.0</span><span className="panel-label">1.0</span></div>
            </div>
          </>
        )}
      </aside>

      {/* ── Centre: the map ────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0" style={{ minHeight: 0 }}>
        <div className="relative flex-1">
          {selectedGlobalEvent && (
            <div
              className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-3"
              style={{ height: 36, background: 'var(--bg-header)', borderBottom: '1px solid var(--border-zinc)', backdropFilter: 'blur(16px)' }}
            >
              <span className="font-mono text-[9px] text-white/40 tracking-wider">⊕ LOCATION</span>
              <span className="font-mono text-[11px] text-white/80 truncate">
                {(selectedGlobalEvent.properties as any).place || (selectedGlobalEvent.properties as any).name || (selectedGlobalEvent.properties as any).title || 'Global Event'}
              </span>
              {selectedGlobalEvent.geometry.type === 'Point' && (
                <span className="font-mono text-[9px] text-white/35 ml-auto shrink-0">
                  {((selectedGlobalEvent.geometry as any).coordinates[1] as number).toFixed(3)}°&nbsp;
                  {((selectedGlobalEvent.geometry as any).coordinates[0] as number).toFixed(3)}°
                </span>
              )}
            </div>
          )}
          <div className="absolute inset-0"><MapComponent /></div>
        </div>

        {/* Phones: the list moves to a strip of chips under the map */}
        {listed.length > 0 && (
          <div className="md:hidden flex-shrink-0 overflow-x-auto" style={{ background: 'var(--bg-header)', borderTop: '1px solid var(--border-zinc)', padding: '6px 10px' }}>
            <div className="flex gap-2" style={{ width: 'max-content' }}>
              {listed.slice(0, 12).map(e => {
                const color = EVENT_TYPE_CONFIG[e.type]?.color ?? '#fff';
                return (
                  <button key={e.id} onClick={() => select(e)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: `${color}18`, border: `1px solid ${color}55`, borderRadius: 2, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                    <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.magnitude != null && e.type === 'tectonic' ? `M${e.magnitude.toFixed(1)} ` : ''}{e.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: the events in the timeline's period ─────────────────────── */}
      <aside className="hidden md:flex w-[300px] flex-shrink-0 border-l border-white/10 glass-sidebar flex-col overflow-hidden" aria-label="Events in the selected period">
        {/* Narrow screens have no left panel, so the selected event's details sit on top of the list */}
        {details && <div className="lg:hidden shrink-0 overflow-y-auto border-b border-white/10" style={{ maxHeight: '46%' }}>{details}</div>}
        <EventList
          listed={listed} inPeriod={inPeriod} total={all.length} period={period} loading={all.length === 0}
          selectedId={selectedId} filter={radarFilter} setFilter={setRadarFilter} onSelect={select}
        />
      </aside>
    </div>
  );
}
