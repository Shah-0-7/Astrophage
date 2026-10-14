/**
 * /events layout – slim standalone layout with back-to-globe header.
 * globals.css is already imported by the root layout (src/app/layout.tsx).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';

export const metadata: Metadata = {
  title: 'Event Directory – NISAR Earth Watch',
  description: 'Browse, search and filter real-time global geophysical events: earthquakes, volcanic eruptions, landslides, cryosphere events, subsidence, mining and induced seismicity.',
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* ── Slim header ─────────────────────────────────────────── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 telem-header"
        style={{ height: 42 }}
        role="banner"
      >
        <div className="flex items-center h-full px-4 gap-0">
          {/* Brand */}
          <div className="flex items-center gap-2.5 pr-4 border-r border-white/10" style={{ minWidth: 140 }}>
            <div className="relative w-5 h-5 flex-shrink-0">
              <div className="absolute inset-0 rounded-full border border-white/20" />
              <div className="absolute inset-[3px] rounded-full" style={{ background: 'var(--crimson)', boxShadow: '0 0 6px var(--crimson)' }} />
            </div>
            <div>
              <p className="font-mono text-[10px] font-bold tracking-[0.18em] text-white leading-none brand-title">NASA / ISRO</p>
              <p className="font-mono text-[8px] tracking-[0.14em] text-white/40 leading-none mt-0.5 brand-sub">NISAR</p>
            </div>
          </div>

          {/* Back link */}
          <Link
            href="/"
            className="nav-tab h-full"
            style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', textDecoration: 'none' }}
            aria-label="Back to globe"
          >
            <span className="text-[11px] opacity-70">←</span>
            GLOBE
          </Link>

          {/* Active tab */}
          <span
            className="nav-tab active h-full"
            style={{ borderRadius: 0, borderTop: 'none', borderBottom: 'none', cursor: 'default' }}
          >
            <span className="text-[11px] opacity-70">☰</span>
            EVENT DIRECTORY
          </span>

          <div className="flex-1" />

          {/* Theme toggle */}
          <div className="px-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Page content (below 42 px header) ────────────────────── */}
      <div style={{ paddingTop: 42, minHeight: '100dvh', background: 'var(--bg-primary)' }}>
        {children}
      </div>
    </>
  );
}
