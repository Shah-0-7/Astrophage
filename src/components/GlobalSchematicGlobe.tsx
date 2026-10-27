/**
 * ============================================================
 * GlobalSchematicGlobe – GLOBAL SCHEMATIC View Mode (v2)
 * ============================================================
 * Three view modes:
 *   WIRES     – dark holographic sphere + lat/lon graticule
 *   TERRAIN   – shaded-relief globe with displacement map + relief slider
 *   SATELLITE – NASA Blue Marble true-colour + city lights toggle
 *
 * All modes share: event markers, pulse rings, plate boundary
 * lines, cause filter, NEAR ME, event side panel, auto-rotate.
 *
 * Mode switch: 400 ms dark-overlay crossfade (no camera reset,
 * no flicker).  Textures are lazy-loaded on first use, cached
 * module-level (no re-download on repeated switches), with a
 * 10 s timeout that falls back to bundled CDN textures.
 *
 * Keyboard shortcuts: 1 = WIRES, 2 = TERRAIN, 3 = SATELLITE.
 * Choice persisted to localStorage.
 *
 * Mobile: 2048 × 1024 textures, 96/128 sphere segments.
 * ============================================================
 */

'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState, Suspense, memo,
} from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Sphere, Line, Stars, Billboard } from '@react-three/drei';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
// (useStore not needed here – globe uses local selectedEvent state)
import {
  useGlobalEvents,
  type GlobalEvent,
  type EventType,
  type CauseFilter,
} from '@/lib/useGlobalEvents';
import type { SourceHealth } from '@/lib/globalEvents';
import { useTheme } from '@/lib/ThemeProvider';
import { WireGlobe } from '@/components/WireGlobe';
import { useWorldGeo } from '@/lib/useWorldGeo';
import { getTerraceTextures, loadWorldGeo, paintBasemap } from '@/lib/worldGeo';

// ── Globe view mode ───────────────────────────────────────────
export type GlobeViewMode = 'WIRES' | 'TERRAIN' | 'SATELLITE';

// ── Constants ─────────────────────────────────────────────────
const GLOBE_RADIUS   = 1.5;
const SEVEN_DAYS_MS  = 7 * 24 * 3600 * 1000;
const LS_MODE_KEY    = 'globe-view-mode-v1';

/** Extra radius each mode adds so markers float above the surface/displacement. */
const MARKER_ELEV: Record<GlobeViewMode, number> = {
  SATELLITE: 0.005,
  WIRES:     0.005,
  TERRAIN:   0.07,   // above max displacement (reliefScale 5 × 0.013 ≈ 0.065)
};

/** Displacement amplitude per unit of reliefScale.  Kept subtle by default. */
const DISP_PER_SCALE = 0.013;

// CDN texture URLs – always available as fallback
// NOTE: CDN_DAY has proper ocean colour (used as fallback if GIBS is unavailable)
const CDN_DAY      = 'https://unpkg.com/three-globe/example/img/earth-day.jpg';
const CDN_NIGHT    = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
const CDN_TOPO     = 'https://unpkg.com/three-globe/example/img/earth-topology.png';

// ── Texture bundle ─────────────────────────────────────────────
interface TexBundle {
  color: THREE.Texture | null;
  bump:  THREE.Texture | null;
  disp:  THREE.Texture | null;
  emit:  THREE.Texture | null;   // city-lights emissive overlay
}
const EMPTY_BUNDLE: TexBundle = { color: null, bump: null, disp: null, emit: null };

// ── Module-level texture cache (survives component re-mounts) ──
const TEX_CACHE  = new Map<string, THREE.Texture>();
const TEX_INFLIGHT = new Map<string, Promise<THREE.Texture | null>>();

function applyTexProps(t: THREE.Texture, isBump = false): THREE.Texture {
  if (!isBump) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS  = t.wrapT = THREE.ClampToEdgeWrapping;
  // High anisotropy + linear filters → sharp detail at oblique angles / zoom
  t.anisotropy    = 16;
  t.minFilter     = THREE.LinearMipmapLinearFilter;
  t.magFilter     = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate   = true;
  return t;
}

/** Load a texture with optional fallback and 10 s timeout. Caches results. */
function loadTex(primary: string, fallback?: string): Promise<THREE.Texture | null> {
  if (TEX_CACHE.has(primary)) return Promise.resolve(TEX_CACHE.get(primary)!);
  if (TEX_INFLIGHT.has(primary)) return TEX_INFLIGHT.get(primary)!;

  const isBump = primary.includes('topology');

  const p = new Promise<THREE.Texture | null>((resolve) => {
    const loader = new THREE.TextureLoader();

    const tryFallback = () => {
      if (!fallback) { resolve(null); return; }
      if (TEX_CACHE.has(fallback)) { resolve(TEX_CACHE.get(fallback)!); return; }
      loader.load(
        fallback,
        (t) => { applyTexProps(t, isBump); TEX_CACHE.set(fallback, t); TEX_CACHE.set(primary, t); resolve(t); },
        undefined,
        () => resolve(null),
      );
    };

    const timer = setTimeout(tryFallback, 10_000);
    loader.load(
      primary,
      (t) => { clearTimeout(timer); applyTexProps(t, isBump); TEX_CACHE.set(primary, t); resolve(t); },
      undefined,
      () => { clearTimeout(timer); tryFallback(); },
    );
  });

  TEX_INFLIGHT.set(primary, p);
  p.finally(() => TEX_INFLIGHT.delete(primary));
  return p;
}

// ── Event type config ─────────────────────────────────────────
interface TypeConfig { color: string; label: string; icon: string; }

const TYPE_CONFIG: Record<EventType, TypeConfig> = {
  tectonic:           { color: '#ef4444', label: 'Tectonic',          icon: '⊕' },
  volcanic:           { color: '#fb923c', label: 'Volcanic',           icon: '△' },
  landslide:          { color: '#a78bfa', label: 'Landslide',          icon: '▽' },
  cryosphere:         { color: '#60a5fa', label: 'Cryosphere',         icon: '❄' },
  subsidence:         { color: '#34d399', label: 'Subsidence',         icon: '↓' },
  mining:             { color: '#fbbf24', label: 'Mining',             icon: '⬡' },
  induced_seismicity: { color: '#f472b6', label: 'Induced Seismicity', icon: '⚡' },
  tsunami:            { color: '#22d3ee', label: 'Tsunami',            icon: '〜' },
  storm:              { color: '#38bdf8', label: 'Tropical Cyclone',    icon: '🌀' },
};

// ── Shared helpers ────────────────────────────────────────────
function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  // Guard against NaN/string values that could crash Three.js math
  const safeLat = isFinite(lat) ? Math.max(-90,  Math.min(90,  lat)) : 0;
  const safeLon = isFinite(lon) ? Math.max(-180, Math.min(180, lon)) : 0;
  const phi   = (90 - safeLat) * (Math.PI / 180);
  const theta = (safeLon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta),
  );
}

