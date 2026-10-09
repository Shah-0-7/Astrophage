/**
 * ============================================================
 * TopoCore3D – View Mode: TOPO_CORE_3D
 * ============================================================
 * WebGL terrain morphometric engine with full API surface:
 *   setZAxisExaggeration(factor)
 *   applyCutawayElevation(datumOffset)
 *   toggleInstrumentLayers(layerFlags)
 *   setCameraViewport(preset)
 *   activePointProbe(raycastCoords)
 *   executeInverseDisplacement()
 * ============================================================
 */

'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Html } from '@react-three/drei';
import { useStore } from '@/lib/store';
import { TARGET_NODES, PASS_EPOCHS } from '@/lib/mockData';
import type { CameraPreset, PolVar, PointProbeResult } from '@/lib/types';

const CAMERA_SETTINGS = {
  ISO_45:     { position: [5, 5, 5], zoom: 200 },
  NADIR_90:   { position: [0, 10, 0.01], zoom: 220 },
  OBLIQUE_15: { position: [0, 2, 8], zoom: 250 },
};

function CameraController({ preset }: { preset: CameraPreset }) {
  const { camera } = useThree();
  useEffect(() => {
    const cam = CAMERA_SETTINGS[preset] || CAMERA_SETTINGS.ISO_45;
    camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    camera.zoom = cam.zoom;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [preset, camera]);
  return null;
}

function TerrainMesh({ currentPassIndex, zExaggeration, layers }: any) {
  const { positions, normals, linePositions, probeH } = useMemo(() => {
    const GRID = 40;
    const heightmap: number[] = [];
    const baseZ = -0.2;
    const terraces = 14;

    const getRawH = (nx: number, ny: number) => {
        const r = Math.sqrt(nx * nx + ny * ny);
        const epochDrift = (currentPassIndex / 18) * 0.25 * Math.sin(nx * 8 + ny * 8);
        return Math.max(0,
            Math.exp(-r * r * 4) * 0.9
            + Math.exp(-r * r * 0.8) * 0.3
            + (Math.sin(nx * 4) * Math.cos(ny * 4)) * 0.08
            - r * 0.15 
            + epochDrift
        );
    };

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const nx = (i / (GRID - 1)) * 2 - 1;
        const ny = (j / (GRID - 1)) * 2 - 1;
        let h = getRawH(nx, ny);
        h = Math.floor(h * terraces) / terraces;
        heightmap.push(h);
      }
    }

    const getH = (i: number, j: number) => heightmap[j * GRID + i];
    
    const pos: number[] = [];
    const norm: number[] = [];
    const lines: number[] = [];
    
    const exag = zExaggeration / 10;
    
    const addQuad = (p0: number[], p1: number[], p2: number[], p3: number[], n: number[]) => {
        pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
        norm.push(...n, ...n, ...n, ...n, ...n, ...n);
    };

    for (let j = 0; j < GRID - 1; j++) {
      for (let i = 0; i < GRID - 1; i++) {
        const h = getH(i, j) * exag;
        const x0 = (i / (GRID - 1)) * 2 - 1;
        const x1 = ((i + 1) / (GRID - 1)) * 2 - 1;
        const y0 = (j / (GRID - 1)) * 2 - 1;
        const y1 = ((j + 1) / (GRID - 1)) * 2 - 1;
        
        const hN = j > 0 ? getH(i, j - 1) * exag : baseZ * exag;
        const hS = j < GRID - 2 ? getH(i, j + 1) * exag : baseZ * exag;
        const hW = i > 0 ? getH(i - 1, j) * exag : baseZ * exag;
        const hE = i < GRID - 2 ? getH(i + 1, j) * exag : baseZ * exag;

        // Top Face
        addQuad([x0, h, y0], [x0, h, y1], [x1, h, y1], [x1, h, y0], [0, 1, 0]);

        // Walls
        if (hN < h) {
            addQuad([x1, hN, y0], [x0, hN, y0], [x0, h, y0], [x1, h, y0], [0, 0, -1]);
            lines.push(x0, h, y0, x1, h, y0);
        } else if (hN === h && j === 0) lines.push(x0, h, y0, x1, h, y0);

        if (hS < h) {
            addQuad([x0, hS, y1], [x1, hS, y1], [x1, h, y1], [x0, h, y1], [0, 0, 1]);
            lines.push(x0, h, y1, x1, h, y1);
        } else if (hS === h && j === GRID - 2) lines.push(x0, h, y1, x1, h, y1);

        if (hW < h) {
            addQuad([x0, hW, y0], [x0, hW, y1], [x0, h, y1], [x0, h, y0], [-1, 0, 0]);
            lines.push(x0, h, y0, x0, h, y1);
        } else if (hW === h && i === 0) lines.push(x0, h, y0, x0, h, y1);

        if (hE < h) {
            addQuad([x1, hE, y1], [x1, hE, y0], [x1, h, y0], [x1, h, y1], [1, 0, 0]);
            lines.push(x1, h, y1, x1, h, y0);
        } else if (hE === h && i === GRID - 2) lines.push(x1, h, y1, x1, h, y0);

        // Vector trees
        if (h > 0.05 * exag && h < 0.6 * exag && (i * 7 + j * 3) % 23 === 0) {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            lines.push(cx, h, cy, cx, h + 0.08, cy);
            lines.push(cx - 0.015, h + 0.04, cy, cx + 0.015, h + 0.04, cy);
            lines.push(cx + 0.015, h + 0.04, cy, cx, h + 0.08, cy);
            lines.push(cx, h + 0.08, cy, cx - 0.015, h + 0.04, cy);
        }
      }
    }

    let pRaw = getRawH(-0.05, -0.05);
    let pH = Math.floor(pRaw * terraces) / terraces * exag;

    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(norm),
      linePositions: new Float32Array(lines),
      probeH: pH
    };
  }, [currentPassIndex, zExaggeration]);

  return (
    <group>
      <mesh>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-normal" args={[normals, 3]} />
        </bufferGeometry>
        <meshStandardMaterial color="#18181b" roughness={0.9} metalness={0.1} />
      </mesh>
      
      {layers.wireframe && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" opacity={0.65} transparent linewidth={1} />
        </lineSegments>
      )}

      {/* Point probe */}
      <group position={[-0.05, probeH, -0.05]}>
          <mesh>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, -0.15, 0]}>
              <cylinderGeometry args={[0.003, 0.003, 0.3]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
          </mesh>
          <Html position={[0.05, 0.05, 0]} center style={{ color: 'white', fontFamily: 'monospace', fontSize: '10px', pointerEvents: 'none', whiteSpace: 'nowrap', textShadow: '0 0 4px black' }}>
              TP-09
          </Html>
      </group>
    </group>
  );
}

