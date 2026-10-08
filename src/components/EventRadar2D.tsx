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
import { TARGET_NODES, PASS_EPOCHS, BACKSCATTER_VALUES } from '@/lib/mockData';
import type { PhaseFilterMode, PolVar, UnifiedFeature } from '@/lib/types';
import { useSSEStream } from '@/lib/useSSEStream';

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

const POL_OPTIONS: PolVar[] = ['HH', 'HV', 'VH', 'VV'];

export default function EventRadar2D() {
  const activeNodeId = useStore(s => s.activeNodeId);
  const spatialContext = useStore(s => s.spatialContext);
  const phaseFilterMode = useStore(s => s.phaseFilterMode);
  const setPhaseFilterMode = useStore(s => s.setPhaseFilterMode);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);
  const setCoherenceThreshold = useStore(s => s.setCoherenceThreshold);
  const activePolarisation = useStore(s => s.activePolarisation);
  const setActivePolarisation = useStore(s => s.setActivePolarisation);
  const currentPassIndex = useStore(s => s.currentPassIndex);
  const lBandStatus = useStore(s => s.lBandStatus);
  const sBandStatus = useStore(s => s.sBandStatus);
  const setFlyToCoords = useStore(s => s.setFlyToCoords);

  const activeNode = TARGET_NODES.find(n => n.id === activeNodeId) ?? TARGET_NODES[0];
  const currentPass = PASS_EPOCHS[currentPassIndex];
  
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
    all.sort((a, b) => {
      const getTs = (f: UnifiedFeature) => {
        if (f.source === 'seismic') return new Date((f.properties as any).event_time).getTime();
        if (f.source === 'volcanism') return new Date((f.properties as any).last_eruption).getTime();
        if (f.source === 'tsunami') return new Date((f.properties as any).issued_at).getTime();
        if (f.source === 'cryosphere') return new Date((f.properties as any).date).getTime();
        return 0;
      };
      return getTs(b) - getTs(a);
    });
    return all.slice(0, 10);
  }, [stream]);

  /** calculateBackscatterRatio: return dB value for active polarisation */
  const backscatterDb = BACKSCATTER_VALUES[activePolarisation];

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
      (evt.properties as any).date || Date.now()
    ).getTime();
    let closestIdx = 0; let minDiff = Infinity;
    PASS_EPOCHS.forEach((pass, idx) => {
      const diff = Math.abs(new Date(pass.date).getTime() - evtTime);
      if (diff < minDiff) { minDiff = diff; closestIdx = idx; }
    });
    setCurrentPassIndex(closestIdx);
  }
  const [searchValue, setSearchValue] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const STATUS_LABEL: Record<string, string> = {
    NOMINAL: 'NOMINAL', ACQUIRING: 'ACQUIRING', STANDBY: 'STANDBY',
  };
  const STATUS_COLOR: Record<string, string> = {
    NOMINAL: 'var(--nominal)', ACQUIRING: 'var(--acquiring)', STANDBY: 'var(--text-muted)',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {/* ── Left: contextual sidebar ──────────────────────── */}
      <div className="hidden md:flex w-[188px] flex-shrink-0 glass-sidebar flex-col border-r border-white/10">
        {/* Mode indicator */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label">SUBSYSTEM</p>
          <p className="font-mono text-[11px] font-600 text-white tracking-wider mt-0.5">
            L-BAND READY
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="panel-label">CARRIER</span>
            <span className="font-mono text-[10px] text-white/60">1.25 GHz</span>
          </div>
        </div>

        {/* Nav modes */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">MODES</p>
          {[
            { id: 'EVENT_RADAR_2D' as const,   icon: '⊕', label: '2D EVENT RADAR' },
            { id: 'TOPO_CORE_3D' as const,     icon: '△', label: '3D TOPO CORE' },
          ].map(m => {
            const isActive = m.id === 'EVENT_RADAR_2D';
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 py-1.5 px-2 rounded-[2px] mb-0.5"
                style={{
                  background: isActive ? 'rgba(239,68,68,0.08)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--crimson)' : '2px solid transparent',
                }}
              >
                <span className="font-mono text-[10px]" style={{ color: isActive ? 'var(--crimson)' : 'var(--text-muted)' }}>
                  {m.icon}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: isActive ? 'var(--white)' : 'var(--text-muted)' }}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Signal profile */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">SIGNAL PROFILE</p>
          {[
            { label: 'COHERENCE', value: activeNode.coherence.toFixed(2) + ' γ' },
            { label: 'SWATH RES', value: '240 KM' },
            { label: 'INCIDENCE', value: '98.4°' },
          ].map(item => (
            <div key={item.label} className="flex justify-between items-center py-1">
              <span className="panel-label">{item.label}</span>
              <span className="font-mono text-[11px] text-white font-600">{item.value}</span>
            </div>
          ))}
        </div>

        {/* Polarisation / backscatter */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">BACKSCATTER</p>
          <div className="grid grid-cols-2 gap-1 mb-2">
            {POL_OPTIONS.map(pol => (
              <button
                key={pol}
                onClick={() => setActivePolarisation(pol)}
                className={`tac-btn text-[9px] py-1 h-auto ${activePolarisation === pol ? 'active' : ''}`}
              >
                {pol}
              </button>
            ))}
          </div>
          <div className="flex justify-between items-center">
            <span className="panel-label">RETURN</span>
            <span className="font-mono text-[12px] text-white font-700">{backscatterDb.toFixed(1)} dB</span>
          </div>
        </div>

        {/* Download link */}
        <div className="mt-auto p-3 border-t border-white/10">
          <p className="panel-label">DOWNLNK // LNK</p>
          <p className="font-mono text-[11px] text-white mt-0.5">4.0 GBPS</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className="status-dot nominal" />
            <span className="panel-label text-white/40">ISRO SHAR GROUND STN</span>
          </div>
        </div>
      </div>

      {/* -- Main content column (map + mobile pills) -- */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
        {/* Map canvas -- fill available space */}
        <div className="relative flex-1">
          {/* Location strip – only shown when a global event is selected */}
          {selectedGlobalEvent && (
            <div
              className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-3"
              style={{ height: 36, background: 'rgba(9,9,11,0.90)', borderBottom: '1px solid var(--border-zinc)', backdropFilter: 'blur(16px)' }}
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
          <div className="md:hidden flex-shrink-0 overflow-x-auto" style={{ background: "rgba(9,9,11,0.95)", borderTop: "1px solid rgba(255,255,255,0.07)", padding: "6px 10px" }}>
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
                  {selectedGlobalEvent.source} - {
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
                {selectedGlobalEvent.source === 'seismic' && (selectedGlobalEvent.properties as any).place}
                {selectedGlobalEvent.source === 'volcanism' && (selectedGlobalEvent.properties as any).name}
                {selectedGlobalEvent.source === 'tsunami' && (selectedGlobalEvent.properties as any).title}
                {selectedGlobalEvent.source === 'cryosphere' && 'Ice Extent Update'}
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="panel-label">MAGNITUDE/SEVERITY</span>
                  <span className="font-mono text-[10px] font-bold text-white">
                    {selectedGlobalEvent.source === 'seismic' && `M${(selectedGlobalEvent.properties as any).magnitude.toFixed(1)}`}
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
                {selectedGlobalEvent.source === 'cryosphere' && (
                  <div className="flex justify-between items-center">
                    <span className="panel-label">AREA COVERED</span>
                    <span className="font-mono text-[10px] text-white">{(selectedGlobalEvent.properties as any).extent_sq_km.toLocaleString()} km²</span>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="status-dot nominal" />
                <span className="panel-label text-white">SAR TELEMETRY</span>
              </div>
              <span className="panel-label">NISAR L-BAND</span>
            </div>

        {/* Displacement + Coherence */}
        <div className="p-3 grid grid-cols-2 gap-2 border-b border-white/10">
          <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
            <p className="panel-label mb-1">DISPLACEMENT</p>
            <p className="font-mono text-[22px] font-700 text-white leading-none">-12.4</p>
            <p className="font-mono text-[9px] text-white/40">CM</p>
          </div>
          <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
            <p className="panel-label mb-1">COHERENCE (γ)</p>
            <p className="font-mono text-[22px] font-700 text-white leading-none">
              {activeNode.coherence.toFixed(2)}
            </p>
            <p className="font-mono text-[9px] text-white/40">PULSAR</p>
          </div>
        </div>

        {/* Repeat orbit */}
        <div className="px-3 py-2.5 border-b border-white/10 flex justify-between items-center">
          <span className="panel-label">REPEAT ORBIT</span>
          <span className="font-mono text-[12px] font-600 text-white">12.0 DAYS</span>
        </div>

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

        {/* Dual-band status */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">DUAL-BAND STATUS</p>
          {[
            { band: 'L-BAND 1.25 GHz', status: lBandStatus },
            { band: 'S-BAND 3.20 GHz', status: sBandStatus },
          ].map(({ band, status }) => (
            <div key={band} className="flex items-center justify-between py-1.5 px-2 mb-1"
                 style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
              <span className="font-mono text-[10px] text-white/70">{band}</span>
              <div className="flex items-center gap-1.5">
                <div
                  className="status-dot"
                  style={{ background: STATUS_COLOR[status], boxShadow: `0 0 4px ${STATUS_COLOR[status]}` }}
                />
                <span className="font-mono text-[9px] font-600" style={{ color: STATUS_COLOR[status] }}>
                  {status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Pass info */}
        <div className="p-3 border-b border-white/10">
          <div className="flex justify-between items-center">
            <span className="panel-label">CURRENT PASS</span>
            <span className="font-mono text-[10px] font-600 text-white">{currentPass?.label}</span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="panel-label">EPOCH</span>
            <span className="font-mono text-[10px] text-white/60">
              {currentPass ? new Date(currentPass.date).toISOString().slice(0, 10) : '--'}
            </span>
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

const STATUS_COLOR: Record<string, string> = {
  NOMINAL: 'var(--nominal)', ACQUIRING: 'var(--acquiring)', STANDBY: 'var(--text-muted)',
};
