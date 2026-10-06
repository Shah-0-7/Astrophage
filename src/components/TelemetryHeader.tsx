/**
 * ============================================================
 * TelemetryHeader – Persistent Top Status Bar
 * ============================================================
 * Displays real-time satellite parameters, UTC timestamp,
 * and payload health.  Persists across all three view modes.
 * ============================================================
 */

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { SATELLITE_TELEMETRY } from '@/lib/mockData';

function useUTCClock() {
  const [utc, setUTC] = useState('');
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ms  = String(d.getUTCMilliseconds()).padStart(3, '0');
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} // ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${ms}Z`;
    };
    setUTC(fmt());
    const id = setInterval(() => setUTC(fmt()), 100);
    return () => clearInterval(id);
  }, []);
  return utc;
}

const { altitude, inclination, swath, downlink, podStatus } = SATELLITE_TELEMETRY;

export default function TelemetryHeader() {
  const viewMode = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const activeNodeId = useStore(s => s.activeNodeId);
  const lBandStatus = useStore(s => s.lBandStatus);
  const sBandStatus = useStore(s => s.sBandStatus);
  const utc = useUTCClock();

  const statusColor = podStatus === 'NOMINAL' ? 'var(--nominal)'
    : podStatus === 'DEGRADED' ? 'var(--acquiring)' : 'var(--crimson)';

  return (
    <div className="fixed top-0 left-0 right-0 z-50 telem-header" style={{ height: 42 }}>
      <div className="flex items-center h-full px-4 gap-0">
        {/* ── Brand mark ───────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 pr-4 border-r border-white/10" style={{ minWidth: 140 }}>
          <div className="relative w-5 h-5 flex-shrink-0">
            <div className="absolute inset-0 rounded-full border border-white/20" />
            <div
              className="absolute inset-[3px] rounded-full status-dot active lock-ring"
              style={{ background: 'var(--crimson)' }}
            />
          </div>
          <div>
            <p className="font-mono text-[10px] font-700 tracking-[0.18em] text-white leading-none">NASA / ISRO</p>
            <p className="font-mono text-[8px] tracking-[0.14em] text-white/40 leading-none mt-0.5">NISAR</p>
          </div>
        </div>

        {/* ── Tri-mode nav tabs ──────────────────────────────── */}
        <div className="flex items-center h-full ml-2">
          {([
            { id: 'EVENT_RADAR_2D',   icon: '⊕', label: '2D RADAR' },
            { id: 'TOPO_CORE_3D',     icon: '△', label: '3D TOPO' },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`nav-tab h-full ${viewMode === tab.id ? 'active' : ''}`}
              style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none' }}
            >
              <span className="text-[11px] opacity-70">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Satellite parameter chips ─────────────────────── */}
        <div className="flex items-center flex-1 justify-center gap-0">
          <span className="telem-chip">
            <span>ALT:</span><span className="value">{altitude} KM</span>
          </span>
          <span className="telem-chip">
            <span>INC:</span><span className="value">{inclination}°</span>
          </span>
          <span className="telem-chip">
            <span>SWATH:</span><span className="value">{swath} KM</span>
          </span>
          <span className="telem-chip">
            <span className="value">{downlink} Gbps</span>
            <span
              className="status-dot ml-1"
              style={{
                background: 'var(--nominal)',
                boxShadow: '0 0 5px var(--nominal)',
              }}
            />
            <span style={{ color: 'var(--nominal)' }}>ACTIVE</span>
          </span>
        </div>

        {/* ── UTC timestamp ─────────────────────────────────── */}
        <div className="px-4 border-l border-white/10 border-r border-white/10">
          <p className="font-mono text-[10px] font-500 tracking-widest text-white/50 leading-none text-right">SYS.CLOCK</p>
          <motion.p
            key={utc.slice(12, 20)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-mono text-[11px] font-600 text-white tracking-wider leading-none mt-0.5"
          >
            {utc}
          </motion.p>
        </div>

        {/* ── POD health indicator ──────────────────────────── */}
        <div className="flex items-center gap-2 pl-4">
          <span
            className="status-dot"
            style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
          />
          <span className="font-mono text-[11px] font-600 tracking-widest" style={{ color: statusColor }}>
            POD {podStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
