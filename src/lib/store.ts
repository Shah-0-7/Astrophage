/**
 * ============================================================
 * NISAR SAR Telemetry Platform – Centralized Zustand Store
 * ============================================================
 * Single source of truth for ALL app state. WebGL shader
 * uniforms, telemetry panels, and UI state are all driven
 * from here to ensure complete synchronization.
 * ============================================================
 */

'use client';

import { create } from 'zustand';
import type {
  ViewMode, TargetCategory, PhaseFilterMode, PolVar,
  CameraPreset, InstrumentLayers, PointProbeResult, SARBand,
} from './types';
import { ALL_SCENARIOS, PASS_EPOCHS } from './mockData';

interface StoreState {
  /* ── Navigation ─────────────────────────────────────────── */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  /* ── Active target (persists across view switches) ────────── */
  activeNodeId: string | null;
  setActiveNodeId: (id: string | null) => void;

  /* ── Legacy scenario (maps to 2D/3D view data) ────────────── */
  activeScenarioId: string;
  setActiveScenario: (id: string) => void;

  /* ── Spatial context (persisted across mode switches) ─────── */
  spatialContext: {
    targetCoords: [number, number] | null;
    breadcrumbTrack: string;
    orbitEpoch: string;
    bandParam: string;
  };
  setSpatialContext: (ctx: Partial<StoreState['spatialContext']>) => void;

  /* ── Temporal: 12-day pass scrubber ──────────────────────── */
  currentPassIndex: number;           // 0-based index into PASS_EPOCHS
  setCurrentPassIndex: (idx: number) => void;
  isPlaying: boolean;
  togglePlayback: () => void;
  stopPlayback: () => void;
  playbackSpeed: 1 | 2 | 5;
  setPlaybackSpeed: (speed: 1 | 2 | 5) => void;

  /* ── Legacy timestamp (drives map layers) ─────────────────── */
  currentTimestamp: string;
  setCurrentTimestamp: (ts: string) => void;

  /* ── Target category filter ─────────────────────────────── */
  selectedTargetCategory: TargetCategory | 'ALL';
  filterTargetMatrix: (category: TargetCategory | 'ALL') => void;

  /* ── Phase processing ───────────────────────────────────── */
  phaseFilterMode: PhaseFilterMode;
  setPhaseFilterMode: (mode: PhaseFilterMode) => void;
  coherenceThreshold: number;         // 0–1
  setCoherenceThreshold: (val: number) => void;
  activePolarisation: PolVar;
  setActivePolarisation: (pol: PolVar) => void;

  /* ── Dual-band status ───────────────────────────────────── */
  lBandStatus: 'NOMINAL' | 'ACQUIRING' | 'STANDBY';
  sBandStatus: 'NOMINAL' | 'ACQUIRING' | 'STANDBY';
  setLBandStatus: (s: 'NOMINAL' | 'ACQUIRING' | 'STANDBY') => void;
  setSBandStatus: (s: 'NOMINAL' | 'ACQUIRING' | 'STANDBY') => void;

  /* ── 3D Morphometric ────────────────────────────────────── */
  zAxisExaggeration: number;          // 1.0–10.0
  setZAxisExaggeration: (factor: number) => void;
  cutawayElevation: number;           // metres datum offset
  setCutawayElevation: (offset: number) => void;
  instrumentLayers: InstrumentLayers;
  toggleInstrumentLayers: (flags: Partial<InstrumentLayers>) => void;
  cameraPreset: CameraPreset;
  setCameraViewport: (preset: CameraPreset) => void;

  /* ── Point-probe ────────────────────────────────────────── */
  pointProbe: PointProbeResult | null;
  setPointProbe: (result: PointProbeResult | null) => void;

  /* ── Inverse displacement ───────────────────────────────── */
  isInverseRunning: boolean;
  executeInverseDisplacement: () => void;

  /* ── Legacy UI / Map ────────────────────────────────────── */
  baseLayer: 'satellite' | 'dark' | 'terrain';
  setBaseLayer: (layer: 'satellite' | 'dark' | 'terrain') => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  compareMode: boolean;
  toggleCompareMode: () => void;

  /* ── Jump to coordinates ────────────────────────────────── */
  flyToCoords: [number, number] | null;
  setFlyToCoords: (coords: [number, number] | null) => void;

  /* ── Global Event Selection ─────────────────────────────── */
  selectedGlobalEvent: import('./types').UnifiedFeature | null;
  setSelectedGlobalEvent: (evt: import('./types').UnifiedFeature | null) => void;
}

const defaultScenario = ALL_SCENARIOS[0];
const defaultPass = PASS_EPOCHS[17]; // Start at PASS 18 (most recent)

