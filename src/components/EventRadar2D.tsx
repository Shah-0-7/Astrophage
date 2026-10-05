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
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { TARGET_NODES, PASS_EPOCHS, BACKSCATTER_VALUES } from '@/lib/mockData';
import type { PhaseFilterMode, PolVar } from '@/lib/types';
import { useEarthquakeData } from '@/lib/useEarthquakeData';

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
  
  const { earthquakes } = useEarthquakeData(4.5, 300);

  /** calculateBackscatterRatio: return dB value for active polarisation */
  const backscatterDb = BACKSCATTER_VALUES[activePolarisation];

  const [searchActive, setSearchActive] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const STATUS_LABEL: Record<string, string> = {
    NOMINAL: 'NOMINAL', ACQUIRING: 'ACQUIRING', STANDBY: 'STANDBY',
  };
  const STATUS_COLOR: Record<string, string> = {
    NOMINAL: 'var(--nominal)', ACQUIRING: 'var(--acquiring)', STANDBY: 'var(--text-muted)',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
      {/* ── Left: contextual sidebar ──────────────────────── */}
      <div className="w-[188px] flex-shrink-0 glass-sidebar flex flex-col border-r border-white/10">
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
            { id: 'GLOBAL_SCHEMATIC' as const, icon: '◎', label: 'GLOBAL SCHEMATIC' },
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

      {/* ── Center: Map + search + radar overlay ──────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Breadcrumb / search bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-0"
             style={{ height: 44, background: 'rgba(9,9,11,0.85)', borderBottom: '1px solid var(--border-zinc)', backdropFilter: 'blur(16px)' }}>
          {/* Reticle */}
          <div className="px-3 border-r border-white/10">
            <div className="w-4 h-4 relative flex-shrink-0">
              <div className="absolute inset-0 rounded-full border border-white/30" />
              <div className="absolute inset-[4px] rounded-full bg-white/60" />
            </div>
          </div>
          {/* Breadcrumb */}
          <div className="px-3 flex items-center gap-2 flex-1 border-r border-white/10">
            <input
              type="text"
              placeholder="Location"
              value={searchValue || 'San Francisco, California, USA...'}
              onChange={e => setSearchValue(e.target.value)}
              onFocus={() => setSearchActive(true)}
              onBlur={() => setSearchActive(false)}
              className="bg-transparent outline-none font-mono text-[11px] text-white/80 flex-1"
            />
          </div>
          {/* Coords display */}
          <div className="px-4 border-r border-white/10">
            <p className="font-mono text-[10px] text-white/40 tracking-wider">
              ⊕ Location  {activeNode.locationDetail.split('//')[0].trim()}
            </p>
          </div>
          {/* Active search toggle */}
          <div className="px-3 flex items-center gap-2">
            <span className="panel-label">ACTIVE SEARCH</span>
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-glow"
              style={{ background: searchActive ? 'var(--crimson)' : 'var(--text-muted)' }}
            />
          </div>
        </div>

        {/* Map canvas */}
        <div className="absolute inset-0 top-[44px]">
          <MapComponent />
        </div>

        {/* Warning callout overlay */}
        <div
          className="absolute bottom-4 left-4 z-20 p-4"
          style={{
            width: 240,
            background: 'rgba(9,9,11,0.88)',
            border: '1px solid var(--border-zinc)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[var(--acquiring)] text-xs">⚠</span>
            <span className="font-mono text-[9px] font-700 text-white/60 tracking-widest uppercase">WARNING</span>
            <span className="font-mono text-[9px] text-white/40">Surface Subsidence / Rupture</span>
            <div className="status-dot ml-auto" style={{ background: 'var(--crimson)', boxShadow: '0 0 6px var(--crimson)' }} />
          </div>
          <h4 className="font-mono text-[18px] font-700 text-white leading-tight">
            {activeNode.label === 'SAN ANDREAS' ? 'Ocean Beach' : activeNode.label}
          </h4>
          <p className="font-mono text-[9px] text-white/40 mt-1 tracking-wider">
            37.7576793° N // -122.5076391° W
          </p>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
            <span className="panel-label">ACTIVE SEARCH</span>
            <div className="flex items-center gap-1">
              <button className="tac-btn active text-[9px] h-6 px-2">on</button>
              <button className="tac-btn text-[9px] h-6 px-2">off</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: SAR Telemetry panel ─────────────────────── */}
      <div className="w-[240px] flex-shrink-0 border-l border-white/10 glass-sidebar flex flex-col">
        {/* Panel header */}
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

        {/* USGS Events */}
        <div className="flex-1 overflow-y-auto p-3 mt-auto min-h-0">
          <p className="panel-label mb-2">USGS EVENTS</p>
          <div className="space-y-1.5">
            {earthquakes.slice(0, 4).map(eq => (
              <div 
                key={eq.id}
                onClick={() => setFlyToCoords([eq.coords[0], eq.coords[1]])}
                className="cursor-pointer hover:bg-white/10 p-2 rounded transition-colors border border-white/5 bg-black/20"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--crimson)' }}>
                    M{eq.magnitude.toFixed(1)}
                  </span>
                  <span className="font-mono text-[9px] text-white/50">
                    {new Date(eq.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
                <p className="font-mono text-[9px] text-white/70 truncate" title={eq.place}>{eq.place}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  NOMINAL: 'var(--nominal)', ACQUIRING: 'var(--acquiring)', STANDBY: 'var(--text-muted)',
};