function markerSize(ev: GlobalEvent): number {
  const mag = isFinite(Number(ev.magnitude)) ? Number(ev.magnitude) : 0;
  return Math.max(0.008, Math.min(0.04, 0.008 + mag * 0.004));
}

function isRecent(ev: GlobalEvent): boolean {
  return Date.now() - ev.time < SEVEN_DAYS_MS;
}

// ── useGlobeViewMode ──────────────────────────────────────────
function useGlobeViewMode(): [GlobeViewMode, (m: GlobeViewMode) => void] {
  const [mode, _setMode] = useState<GlobeViewMode>(() => {
    if (typeof window === 'undefined') return 'SATELLITE';
    const saved = localStorage.getItem(LS_MODE_KEY) as GlobeViewMode | null;
    return saved && ['WIRES', 'TERRAIN', 'SATELLITE'].includes(saved)
      ? saved : 'SATELLITE';
  });

  const setMode = useCallback((m: GlobeViewMode) => {
    _setMode(m);
    try { localStorage.setItem(LS_MODE_KEY, m); } catch { /* SSR / private */ }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === '1') setMode('WIRES');
      else if (e.key === '2') setMode('TERRAIN');
      else if (e.key === '3') setMode('SATELLITE');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode]);

  return [mode, setMode];
}

// ── useGlobeTextures ──────────────────────────────────────────
/**
 * Lazily loads the texture bundle for a given mode.
 * Results are kept in module-level TEX_CACHE so switching back
 * to a previous mode is instant.
 */
function useGlobeTextures(mode: GlobeViewMode): { textures: TexBundle; loading: boolean } {
  const [textures, setTextures] = useState<TexBundle>(EMPTY_BUNDLE);
  const [loading,  setLoading]  = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    setLoading(true);

    let p: Promise<TexBundle>;

    if (mode === 'WIRES') {
      // Drawn entirely from bundled geometry (WireGlobe) – no remote textures
      p = Promise.resolve(EMPTY_BUNDLE);

    } else if (mode === 'SATELLITE') {
      p = Promise.all([
        loadTex('/api/globe-texture?layer=satellite', CDN_DAY),
        loadTex(CDN_NIGHT),          // city-lights emissive
      ]).then(([color, emit]) => ({ color, bump: null, disp: null, emit }));

    } else {
      // TERRAIN
      p = Promise.all([
        loadTex('/api/globe-texture?layer=terrain', CDN_TOPO),
        loadTex(CDN_TOPO),           // heightmap (bump + displacement)
      ]).then(([color, bump]) => ({ color, bump, disp: bump, emit: null }));
    }

    p.then(bundle => {
      if (!mountedRef.current) return;
      setTextures(bundle);
      setLoading(false);
    });
  }, [mode]);

  return { textures, loading };
}

// ── GraticuleLines (WIRES mode) ───────────────────────────────
const GraticuleLines = memo(function GraticuleLines({ isLight }: { isLight?: boolean }) {
  const lines = useMemo(() => {
    const result: { pts: THREE.Vector3[]; main: boolean }[] = [];
    const R   = GLOBE_RADIUS + 0.003;
    const SEG = 72;

    // Latitude lines every 15° (skip poles)
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= SEG; i++) pts.push(latLonToVec3(lat, -180 + 360 * i / SEG, R));
      result.push({ pts, main: lat === 0 });
    }

    // Longitude lines every 15°
    for (let lon = -180; lon < 180; lon += 15) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= SEG; i++) pts.push(latLonToVec3(-90 + 180 * i / SEG, lon, R));
      result.push({ pts, main: lon === 0 });
    }

    return result;
  }, []);

  const mainColor = isLight ? '#A68763' : '#b9c9dc';
  const subColor  = isLight ? '#DCD7CE' : '#7d8ea3';

  return (
    <>
      {lines.map((l, i) => (
        <Line
          key={i}
          points={l.pts}
          color={l.main ? mainColor : subColor}
          lineWidth={l.main ? 0.7 : 0.3}
          transparent
          opacity={l.main ? 0.4 : 0.15}
        />
      ))}
    </>
  );
});

