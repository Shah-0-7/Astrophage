/**
 * ============================================================
 * Navbar – Top navigation bar
 * ============================================================
 * Glassmorphism bar with NISAR branding, base-layer switcher,
 * and scenario quick-select pills.
 * ============================================================
 */

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { useNISARData } from '@/lib/useNISARData';

const LAYER_OPTIONS = [
  { id: 'dark' as const, label: 'Dark', icon: '🌑' },
  { id: 'satellite' as const, label: 'Satellite', icon: '🛰️' },
  { id: 'terrain' as const, label: 'Terrain', icon: '🏔️' },
];

const CATEGORY_ICONS: Record<string, string> = {
  glacier: '🧊',
  earthquake: '🌋',
  agriculture: '🌾',
  wildfire: '🔥',
};

export default function Navbar() {
  const { scenarios } = useNISARData();
  const activeScenarioId = useStore(s => s.activeScenarioId);
  const setActiveScenario = useStore(s => s.setActiveScenario);
  const baseLayer = useStore(s => s.baseLayer);
  const setBaseLayer = useStore(s => s.setBaseLayer);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const toggleSidebar = useStore(s => s.toggleSidebar);

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 right-0 z-50 glass"
      style={{ height: '64px' }}
    >
      <div className="flex items-center justify-between h-full px-5">
        {/* ── Brand ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="w-9 h-9 rounded-lg glass-light flex items-center justify-center hover:border-[var(--border-glow)] transition-all duration-200 cursor-pointer"
            title={sidebarOpen ? 'Close panel' : 'Open panel'}
          >
            <motion.div
              animate={{ rotate: sidebarOpen ? 0 : 180 }}
              transition={{ duration: 0.3 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          </button>

          <div className="flex items-center gap-2.5">
            {/* NISAR logo mark */}
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full border-2 border-[var(--accent-cyan)] opacity-60" />
              <div className="absolute inset-1 rounded-full border border-[var(--accent-magenta)] opacity-40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse-glow" />
              </div>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wider gradient-text leading-none">
                NISAR EARTH WATCH
              </h1>
              <p className="text-[10px] text-[var(--text-muted)] tracking-widest font-mono mt-0.5">
                THE WALTZ OF SURFACE CHANGE
              </p>
            </div>
          </div>
        </div>

        {/* ── Scenario Pills ────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-2">
          {scenarios.map(scenario => {
            const isActive = scenario.id === activeScenarioId;
            return (
              <motion.button
                key={scenario.id}
                onClick={() => setActiveScenario(scenario.id)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-300 cursor-pointer
                  ${isActive
                    ? `badge-${scenario.category} shadow-lg`
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                  }
                `}
              >
                <span className="mr-1.5">{CATEGORY_ICONS[scenario.category]}</span>
                {scenario.title.split(' ').slice(0, 2).join(' ')}
                {isActive && (
                  <motion.div
                    layoutId="activeScenarioPill"
                    className="absolute inset-0 rounded-full border border-current opacity-30"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* ── Base Layer Switcher ────────────────────────────── */}
        <div className="flex items-center gap-1.5 glass-light rounded-lg p-1">
          {LAYER_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setBaseLayer(opt.id)}
              className={`
                px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer
                ${baseLayer === opt.id
                  ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }
              `}
              title={opt.label}
            >
              <span className="mr-1">{opt.icon}</span>
              <span className="hidden lg:inline">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </motion.nav>
  );
}
