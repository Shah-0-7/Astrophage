/**
 * ============================================================
 * TelemetryHeader – Persistent Top Status Bar
 * ============================================================
 * Displays real-time satellite parameters from CelesTrak,
 * UTC timestamp, and payload health.
 * Persists across all view modes.
 * ============================================================
 */

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { SATELLITE_TELEMETRY } from '@/lib/mockData';
import { useTheme } from '@/lib/ThemeProvider';

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

interface OrbitData {
  altitudeKm: number;
  inclination: number;
  velocityKms: number;
  periodMin: number;
  epoch: string;
}

function useOrbitData() {
  const [orbit, setOrbit] = useState<OrbitData | null>(null);
  useEffect(() => {
    fetch('/api/orbit')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.altitudeKm) setOrbit(d as OrbitData);
      })
      .catch(() => {/* silently fall back to static values */});
  }, []);
  return orbit;
}

const { swath, downlink, podStatus } = SATELLITE_TELEMETRY;

export default function TelemetryHeader() {
  const viewMode    = useStore(s => s.viewMode);
  const setViewMode = useStore(s => s.setViewMode);
  const lBandStatus = useStore(s => s.lBandStatus);
  const sBandStatus = useStore(s => s.sBandStatus);
  const utc         = useUTCClock();
  const orbit       = useOrbitData();
  const pathname    = usePathname();
  const onGlobePage = pathname === '/';
  const { theme, toggle } = useTheme();

  // Suppress unused-var lint – sBandStatus used implicitly in future
  void sBandStatus;
  void lBandStatus;

  // Keyboard shortcut 'T' to toggle theme (ignore when typing in inputs)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 't' && e.key !== 'T') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      toggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  // Use live CelesTrak data if available, fall back to static mock values
  const altitude    = orbit ? Math.round(orbit.altitudeKm)      : SATELLITE_TELEMETRY.altitude;
  const inclination = orbit ? orbit.inclination.toFixed(1)       : SATELLITE_TELEMETRY.inclination.toFixed(1);
  const isLive      = orbit !== null;

  const statusColor = podStatus === 'NOMINAL' ? 'var(--nominal)'
    : podStatus === 'DEGRADED' ? 'var(--acquiring)' : 'var(--crimson)';

  return (
    <div className="fixed top-0 left-0 right-0 z-50 telem-header" style={{ height: 42 }}>
      <div className="flex items-center h-full px-4 gap-0">
        {/* ── Brand mark ───────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 pr-4 border-r border-[var(--border-zinc)]" style={{ minWidth: 140 }}>
          <div className="relative w-5 h-5 flex-shrink-0">
            <div className="absolute inset-0 rounded-full border border-[var(--border-zinc)]" />
            <div
              className="absolute inset-[3px] rounded-full status-dot active lock-ring"
              style={{ background: 'var(--crimson)' }}
            />
          </div>
          <div>
            <p className="font-mono text-[10px] font-700 tracking-[0.18em] text-[var(--text-primary)] leading-none brand-title">NASA / ISRO</p>
            <p className="font-mono text-[8px] tracking-[0.14em] text-[var(--text-muted)] leading-none mt-0.5 brand-sub">NISAR</p>
          </div>
        </div>

        {/* ── Nav tabs ─────────────────────────────────────────── */}
        <div className="flex items-center h-full ml-2">
          {/* Globe view-mode tabs – only active when on the globe page */}
          {(([
            { id: 'GLOBAL_SCHEMATIC', icon: '🌐', label: 'GLOBAL SCHEMATIC' },
            { id: 'EVENT_RADAR_2D',   icon: '⊕', label: '2D RADAR' },
            { id: 'TOPO_CORE_3D',     icon: '△', label: '3D TOPO' },
          ] as const)).map(tab => (
            <button
              key={tab.id}
              onClick={() => { if (onGlobePage) setViewMode(tab.id); else window.location.href = '/'; }}
              className={`nav-tab h-full ${onGlobePage && viewMode === tab.id ? 'active' : ''}`}
              style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none' }}
            >
              <span className="text-[11px] opacity-70">{tab.icon}</span>
              {tab.label}
            </button>
          ))}

          {/* EVENT DIRECTORY – separate page */}
          <Link
            href="/events"
            className={`nav-tab h-full ${pathname.startsWith('/events') ? 'active' : ''}`}
            style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', textDecoration: 'none' }}
          >
            <span className="text-[11px] opacity-70">☰</span>
            EVENT DIRECTORY
          </Link>
        </div>

        {/* ── Satellite parameter chips ─────────────────────────── */}
        <div className="hidden md:flex items-center flex-1 justify-center gap-0">
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
          {/* CelesTrak live badge – only shown when live data arrives */}
          {isLive && (
            <span className="telem-chip" style={{ color: 'var(--nominal)', fontSize: 9 }}>
              <span
                className="status-dot mr-1"
                style={{ background: 'var(--nominal)', boxShadow: '0 0 5px var(--nominal)' }}
              />
              CELESTRAK LIVE
            </span>
          )}
        </div>
        {/* Spacer pushes UTC/POD right on mobile */}
        <div className="flex-1 md:hidden" />

        {/* ── UTC timestamp ─────────────────────────────────────── */}
        <div className="hidden sm:block px-4 border-l border-r border-[var(--border-zinc)]">
          <p className="font-mono text-[10px] font-500 tracking-widest text-[var(--text-muted)] leading-none text-right clock-label">SYS.CLOCK</p>
          <motion.p
            key={utc.slice(12, 20)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-mono text-[11px] font-600 text-[var(--text-primary)] tracking-wider leading-none mt-0.5 clock-val"
          >
            {utc}
          </motion.p>
        </div>

        {/* ── Theme toggle button ────────────────────────────────── */}
        <div className="px-2 border-r border-[var(--border-zinc)]">
          <button
            type="button"
            onClick={toggle}
            className="theme-toggle"
            aria-label={theme === 'dark' ? 'Switch to light theme (T)' : 'Switch to dark theme (T)'}
            title={theme === 'dark' ? 'Switch to light theme (T)' : 'Switch to dark theme (T)'}
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>

        {/* ── POD health indicator ───────────────────────────────── */}
        <div className="flex items-center gap-2 pl-4">
          <span
            className="status-dot"
            style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
          />
          <span className="hidden sm:inline font-mono text-[11px] font-600 tracking-widest" style={{ color: statusColor }}>
            POD {podStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