function EventMarker({
  event, isSelected, onClick, elevationOffset,
}: {
  event: GlobalEvent;
  isSelected: boolean;
  onClick: (ev: GlobalEvent, e: ThreeEvent<MouseEvent>) => void;
  elevationOffset: number;
}) {
  const cfg    = TYPE_CONFIG[event.type];
  const color  = new THREE.Color(cfg.color);
  const pos    = latLonToVec3(event.lat, event.lon, GLOBE_RADIUS + elevationOffset);
  const size   = markerSize(event);
  const recent = isRecent(event);
  const pulseRef = useRef<THREE.Mesh>(null);
  const tRef     = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    if (!pulseRef.current) return;
    tRef.current += delta * 1.5;
    const s = 1 + Math.sin(tRef.current) * 0.35;
    pulseRef.current.scale.setScalar(s);
    (pulseRef.current.material as THREE.MeshBasicMaterial).opacity =
      0.5 - Math.sin(tRef.current) * 0.3;
  });

  return (
    <group position={pos}>
      {/* Animated pulse ring – smooth ring geometry, only for recent events */}
      {recent && (
        <Billboard>
          <mesh ref={pulseRef}>
            {/* ringGeometry(innerR, outerR, segments) – always a perfect circle */}
            <ringGeometry args={[size * 1.7, size * 2.6, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </Billboard>
      )}

      {/* Soft additive glow halo – makes marker visible against any terrain */}
      <Billboard>
        <mesh>
          <circleGeometry args={[size * 2.0, 48]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={isSelected ? 0.35 : (recent ? 0.20 : 0.08)}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </Billboard>

      {/* Main marker dot – always circular billboard */}
      <Billboard>
        <mesh
          onClick={(e) => { e.stopPropagation(); onClick(event, e); }}
          onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
          <circleGeometry args={[size, 48]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </Billboard>

      {/* Selection ring */}
      {isSelected && (
        <Billboard>
          <mesh>
            <ringGeometry args={[size * 1.9, size * 3.2, 64]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.75}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}

// ── FaultLines ────────────────────────────────────────────────
function FaultLines({
  data, elevationOffset, isLight,
}: {
  data: object | null;
  elevationOffset: number;
  isLight?: boolean;
}) {
  const lines = useMemo(() => {
    if (!data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = data as any;
    const result: THREE.Vector3[][] = [];
    const R = GLOBE_RADIUS + elevationOffset + 0.002;
    for (const feat of fc.features ?? []) {
      if (feat.geometry?.type === 'LineString') {
        const pts = feat.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => latLonToVec3(lat, lng, R));
        if (pts.length >= 2) result.push(pts);
      } else if (feat.geometry?.type === 'MultiLineString') {
        for (const line of feat.geometry.coordinates) {
          const pts = line.map(([lng, lat]: [number, number]) => latLonToVec3(lat, lng, R));
          if (pts.length >= 2) result.push(pts);
        }
      }
    }
    return result;
  }, [data, elevationOffset]);

  const faultColor = isLight ? '#C0392B' : '#ef4444';

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color={faultColor} lineWidth={0.5} transparent opacity={0.35} />
      ))}
    </>
  );
}

// ── Tile coordinate helpers (GIBS 500m TileMatrixSet) ─────────
/**
 * GIBS EPSG:4326 "500m" TileMatrixSet grid dimensions:
 *   tilesX(z) = 2^z + 1      (e.g. z=2 → 5 columns)
 *   tilesY(z) = ceil(tilesX / 2)  (e.g. z=2 → 3 rows)
 * Each tile is 512×512 px covering equal degrees.
 */
function gibs500mGrid(z: number): { tilesX: number; tilesY: number; degPerTileX: number; degPerTileY: number } {
  const tilesX     = Math.pow(2, z) + 1;
  const tilesY     = Math.ceil(tilesX / 2);
  const degPerTileX = 360 / tilesX;
  const degPerTileY = 180 / tilesY;
  return { tilesX, tilesY, degPerTileX, degPerTileY };
}

/** Convert lon/lat to GIBS 500m tile x,y at zoom z. */
function lonLatToTileXY(lon: number, lat: number, z: number) {
  const { tilesX, tilesY, degPerTileX, degPerTileY } = gibs500mGrid(z);
  const x = Math.floor((lon + 180) / degPerTileX);
  const y = Math.floor((90 - lat) / degPerTileY);
  return {
    x: Math.max(0, Math.min(x, tilesX - 1)),
    y: Math.max(0, Math.min(y, tilesY - 1)),
  };
}

/**
 * Given camera distance, returns the ideal WMTS zoom level.
 * At GLOBE_RADIUS*6 (far out) → z=0, at GLOBE_RADIUS*1.3 (close) → z=5
 */
function distanceToZoom(dist: number): number {
  const far  = GLOBE_RADIUS * 6.0;
  const near = GLOBE_RADIUS * 1.3;
  const t = 1 - Math.max(0, Math.min(1, (dist - near) / (far - near)));
  // Non-linear ramp: stays coarse until camera is really close
  return Math.round(t * t * 5);
}


// ── useTiledGlobeTexture ──────────────────────────────────────
/**
 * Creates and maintains a CanvasTexture that starts from the base WMS
 * flat image and progressively paints higher-res WMTS tiles on top as
 * the camera zooms in.  Returns a stable texture ref that the material
 * can use directly.
 *
 * Tile layout: GIBS EPSG:4326 GoogleMapsCompatible
 *   zoom z  →  2^(z+1) × 2^z  tiles (each 256×256 px)
 *   Full canvas: 512×256 at z=0, 4096×2048 at z=3, …
 */
const CANVAS_W = 4096;
const CANVAS_H = 2048;
// Track which tiles have already been painted so we don't re-fetch.
const PAINTED_TILES = new Set<string>();

/** Return type from useTiledGlobeTexture */
interface TiledTexResult {
  tex:       THREE.CanvasTexture | null;
  loadTiles: ((lat: number, lon: number, z: number) => void) | null;
}

function useTiledGlobeTexture(
  baseTexture: THREE.Texture | null,
  layer: string,
  enabled: boolean,
): TiledTexResult {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const ctxRef      = useRef<CanvasRenderingContext2D | null>(null);
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  const baseReady   = useRef(false);

  // Initialise canvas + CanvasTexture once when enabled
  useEffect(() => {
    if (!enabled) return;
    const canvas = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#05304a'; // deep-ocean colour until the bundled basemap is ready
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    canvasRef.current = canvas;
    ctxRef.current    = ctx;

    const newTex = new THREE.CanvasTexture(canvas);
    applyTexProps(newTex);
    setTex(newTex);

    // Bundled basemap underneath: if NASA imagery is slow or unreachable the globe still shows geography.
    let alive = true;
    loadWorldGeo().then(geo => {
      if (!alive || baseReady.current) return;
      paintBasemap(ctx, geo, CANVAS_W, CANVAS_H);
      newTex.needsUpdate = true;
    }).catch(() => { /* keep the flat colour */ });

    return () => {
      alive = false;
      newTex.dispose();
      setTex(null);
      canvasRef.current = null;
      ctxRef.current    = null;
      baseReady.current = false;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paint base WMS texture onto canvas when available
  useEffect(() => {
    if (!enabled || !baseTexture || !ctxRef.current || baseReady.current) return;
    const img = baseTexture.image as HTMLImageElement | ImageBitmap;
    if (!img) return;
    try {
      ctxRef.current.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      baseReady.current = true;
      if (tex) { tex.needsUpdate = true; }
    } catch { /* cross-origin – skip */ }
  }, [baseTexture, enabled, tex]);

  /** Called by TileTextureUpdater when a new zoom level is reached. */
  const loadTiles = useCallback((
    cameraLat: number, cameraLon: number, z: number,
  ) => {
    if (!enabled || !canvasRef.current || !ctxRef.current) return;
    if (!baseReady.current) return; // base must be painted first
    // Clamp to GIBS 500m max zoom
    const safeZ = Math.min(z, 5);
    const { tilesX, tilesY } = gibs500mGrid(safeZ);

    // Determine which tiles are within a radius of the camera look-at point
    const centre = lonLatToTileXY(cameraLon, cameraLat, safeZ);
    const RADIUS = Math.max(1, 3 - safeZ); // fewer tiles at high zoom

    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS * 2; dx <= RADIUS * 2; dx++) {
        const tx = Math.max(0, Math.min(centre.x + dx, tilesX - 1));
        const ty = Math.max(0, Math.min(centre.y + dy, tilesY - 1));
        const key = `${layer}/${safeZ}/${tx}/${ty}`;
        if (PAINTED_TILES.has(key)) continue;
        PAINTED_TILES.add(key);

        const url = `/api/globe-texture/tile?layer=${layer}&z=${safeZ}&x=${tx}&y=${ty}`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!ctxRef.current || !canvasRef.current) return;

          // Derive the tile's geographic extent and map directly to canvas pixels.
          // Using geo-coords (not tile indices) ensures cross-zoom alignment:
          // both z=2 and z=3 tiles use the same lon/lat → pixel formula so they
          // always land at the correct position regardless of non-integer tile widths.
          const { degPerTileX, degPerTileY } = gibs500mGrid(safeZ);
          const lonStart = -180 + tx * degPerTileX;
          const latStart =   90 - ty * degPerTileY; // lat decreases top→bottom
          const lonEnd   = lonStart + degPerTileX;
          const latEnd   = latStart - degPerTileY;

          // Round start/end independently so adjacent tiles are always contiguous
          const x0 = Math.round((lonStart + 180) / 360 * CANVAS_W);
          const y0 = Math.round((90 - latStart)  / 180 * CANVAS_H);
          const x1 = Math.round((lonEnd   + 180) / 360 * CANVAS_W);
          const y1 = Math.round((90 - latEnd)    / 180 * CANVAS_H);
          const tw = Math.max(1, x1 - x0);
          const th = Math.max(1, y1 - y0);

          ctxRef.current.imageSmoothingEnabled = true;
          ctxRef.current.imageSmoothingQuality = 'high';
          ctxRef.current.drawImage(img, x0, y0, tw, th);

          // Signal Three.js to re-upload the texture
          const canvasTex = (canvasRef.current as HTMLCanvasElement & { __tex?: THREE.CanvasTexture }).__tex;
          if (canvasTex) canvasTex.needsUpdate = true;
        };
        img.src = url;
      }
    }
  }, [enabled, layer]); // eslint-disable-line react-hooks/exhaustive-deps

  // Store texture ref on the canvas element so the img.onload can find it
  useEffect(() => {
    if (canvasRef.current && tex) {
      (canvasRef.current as HTMLCanvasElement & { __tex?: THREE.CanvasTexture }).__tex = tex;
    }
  }, [tex]);

  return { tex, loadTiles: enabled ? loadTiles : null };
}

function TileTextureUpdater({
  enabled, loadTiles,
}: {
  enabled: boolean;
  loadTiles: ((lat: number, lon: number, z: number) => void) | null;
}) {
  const { camera } = useThree();
  const lastZRef   = useRef(-1);
  const lastLatRef = useRef(0);
  const lastLonRef = useRef(0);

  useFrame(() => {
    if (!enabled || !loadTiles) return;
    const dist = camera.position.length();
    const z    = distanceToZoom(dist);

    // Convert camera direction to lat/lon
    const dir = camera.position.clone().negate().normalize();
    const lat = Math.asin(dir.y) * (180 / Math.PI);
    const lon = Math.atan2(dir.z, -dir.x) * (180 / Math.PI);

    const zChanged   = z !== lastZRef.current;
    // Trigger on pan only when we've moved far enough to enter new tiles (~15°)
    const PAN_THRESH = 15;
    const panMoved   =
      Math.abs(lat - lastLatRef.current) > PAN_THRESH ||
      Math.abs(lon - lastLonRef.current) > PAN_THRESH;

    if (!zChanged && !panMoved) return;

    lastZRef.current   = z;
    lastLatRef.current = lat;
    lastLonRef.current = lon;
    loadTiles(lat, lon, z);
  });

  return null;
}

// ── GlobeMesh (single sphere for one mode) ────────────────────
function GlobeMesh({
  mode, textures, reliefScale, showCityLights, isMobile, tiledSatTex, isLight,
}: {
  mode: GlobeViewMode;
  textures: TexBundle;
  reliefScale: number;
  showCityLights: boolean;
  isMobile: boolean;
  tiledSatTex: THREE.CanvasTexture | null;
  isLight?: boolean;
}) {
  const segs = isMobile
    ? (mode === 'TERRAIN' ? 128 : 96)
    : (mode === 'TERRAIN' ? 192 : 128);

  const dispScale = mode === 'TERRAIN' ? DISP_PER_SCALE * reliefScale : 0;
  const atmoColor = mode === 'WIRES'
    ? '#8fb8ff'
    : (isLight ? '#B8A489' : '#1a6fff');
  const atmoOpacity = mode === 'WIRES' ? 0.05 : 0.07;
  const worldGeo = useWorldGeo();
  const terraceFallback = useMemo(
    () => (mode === 'TERRAIN' && worldGeo ? getTerraceTextures(worldGeo) : null),
    [mode, worldGeo],
  );

  // For SATELLITE mode: prefer the progressively-tiled CanvasTexture;
  // fall back to base WMS texture if tiled system isn't ready yet.
  const satMap = (tiledSatTex ?? textures.color) ?? undefined;

  return (
    <>
      {/* ── Main globe sphere ── */}
      {mode === 'WIRES' ? (
        // Terraced land, glowing borders, land network, limb glow, satellite – all bundled geometry
        <WireGlobe radius={GLOBE_RADIUS} />
      ) : (
        <Sphere args={[GLOBE_RADIUS, segs, segs]}>
          {mode === 'SATELLITE' ? (
            // meshBasicMaterial → colour is NEVER dimmed by scene lights;
            // the texture is shown at 100 % of its original colours.
            // City lights are composited as an additive emissive overlay.
            <meshBasicMaterial map={satMap} />
          ) : (
            /* TERRAIN – PBR so shading shows relief. Falls back to bundled terraces if imagery is unreachable. */
            <meshStandardMaterial
              key={`${textures.color ? 'img' : 'x'}-${terraceFallback ? 'fb' : 'x'}`}
              map={textures.color ?? terraceFallback?.color ?? undefined}
              bumpMap={textures.bump ?? terraceFallback?.bump ?? undefined}
              bumpScale={textures.bump ? 0.06 : 2.2}
              displacementMap={textures.disp ?? undefined}
              displacementScale={dispScale}
              roughness={0.65}
              metalness={0.0}
            />
          )}
        </Sphere>
      )}

      {/* ── Satellite city-lights emissive overlay ── */}
      {mode === 'SATELLITE' && showCityLights && textures.emit && (
        <Sphere args={[GLOBE_RADIUS + 0.001, segs, segs]}>
          <meshBasicMaterial
            map={textures.emit}
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </Sphere>
      )}

      {/* ── Atmospheric glow halo ── */}
      <Sphere args={[GLOBE_RADIUS * 1.04, 32, 32]}>
        <meshBasicMaterial
          color={atmoColor}
          transparent
          opacity={atmoOpacity}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </Sphere>
    </>
  );
}

// ── FlyToTarget ───────────────────────────────────────────────
// Handles flying the camera to a lat/lon target without
// conflicting with OrbitControls (which manages auto-rotation natively).
function FlyToTarget({
  flyTo,
  controlsRef,
}: {
  flyTo: [number, number] | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const lastFlyTo = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!flyTo || flyTo === lastFlyTo.current) return;
    lastFlyTo.current = flyTo;
    const target = latLonToVec3(flyTo[0], flyTo[1], GLOBE_RADIUS);
    camera.position.copy(target.clone().normalize().multiplyScalar(GLOBE_RADIUS * 2.2));
    camera.lookAt(0, 0, 0);
    // Sync OrbitControls internal state so zoom/pan remain coherent
    if (controlsRef.current) {
      controlsRef.current.update();
    }
  }, [flyTo, camera, controlsRef]);

  return null;
}

