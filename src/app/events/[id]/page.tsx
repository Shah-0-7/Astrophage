/**
 * /events/[id] – Event Detail Page (placeholder)
 * Full InSAR displacement detail coming in next step.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Event Detail – NISAR SAR/InSAR Geospatial Telemetry Platform',
  description: 'Detailed InSAR displacement analysis for a specific geophysical event.',
};

export default function EventDetailPage({ params }: { params: { id: string } }) {
  return (
    <main
      className="w-screen h-screen overflow-hidden flex items-center justify-center"
      style={{ background: '#09090b', fontFamily: "'Roboto Mono', monospace" }}
    >
      <div className="flex flex-col items-center gap-6 text-center px-8">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border border-white/10" />
          <div
            className="absolute inset-[5px] rounded-full border border-white/20"
            style={{ boxShadow: '0 0 20px rgba(239,68,68,0.2)' }}
          />
          <div
            className="absolute inset-[10px] rounded-full"
            style={{ background: 'var(--crimson)', boxShadow: '0 0 12px rgba(239,68,68,0.6)' }}
          />
        </div>

        <div>
          <p
            className="font-mono text-[9px] tracking-[0.25em] uppercase mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            EVENT ID: {params.id}
          </p>
          <h1
            className="font-mono text-[20px] font-700 text-white tracking-wider uppercase mb-2"
          >
            EVENT DETAIL
          </h1>
          <p
            className="font-mono text-[11px] tracking-widest uppercase"
            style={{ color: 'var(--crimson)' }}
          >
            InSAR Displacement Analysis
          </p>
        </div>

        <div
          className="glass-panel rounded-sm px-6 py-4 max-w-md"
          style={{ border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <p className="font-mono text-[11px] text-white/60 leading-relaxed">
            Full InSAR surface displacement analysis, phase coherence maps, and
            time-series deformation plots will be rendered here in the next
            implementation step. This route is pre-registered to accept deep
            links from the Global Schematic marker panel.
          </p>
        </div>

        <a
          href="/"
          className="tac-btn px-8"
          style={{ height: 36, fontSize: 11 }}
        >
          ← RETURN TO SCHEMATIC
        </a>
      </div>
    </main>
  );
}
