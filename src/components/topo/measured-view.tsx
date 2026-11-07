'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { GlobalEvent } from '@/lib/globalEvents';
import { boxAround, boxSizeKm, type BBox, type HeightGrid } from '@/lib/terrain';
import { useTerrain } from '@/lib/useTerrain';
import { useDisplacement } from '@/lib/useDisplacement';
import { useNisarCoverage } from '@/lib/useNisarCoverage';
import { fieldStats, FRINGE_CM, type DisplacementField } from '@/lib/displacement/field';
import { fringeColor, losColor, niceLimit } from '@/lib/displacement/colors';
import { flatGrid, heightAt, paintDrape, probeAt, type DrapeMode, type Probe } from '@/lib/displacement/drape';
import './measured-view.css';

const SPAN = 4; // longest ground side in scene units
type Preset = 'iso' | 'top' | 'low';
const PRESETS: Record<Preset, [number, number, number]> = { iso: [0, 3.4, 4.2], top: [0, 7.5, 0.01], low: [0, 1.1, 5.6] };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtCm = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} cm`;

// ── 3D scene ──────────────────────────────────────────────────

function Rig({ preset }: { preset: Preset }) {
  const { camera } = useThree();
  useEffect(() => { const p = PRESETS[preset]; camera.position.set(p[0], p[1], p[2]); camera.lookAt(0, 0, 0); }, [preset, camera]);
  return null;
}

interface SceneProps {
  terrain: HeightGrid; field: DisplacementField | null; mode: DrapeMode; limit: number; opacity: number; minCoherence: number;
  exaggeration: number; wireframe: boolean; event: GlobalEvent; pinned: Probe | null;
  onHover: (p: Probe | null) => void; onPin: (p: Probe) => void;
}

function Scene({ terrain, field, mode, limit, opacity, minCoherence, exaggeration, wireframe, event, pinned, onHover, onPin }: SceneProps) {
  const { widthKm, heightKm } = useMemo(() => boxSizeKm(terrain.bbox), [terrain.bbox]);
  const unit = SPAN / Math.max(widthKm, heightKm, 1e-6);          // scene units per km
  const W = widthKm * unit, D = heightKm * unit;
  const yOf = (h: number) => ((h - terrain.min) / 1000) * unit * exaggeration;

  const geometry = useMemo(() => {
    const { nx, ny, heights } = terrain;
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = (i / (nx - 1) - 0.5) * W;
      pos[k * 3 + 1] = yOf(heights[k]);
      pos[k * 3 + 2] = (j / (ny - 1) - 0.5) * D;          // row 0 = north = -z
      uv[k * 2] = i / (nx - 1); uv[k * 2 + 1] = j / (ny - 1);
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let o = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }, [terrain, W, D, exaggeration, unit]); // yOf depends only on these
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Measured colours are painted at the grid's own resolution and draped as a texture, so they stay crisp whatever the mesh density.
  const texture = useMemo(() => {
    const [w, s, e, n] = terrain.bbox;
    // With no field, paint bare terrain through a one-cell NaN field.
    const f: DisplacementField = field ?? { id: '', maturity: '', track: null, frame: null, direction: null, reference: 0, secondary: 0, bbox: [w, s, e, n], nx: 96, ny: 96, cm: new Float32Array(96 * 96).fill(NaN) };
    const { rgba } = paintDrape(f, terrain, { mode, limit, opacity, minCoherence });
    const t = new THREE.DataTexture(rgba, f.nx, f.ny, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = field ? THREE.NearestFilter : THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [terrain, field, mode, limit, opacity, minCoherence]);
  useEffect(() => () => texture.dispose(), [texture]);

  const hit = (e: ThreeEvent<PointerEvent | MouseEvent>): Probe | null => {
    if (!e.uv) return null;
    const [w, s, ea, n] = terrain.bbox;
    return probeAt(field, terrain, w + e.uv.x * (ea - w), n - e.uv.y * (n - s));
  };
  const place = (lon: number, lat: number): [number, number, number] | null => {
    const [w, s, e, n] = terrain.bbox;
    if (lon < w || lon > e || lat < s || lat > n) return null;
    const h = heightAt(terrain, lon, lat) ?? terrain.min;
    return [((lon - w) / (e - w) - 0.5) * W, yOf(h), (0.5 - (lat - s) / (n - s)) * D];
  };
  const evPos = place(event.lon, event.lat);
  const pinPos = pinned ? place(pinned.lon, pinned.lat) : null;
  const wrap = Math.max(W, D) * 0.0075;

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[-3, 5, -2]} intensity={0.8} />
      <mesh geometry={geometry}
        onPointerMove={e => { e.stopPropagation(); onHover(hit(e)); }}
        onPointerOut={() => onHover(null)}
        onClick={e => { e.stopPropagation(); const p = hit(e); if (p) onPin(p); }}>
        <meshLambertMaterial map={texture} />
      </mesh>
      {wireframe && <mesh geometry={geometry} position={[0, 0.004, 0]}><meshBasicMaterial wireframe color="#ffffff" transparent opacity={0.1} /></mesh>}
      {evPos && (
        <group position={evPos}>
          <mesh position={[0, wrap * 6, 0]}><cylinderGeometry args={[wrap * 0.35, wrap * 0.35, wrap * 12, 8]} /><meshBasicMaterial color="#fbbf24" /></mesh>
          <mesh position={[0, wrap * 12.5, 0]}><sphereGeometry args={[wrap * 1.6, 16, 12]} /><meshBasicMaterial color="#fbbf24" /></mesh>
        </group>
      )}
      {pinPos && (
        <group position={pinPos}>
          <mesh position={[0, wrap * 3, 0]}><cylinderGeometry args={[wrap * 0.25, wrap * 0.25, wrap * 6, 8]} /><meshBasicMaterial color="#ffffff" /></mesh>
          <mesh position={[0, wrap * 6.5, 0]}><sphereGeometry args={[wrap * 1.1, 16, 12]} /><meshBasicMaterial color="#ffffff" /></mesh>
        </group>
      )}
    </>
  );
}

// ── Legend ────────────────────────────────────────────────────

function Legend({ mode, limit }: { mode: DrapeMode; limit: number }) {
  const bg = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const c = mode === 'fringe' ? fringeColor(t * FRINGE_CM) : losColor((t * 2 - 1) * limit, limit);
      stops.push(`rgb(${c.map(v => Math.round(v * 255)).join(',')}) ${Math.round(t * 100)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(',')})`;
  }, [mode, limit]);
  return (
    <div className="mv-legend">
      <div className="mv-bar" style={{ background: bg }} />
      {mode === 'continuous' ? (
        <div className="mv-ticks"><span>{(-limit).toFixed(limit < 10 ? 1 : 0)}</span><span>0</span><span>+{limit.toFixed(limit < 10 ? 1 : 0)} cm</span></div>
      ) : (
        <div className="mv-ticks"><span>0</span><span>one cycle = {FRINGE_CM.toFixed(1)} cm</span><span>0</span></div>
      )}
      <div className="mv-ticks mv-dir">{mode === 'continuous' ? <><span>← away from satellite</span><span>toward satellite →</span></> : <span>colour repeats every half wavelength of line-of-sight motion</span>}</div>
    </div>
  );
}

// ── The view ──────────────────────────────────────────────────

export function MeasuredTopoView({ event, onExit }: { event: GlobalEvent; onExit: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const disp = useDisplacement(event, pick);
  const coverage = useNisarCoverage(disp.status === 'none' ? event : null, disp.status === 'none');

  const field = disp.status === 'ready' ? disp.field : null;
  const bbox: BBox | null = useMemo(() => {
    if (disp.status === 'loading') return null;
    return field ? field.bbox : boxAround(event.lon, event.lat, 60);
  }, [disp.status, field, event.lon, event.lat]);
  const terrainState = useTerrain(bbox);
  const terrain: HeightGrid | null = terrainState.status === 'ready' ? terrainState.grid : (bbox && terrainState.status === 'failed' ? flatGrid(bbox) : null);

  const stats = useMemo(() => (field ? fieldStats(field) : null), [field]);
  const limit = useMemo(() => (stats ? niceLimit(Math.max(Math.abs(stats.p2), Math.abs(stats.p98))) : 1), [stats]);

  const [mode, setMode] = useState<DrapeMode>('continuous');
  const [opacity, setOpacity] = useState(0.9);
  const [exag, setExag] = useState(2);
  const [minCoh, setMinCoh] = useState(0.3);
  const [wire, setWire] = useState(false);
  const [preset, setPreset] = useState<Preset>('iso');
  const [hover, setHover] = useState<Probe | null>(null);
  const [pinned, setPinned] = useState<Probe | null>(null);
  useEffect(() => { setPinned(null); setHover(null); }, [field?.id]);
  const shownProbe = hover ?? pinned;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR-SITE';
  const spanning = coverage.phase === 'done' && coverage.data.status === 'ok' ? coverage.data.interferograms.filter(g => g.fit === 'spans-event') : [];

  let overlay: React.ReactNode = null;
  if (disp.status === 'loading') overlay = <div className="mv-overlay"><b>LOADING MEASURED GRID…</b></div>;
  else if (disp.status === 'failed') overlay = <div className="mv-overlay"><b>COULD NOT LOAD DISPLACEMENT DATA</b><p>The request failed ({disp.detail}). Elevation is shown below without a measurement; try again in a moment.</p></div>;
  else if (disp.status === 'unconfigured') overlay = <div className="mv-overlay"><b>NO DATABASE ON THIS DEPLOYMENT</b><p>Measured grids are stored in the Cloudflare D1 database, which this deployment does not have. See docs/DISPLACEMENT.md. Elevation is real; there is nothing measured to drape yet.</p></div>;
  else if (disp.status === 'none') overlay = (
    <div className="mv-overlay">
      <b>NO MEASURED GRID FOR THIS EVENT YET</b>
      <p className="mv-muted" style={{ fontSize: 11 }}>Looked for a grid covering {event.lat.toFixed(3)}°, {event.lon.toFixed(3)}° whose two dates enclose {new Date(event.time).toISOString().slice(0, 16).replace('T', ' ')} UTC. Recent uploads can take a few minutes to appear.</p>
      <p>Nothing has been processed here, so no motion is drawn. {terrainState.status === 'ready' ? 'The surface is real elevation.' : 'Elevation is not available either.'}</p>
      {spanning.length > 0 ? (
        <>
          <p>{spanning.length === 1 ? 'An interferogram' : `${spanning.length} interferograms`} on NASA&apos;s catalogue pair{spanning.length === 1 ? 's' : ''} a date before and after this event. Process the first one and upload it:</p>
          <pre className="mv-cmd">{`python tools/nisar-grid/nisar_grid.py \\\n  ${spanning[0].dataUrl ?? spanning[0].id + '.h5'} \\\n  --center ${event.lon.toFixed(3)},${event.lat.toFixed(3)} --radius-km 120 \\\n  --upload ${origin} --token $INGEST_SECRET`}</pre>
        </>
      ) : coverage.phase === 'loading' ? <p>Checking NASA&apos;s catalogue for interferograms…</p>
        : <p>NASA&apos;s catalogue lists no published interferogram that spans this event yet.</p>}
    </div>
  );

  return (
    <div className="mv">
      <header className="mv-head">
        <div className="mv-title"><i /> <b>{field ? 'MEASURED · NISAR L-BAND INTERFEROGRAM' : 'TERRAIN'}</b><span>{event.title}</span></div>
        <button type="button" className="mv-btn" onClick={onExit}>CLASSIC 3D VIEW</button>
      </header>

      <div className="mv-body">
        <div className="mv-stage">
          {terrain ? (
            <Canvas camera={{ position: PRESETS.iso, fov: 38, near: 0.05, far: 60 }} dpr={[1, 2]}>
              <color attach="background" args={['#09090b']} />
              <Rig preset={preset} />
              <Scene terrain={terrain} field={field} mode={mode} limit={limit} opacity={opacity} minCoherence={field?.coh ? minCoh : 0}
                exaggeration={exag} wireframe={wire} event={event} pinned={pinned} onHover={setHover} onPin={setPinned} />
              <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={1.2} maxDistance={14} />
            </Canvas>
          ) : (disp.status !== 'loading' && terrainState.status === 'loading') ? <div className="mv-overlay"><b>LOADING ELEVATION…</b></div> : null}
          {overlay}
          {terrainState.status === 'failed' && field && <div className="mv-note">Elevation tiles could not be loaded, so the measurement is drawn on a flat surface.</div>}
          {field && <div className="mv-hint">Drag to rotate · scroll to zoom · click to pin a reading</div>}
        </div>

        <aside className="mv-side">
          {field && stats ? (
            <>
              <section>
                <h4>INTERFEROGRAM</h4>
                <dl>
                  <div><dt>Reference</dt><dd>{utcDay(field.reference)}</dd></div>
                  <div><dt>Secondary</dt><dd>{utcDay(field.secondary)}</dd></div>
                  <div><dt>Span</dt><dd>{Math.round((field.secondary - field.reference) / 86_400_000)} days</dd></div>
                  <div><dt>Track / frame</dt><dd>{field.track ?? '—'} / {field.frame ?? '—'}</dd></div>
                  <div><dt>Pass</dt><dd>{field.direction === 'A' ? 'Ascending' : field.direction === 'D' ? 'Descending' : '—'}</dd></div>
                  <div><dt>Maturity</dt><dd>{field.maturity}</dd></div>
                </dl>
                {disp.status === 'ready' && disp.others.length > 0 && (
                  <label className="mv-pair">Other pairs
                    <select value={field.id} onChange={e => setPick(e.target.value)}>
                      <option value={field.id}>{utcDay(field.reference)} → {utcDay(field.secondary)}</option>
                      {disp.others.map(o => <option key={o.id} value={o.id}>{utcDay(o.reference)} → {utcDay(o.secondary)}</option>)}
                    </select>
                  </label>
                )}
              </section>

              <section>
                <h4>LINE-OF-SIGHT CHANGE</h4>
                <Legend mode={mode} limit={limit} />
                <dl>
                  <div><dt>Toward satellite</dt><dd>{fmtCm(stats.max)}</dd></div>
                  <div><dt>Away</dt><dd>{fmtCm(stats.min)}</dd></div>
                  <div><dt>Coverage</dt><dd>{Math.round(stats.coverage * 100)}% of grid</dd></div>
                </dl>
              </section>

              <section>
                <h4>DISPLAY</h4>
                <div className="mv-seg">
                  <button type="button" className={mode === 'continuous' ? 'on' : ''} onClick={() => setMode('continuous')}>CONTINUOUS</button>
                  <button type="button" className={mode === 'fringe' ? 'on' : ''} onClick={() => setMode('fringe')}>FRINGES</button>
                </div>
                <label className="mv-range">Drape opacity <span>{Math.round(opacity * 100)}%</span>
                  <input type="range" min={30} max={100} value={Math.round(opacity * 100)} onChange={e => setOpacity(+e.target.value / 100)} /></label>
                {field.coh && <label className="mv-range">Coherence floor <span>γ ≥ {minCoh.toFixed(2)}</span>
                  <input type="range" min={0} max={90} value={Math.round(minCoh * 100)} onChange={e => setMinCoh(+e.target.value / 100)} /></label>}
                <label className="mv-range">Height exaggeration <span>{exag.toFixed(1)}×</span>
                  <input type="range" min={10} max={80} value={Math.round(exag * 10)} onChange={e => setExag(+e.target.value / 10)} /></label>
                <label className="mv-check"><input type="checkbox" checked={wire} onChange={e => setWire(e.target.checked)} /> Terrain wireframe</label>
                <div className="mv-seg">
                  {(['iso', 'top', 'low'] as Preset[]).map(p => <button key={p} type="button" className={preset === p ? 'on' : ''} onClick={() => setPreset(p)}>{p === 'iso' ? 'ANGLED' : p === 'top' ? 'TOP' : 'LOW'}</button>)}
                </div>
              </section>
            </>
          ) : (
            <section>
              <h4>EVENT</h4>
              <dl>
                <div><dt>Location</dt><dd>{event.lat.toFixed(3)}°, {event.lon.toFixed(3)}°</dd></div>
                <div><dt>Observed</dt><dd>{utcDay(event.time)}</dd></div>
                {event.magnitude != null && <div><dt>Magnitude</dt><dd>{event.magnitude.toFixed(1)}</dd></div>}
              </dl>
              {terrain && (
                <div className="mv-seg">
                  {(['iso', 'top', 'low'] as Preset[]).map(p => <button key={p} type="button" className={preset === p ? 'on' : ''} onClick={() => setPreset(p)}>{p === 'iso' ? 'ANGLED' : p === 'top' ? 'TOP' : 'LOW'}</button>)}
                </div>
              )}
            </section>
          )}

          <section>
            <h4>READING {pinned && !hover ? '· PINNED' : ''}</h4>
            {shownProbe ? (
              <dl>
                <div><dt>Position</dt><dd>{shownProbe.lat.toFixed(4)}°, {shownProbe.lon.toFixed(4)}°</dd></div>
                <div><dt>Elevation</dt><dd>{shownProbe.elevation != null ? `${Math.round(shownProbe.elevation).toLocaleString()} m` : '—'}</dd></div>
                {field && <div><dt>LOS change</dt><dd>{shownProbe.los != null ? fmtCm(shownProbe.los) : 'no data'}</dd></div>}
                {field?.coh && <div><dt>Coherence</dt><dd>{shownProbe.coherence != null ? shownProbe.coherence.toFixed(2) : '—'}</dd></div>}
              </dl>
            ) : <p className="mv-muted">Move over the surface to read it, click to pin.</p>}
          </section>

          {field && (
            <section className="mv-caveat">
              <h4>HOW TO READ THIS</h4>
              <p>Measured by NISAR, not modelled. The value is motion along the satellite&apos;s line of sight, not vertical motion. A single pass cannot separate up from sideways.</p>
              <p>An interferogram has no absolute zero: the map is relative to the median of its outer edge. Atmosphere, ionosphere and tides are not corrected here, so a few cm of smooth gradient across the scene can be noise.</p>
              {field.notes && <p className="mv-muted">{field.notes}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
