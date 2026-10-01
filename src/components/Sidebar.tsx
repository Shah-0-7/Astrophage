/**
 * ============================================================
 * Sidebar – Event Dashboard & Storytelling Panel
 * ============================================================
 * Glassmorphism floating side panel with data charts,
 * educational content, and compare toggle.
 * ============================================================
 */

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { useNISARData } from '@/lib/useNISARData';
import DataChart from './DataChart';

const CATEGORY_COLORS: Record<string, string> = {
  glacier: 'var(--color-glacier)',
  earthquake: 'var(--color-earthquake)',
  agriculture: 'var(--color-agriculture)',
  wildfire: 'var(--color-wildfire)',
};

const CATEGORY_ICONS: Record<string, string> = {
  glacier: '🧊',
  earthquake: '🌋',
  agriculture: '🌾',
  wildfire: '🔥',
};

export default function Sidebar() {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const compareMode = useStore(s => s.compareMode);
  const toggleCompareMode = useStore(s => s.toggleCompareMode);

  const {
    activeScenario,
    chartData,
    formattedTimestamp,
    progress,
  } = useNISARData();

  const accentColor = CATEGORY_COLORS[activeScenario.category] || 'var(--accent-cyan)';

  return (
    <AnimatePresence mode="wait">
      {sidebarOpen && (
        <motion.aside
          key="sidebar"
          initial={{ x: -400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -400, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed left-4 top-20 bottom-28 z-30 w-[380px] glass-sidebar rounded-2xl overflow-hidden flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        >
          {/* ── Header ──────────────────────────────────────── */}
          <div className="p-5 pb-4 border-b border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]">
                {CATEGORY_ICONS[activeScenario.category]}
              </span>
              <div>
                <motion.h2
                  key={activeScenario.id}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="text-xl font-black leading-tight drop-shadow-[0_0_12px_currentColor]"
                  style={{ color: accentColor }}
                >
                  {activeScenario.title}
                </motion.h2>
                <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5 tracking-wider uppercase">
                  {activeScenario.subtitle}
                </p>
              </div>
            </div>

            {/* Category badge + timestamp */}
            <div className="flex items-center justify-between">
              <span className={`badge-${activeScenario.category} px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-inner`}>
                {activeScenario.category}
              </span>
              <span className="text-sm text-[var(--text-primary)] font-mono font-semibold tracking-wider">
                {formattedTimestamp}
              </span>
            </div>
          </div>

          {/* ── Scrollable Content ──────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Description */}
            <motion.p
              key={activeScenario.id + '-desc'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-sm text-[var(--text-secondary)] leading-relaxed font-medium"
            >
              {activeScenario.description}
            </motion.p>

            {/* ── Data Chart ──────────────────────────────── */}
            <div className="glass-light rounded-xl p-4 shadow-inner">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  {activeScenario.timeSeries.metricName}
                </h3>
                <span
                  className="text-lg font-mono font-black drop-shadow-[0_0_8px_currentColor]"
                  style={{ color: accentColor }}
                >
                  {chartData.length > 0 ? chartData[chartData.length - 1].value.toLocaleString() : '—'}
                  <span className="text-xs text-[var(--text-muted)] font-normal ml-1 tracking-wider uppercase">
                    {activeScenario.timeSeries.unit}
                  </span>
                </span>
              </div>
              <DataChart
                data={chartData}
                color={accentColor}
                unit={activeScenario.timeSeries.unit}
              />
            </div>

            {/* ── Progress Bar ─────────────────────────────── */}
            <div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono font-semibold mb-1.5 uppercase tracking-wider">
                <span>Timeline Progress</span>
                <span style={{ color: accentColor }}>{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/40 overflow-hidden shadow-inner border border-white/5">
                <motion.div
                  className="h-full rounded-full shadow-[0_0_10px_currentColor]"
                  style={{ background: accentColor }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* ── Educational Content ──────────────────────── */}
            <motion.div
              key={activeScenario.id + '-edu'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-light rounded-xl p-4 space-y-3 border-l-4"
              style={{ borderLeftColor: accentColor }}
            >
              <h3
                className="text-[13px] font-black uppercase tracking-wider"
                style={{ color: accentColor }}
              >
                {activeScenario.educationalContent.headline}
              </h3>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed font-medium">
                {activeScenario.educationalContent.body}
              </p>
              <div className="flex items-start gap-2 pt-3 border-t border-white/10">
                <span className="text-sm mt-0.5 filter drop-shadow-[0_0_4px_rgba(255,171,0,0.8)]">💡</span>
                <p className="text-xs text-[var(--accent-amber)] font-medium italic leading-relaxed">
                  {activeScenario.educationalContent.funFact}
                </p>
              </div>
            </motion.div>

            {/* ── Compare Toggle ───────────────────────────── */}
            <button
              onClick={toggleCompareMode}
              className={`
                w-full py-3.5 rounded-xl text-[11px] font-bold uppercase tracking-widest
                transition-all duration-300 cursor-pointer shadow-lg
                ${compareMode
                  ? 'glass-glow text-[var(--bg-primary)] bg-[var(--accent-cyan)] shadow-[0_0_20px_var(--accent-cyan)] border-[var(--accent-cyan)]'
                  : 'glass-light text-[var(--text-primary)] hover:text-[var(--accent-cyan)] hover:border-[var(--accent-cyan)]/50'
                }
              `}
            >
              <span className="mr-2 text-sm">{compareMode ? '✦' : '⇄'}</span>
              {compareMode ? 'Exit Compare Mode' : 'Before / After Compare'}
            </button>

            {/* ── Metric Cards ─────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 pb-2">
              <MetricCard
                label="Data Points"
                value={activeScenario.features.features.length.toLocaleString()}
                icon="📊"
              />
              <MetricCard
                label="Time Span"
                value={getTimeSpan(activeScenario.timeRange)}
                icon="📅"
              />
              <MetricCard
                label="Coverage"
                value={getCoverage(activeScenario.category)}
                icon="🗺️"
              />
              <MetricCard
                label="Resolution"
                value="12-day"
                icon="📡"
              />
            </div>
          </div>

          {/* ── Footer: NASA / ISRO branding ─────────────── */}
          <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/40 backdrop-blur-md">
            <span className="text-[9px] text-[var(--text-secondary)] font-mono font-bold tracking-[0.2em] uppercase">
              NASA-ISRO SAR Mission
            </span>
            <span className="text-[9px] text-[var(--text-secondary)] font-mono font-bold tracking-[0.2em] uppercase">
              NISAR L+S Band
            </span>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/* ── Metric Card Sub-component ──────────────────────────────── */
function MetricCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="glass-light rounded-xl p-3 text-center hover:bg-white/5 transition-colors">
      <span className="text-xl block mb-1.5 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">{icon}</span>
      <p className="text-sm font-black text-[var(--text-primary)] font-mono">{value}</p>
      <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */
function getTimeSpan(range: { start: string; end: string }): string {
  const ms = new Date(range.end).getTime() - new Date(range.start).getTime();
  const months = Math.round(ms / (1000 * 60 * 60 * 24 * 30));
  return months >= 12 ? `${Math.round(months / 12)} years` : `${months} months`;
}

function getCoverage(category: string): string {
  const map: Record<string, string> = {
    glacier: '~240 km²',
    earthquake: '~850 km²',
    agriculture: '~5,200 km²',
    wildfire: '~1,100 km²',
  };
  return map[category] || 'N/A';
}
