"use client";

/**
 * ============================================================
 * NISAR SAR/InSAR Geospatial Telemetry Platform
 * ============================================================
 * Main application page. Assembles the tri-mode view router
 * with persistent TelemetryHeader and PassScrubber.
 *
 * View routing:
 *   GLOBAL_SCHEMATIC  → GlobalSchematic
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

// Dynamically import all view panels to avoid SSR issues with canvas/WebGL
const GlobalSchematic = dynamic(() => import('@/components/GlobalSchematic'), {
  ssr: false,
  loading: () => <ViewLoader label="LOADING TARGET MATRIX..." />,
});

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

  // Radar scan line (decorative overlay, applied to all views)
  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Radar scan line overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-50 opacity-30">
        <div className="radar-scan-line w-full h-[200%]" />
      </div>

      {/* View panels */}
      {viewMode === 'GLOBAL_SCHEMATIC' && <GlobalSchematic />}
      {viewMode === 'EVENT_RADAR_2D'   && <EventRadar2D />}
      {viewMode === 'TOPO_CORE_3D'     && <TopoCore3D />}
    </div>
  );
}

export default function Home() {
  return (
    <main
      className="w-screen h-screen overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* ── Persistent telemetry header (42px) ───────────────── */}
      <TelemetryHeader />

      {/* ── Main content area (below header, above scrubber) ─── */}
      <div
        className="flex flex-col"
        style={{ marginTop: 42, marginBottom: 94, flex: 1, overflow: 'hidden' }}
      >
        <ViewRouter />
      </div>

      {/* ── Persistent pass scrubber (bottom, ~94px) ─────────── */}
      <PassScrubber />
    </main>
  );
}
