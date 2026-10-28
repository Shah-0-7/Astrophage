'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { OutlineWordmark } from '@/components/ui/outline-wordmark';
import { useStore } from '@/lib/store';
import { PASS_EPOCHS } from '@/lib/mockData';
import type { SourceHealth } from '@/lib/globalEvents';
import { WatchBell } from './watch-panel';
import type { Watchlist } from '@/lib/useWatchlist';
import { PLAYBACK_WINDOWS, windowRange, cutoffInRange } from '@/lib/playbackFilter';

export type ObView = 'globe' | 'radar' | 'topo' | 'events';

const VIEWS: Array<{ id: ObView; label: string }> = [
  { id: 'globe',  label: 'GLOBE'  },
  { id: 'radar',  label: 'RADAR'  },
  { id: 'topo',   label: 'TOPO'   },
  { id: 'events', label: 'EVENTS' },
];

const STATUS_COLOR: Record<string, string> = {
  ok: '#4ade80', cached: '#4ade80', loading: '#facc15', error: '#ff6a5e',
};

/* ── UTC clock + CelesTrak orbit readout ─────────────────────── */
function useUtcClock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setT(`${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

interface OrbitData { altitudeKm: number; inclination: number }
function useOrbit() {
  const [orbit, setOrbit] = useState<OrbitData | null>(null);
  useEffect(() => {
    fetch('/api/orbit')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && d.altitudeKm) setOrbit(d as OrbitData); })
      .catch(() => { /* static fallback below */ });
  }, []);
  return orbit;
}

export function TopBar({
  view, onView, health, watch,
}: {
  view: ObView;
  onView: (v: ObView, x: number, y: number) => void;
  health: SourceHealth[];
  watch?: Watchlist;
}) {
  const utc = useUtcClock();
  const orbit = useOrbit();
  const anyError = health.some(h => h.status === 'error');
  const allDone = health.length > 0 && health.every(h => h.status === 'ok' || h.status === 'cached');
  const liveColor = anyError ? '#facc15' : allDone ? '#4ade80' : '#ff6a5e';

  return (
    <header className="ob-top">
      <Link href="/" className="ob-brand" aria-label="Astrophage home">
        <OutlineWordmark
          text="ASTROPHAGE"
          style={{ fontFamily: 'var(--font-display), "Arial Black", system-ui, sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: '.14em' }}
        />
      </Link>

      <nav className="ob-tabs" aria-label="Views">
        {VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            className="ob-tab"
            data-on={view === v.id}
            aria-current={view === v.id ? 'page' : undefined}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect();
              onView(v.id, r.left + r.width / 2, r.top + r.height / 2);
            }}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="ob-right">
        <div className="ob-telemetry" aria-label="Satellite telemetry">
          <span>{utc}</span>
          <span>ALT {orbit ? orbit.altitudeKm.toFixed(0) : '747'} KM</span>
          <span>INC {orbit ? orbit.inclination.toFixed(1) : '98.4'}°</span>
        </div>
        {watch && <WatchBell watch={watch} />}
        <div className="ob-live" tabIndex={0}>
          <i style={{ background: liveColor, boxShadow: `0 0 10px ${liveColor}` }} /> LIVE
          <div className="ob-sources" role="tooltip">
            <b>FEEDS</b>
            {health.length === 0 && <span>Connecting…</span>}
            {health.map(h => (
              <span key={h.name}>
                <em style={{ background: STATUS_COLOR[h.status] ?? '#999' }} />
                {h.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ── Timeline: drives the shared pass index in the store ───────── */
const SPEEDS = [1, 2, 5] as const;

export function Timeline({ ticks }: { ticks: Array<{ at: number; color: string }> }) {
  const currentPassIndex = useStore(s => s.currentPassIndex);
  const setCurrentPassIndex = useStore(s => s.setCurrentPassIndex);
  const isPlaying = useStore(s => s.isPlaying);
  const togglePlayback = useStore(s => s.togglePlayback);
  const playbackSpeed = useStore(s => s.playbackSpeed);
  const playbackWindow = useStore(s => s.playbackWindow);
  const playbackAnchor = useStore(s => s.playbackAnchor);
  const setPlaybackWindow = useStore(s => s.setPlaybackWindow);
  const setPlaybackSpeed = useStore(s => s.setPlaybackSpeed);
  const total = PASS_EPOCHS.length;
  const pass = PASS_EPOCHS[currentPassIndex];
  const progress = total > 1 ? currentPassIndex / (total - 1) : 0;
  const track = useRef<HTMLDivElement>(null);
  const range = windowRange(playbackWindow, playbackAnchor);

  // Auto-playback: one pass per second, divided by speed (same cadence as the original scrubber).
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      useStore.setState(state => {
        const next = state.currentPassIndex + 1;
        if (next >= total) return { isPlaying: false, currentPassIndex: 0, currentTimestamp: PASS_EPOCHS[0].date };
        return { currentPassIndex: next, currentTimestamp: PASS_EPOCHS[next].date };
      });
    }, 1000 / playbackSpeed);
    return () => clearInterval(id);
  }, [isPlaying, playbackSpeed, total]);

  // Keyboard: space = play/pause, arrows = step.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
      if (e.code === 'ArrowRight') setCurrentPassIndex(Math.min(currentPassIndex + 1, total - 1));
      if (e.code === 'ArrowLeft') setCurrentPassIndex(Math.max(currentPassIndex - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPassIndex, togglePlayback, setCurrentPassIndex, total]);

  const seek = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setCurrentPassIndex(Math.round(f * (total - 1)));
  };

  return (
    <footer className="ob-time">
      <div className="ob-time-controls">
        <button type="button" className="ob-play" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying
            ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor" /></svg>}
        </button>
        <div className="ob-speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map(s => (
            <button key={s} type="button" data-on={playbackSpeed === s} aria-pressed={playbackSpeed === s} onClick={() => setPlaybackSpeed(s)}>{s}×</button>
          ))}
        </div>
        <div className="ob-speeds ob-windows" role="group" aria-label="Event replay window">
          {PLAYBACK_WINDOWS.map(w => (
            <button key={w.id} type="button" data-on={playbackWindow === w.id} aria-pressed={playbackWindow === w.id} onClick={() => setPlaybackWindow(w.id)}>{w.label}</button>
          ))}
        </div>
        <div className="ob-epoch">
          {range ? new Date(cutoffInRange(range, progress)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : pass ? pass.date.slice(0, 10) : '—'}
          <small>{range ? `REPLAY · LAST ${playbackWindow === '24h' ? '24 HOURS' : '7 DAYS'}` : `${pass?.label ?? '—'} · 12-DAY REPEAT`}</small>
        </div>
        <div className="ob-accum">
          <div><small>ΔD ACCUM</small>{pass?.accumDisplacement?.toFixed(1) ?? '—'} <span>MM</span></div>
          <div className="ob-resid"><small>RESIDUAL</small>±{pass?.residualError?.toFixed(1) ?? '—'} <span>MM</span></div>
        </div>
      </div>
      <div
        ref={track}
        className="ob-track"
        role="slider"
        tabIndex={0}
        aria-label="Observation pass"
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={currentPassIndex}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seek(e.clientX); }}
        onPointerMove={e => { if (e.buttons) seek(e.clientX); }}
      >
        <div className="ob-rail" />
        <div className="ob-fill" style={{ width: `${progress * 100}%` }} />
        {ticks.map((t, i) => <i key={i} className="ob-tick" style={{ left: `${t.at * 100}%`, background: t.color }} />)}
        <div className="ob-knob" style={{ left: `${progress * 100}%` }} />
      </div>
    </footer>
  );
}
