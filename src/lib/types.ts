/**
 * ============================================================
 * NISAR SAR/InSAR Geospatial Telemetry Platform – Core Types
 * ============================================================
 * Unified data contract for all visual components & the
 * centralized Zustand store.  Replacing mock data with real
 * NISAR HDF5 / GeoTIFF feeds only requires conforming here.
 * ============================================================
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

/* ── View / Navigation Modes ────────────────────────────────── */
export type ViewMode = 'GLOBAL_SCHEMATIC' | 'EVENT_RADAR_2D' | 'TOPO_CORE_3D';

/* ── Target deformation classification ─────────────────────── */
export type TargetCategory = 'TECTONIC' | 'CRYOSPHERE' | 'VOLCANIC' | 'BIOMASS';

/* ── Legacy category (kept for mock data compatibility) ─────── */
export type NISARCategory = 'wildfire' | 'glacier' | 'earthquake' | 'agriculture';

/* ── SAR Band identifiers ───────────────────────────────────── */
export type SARBand = 'L-BAND' | 'S-BAND';
export type BandStatus = 'NOMINAL' | 'ACQUIRING' | 'STANDBY' | 'ERROR';

/* ── Phase processing mode ──────────────────────────────────── */
export type PhaseFilterMode = 'RAW' | 'FILTERED';

/* ── Polarisation states ────────────────────────────────────── */
export type PolVar = 'HH' | 'HV' | 'VH' | 'VV';

/* ── Camera viewport presets ───────────────────────────────── */
export type CameraPreset = 'ISO_45' | 'NADIR_90' | 'OBLIQUE_15';

/* ── Instrument layer flags ─────────────────────────────────── */
export interface InstrumentLayers {
  wireframe: boolean;
  phaseFringe: boolean;
  coherenceMask: boolean;
}

/* ── Global target node (for GLOBAL_SCHEMATIC matrix) ────────── */
export interface TargetNode {
  id: string;                        // e.g. "TC-89"
  label: string;                     // e.g. "SAN ANDREAS"
  category: TargetCategory;
  coords: [number, number];          // [lng, lat]
  deformationVelocity: number;       // mm/yr
  coherence: number;                 // γ 0–1
  status: 'ELEVATED' | 'NOMINAL' | 'CRITICAL';
  description: string;
  locationDetail: string;            // e.g. "35.7° N, 120.3° W // CARRIZO PLAIN"
  fringe: string;                    // e.g. "20.4mm repeat displacement"
}

/* ── Orbit pass epoch ───────────────────────────────────────── */
export interface PassEpoch {
  index: number;     // 1-based pass number
  label: string;     // "PASS 01"
  date: string;      // ISO-8601
  accumDisplacement: number;   // mm cumulative from P01
  residualError: number;       // ±mm
}

/* ── Point-probe telemetry result ───────────────────────────── */
export interface PointProbeResult {
  id: string;                        // e.g. "TP-09"
  siteName: string;                  // e.g. "Mt. Rainier Flank"
  coordinates: [number, number];     // [lat, lng] display form
  elevation: number;                 // metres
  verticalDriftRate: number;         // mm/yr
  raycastCoords: { x: number; y: number };
}

/* ── Satellite telemetry constants ──────────────────────────── */
export interface SatelliteTelemetry {
  altitude: number;    // km
  inclination: number; // degrees
  swath: number;       // km
  downlink: number;    // Gbps
  podStatus: 'NOMINAL' | 'DEGRADED' | 'ERROR';
}

/* ── Single data point (kept for unified data queries) ──────── */
export interface NISARDataPoint {
  id: string;
  timestamp: string;
  category: NISARCategory;
  coordinates: [number, number];
  metricName: string;
  metricValue: number;
  geoJsonGeometry: Geometry;
}

/* ── Time-series collection ─────────────────────────────────── */
export interface NISARTimeSeries {
  timestamps: string[];
  values: number[];
  metricName: string;
  unit: string;
}

/* ── Scenario / Event metadata ──────────────────────────────── */
export interface NISARScenario {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: NISARCategory;
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  timeRange: { start: string; end: string };
  timeSeries: NISARTimeSeries;
  features: FeatureCollection;
  educationalContent: {
    headline: string;
    body: string;
    funFact: string;
  };
}

/* ── Centralized store state ────────────────────────────────── */
export interface AppState {
  // Navigation
  viewMode: ViewMode;

  // Active target (persists across view switches)
  activeNodeId: string | null;
  activeScenarioId: string;

  // Temporal
  currentPassIndex: number;       // 0-based index into passes array
  isPlaying: boolean;
  playbackSpeed: 1 | 2 | 5;

  // Phase / signal processing
  phaseFilterMode: PhaseFilterMode;
  coherenceThreshold: number;     // 0–1, default 0.5
  activePolarisation: PolVar;
  activeband: SARBand;

  // 3D Morphometric
  zAxisExaggeration: number;      // 1.0–10.0, default 4.2
  cutawayElevation: number;       // metres datum offset
  instrumentLayers: InstrumentLayers;
  cameraPreset: CameraPreset;

  // Point-probe
  activePointProbe: PointProbeResult | null;

  // Target filter
  selectedTargetCategory: TargetCategory | 'ALL';

  // Legacy / Map
  baseLayer: 'satellite' | 'dark' | 'terrain';
  sidebarOpen: boolean;
  compareMode: boolean;
}

/* ── Map viewport ───────────────────────────────────────────── */
export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
}

/* ── Chart data point (for Recharts) ────────────────────────── */
export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}