export const useStore = create<StoreState>((set, get) => ({
  /* ── Navigation ─────────────────────────────────────────── */
  viewMode: 'EVENT_RADAR_2D',
  setViewMode: (mode) => set({ viewMode: mode }),

  /* ── Active target ──────────────────────────────────────── */
  activeNodeId: null as string | null,
  setActiveNodeId: (id) => set({ activeNodeId: id }),

  /* ── Legacy scenario ────────────────────────────────────── */
  activeScenarioId: defaultScenario.id,
  setActiveScenario: (id) => {
    const scenario = ALL_SCENARIOS.find(s => s.id === id);
    if (scenario) {
      set({
        activeScenarioId: id,
        currentTimestamp: scenario.timeRange.start,
        isPlaying: false,
      });
    }
  },

  /* ── Spatial context ────────────────────────────────────── */
  spatialContext: {
    targetCoords: [-120.35, 35.72],
    breadcrumbTrack: 'PACIFIC MARGIN / SAN ANDREAS COASTAL ZONE',
    orbitEpoch: defaultPass.date,
    bandParam: 'L-BAND 24cm λ',
  },
  setSpatialContext: (ctx) =>
    set(s => ({ spatialContext: { ...s.spatialContext, ...ctx } })),

  /* ── Temporal ───────────────────────────────────────────── */
  currentPassIndex: 17,               // PASS 18
  setCurrentPassIndex: (idx) => {
    const pass = PASS_EPOCHS[idx];
    if (pass) {
      set({
        currentPassIndex: idx,
        currentTimestamp: pass.date,
      });
    }
  },
  isPlaying: false,
  togglePlayback: () => set(s => ({ isPlaying: !s.isPlaying })),
  stopPlayback: () => set({ isPlaying: false }),
  playbackSpeed: 1,
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  currentTimestamp: defaultScenario.timeRange.end,
  setCurrentTimestamp: (ts) => set({ currentTimestamp: ts }),

  /* ── Target category filter ─────────────────────────────── */
  selectedTargetCategory: 'ALL',
  filterTargetMatrix: (category) => set({ selectedTargetCategory: category }),

  /* ── Phase processing ───────────────────────────────────── */
  phaseFilterMode: 'FILTERED',
  setPhaseFilterMode: (mode) => set({ phaseFilterMode: mode }),
  coherenceThreshold: 0.5,
  setCoherenceThreshold: (val) => set({ coherenceThreshold: Math.max(0, Math.min(1, val)) }),
  activePolarisation: 'HH',
  setActivePolarisation: (pol) => set({ activePolarisation: pol }),

  /* ── Dual-band status ───────────────────────────────────── */
  lBandStatus: 'NOMINAL',
  sBandStatus: 'ACQUIRING',
  setLBandStatus: (s) => set({ lBandStatus: s }),
  setSBandStatus: (s) => set({ sBandStatus: s }),

  /* ── 3D Morphometric ────────────────────────────────────── */
  zAxisExaggeration: 4.2,
  setZAxisExaggeration: (factor) => set({ zAxisExaggeration: Math.max(1, Math.min(10, factor)) }),
  cutawayElevation: 1280,
  setCutawayElevation: (offset) => set({ cutawayElevation: offset }),
  instrumentLayers: { wireframe: true, phaseFringe: true, coherenceMask: true },
  toggleInstrumentLayers: (flags) =>
    set(s => ({ instrumentLayers: { ...s.instrumentLayers, ...flags } })),
  cameraPreset: 'ISO_45',
  setCameraViewport: (preset) => set({ cameraPreset: preset }),

  /* ── Point-probe ────────────────────────────────────────── */
  pointProbe: {
    id: 'TP-09',
    siteName: 'Mt. Rainier Flank',
    coordinates: [46.85, 121.76],
    elevation: 1428,
    verticalDriftRate: 3.8,
    raycastCoords: { x: 0.5, y: 0.5 },
  },
  setPointProbe: (result) => set({ pointProbe: result }),

  /* ── Inverse displacement ───────────────────────────────── */
  isInverseRunning: false,
  executeInverseDisplacement: () => {
    set({ isInverseRunning: true });
    // Simulate a 2s computation
    setTimeout(() => set({ isInverseRunning: false }), 2200);
  },

  /* ── Legacy UI / Map ────────────────────────────────────── */
  baseLayer: 'dark',
  setBaseLayer: (layer) => set({ baseLayer: layer }),
  sidebarOpen: true,
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  compareMode: false,
  toggleCompareMode: () => set(s => ({ compareMode: !s.compareMode })),
  
  /* ── Jump to coordinates ────────────────────────────────── */
  flyToCoords: null,
  setFlyToCoords: (coords) => set({ flyToCoords: coords }),

  /* ── Global Event Selection ─────────────────────────────── */
  selectedGlobalEvent: null,
  setSelectedGlobalEvent: (evt) => set({ selectedGlobalEvent: evt }),
}));
