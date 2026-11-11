/**
 * ============================================================
 * EventRadar2D – View Mode: EVENT_RADAR_2D
 * ============================================================
 * Interactive 2D radar map with InSAR phase fringes,
 * spatial breadcrumb track, search input, and contextual
 * telemetry sidebar.
 *
 * API surface: setPhaseFilterMode, coherenceThreshold mask,
 * calculateBackscatterRatio
 * ============================================================
 */

'use client';

import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { PASS_EPOCHS } from '@/lib/mockData';
import type { PhaseFilterMode, UnifiedFeature } from '@/lib/types';
import { useSSEStream } from '@/lib/useSSEStream';
import { filterByPlayback, windowRange } from '@/lib/playbackFilter';
import { estimateDisplacement } from '@/lib/eventPhysics';
import Link from 'next/link';
import { DemoBadge } from '@/components/ui/demo-badge';

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

export default function EventRadar2D() {
  const phaseFilterMode = useStore(s => s.phaseFilterMode);
  const setPhaseFilterMode = useStore(s => s.setPhaseFilterMode);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);
  const setCoherenceThreshold = useStore(s => s.setCoherenceThreshold);
  const currentPassIndex = useStore(s => s.currentPassIndex);
  const playbackWindow = useStore(s => s.playbackWindow);
  const playbackAnchor = useStore(s => s.playbackAnchor);
  const setFlyToCoords = useStore(s => s.setFlyToCoords);

  
  const stream = useSSEStream();
  const selectedGlobalEvent = useStore(s => s.selectedGlobalEvent);
  const setSelectedGlobalEvent = useStore(s => s.setSelectedGlobalEvent);
  const setCurrentPassIndex = useStore(s => s.setCurrentPassIndex);

  const EVENT_SYMBOLS: Record<string, string> = {
    seismic: '▲', cryosphere: '◆', volcanism: '⬡', tsunami: '🌊',
  };

  const globalEvents = useMemo(() => {
    const all = [
      ...stream.seismic,
      ...stream.volcanism,
      ...stream.tsunami,
      ...stream.cryosphere,
    ];
    const getTs = (f: UnifiedFeature) => {
      if (f.source === 'seismic') return new Date((f.properties as any).event_time).getTime();
      if (f.source === 'volcanism') return new Date((f.properties as any).last_eruption).getTime();
      if (f.source === 'tsunami') return new Date((f.properties as any).issued_at).getTime();
      if (f.source === 'cryosphere') return new Date((f.properties as any).date).getTime();
      return 0;
    };
    all.sort((a, b) => getTs(b) - getTs(a));
    const progress = currentPassIndex / Math.max(1, PASS_EPOCHS.length - 1);
    const visible = filterByPlayback(all, getTs, progress, windowRange(playbackWindow, playbackAnchor));
    return visible.slice(0, 10);
  }, [stream, currentPassIndex, playbackWindow, playbackAnchor]);

  const [eventsExpanded, setEventsExpanded] = useState(true);


  const EVT_COLOR: Record<string, string> = {
    seismic: '#ef4444', volcanism: '#f97316', tsunami: '#60a5fa', cryosphere: '#7dd3fc',
  };
  const EVT_ICON: Record<string, string> = {
    seismic: '\u25b2', volcanism: '\u2b21', tsunami: '\u2248', cryosphere: '\u25c6',
  };

  function handleEventClick(evt: UnifiedFeature) {
    setSelectedGlobalEvent(evt);
    const coords = evt.geometry.type === 'Point' ? (evt.geometry as any).coordinates : null;
    if (coords) setFlyToCoords([coords[0], coords[1]]);
    const evtTime = new Date(
      evt.source === 'seismic' ? (evt.properties as any).event_time :
      evt.source === 'volcanism' ? (evt.properties as any).last_eruption :
      evt.source === 'tsunami' ? (evt.properties as any).issued_at :
      (evt.properties as any).date
    ).getTime();
    if (!isFinite(evtTime)) return; // no usable timestamp: leave the scrubber where it is
    let closestIdx = 0; let minDiff = Infinity;
    PASS_EPOCHS.forEach((pass, idx) => {
      const diff = Math.abs(new Date(pass.date).getTime() - evtTime);
      if (diff < minDiff) { minDiff = diff; closestIdx = idx; }
    });
    setCurrentPassIndex(closestIdx);
  }
  const [searchValue, setSearchValue] = useState('');
  const [searchActive, setSearchActive] = useState(false);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {/* -- Main content column (map + mobile pills) -- */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
        {/* Map canvas -- fill available space */}
        <div className="relative flex-1">
          {/* Location strip – only shown when a global event is selected */}
          {selectedGlobalEvent && (
            <div
              className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-3"
              style={{ height: 36, background: 'var(--bg-header)', borderBottom: '1px solid var(--border-zinc)', backdropFilter: 'blur(16px)' }}
            >
              <span className="font-mono text-[9px] text-white/40 tracking-wider">⊕ LOCATION</span>
              <span className="font-mono text-[11px] text-white/80">
                {(selectedGlobalEvent.properties as any).place ||
                 (selectedGlobalEvent.properties as any).name ||
                 (selectedGlobalEvent.properties as any).title ||
                 'Global Event'}
              </span>
              {selectedGlobalEvent.geometry.type === 'Point' && (
                <span className="font-mono text-[9px] text-white/35 ml-auto">
                  {((selectedGlobalEvent.geometry as any).coordinates[1] as number).toFixed(3)}°&nbsp;
                  {((selectedGlobalEvent.geometry as any).coordinates[0] as number).toFixed(3)}°
                </span>
              )}
            </div>
          )}
          <div className="absolute inset-0"><MapComponent /></div>
        </div>

        {/* Mobile-only: event pills */}
        {globalEvents.length > 0 && (
          <div className="md:hidden flex-shrink-0 overflow-x-auto" style={{ background: "var(--bg-header)", borderTop: "1px solid var(--border-zinc)", padding: "6px 10px" }}>
            <div className="flex gap-2" style={{ width: "max-content" }}>
              {globalEvents.slice(0, 8).map(evt => {
                const color = EVT_COLOR[evt.source] ?? "#fff";
                const icon  = EVT_ICON[evt.source]  ?? "?";
                const label = (evt.properties as any).place || (evt.properties as any).name || (evt.properties as any).title || evt.source.toUpperCase();
                return (
                  <button key={evt.id} onClick={() => handleEventClick(evt)}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: `${color}18`, border: `1px solid ${color}55`, borderRadius: 2, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}
                  >
                    <span style={{ fontSize: 9, color }}>{icon}</span>
                    <span className="font-mono" style={{ fontSize: 9, color: "rgba(255,255,255,0.75)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: SAR Telemetry panel / Event Details ─────────────────────── */}
      <div className="hidden md:flex w-[240px] flex-shrink-0 border-l border-white/10 glass-sidebar flex-col">
        {selectedGlobalEvent ? (
          <>
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--crimson)', fontSize: '14px' }}>{EVENT_SYMBOLS[selectedGlobalEvent.source] || '●'}</span>
                <span className="panel-label text-white uppercase">
                  {(selectedGlobalEvent.properties as any).kind_label ?? selectedGlobalEvent.source} - {
                    selectedGlobalEvent.source === 'seismic' ? 'Earthquake' :
                    selectedGlobalEvent.source === 'volcanism' ? 'Volcano' :
                    selectedGlobalEvent.source === 'tsunami' ? 'Tsunami' : 'Alert'
                  }
                </span>
              </div>
              <button onClick={() => setSelectedGlobalEvent(null)} className="text-white/50 hover:text-white">✕</button>
            </div>
            
            <div className="p-3 border-b border-white/10">
              <h4 className="font-mono text-sm font-bold text-white mb-2 break-words">
                {(() => {
                  const p = selectedGlobalEvent.properties as any;
                  return p.place ?? p.name ?? p.title ?? (selectedGlobalEvent.source === 'cryosphere' ? 'Ice Extent Update' : 'Event');
                })()}
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="panel-label">MAGNITUDE/SEVERITY</span>
                  <span className="font-mono text-[10px] font-bold text-white">
                    {(selectedGlobalEvent.properties as any).headline ?? (selectedGlobalEvent.source === 'seismic' && `M${(selectedGlobalEvent.properties as any).magnitude.toFixed(1)}`)}
                    {selectedGlobalEvent.source === 'volcanism' && (selectedGlobalEvent.properties as any).alert_level}
                    {selectedGlobalEvent.source === 'tsunami' && (selectedGlobalEvent.properties as any).severity}
                    {selectedGlobalEvent.source === 'cryosphere' && 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="panel-label">TIME</span>
                  <span className="font-mono text-[10px] text-white">
                    {selectedGlobalEvent.source === 'seismic' && new Date((selectedGlobalEvent.properties as any).event_time).toLocaleString()}
                    {selectedGlobalEvent.source === 'volcanism' && new Date((selectedGlobalEvent.properties as any).last_eruption).toLocaleString()}
                    {selectedGlobalEvent.source === 'tsunami' && new Date((selectedGlobalEvent.properties as any).issued_at).toLocaleString()}
                    {selectedGlobalEvent.source === 'cryosphere' && new Date((selectedGlobalEvent.properties as any).date).toLocaleDateString()}
                  </span>
                </div>
                {selectedGlobalEvent.source === 'seismic' && (
                  <div className="flex justify-between items-center">
                    <span className="panel-label">DEPTH</span>
                    <span className="font-mono text-[10px] text-white">{(selectedGlobalEvent.properties as any).depth_km.toFixed(1)} km</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="panel-label">EST. DISPLACEMENT</span>
                  <span className="font-mono text-[10px] font-bold text-white">
                    {(() => {
                      const p = selectedGlobalEvent.properties as any;
                      if (p.displacement_label) return p.displacement_label;
                      if (selectedGlobalEvent.source === 'seismic' && p.magnitude != null)
                        return estimateDisplacement({ type: 'tectonic', magnitude: p.magnitude, depth: p.depth_km ?? null, displacement_cm: null }).label;
                      return 'N/A';
                    })()}
                  </span>
                </div>
                {(selectedGlobalEvent.properties as any).displacement_note && (
                  <p className="font-mono text-[9px] leading-snug text-white/45">{(selectedGlobalEvent.properties as any).displacement_note}</p>
                )}
                {selectedGlobalEvent.source === 'cryosphere' && (
                  <div className="flex justify-between items-center">
                    <span className="panel-label">AREA COVERED</span>
                    <span className="font-mono text-[10px] text-white">{(selectedGlobalEvent.properties as any).extent_sq_km.toLocaleString()} km²</span>
                  </div>
                )}
              </div>
              {(selectedGlobalEvent.properties as any).global_id && (
                <div className="flex gap-2 mt-3">
                  <Link
                    href={`/events/${encodeURIComponent((selectedGlobalEvent.properties as any).global_id)}`}
                    className="tac-btn flex-1 justify-center text-center" style={{ height: 28, fontSize: 9 }}
                  >FULL REPORT →</Link>
                  {(selectedGlobalEvent.properties as any).source_url && (
                    <a href={(selectedGlobalEvent.properties as any).source_url} target="_blank" rel="noreferrer"
                      className="tac-btn justify-center text-center" style={{ height: 28, fontSize: 9, padding: '0 8px' }}>SOURCE ↗</a>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <span className="panel-label text-white">FRINGE LAYER</span>
              <DemoBadge />
            </div>
            <p className="px-3 pt-2.5 font-mono text-[9px] leading-snug text-white/45">
              Controls for the simulated interferogram layer. Pick an event on the map or in the feed below for its details; real NISAR footprints are under LAYERS.
            </p>

        {/* Phase filter */}
        <div className="px-3 py-2.5 border-b border-white/10 flex justify-between items-center">
          <span className="panel-label">PHASE FILTER:</span>
          <div className="flex gap-1">
            {(['RAW', 'FILTERED'] as PhaseFilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setPhaseFilterMode(mode)}
                className={`tac-btn text-[9px] h-6 px-2 ${phaseFilterMode === mode ? 'active' : ''}`}
              >
                {mode === 'RAW' ? 'Raw' : 'Filtered'}
              </button>
            ))}
          </div>
        </div>

        {/* Coherence threshold slider */}
        <div className="p-3 border-b border-white/10">
          <div className="flex justify-between items-center mb-2">
            <span className="panel-label">COHERENCE MASK (γ ≥ {coherenceThreshold.toFixed(2)})</span>
          </div>
          <input
            type="range"
            min={0} max={100}
            value={Math.round(coherenceThreshold * 100)}
            onChange={e => setCoherenceThreshold(parseInt(e.target.value) / 100)}
            className="tac-slider-crimson w-full"
            style={{ '--progress': `${coherenceThreshold * 100}%` } as React.CSSProperties}
          />
          <div className="flex justify-between mt-1">
            <span className="panel-label">0.0</span>
            <span className="panel-label">1.0</span>
          </div>
        </div>

          </>
        )}

        {/* -- Global Events (collapsible) -- */}
        <div className="border-t border-white/10 flex flex-col" style={{ flexShrink: 0 }}>
          <button
            onClick={() => setEventsExpanded(o => !o)}
            className="flex items-center justify-between px-3 py-2 w-full hover:bg-white/5 transition-colors"
            style={{ background: "transparent", border: "none", cursor: "pointer" }}
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 6px #34d399' }} />
              <span className="panel-label text-white">LIVE HAZARD FEED</span>
              {globalEvents.length > 0 && (
                <span className="font-mono text-[8px] px-1.5 py-0.5" style={{ background: "rgba(239,68,68,0.18)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 2 }}>
                  {globalEvents.length} REAL-TIME
                </span>
              )}
            </div>
            <motion.span animate={{ rotate: eventsExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="font-mono text-[10px] text-white/40">
              {eventsExpanded ? "^" : "v"}
            </motion.span>
          </button>
          <AnimatePresence>
            {eventsExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <div className="overflow-y-auto p-3 pt-1 space-y-1.5" style={{ maxHeight: 260 }}>
                  <p className="font-mono text-[8px] text-white/40 pb-1 border-b border-white/5">
                    ● Real-time USGS & Smithsonian feed (past 30 days)
                  </p>
                  {globalEvents.length === 0 ? (
                    <p className="font-mono text-[9px] text-white/30 text-center py-4">NO LIVE EVENTS</p>
                  ) : globalEvents.map(evt => (
                    <div key={evt.id} onClick={() => handleEventClick(evt)}
                      className={`cursor-pointer hover:bg-white/10 p-2 rounded transition-colors border bg-black/20 ${selectedGlobalEvent?.id === evt.id ? 'border-[var(--crimson)]' : 'border-white/5'}`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-mono text-[11px] font-bold" style={{ color: EVT_COLOR[evt.source] ?? "var(--crimson)" }}>
                          {EVT_ICON[evt.source] ?? "?"} {evt.source.toUpperCase()}
                        </span>
                        <span className="font-mono text-[9px] text-white/50">
                          {evt.source === "seismic" && new Date((evt.properties as any).event_time).toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"})}
                          {evt.source === "volcanism" && new Date((evt.properties as any).last_eruption).toLocaleDateString()}
                          {evt.source === "tsunami" && new Date((evt.properties as any).issued_at).toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"})}
                        </span>
                      </div>
                      <p className="font-mono text-[9px] text-white/70 truncate">
                        {(evt.properties as any).place || (evt.properties as any).name || (evt.properties as any).title || "Global Event"}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

