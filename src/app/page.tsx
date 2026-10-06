"use client";

/**
 * ============================================================
 * NISAR SAR/InSAR Geospatial Telemetry Platform
 * ============================================================
 * Main application page. Assembles the tri-mode view router
 * with persistent TelemetryHeader and PassScrubber.
 *
 * View routing:
 *   EVENT_RADAR_2D    → EventRadar2D  (default)
 *   TOPO_CORE_3D      → TopoCore3D
 *
 * Spatial context (active node, coords, epoch, band) persists
 * across all view switches via the centralized Zustand store.
 * ============================================================
 */

import dynamic from 'next/dynamic';
import TelemetryHeader from '@/components/TelemetryHeader';
import PassScrubber from '@/components/PassScrubber';
import { useStore } from '@/lib/store';

const EventRadar2D = dynamic(() => import('@/components/EventRadar2D'), {
  ssr: false,
  loading: () => <ViewLoader label="CALIBRATING RADAR ARRAY..." />,
});

const TopoCore3D = dynamic(() => import('@/components/TopoCore3D'), {
  ssr: false,
  loading: () => <ViewLoader label="INITIALIZING MORPHOMETRIC ENGINE..." />,
});

function ViewLoader({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: '#09090b' }}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent spin"
          style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'var(--crimson)' }}
        />
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase"
           style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      </div>
    </div>
  );
}

function ViewRouter() {
  const viewMode = useStore(s => s.viewMode);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* Radar scan line overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-50 opacity-30">
        <div className="radar-scan-line w-full h-[200%]" />
      </div>

      {/* View panels */}
      {viewMode === 'EVENT_RADAR_2D'   && <EventRadar2D />}
      {viewMode === 'TOPO_CORE_3D'     && <TopoCore3D />}
    </div>
  );
}

export default function Home() {
  return (
    <main
      className="w-screen h-screen overflow-hidden"
      style={{ background: 'var(--bg-primary)', position: 'relative' }}
    >
      {/* ── Persistent telemetry header (42px fixed top) ───────── */}
      <TelemetryHeader />

      {/* ── Main content area fills between header and scrubber ── */}
      <div
        style={{
          position: 'absolute',
          top: 42,
          left: 0,
          right: 0,
          bottom: 94,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ViewRouter />
      </div>

      {/* ── Persistent pass scrubber (fixed bottom ~94px) ──────── */}
      <PassScrubber />
    </main>
  );
}
