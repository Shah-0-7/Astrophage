/**
 * ============================================================
 * Timeline – "The Waltz" Time-Series Slider
 * ============================================================
 * Prominent bottom-of-screen slider with play/pause, speed
 * control, and date markers.  Drives the entire app's temporal
 * state through the Zustand store.
 * ============================================================
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/lib/store';
import { useNISARData } from '@/lib/useNISARData';

const SPEED_OPTIONS = [1, 2, 5] as const;

export default function Timeline() {
  const {
    activeScenario,
    timelineSteps,
    currentStepIndex,
    totalSteps,
    formattedTimestamp,
    progress,
  } = useNISARData();

  const isPlaying = useStore(s => s.isPlaying);
  const togglePlayback = useStore(s => s.togglePlayback);
  const playbackSpeed = useStore(s => s.playbackSpeed);
  const setPlaybackSpeed = useStore(s => s.setPlaybackSpeed);
  const setCurrentTimestamp = useStore(s => s.setCurrentTimestamp);
  const stopPlayback = useStore(s => s.stopPlayback);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Auto-playback loop ───────────────────────────────────── */
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        useStore.setState(state => {
          const scenario = activeScenario;
          const steps = scenario.timeSeries.timestamps;
          const currentIdx = steps.findIndex(
            t => new Date(t).getTime() >= new Date(state.currentTimestamp).getTime()
          );
          const nextIdx = currentIdx + 1;
          if (nextIdx >= steps.length) {
            // Loop back to start
            return { currentTimestamp: steps[0], isPlaying: false };
          }
          return { currentTimestamp: steps[nextIdx] };
        });
      }, 1200 / playbackSpeed);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, activeScenario]);

  /* ── Slider change handler ────────────────────────────────── */
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = parseInt(e.target.value, 10);
      if (timelineSteps[idx]) {
        setCurrentTimestamp(timelineSteps[idx]);
      }
    },
    [timelineSteps, setCurrentTimestamp]
  );

  /* ── Keyboard shortcuts ───────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
      if (e.code === 'ArrowRight') {
        const next = Math.min(currentStepIndex + 1, totalSteps - 1);
        setCurrentTimestamp(timelineSteps[next]);
      }
      if (e.code === 'ArrowLeft') {
        const prev = Math.max(currentStepIndex - 1, 0);
        setCurrentTimestamp(timelineSteps[prev]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentStepIndex, totalSteps, timelineSteps, togglePlayback, setCurrentTimestamp]);

  /* ── Date markers (show ~5-6 evenly spaced labels) ────────── */
  const markerCount = Math.min(6, totalSteps);
  const markerIndices = Array.from({ length: markerCount }, (_, i) =>
    Math.round((i / (markerCount - 1)) * (totalSteps - 1))
  );

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="fixed bottom-0 left-0 right-0 z-40 glass"
      style={{ padding: '12px 24px 16px' }}
    >
      {/* ── Top row: controls + current date ─────────────────── */}
      <div className="flex items-center gap-4 mb-3">
        {/* Play/Pause */}
        <motion.button
          onClick={togglePlayback}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="w-10 h-10 rounded-full glass-glow flex items-center justify-center cursor-pointer hover:shadow-[var(--shadow-glow-cyan)]"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg width="14" height="16" viewBox="0 0 14 16" fill="var(--accent-cyan)">
              <rect x="1" y="1" width="4" height="14" rx="1" />
              <rect x="9" y="1" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="16" viewBox="0 0 14 16" fill="var(--accent-cyan)">
              <path d="M2 1.5L13 8L2 14.5V1.5Z" />
            </svg>
          )}
        </motion.button>

        {/* Speed control */}
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map(speed => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`
                px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-all cursor-pointer
                ${playbackSpeed === speed
                  ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }
              `}
            >
              {speed}×
            </button>
          ))}
        </div>

        {/* Current timestamp */}
        <div className="flex-1 text-center">
          <motion.span
            key={formattedTimestamp}
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-sm font-semibold text-[var(--accent-cyan)] font-mono tracking-wider"
          >
            {formattedTimestamp}
          </motion.span>
        </div>

        {/* Scenario label */}
        <div className="text-right">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-mono">
            {activeScenario.timeSeries.metricName}
          </span>
        </div>
      </div>

      {/* ── Slider ───────────────────────────────────────────── */}
      <div className="relative">
        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentStepIndex}
          onChange={handleSliderChange}
          className="timeline-slider"
          style={{ '--progress': `${progress}%` } as React.CSSProperties}
        />

        {/* Date markers */}
        <div className="relative mt-2 h-4">
          {markerIndices.map((idx, i) => {
            const left = totalSteps > 1 ? (idx / (totalSteps - 1)) * 100 : 0;
            const date = new Date(timelineSteps[idx]);
            const label = date.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
            return (
              <span
                key={i}
                className="absolute text-[9px] text-[var(--text-muted)] font-mono transform -translate-x-1/2"
                style={{ left: `${left}%` }}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
