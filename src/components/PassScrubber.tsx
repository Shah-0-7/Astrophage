/**
 * ============================================================
 * PassScrubber – Multi-Epoch Time-Series Scrubber
 * ============================================================
 * Snaps to 12-day repeat orbit pass intervals (PASS 01–18).
 * Displays cumulative displacement (Δd ACCUM) and residual
 * error relative to baseline epoch P01.
 * Supports 1×, 2×, 5× variable speed playback.
 * ============================================================
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { PASS_EPOCHS } from '@/lib/mockData';
import { useNISARData } from '@/lib/useNISARData';

const SPEED_OPTIONS = [1, 2, 5] as const;
const TOTAL_PASSES = PASS_EPOCHS.length;     // 18

export default function PassScrubber() {
  const viewMode = useStore(s => s.viewMode);
  const currentPassIndex = useStore(s => s.currentPassIndex);
  const setCurrentPassIndex = useStore(s => s.setCurrentPassIndex);
  const isPlaying = useStore(s => s.isPlaying);
  const togglePlayback = useStore(s => s.togglePlayback);
  const stopPlayback = useStore(s => s.stopPlayback);
  const playbackSpeed = useStore(s => s.playbackSpeed);
  const setPlaybackSpeed = useStore(s => s.setPlaybackSpeed);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentPass = PASS_EPOCHS[currentPassIndex];
  const progress = TOTAL_PASSES > 1 ? (currentPassIndex / (TOTAL_PASSES - 1)) * 100 : 0;

  /* ── Auto-playback across passes ────────────────────────────── */
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        useStore.setState(state => {
          const next = state.currentPassIndex + 1;
          if (next >= TOTAL_PASSES) {
            return { isPlaying: false, currentPassIndex: 0 };
          }
          const pass = PASS_EPOCHS[next];
          return {
            currentPassIndex: next,
            currentTimestamp: pass.date,
          };
        });
      }, 1000 / playbackSpeed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, playbackSpeed]);

  /* ── Keyboard shortcuts ──────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
      if (e.code === 'ArrowRight') setCurrentPassIndex(Math.min(currentPassIndex + 1, TOTAL_PASSES - 1));
      if (e.code === 'ArrowLeft')  setCurrentPassIndex(Math.max(currentPassIndex - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPassIndex, togglePlayback, setCurrentPassIndex]);

  /* ── Scrubber change ─────────────────────────────────────────── */
  const handleSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    setCurrentPassIndex(idx);
  }, [setCurrentPassIndex]);

  // Epoch label display
  const epochDate = currentPass
    ? new Date(currentPass.date).toISOString().slice(0, 10).replace(/-/g, '-')
    : '--';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: 'rgba(9,9,11,0.96)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(20px)',
        padding: '10px 20px 14px',
      }}
    >
      {/* ── Top row: controls + epoch display + metrics ─────── */}
      <div className="flex items-center gap-4 mb-2.5">
        {/* Play / Pause */}
        <motion.button
          onClick={togglePlayback}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg width="10" height="12" viewBox="0 0 10 12" fill="white">
              <rect x="0" y="0" width="3.5" height="12" rx="0.5" />
              <rect x="6.5" y="0" width="3.5" height="12" rx="0.5" />
            </svg>
          ) : (
            <svg width="10" height="12" viewBox="0 0 10 12" fill="white">
              <path d="M1 0.5L9.5 6L1 11.5V0.5Z" />
            </svg>
          )}
        </motion.button>

        {/* Speed buttons */}
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map(speed => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`tac-btn text-[9px] h-6 px-2 ${playbackSpeed === speed ? 'active' : ''}`}
            >
              {speed}×
            </button>
          ))}
        </div>

        {/* Epoch label */}
        <div className="flex items-center gap-3 ml-2">
          <div>
            <span className="panel-label">EPOCH:</span>
            <motion.span
              key={epochDate}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-mono text-[12px] font-700 text-white ml-2"
            >
              {epochDate} [{currentPass?.label ?? '—'}]
            </motion.span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Δd ACCUM */}
        <div className="text-right">
          <p className="panel-label">Δd ACCUM</p>
          <motion.p
            key={currentPassIndex}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            className="font-mono text-[13px] font-700"
            style={{ color: 'var(--crimson)' }}
          >
            {currentPass?.accumDisplacement?.toFixed(1) ?? '—'} mm
          </motion.p>
        </div>

        <div className="w-px h-8 bg-white/10" />

        {/* Residual error */}
        <div className="text-right">
          <p className="panel-label">RESIDUAL</p>
          <p className="font-mono text-[13px] font-700 text-white/60">
            ±{currentPass?.residualError?.toFixed(1) ?? '—'} mm
          </p>
        </div>
      </div>

      {/* ── Pass scrubber slider ──────────────────────────────── */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={TOTAL_PASSES - 1}
          value={currentPassIndex}
          onChange={handleSlider}
          className="timeline-slider"
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />

        {/* Pass tick marks */}
        <div className="relative mt-1.5 h-5">
          {PASS_EPOCHS.map((pass, idx) => {
            const left = TOTAL_PASSES > 1 ? (idx / (TOTAL_PASSES - 1)) * 100 : 0;
            const isCurrent = idx === currentPassIndex;
            // Show label for every 3rd pass
            const showLabel = idx === 0 || idx === TOTAL_PASSES - 1 || idx % 3 === 0;
            return (
              <div
                key={pass.label}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${left}%`,
                  transform: 'translateX(-50%)',
                  cursor: 'pointer',
                }}
                onClick={() => setCurrentPassIndex(idx)}
              >
                <div
                  className="w-[1px]"
                  style={{
                    height: 6,
                    background: isCurrent ? 'var(--crimson)' : 'var(--white-30)',
                    boxShadow: isCurrent ? '0 0 6px var(--crimson)' : undefined,
                  }}
                />
                {showLabel && (
                  <span
                    className="font-mono text-[8px] mt-0.5 whitespace-nowrap"
                    style={{ color: isCurrent ? 'var(--white)' : 'var(--text-muted)' }}
                  >
                    {pass.date.slice(0, 7)} [{pass.label}]
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