// ── GlobeScene ─────────────────────────────────────────────────
interface SceneProps {
  events:          GlobalEvent[];
  faultLines:      object | null;
  showFaultLines:  boolean;
  selectedEvent:   GlobalEvent | null;
  onSelectEvent:   (ev: GlobalEvent | null) => void;
  flyTo:           [number, number] | null;
  viewMode:        GlobeViewMode;
  textures:        TexBundle;
  reliefScale:     number;
  showCityLights:  boolean;
  isMobile:        boolean;
  /** Progressive tiled satellite texture for meshBasicMaterial (null = use base WMS texture) */
  tiledSatTex:     THREE.CanvasTexture | null;
  /** Tile-load callback from useTiledGlobeTexture (null when not in SATELLITE mode) */
  tiledLoadTiles:  ((lat: number, lon: number, z: number) => void) | null;
  isLight?:        boolean;
}

function GlobeScene({
  events, faultLines, showFaultLines, selectedEvent, onSelectEvent, flyTo,
  viewMode, textures, reliefScale, showCityLights, isMobile, tiledSatTex, tiledLoadTiles,
  isLight,
}: SceneProps) {
  const [isInteracting, setIsInteracting] = useState(false);
  const idleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef  = useRef<OrbitControlsImpl | null>(null);
  const elevOffset   = MARKER_ELEV[viewMode];

  const handleInteract = useCallback(() => {
    setIsInteracting(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIsInteracting(false), 3500);
  }, []);

  return (
    <>
      {/* ── Starfield background ── */}
      {!isLight && (
        <Stars
          radius={100}
          depth={50}
          count={5000}
          factor={4}
          saturation={0}
          fade
          speed={0.3}
        />
      )}

      {/* ── Lighting ── */}
      {/* SATELLITE uses meshBasicMaterial so lights don't affect it.
          TERRAIN/WIRES use PBR so we need generous light. */}
      {viewMode === 'WIRES' ? (
        <>
          {/* low ambient + one raking light so the terrace lips catch highlights */}
          <ambientLight intensity={0.55} />
          <directionalLight position={[-4, 5, 6]} intensity={2.6} color="#ffffff" />
          <directionalLight position={[5, -2, 3]} intensity={0.5} color="#9db8e8" />
        </>
      ) : (
        <>
          <ambientLight intensity={viewMode === 'TERRAIN' ? 1.8 : 1.4} />
          <directionalLight
            position={[5, 3, 5]}
            intensity={viewMode === 'TERRAIN' ? 3.0 : 2.4}
            color="#ffffff"
          />
          {/* Soft fill from opposite side to lift shadow regions */}
          <directionalLight position={[-4, -2, -4]} intensity={0.8} color="#c8d8ff" />
          <directionalLight position={[0, 5, -5]} intensity={0.5} color="#ffffff" />
        </>
      )}

      {/* ── Globe sphere ── */}
      <GlobeMesh
        mode={viewMode}
        textures={textures}
        reliefScale={reliefScale}
        showCityLights={showCityLights}
        isMobile={isMobile}
        tiledSatTex={tiledSatTex}
        isLight={isLight}
      />

      {/* ── Progressive tile updater (SATELLITE only) ── */}
      <TileTextureUpdater
        enabled={viewMode === 'SATELLITE'}
        loadTiles={tiledLoadTiles}
      />

      {/* ── Graticule (WIRES only) ── */}
      {viewMode === 'WIRES' && <GraticuleLines isLight={isLight} />}

      {/* ── Tectonic plate boundaries ── */}
      {showFaultLines && <FaultLines data={faultLines} elevationOffset={elevOffset} isLight={isLight} />}

      {/* ── Event markers ── */}
      {events.map(ev => (
        <EventMarker
          key={ev.id}
          event={ev}
          isSelected={selectedEvent?.id === ev.id}
          onClick={(event) => { onSelectEvent(event); }}
          elevationOffset={elevOffset}
        />
      ))}

      {/* OrbitControls with native autoRotate to avoid camera state conflicts */}
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={GLOBE_RADIUS * 1.3}
        maxDistance={GLOBE_RADIUS * 6}
        // Prevent camera from orbiting under the globe (south pole flip)
        // 0.1 = can't flip over north pole, 0.88*PI ≈ 158° = good southern coverage without going underneath
        minPolarAngle={Math.PI * 0.05}
        maxPolarAngle={Math.PI * 0.88}
        autoRotate={!isInteracting}
        autoRotateSpeed={0.5}
        onStart={handleInteract}
        onChange={handleInteract}
        dampingFactor={0.08}
        enableDamping
        rotateSpeed={0.5}
        zoomSpeed={0.7}
      />

      <FlyToTarget flyTo={flyTo} controlsRef={controlsRef} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// UI COMPONENTS (2-D overlays)
// ══════════════════════════════════════════════════════════════

// ── SourceBadge ───────────────────────────────────────────────
function SourceBadge({ health }: { health: SourceHealth }) {
  const color =
    health.status === 'ok'     ? '#4ade80' :
    health.status === 'error'  ? '#ef4444' :
    health.status === 'cached' ? '#facc15' : '#94a3b8';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
           style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
      <span className="font-mono text-[9px] text-white/50 uppercase tracking-wider">
        {health.name}
      </span>
      {health.lastUpdated && (
        <span className="font-mono text-[8px] text-white/25">
          {health.lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}

// ── Event side panel ──────────────────────────────────────────
function EventPanel({
  event, onClose,
}: { event: GlobalEvent; onClose: () => void }) {
  const cfg      = TYPE_CONFIG[event.type];
  const date     = new Date(event.time);
  const isNatural = event.cause === 'natural';

  return (
    <motion.div
      key={event.id}
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="event-side-panel absolute top-0 right-0 bottom-0 z-30 flex flex-col overflow-y-auto"
      style={{
        width: 'clamp(280px, 30vw, 360px)',
        background: 'var(--bg-drawer)',
        borderLeft: '1px solid var(--border-zinc)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <div className="p-4 border-b flex-shrink-0" style={{ borderBottomColor: `${cfg.color}22` }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base" style={{ color: cfg.color }}>{cfg.icon}</span>
            <span className="font-mono text-[10px] font-700 tracking-widest uppercase px-2 py-0.5 rounded-sm"
                  style={{ background: `${cfg.color}22`, border: `1px solid ${cfg.color}44`, color: cfg.color }}>
              {cfg.label}
            </span>
            <span className="font-mono text-[9px] font-600 tracking-wider uppercase px-2 py-0.5 rounded-sm"
                  style={{
                    background: isNatural ? 'rgba(96,165,250,0.12)' : 'rgba(251,191,36,0.12)',
                    border: `1px solid ${isNatural ? 'rgba(96,165,250,0.3)' : 'rgba(251,191,36,0.3)'}`,
                    color: isNatural ? '#60a5fa' : '#fbbf24',
                  }}>
              {isNatural ? 'NATURAL' : 'HUMAN-MADE'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors font-mono text-lg leading-none cursor-pointer ml-2"
          >
            ×
          </button>
        </div>
        <h3 className="font-mono text-[14px] font-700 text-[var(--text-primary)] leading-snug mt-1">{event.title}</h3>
        <p className="font-mono text-[10px] text-[var(--text-muted)] mt-1 tracking-wider">
          {date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="p-4 border-b border-[var(--border-glass)] flex-shrink-0">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="panel-label mb-1">MAGNITUDE</p>
            <p className="font-mono text-[22px] font-700 leading-none"
               style={{ color: event.magnitude ? cfg.color : 'var(--text-muted)' }}>
              {event.magnitude != null && isFinite(Number(event.magnitude))
                ? Number(event.magnitude).toFixed(1)
                : '—'}
            </p>
          </div>
          <div>
            <p className="panel-label mb-1">DEPTH (km)</p>
            <p className="font-mono text-[22px] font-700 text-[var(--text-primary)] leading-none">
              {event.depth != null && isFinite(Number(event.depth))
                ? Number(event.depth).toFixed(0)
                : '—'}
            </p>
          </div>
          <div>
            <p className="panel-label mb-1">LATITUDE</p>
            <p className="font-mono text-[13px] font-600 text-[var(--text-secondary)]">
              {isFinite(Number(event.lat))
                ? `${Number(event.lat).toFixed(3)}°${Number(event.lat) >= 0 ? 'N' : 'S'}`
                : '—'}
            </p>
          </div>
          <div>
            <p className="panel-label mb-1">LONGITUDE</p>
            <p className="font-mono text-[13px] font-600 text-[var(--text-secondary)]">
              {isFinite(Number(event.lon))
                ? `${Math.abs(Number(event.lon)).toFixed(3)}°${Number(event.lon) >= 0 ? 'E' : 'W'}`
                : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 border-b border-[var(--border-glass)] flex-shrink-0">
        <p className="panel-label mb-2">DATA SOURCES</p>
        <div className="flex flex-wrap gap-1.5">
          {event.sources.map(src => (
            <span key={src} className="font-mono text-[9px] px-2 py-0.5 rounded-sm"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border-zinc)', color: 'var(--text-secondary)' }}>
              {src}
            </span>
          ))}
        </div>
        <a href={event.source_url} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 mt-3 font-mono text-[10px] tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <span style={{ color: cfg.color }}>↗</span> ORIGINAL RECORD
        </a>
      </div>

      <div className="p-4 flex-shrink-0">
        <a href={`/events/${event.id}`}
           className="tac-btn w-full flex items-center justify-center gap-2"
           style={{ borderColor: `${cfg.color}44`, color: cfg.color }}>
          <span>⊕</span> VIEW FULL DETAIL
        </a>
        <p className="font-mono text-[8px] text-[var(--text-muted)] text-center mt-2 tracking-wider">
          Full analysis, related events &amp; enrichment
        </p>
      </div>

      {isRecent(event) && (
        <div className="px-4 py-2 flex-shrink-0 mt-auto border-t" style={{ borderTopColor: `${cfg.color}22` }}>
          <span className="font-mono text-[9px] font-700 tracking-widest uppercase" style={{ color: cfg.color }}>
            ● RECENT EVENT – within last 7 days
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ── ViewModeToggle [NEW] ─────────────────────────────────────
const VIEW_MODE_OPTIONS: { id: GlobeViewMode; label: string; key: string }[] = [
  { id: 'WIRES',     label: 'WIRES',  key: '1' },
  { id: 'TERRAIN',   label: 'TERR',   key: '2' },
  { id: 'SATELLITE', label: 'SAT',    key: '3' },
];

function ViewModeToggle({
  mode, setMode,
}: { mode: GlobeViewMode; setMode: (m: GlobeViewMode) => void }) {
  return (
    <div className="glass-panel rounded-sm" style={{ padding: 8 }}>
      <p className="panel-label mb-2">VIEW MODE</p>
      <div className="flex gap-1">
        {VIEW_MODE_OPTIONS.map(({ id, label, key }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            title={`${id} — keyboard shortcut [${key}]`}
            className={`tac-btn flex-1 flex-col items-center py-1.5 px-0 h-auto gap-0 ${mode === id ? 'active' : ''}`}
            style={{ fontSize: 8 }}
          >
            <span className="block">{label}</span>
            <span
              className="font-mono text-[7px] opacity-50"
              style={{ color: mode === id ? 'var(--crimson)' : 'var(--text-muted)' }}
            >
              [{key}]
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ReliefSlider [NEW] ────────────────────────────────────────
function ReliefSlider({
  value, onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="glass-panel rounded-sm" style={{ padding: 8 }}>
      <div className="flex items-center justify-between mb-2">
        <p className="panel-label">RELIEF SCALE</p>
        <span className="font-mono text-[10px] font-700" style={{ color: 'var(--crimson)' }}>
          {value.toFixed(1)}×
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={0.5}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="globe-relief-slider w-full"
        aria-label="Terrain relief vertical exaggeration"
      />
      <div className="flex justify-between mt-1">
        <span className="font-mono text-[7px] text-white/20">SUBTLE 1×</span>
        <span className="font-mono text-[7px] text-white/20">5× EXAG.</span>
      </div>
    </div>
  );
}

// ── LayerControl (extended) ────────────────────────────────────
interface LayerControlProps {
  showFaultLines:  boolean;
  toggleFaultLines: () => void;
  causeFilter:     CauseFilter;
  setCauseFilter:  (f: CauseFilter) => void;
  naturalCount:    number;
  humanCount:      number;
  totalCount:      number;
  onNearMe:        () => void;
  userLocation:    [number, number] | null;
  locationError:   string | null;
  loading:         boolean;
  viewMode:        GlobeViewMode;
  setViewMode:     (m: GlobeViewMode) => void;
  reliefScale:     number;
  setReliefScale:  (v: number) => void;
  showCityLights:  boolean;
  toggleCityLights: () => void;
}

function LayerControl({
  showFaultLines, toggleFaultLines,
  causeFilter, setCauseFilter,
  naturalCount, humanCount, totalCount,
  onNearMe, userLocation, locationError, loading,
  viewMode, setViewMode,
  reliefScale, setReliefScale,
  showCityLights, toggleCityLights,
}: LayerControlProps) {
  const CAUSE_OPTIONS: { id: CauseFilter; label: string; count: number }[] = [
    { id: 'all',     label: 'ALL',     count: totalCount   },
    { id: 'natural', label: 'NATURAL', count: naturalCount },
    { id: 'human',   label: 'HUMAN',   count: humanCount   },
  ];

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-2" style={{ maxWidth: 226 }}>
      {/* View mode toggle */}
      <ViewModeToggle mode={viewMode} setMode={setViewMode} />

      {/* Cause filter */}
      <div className="glass-panel rounded-sm" style={{ padding: 8 }}>
        <p className="panel-label mb-2">CAUSE FILTER</p>
        <div className="flex gap-1">
          {CAUSE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setCauseFilter(opt.id)}
              className={`tac-btn flex-1 flex flex-col items-center py-1.5 px-1 h-auto ${causeFilter === opt.id ? 'active' : ''}`}
              style={{ fontSize: 9, gap: 2 }}
            >
              <span>{opt.label}</span>
              {loading
                ? <span className="shimmer w-6 h-3 rounded" />
                : <span style={{ color: causeFilter === opt.id ? 'var(--crimson)' : 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>
                    {opt.count}
                  </span>
              }
            </button>
          ))}
        </div>
      </div>

      {/* Layers */}
      <div className="glass-panel rounded-sm" style={{ padding: 8 }}>
        <p className="panel-label mb-2">LAYERS</p>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={toggleFaultLines}
            className={`tac-btn w-full ${showFaultLines ? 'active' : ''}`}
            style={{ height: 28, fontSize: 9, gap: 6 }}
          >
            <div className="w-2.5 h-0.5 rounded"
                 style={{ background: showFaultLines ? 'rgba(239,68,68,0.8)' : 'var(--text-muted)' }} />
            TECTONIC PLATES
          </button>

          {viewMode === 'SATELLITE' && (
            <button
              onClick={toggleCityLights}
              className={`tac-btn w-full ${showCityLights ? 'active' : ''}`}
              style={{ height: 28, fontSize: 9, gap: 6 }}
            >
              <span style={{ color: showCityLights ? '#fbbf24' : 'var(--text-muted)' }}>✦</span>
              CITY LIGHTS
            </button>
          )}
        </div>
      </div>

      {/* Relief slider – TERRAIN only */}
      {viewMode === 'TERRAIN' && (
        <ReliefSlider value={reliefScale} onChange={setReliefScale} />
      )}

      {/* Near me */}
      <div className="glass-panel rounded-sm" style={{ padding: 8 }}>
        <button onClick={onNearMe} className="tac-btn w-full" style={{ height: 28, fontSize: 9 }}>
          <span>⊙</span>
          {userLocation ? 'NEAR ME ✓' : 'NEAR ME'}
        </button>
        {locationError && (
          <p className="font-mono text-[8px] text-red-400 mt-1.5 leading-tight">{locationError}</p>
        )}
      </div>
    </div>
  );
}

// ── NearbyPanel ───────────────────────────────────────────────
function NearbyPanel({
  events, onSelect,
}: {
  events: (GlobalEvent & { distanceKm: number })[];
  onSelect: (ev: GlobalEvent) => void;
}) {
  if (!events.length) return null;
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
      className="absolute bottom-0 left-0 right-0 z-20 glass"
      style={{ padding: '10px 12px', maxHeight: 160, overflowY: 'auto' }}
    >
      <p className="panel-label mb-2">⊙ NEAREST EVENTS TO YOUR LOCATION</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {events.map(ev => {
          const cfg = TYPE_CONFIG[ev.type];
          return (
            <button key={ev.id} onClick={() => onSelect(ev)}
                    className="flex-shrink-0 tac-btn flex-col items-start p-2 h-auto gap-0.5 text-left"
                    style={{ minWidth: 150, borderColor: `${cfg.color}33` }}>
              <span className="font-mono text-[10px] text-white/80 leading-tight">{ev.title.slice(0, 30)}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span style={{ color: cfg.color, fontSize: 9 }}>{cfg.label}</span>
                <span className="font-mono text-[8px] text-white/30">{ev.distanceKm.toFixed(0)} km</span>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Legend strip ──────────────────────────────────────────────
function LegendStrip() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 p-2"
         style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {(Object.entries(TYPE_CONFIG) as [EventType, TypeConfig][]).map(([type, cfg]) => (
        <div key={type} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full flex-shrink-0"
               style={{ background: cfg.color, boxShadow: `0 0 4px ${cfg.color}` }} />
          <span className="font-mono text-[8px] text-white/40 uppercase tracking-wider">{cfg.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <div className="w-4 h-0.5 flex-shrink-0" style={{ background: 'rgba(239,68,68,0.5)' }} />
        <span className="font-mono text-[8px] text-white/40 uppercase tracking-wider">Plate Boundary</span>
      </div>
    </div>
  );
}

// ── Source health strip ───────────────────────────────────────
function SourceHealthStrip({ health }: { health: SourceHealth[] }) {
  return (
    <div className="absolute top-3 right-3 z-20 glass-panel rounded-sm" style={{ padding: '8px 10px' }}>
      <p className="panel-label mb-1.5">SOURCE STATUS</p>
      <div className="flex flex-col gap-1">
        {health.map(h => <SourceBadge key={h.name} health={h} />)}
      </div>
    </div>
  );
}

// ── Data sources footer (updated with GIBS + ETOPO) ──────────
function DataSourcesFooter({ viewMode }: { viewMode: GlobeViewMode }) {
  const base = [
    { name: 'USGS',            url: 'https://earthquake.usgs.gov' },
    { name: 'NASA EONET',      url: 'https://eonet.gsfc.nasa.gov' },
    { name: 'Smithsonian GVP', url: 'https://volcano.si.edu' },
    { name: 'NASA COOLR',      url: 'https://gpm.nasa.gov/landslides/index.html' },
    { name: 'HiQuake',         url: 'https://inducedearthquakes.org' },
  ];

  const imagery = viewMode !== 'WIRES' ? [
    { name: 'Imagery: NASA GIBS / Blue Marble', url: 'https://earthdata.nasa.gov/engage/open-data-services-and-software/api/earthdata-search/gibs' },
  ] : [];

  const elev = viewMode === 'TERRAIN' ? [
    { name: 'Elevation: NASA ETOPO / USGS', url: 'https://www.gebco.net' },
  ] : [];

  const sources = [...base, ...imagery, ...elev];

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-x-4 gap-y-1 flex-wrap px-4 py-1"
      style={{ background: 'rgba(9,9,11,0.7)', borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <span className="font-mono text-[7px] text-white/20 tracking-widest uppercase">DATA SOURCES:</span>
      {sources.map(s => (
        <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
           className="font-mono text-[8px] text-white/30 hover:text-white/60 transition-colors tracking-wider">
          {s.name}
        </a>
      ))}
    </div>
  );
}

// ── Globe loading skeleton ────────────────────────────────────
function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-48 h-48">
          <div className="absolute inset-0 rounded-full shimmer opacity-20" />
          <div className="absolute inset-0 rounded-full border border-white/10"
               style={{ boxShadow: '0 0 40px rgba(239,68,68,0.1)' }} />
          <div className="absolute inset-4 rounded-full border border-white/05" />
          <div className="absolute inset-8 rounded-full border border-white/05" />
          <div className="absolute inset-0 rounded-full overflow-hidden opacity-30">
            <div className="radar-scan-line w-full h-[200%]" />
          </div>
        </div>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: 'var(--text-muted)' }}>
          INITIALIZING GLOBAL SCHEMATIC...
        </p>
        <div className="flex gap-2">
          {['USGS', 'EONET', 'GVP', 'COOLR', 'HiQuake'].map(src => (
            <div key={src} className="shimmer h-5 rounded" style={{ width: src.length * 8 + 16 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Texture loading shimmer (shown while new mode textures load) ─
function TextureLoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className="absolute inset-0 z-[45] pointer-events-none"
      style={{
        background: '#09090b',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms ease-in-out',
      }}
    >
      {visible && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent spin"
                 style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: 'var(--crimson)' }} />
            <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
              LOADING IMAGERY...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── useFaultLines ─────────────────────────────────────────────
function useFaultLines() {
  const [data, setData] = useState<object | null>(null);
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json')
      .then(r => r.json())
      .then(setData)
      .catch(err => console.warn('[GlobalSchematicGlobe] fault lines fetch failed:', err));
  }, []);
  return data;
}

// ══════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ══════════════════════════════════════════════════════════════
export default function GlobalSchematicGlobe({ focusId = null }: { focusId?: string | null } = {}) {
  const {
    filteredEvents,
    sourceHealth,
    loading,
    causeFilter, setCauseFilter,
    naturalCount, humanCount,
    userLocation, locationError, requestLocation,
    nearbyEvents,
  } = useGlobalEvents();

  // The store slot is typed UnifiedFeature (used by EventRadar2D / Map).
  // The globe works with GlobalEvent — a different flat schema.
  // Use a local state so there is no type conflict with the store.
  const [selectedEvent, setSelectedEvent] = useState<GlobalEvent | null>(null);

  // ── View mode + texture state ───────────────────────────────
  const [viewMode, setViewModeRaw] = useGlobeViewMode();
  const [renderedMode, setRenderedMode] = useState<GlobeViewMode>(viewMode);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const { textures, loading: texLoading } = useGlobeTextures(viewMode);

  // Progressive tile-based texture for SATELLITE mode (zoom-dependent quality).
  // useTiledGlobeTexture runs outside the Canvas; TileTextureUpdater (inside
  // Canvas) calls loadTiles when camera zoom level changes.
  const { tex: tiledSatTex, loadTiles: tiledLoadTiles } = useTiledGlobeTexture(
    textures.color,
    'satellite',
    renderedMode === 'SATELLITE',
  );

  // When switching away from SATELLITE, clear painted-tile cache so
  // re-entering SATELLITE re-fetches fresh tiles.
  useEffect(() => {
    if (renderedMode !== 'SATELLITE') PAINTED_TILES.clear();
  }, [renderedMode]);

  // Crossfade orchestration: dark overlay → swap rendered mode → fade back
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setViewMode = useCallback((m: GlobeViewMode) => {
    if (m === viewMode) return;
    setViewModeRaw(m);
  }, [viewMode, setViewModeRaw]);

  useEffect(() => {
    if (viewMode === renderedMode) return;
    // Wait until new textures are ready (or mode is WIRES which needs none)
    if (texLoading && viewMode !== 'WIRES') return;

    // Phase 1: show overlay (200 ms)
    setOverlayVisible(true);

    if (swapTimerRef.current) clearTimeout(swapTimerRef.current);
    swapTimerRef.current = setTimeout(() => {
      // Phase 2: swap rendered mode (invisible under overlay)
      setRenderedMode(viewMode);

      // Phase 3: hide overlay (200 ms fade-out)
      setTimeout(() => setOverlayVisible(false), 50);
    }, 220);

    return () => { if (swapTimerRef.current) clearTimeout(swapTimerRef.current); };
  }, [viewMode, renderedMode, texLoading]);

  // ── Other state ─────────────────────────────────────────────
  const [showFaultLines,  setShowFaultLines]  = useState(true);
  const [showCityLights,  setShowCityLights]  = useState(false);
  const [reliefScale,     setReliefScale]     = useState(1.5);
  const [flyTo,           setFlyTo]           = useState<[number, number] | null>(null);

  const faultLines = useFaultLines();

  // Mobile detection
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Fly to user location when obtained
  useEffect(() => { if (userLocation) setFlyTo(userLocation); }, [userLocation]);

  // Fly to selected event
  useEffect(() => {
    if (selectedEvent) setFlyTo([selectedEvent.lat, selectedEvent.lon]);
  }, [selectedEvent]);

  // Deep link from the event ledger: select and fly to the requested event once it is loaded.
  useEffect(() => {
    if (!focusId) return;
    const target = filteredEvents.find(e => e.id === focusId);
    if (target) setSelectedEvent(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, filteredEvents.length]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: isLight ? 'var(--bg-primary)' : 'radial-gradient(ellipse at center, #0a0f1e 0%, #040810 60%, #020408 100%)' }}
    >
      {/* Radar scan overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[51] opacity-20">
        <div className="radar-scan-line w-full h-[200%]" />
      </div>

      {/* Three.js Globe Canvas */}
      {loading ? (
        <GlobeSkeleton />
      ) : (
        <Canvas
          camera={{ position: [0, GLOBE_RADIUS * 1.05, GLOBE_RADIUS * 2.75], fov: 45 }}
          style={{ background: isLight ? 'var(--bg-primary)' : '#030609' }}
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
        >
          <Suspense fallback={null}>
          <GlobeScene
              events={filteredEvents}
              faultLines={faultLines}
              showFaultLines={showFaultLines}
              selectedEvent={selectedEvent}
              onSelectEvent={setSelectedEvent}
              flyTo={flyTo}
              viewMode={renderedMode}
              textures={textures}
              reliefScale={reliefScale}
              showCityLights={showCityLights}
              isMobile={isMobile}
              tiledSatTex={tiledSatTex}
              tiledLoadTiles={tiledLoadTiles}
              isLight={isLight}
            />
          </Suspense>
        </Canvas>
      )}

      {/* Crossfade overlay (dips to dark between mode swaps) */}
      <TextureLoadingOverlay visible={overlayVisible} />

      {/* Layer controls (top-left) */}
      <LayerControl
        showFaultLines={showFaultLines}
        toggleFaultLines={() => setShowFaultLines(v => !v)}
        causeFilter={causeFilter}
        setCauseFilter={setCauseFilter}
        naturalCount={naturalCount}
        humanCount={humanCount}
        totalCount={filteredEvents.length}
        onNearMe={requestLocation}
        userLocation={userLocation}
        locationError={locationError}
        loading={loading}
        viewMode={viewMode}
        setViewMode={setViewMode}
        reliefScale={reliefScale}
        setReliefScale={setReliefScale}
        showCityLights={showCityLights}
        toggleCityLights={() => setShowCityLights(v => !v)}
      />

      {/* Source health (top-right) */}
      {sourceHealth.length > 0 && <SourceHealthStrip health={sourceHealth} />}

      {/* Legend */}
      <div className="absolute z-20"
           style={{ background: 'rgba(9,9,11,0.80)', bottom: 24, left: 0, width: 'clamp(280px, 50vw, 480px)' }}>
        <LegendStrip />
      </div>

      {/* Nearby events strip */}
      <AnimatePresence>
        {nearbyEvents.length > 0 && !selectedEvent && (
          <NearbyPanel events={nearbyEvents} onSelect={setSelectedEvent} />
        )}
      </AnimatePresence>

      {/* Event detail panel */}
      <AnimatePresence>
        {selectedEvent && (
          <EventPanel
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </AnimatePresence>

      {/* Data sources footer */}
      <DataSourcesFooter viewMode={renderedMode} />
    </div>
  );
}