/* ── 3D terrain renderer (React Three Fiber) */
function TerrainCanvas({
  zExaggeration, cutawayElevation, layers, cameraPreset, currentPassIndex,
  onProbe,
}: {
  zExaggeration: number;
  cutawayElevation: number;
  layers: { wireframe: boolean; phaseFringe: boolean; coherenceMask: boolean };
  cameraPreset: CameraPreset;
  currentPassIndex: number;
  onProbe: (x: number, y: number) => void;
}) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onProbe(x, y);
  }, [onProbe]);

  return (
    <div className="w-full h-full relative cursor-crosshair terrain-canvas" onClick={handleClick}>
      <Canvas>
        <OrthographicCamera makeDefault position={[5, 5, 5]} zoom={200} near={-20} far={50} />
        <CameraController preset={cameraPreset} />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
        
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 2]} intensity={1.5} />
        <directionalLight position={[-5, 5, -5]} intensity={0.5} />
        
        <TerrainMesh currentPassIndex={currentPassIndex} zExaggeration={zExaggeration} layers={layers} />
      </Canvas>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────── */
export default function TopoCore3D() {
  const activeNodeId = useStore(s => s.activeNodeId);
  const currentPassIndex = useStore(s => s.currentPassIndex);
  const zAxisExaggeration = useStore(s => s.zAxisExaggeration);
  const setZAxisExaggeration = useStore(s => s.setZAxisExaggeration);
  const cutawayElevation = useStore(s => s.cutawayElevation);
  const setCutawayElevation = useStore(s => s.setCutawayElevation);
  const instrumentLayers = useStore(s => s.instrumentLayers);
  const toggleInstrumentLayers = useStore(s => s.toggleInstrumentLayers);
  const cameraPreset = useStore(s => s.cameraPreset);
  const setCameraViewport = useStore(s => s.setCameraViewport);
  const pointProbe = useStore(s => s.pointProbe);
  const setPointProbe = useStore(s => s.setPointProbe);
  const lBandStatus = useStore(s => s.lBandStatus);
  const sBandStatus = useStore(s => s.sBandStatus);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);

  const activeNode = TARGET_NODES.find(n => n.id === activeNodeId) ?? TARGET_NODES[0];
  const currentPass = PASS_EPOCHS[currentPassIndex];

  const probeCount = useRef(0);

  /** activePointProbe: WebGL raycast on canvas click */
  const handleProbe = useCallback((x: number, y: number) => {
    probeCount.current += 1;
    const id = `TP-${String(probeCount.current).padStart(2, '0')}`;
    // Simulate elevation from click coords
    const elev = Math.round(600 + x * 1800);
    const drift = parseFloat((1.5 + Math.random() * 5).toFixed(1));
    const result: PointProbeResult = {
      id, siteName: `${activeNode.label} Flank`,
      coordinates: [46.85 + y * 0.3, 121.76 - x * 0.5],
      elevation: elev, verticalDriftRate: drift,
      raycastCoords: { x, y },
    };
    setPointProbe(result);
  }, [activeNode.label, setPointProbe]);

  const CAMERA_PRESETS: CameraPreset[] = ['ISO_45', 'NADIR_90', 'OBLIQUE_15'];
  const CAMERA_LABELS: Record<CameraPreset, string> = {
    ISO_45: 'ISO 45°', NADIR_90: 'NADIR 90°', OBLIQUE_15: 'OBLIQUE 15°',
  };

  const STATUS_COLOR: Record<string, string> = {
    NOMINAL: 'var(--nominal)', ACQUIRING: 'var(--acquiring)', STANDBY: 'var(--text-muted)',
  };

  return (
    <div className="flex h-full">
      {/* ── Left: instrument control panel ──────────────────── */}
      <div className="hidden md:flex w-[200px] flex-shrink-0 glass-sidebar border-r border-white/10 flex-col overflow-y-auto">

        {/* Instrument status */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">INSTRUMENT STATUS</p>
          <div className="flex items-center gap-2">
            <div className="status-dot active" />
            <span className="font-mono text-[11px] font-600 text-white">ACTIVE</span>
          </div>
          <div className="grid grid-cols-2 gap-1 mt-3">
            {[
              { label: 'L-BAND 1.25G', status: lBandStatus },
              { label: 'S-BAND 3.20G', status: sBandStatus },
            ].map(({ label, status }) => (
              <div key={label} className="p-1.5 text-center" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
                <p className="font-mono text-[8px] text-white/50 uppercase tracking-wider">{label}</p>
                <p className="font-mono text-[9px] font-700 mt-0.5" style={{ color: STATUS_COLOR[status] }}>{status}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tactical modes */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">TACTICAL MODES</p>
          {[
            { id: 'GLOBAL_SCHEMATIC' as const, icon: '◎', label: 'GLOBAL SCHEMATIC' },
            { id: 'EVENT_RADAR_2D' as const,   icon: '⊕', label: '2D EVENT RADAR' },
            { id: 'TOPO_CORE_3D' as const,     icon: '△', label: '3D TOPOGRAPHIC CORE' },
          ].map(m => {
            const isActive = m.id === 'TOPO_CORE_3D';
            return (
              <div key={m.id} className="flex items-center gap-1.5 py-1 px-1.5 mb-0.5"
                   style={{
                     background: isActive ? 'rgba(239,68,68,0.08)' : 'transparent',
                     borderLeft: isActive ? '2px solid var(--crimson)' : '2px solid transparent',
                   }}>
                <span className="text-[10px]" style={{ color: isActive ? 'var(--crimson)' : 'var(--text-muted)' }}>{m.icon}</span>
                <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: isActive ? 'var(--white)' : 'var(--text-muted)' }}>{m.label}</span>
              </div>
            );
          })}
        </div>

        {/* SAR filter profiles */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">SAR FILTER PROFILES</p>
          {[
            { label: 'COHERENCE', value: `${coherenceThreshold.toFixed(2)} γ` },
            { label: 'INTERFEROGRAM', value: '28mm' },
            { label: 'BACKSCATTER', value: '-14.2 dB' },
          ].map(item => (
            <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-white/05">
              <span className="panel-label">{item.label}</span>
              <span className="font-mono text-[11px] text-white font-600">{item.value}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 mt-auto border-t border-white/10">
          <p className="panel-label">STATION</p>
          <p className="font-mono text-[9px] text-white/40 mt-0.5">ISRO SHAR</p>
          <p className="panel-label mt-2">DOWNLINK</p>
          <p className="font-mono text-[10px] text-white mt-0.5">4.0 Gbps</p>
        </div>
      </div>

      {/* ── Center: 3D terrain canvas ────────────────────────── */}
      <div className="flex-1 relative flex flex-col">

        {/* Top bar */}
        <div className="h-[44px] border-b border-white/10 flex items-center px-4 gap-4 flex-shrink-0"
             style={{ background: 'rgba(9,9,11,0.9)', backdropFilter: 'blur(12px)' }}>
          {/* Tab / mode label */}
          <div className="flex items-center gap-2 border border-white/20 px-3 h-7"
               style={{ borderRadius: 2 }}>
            <span className="font-mono text-[9px] font-700 text-white tracking-wider">◎ SAR-CORE 3D DEM</span>
          </div>
          <span className="font-mono text-[9px] text-white/30">TACTICAL-SECTOR-47</span>
          <span className="font-mono text-[9px] text-white/30">/ COHERENCE: γ ≥ {coherenceThreshold.toFixed(2)}</span>

          <div className="ml-auto">
            <button
              onClick={() => {/* reset camera to ISO_45 */setCameraViewport('ISO_45'); }}
              className="tac-btn"
            >
              ↺ RESET VIEW
            </button>
          </div>
        </div>

        {/* Location strip */}
        <div className="h-[30px] border-b border-white/06 flex items-center px-4 gap-4 flex-shrink-0"
             style={{ background: 'rgba(9,9,11,0.7)' }}>
          <span className="panel-label">LOCATION:</span>
          <span className="font-mono text-[10px] text-white">46°51′08.2″N  121°45′37.1″W</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="panel-label">M</span>
            <span className="font-mono text-[10px] text-white/40">MISSION CLOCK ACTIVE</span>
          </div>
        </div>

        {/* Morphometric controls */}
        <div className="border-b border-white/10 px-4 py-3 flex-shrink-0"
             style={{ background: 'rgba(9,9,11,0.85)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[9px] text-white/40">≡≡</span>
            <span className="font-mono text-[10px] font-700 text-white tracking-wider uppercase">Morphometric Control</span>
            <span className="ml-auto panel-label">CF9.01</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Z-axis exaggeration */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="panel-label">Z-AXIS EXAGGERATION</span>
                <span className="font-mono text-[11px] font-700 text-white">{zAxisExaggeration.toFixed(1)}×</span>
              </div>
              <input
                type="range" min={10} max={100}
                value={Math.round(zAxisExaggeration * 10)}
                onChange={e => setZAxisExaggeration(parseInt(e.target.value) / 10)}
                className="tac-slider w-full"
                style={{ '--progress': `${((zAxisExaggeration - 1) / 9) * 100}%` } as React.CSSProperties}
              />
              <div className="flex justify-between mt-0.5">
                <span className="panel-label">1.0× (FLAT)</span>
                <span className="panel-label">5.0×</span>
                <span className="panel-label">10.0× (HYPER)</span>
              </div>
            </div>

            {/* Cutaway elevation */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="panel-label">CUTAWAY ELEVATION</span>
                <span className="font-mono text-[11px] font-700 text-white">+{cutawayElevation.toLocaleString()} m</span>
              </div>
              <input
                type="range" min={0} max={2450}
                value={cutawayElevation}
                onChange={e => setCutawayElevation(parseInt(e.target.value))}
                className="tac-slider w-full"
                style={{ '--progress': `${(cutawayElevation / 2450) * 100}%` } as React.CSSProperties}
              />
              <div className="flex justify-between mt-0.5">
                <span className="panel-label">0m (DATUM)</span>
                <span className="panel-label">+1,280m</span>
                <span className="panel-label">+2,450m</span>
              </div>
            </div>
          </div>
        </div>

        {/* Instrument layers */}
        <div className="border-b border-white/10 px-4 py-2 flex-shrink-0 flex items-center gap-6"
             style={{ background: 'rgba(9,9,11,0.80)' }}>
          <span className="panel-label">ACTIVE INSTRUMENT LAYERS</span>
          {[
            { key: 'wireframe' as const, label: 'DEM Contour Wireframe' },
            { key: 'phaseFringe' as const, label: 'L-Band Phase Fringe' },
            { key: 'coherenceMask' as const, label: 'Coherence Mask (γ ≥ 0.5)' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={instrumentLayers[key]}
                onChange={e => toggleInstrumentLayers({ [key]: e.target.checked })}
                className="tac-checkbox"
              />
              <span className="font-mono text-[10px] text-white/70">{label}</span>
            </label>
          ))}
        </div>

        {/* Terrain canvas */}
        <div className="flex-1 relative overflow-hidden" style={{ background: '#09090b' }}>
          <TerrainCanvas
            zExaggeration={zAxisExaggeration}
            cutawayElevation={cutawayElevation}
            layers={instrumentLayers}
            cameraPreset={cameraPreset}
            currentPassIndex={currentPassIndex}
            onProbe={handleProbe}
          />

          {/* Mission footer */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 flex items-center gap-6"
               style={{ background: 'rgba(9,9,11,0.85)', borderTop: '1px solid var(--border-zinc)' }}>
            <span className="font-mono text-[9px] text-white/30 uppercase tracking-wider">
              MISSION: NASA-ISRO SAR (NISAR) // QUAD-POL (HH/HV/VH/VV) // POD EPHEMERIS CONFIRMED
            </span>
            <div className="ml-auto flex items-center gap-4">
              <span className="font-mono text-[9px] text-white/30">AZIMUTH: <span className="text-white/60">1.0 m/px</span></span>
              <span className="font-mono text-[9px] text-white/30">BAND: <span className="text-white/60">L-BAND 24cm λ</span></span>
              <span className="panel-label text-right">DATA RIGHTS: TIER-1 OPEN ACCESS</span>
            </div>
          </div>
        </div>

        {/* 3D Model Telemetry footer */}
        <div className="border-t border-white/10 px-4 py-2.5 flex-shrink-0 flex items-center justify-between"
             style={{ background: 'rgba(9,9,11,0.92)' }}>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono text-[9px] text-white/70 tracking-wider">3D TOPOGRAPHIC STRAIN VISUALIZER</span>
          </div>
          <span className="font-mono text-[9px] text-white/40">Z-EXAGGERATION: {zAxisExaggeration.toFixed(1)}×</span>
        </div>
      </div>

      {/* ── Right: point probe telemetry + camera viewport ──── */}
      <div className="hidden md:flex w-[220px] flex-shrink-0 border-l border-white/10 glass-sidebar flex-col">

        {/* Point probe panel */}
        <div className="border-b border-white/10">
          <div className="px-3 py-2.5 flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-white">↔↔ POINT-PROBE TELEMETRY</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="status-dot active" />
              <span className="font-mono text-[9px] font-700 text-white">LOCKED</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {pointProbe && (
              <motion.div
                key={pointProbe.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-3"
              >
                <p className="panel-label mb-1">SAMPLE SITE</p>
                <p className="font-mono text-[13px] font-700 text-white leading-tight">{pointProbe.siteName} ({pointProbe.id})</p>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
                    <p className="panel-label mb-0.5">COORDINATES</p>
                    <p className="font-mono text-[10px] text-white leading-tight">
                      {pointProbe.coordinates[0].toFixed(2)}°N<br />
                      {pointProbe.coordinates[1].toFixed(2)}°W
                    </p>
                  </div>
                  <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
                    <p className="panel-label mb-0.5">ELEVATION</p>
                    <p className="font-mono text-[18px] font-700 text-white leading-tight">{pointProbe.elevation.toLocaleString()}</p>
                    <p className="font-mono text-[9px] text-white/40">m</p>
                  </div>
                </div>

                <div className="mt-3 p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
                  <p className="panel-label mb-1">NET VERTICAL DRIFT</p>
                  <p className="font-mono text-[9px] text-white/40 mb-1">12-cycle differential</p>
                  <p className="font-mono text-[16px] font-700 text-white">
                    ↑ +{pointProbe.verticalDriftRate} mm/yr
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Camera viewport */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">CAMERA VIEWPORT</p>
          <div className="grid grid-cols-3 gap-1">
            {CAMERA_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => setCameraViewport(preset)}
                className={`tac-btn text-[8px] h-7 px-1 justify-center ${cameraPreset === preset ? 'active' : ''}`}
              >
                {CAMERA_LABELS[preset]}
              </button>
            ))}
          </div>
        </div>

        {/* Pass telemetry */}
        <div className="p-3 border-b border-white/10">
          <p className="panel-label mb-2">ACTIVE PASS</p>
          <p className="font-mono text-[14px] font-700 text-white">{currentPass?.label ?? '—'}</p>
          <p className="font-mono text-[9px] text-white/40 mt-0.5">
            {currentPass ? new Date(currentPass.date).toISOString().slice(0, 10) : '--'}
          </p>
          {currentPass && (
            <div className="mt-2 pt-2 border-t border-white/10 flex justify-between">
              <div>
                <p className="panel-label">Δd ACCUM</p>
                <p className="font-mono text-[11px] font-700 text-white">{currentPass.accumDisplacement} mm</p>
              </div>
              <div className="text-right">
                <p className="panel-label">RESIDUAL</p>
                <p className="font-mono text-[11px] font-700 text-white">±{currentPass.residualError} mm</p>
              </div>
            </div>
          )}
        </div>

        {/* Target coords */}
        <div className="p-3">
          <p className="panel-label mb-2">TARGET COORDINATES</p>
          <div className="p-2" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-zinc)' }}>
            <p className="font-mono text-[12px] font-700 text-white">37.7576 N</p>
            <p className="font-mono text-[9px] text-white/40">{activeNode.locationDetail}</p>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="panel-label">PASS INTERVAL</span>
            <span className="font-mono text-[10px] font-600 text-white">12 DAYS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
