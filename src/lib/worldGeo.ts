/**
 * worldGeo – bundled world geometry (Natural Earth 1:50m via world-atlas).
 *
 * Everything the globe needs to draw geography *without any network request*:
 *   - coastline and country-border segments (lon/lat pairs)
 *   - an equirectangular land mask + distance-to-coast fields
 *   - a "terraced" colour/bump texture pair (stacked-paper look for WIRES / TERRAIN)
 *   - a stylised satellite-ish basemap, used while NASA imagery loads or when it is unreachable
 *   - a triangulated network over the land (the "plexus" in the wires look)
 *
 * Client-only (uses canvas). The heavy work runs once and is cached.
 */
import * as THREE from 'three';
import { feature, mesh } from 'topojson-client';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import type { GeometryCollection, Topology } from 'topojson-specification';

export const MASK_W = 2048;
export const MASK_H = 1024;
const D2R = Math.PI / 180;

export interface WorldGeo {
  /** lon,lat,lon,lat per segment */
  coast: Float32Array;
  borders: Float32Array;
  /** 1 = land, equirectangular MASK_W × MASK_H */
  mask: Uint8Array;
  /** px distance from land pixels to the nearest ocean pixel (0 on ocean) */
  dist: Float32Array;
  /** px distance from ocean pixels to the nearest land pixel (0 on land) */
  odist: Float32Array;
  /** unit-sphere xyz per node */
  netNodes: Float32Array;
  /** node index pairs */
  netEdges: Uint32Array;
}

/** Same convention as latLonToVec3 in GlobalSchematicGlobe, written into a flat array. */
export function lonLatToXYZ(lon: number, lat: number, r: number, out: ArrayLike<number> & { [i: number]: number }, o: number) {
  const phi = (90 - lat) * D2R;
  const th = (lon + 180) * D2R;
  out[o] = -r * Math.sin(phi) * Math.cos(th);
  out[o + 1] = r * Math.cos(phi);
  out[o + 2] = r * Math.sin(phi) * Math.sin(th);
}

/** [lon,lat,lon,lat,…] → [x,y,z,…] at radius r. */
export function lonLatToPositions(ll: Float32Array, r: number): Float32Array {
  const n = ll.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) lonLatToXYZ(ll[i * 2], ll[i * 2 + 1], r, out, i * 3);
  return out;
}

// ── helpers ────────────────────────────────────────────────────
const tick = () => new Promise<void>(r => setTimeout(r, 0));

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2-D value noise over the equirectangular plane; u,v in 0..1. */
function makeNoise(seed: number, gx = 48, gy = 24) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(gx * (gy + 1));
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * gx, y = v * gy;
    const x0 = Math.floor(x), y0 = Math.min(gy - 1, Math.floor(y));
    const fx = sm(x - x0), fy = sm(y - y0);
    const xa = ((x0 % gx) + gx) % gx, xb = (xa + 1) % gx;
    const a = g[y0 * gx + xa], b = g[y0 * gx + xb], c = g[(y0 + 1) * gx + xa], d = g[(y0 + 1) * gx + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

type LL = number[][];

function pushLine(out: number[], line: LL, maxStep = 1.2) {
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    if (Math.abs(x1 - x0) > 180) continue;                               // wrapped across the antimeridian
    if (Math.abs(x0) >= 179.98 && Math.abs(x1) >= 179.98) continue;      // the cut edge along ±180°
    if (y0 <= -89.9 && y1 <= -89.9) continue;                            // Antarctica's flat base
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / maxStep));
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n;
      out.push(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
    }
  }
}

function rasterMask(geoms: Array<{ type: string; coordinates: unknown }>): Uint8Array {
  const c = document.createElement('canvas');
  c.width = MASK_W; c.height = MASK_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MASK_W, MASK_H);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const X = (lon: number) => ((lon + 180) / 360) * MASK_W;
  const Y = (lat: number) => ((90 - lat) / 180) * MASK_H;
  for (const g of geoms) {
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as LL[][];
    for (const poly of polys) for (const ring of poly) {
      // unwrap longitudes so a ring crossing ±180° stays continuous, then draw it and its ±360° copies
      const xs: number[] = []; let k = 0, prev = ring[0][0];
      for (const [lon] of ring) {
        if (lon - prev > 180) k -= 1; else if (lon - prev < -180) k += 1;
        prev = lon; xs.push(lon + 360 * k);
      }
      for (const off of [-360, 0, 360]) {
        ring.forEach(([, lat], i) => (i ? ctx.lineTo(X(xs[i] + off), Y(lat)) : ctx.moveTo(X(xs[i] + off), Y(lat))));
        ctx.closePath();
      }
    }
  }
  ctx.fill('evenodd');
  const px = ctx.getImageData(0, 0, MASK_W, MASK_H).data;
  const mask = new Uint8Array(MASK_W * MASK_H);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 1 : 0;
  return mask;
}

/** Two-pass chamfer distance (in "ground pixels": horizontal steps shrink with cos(lat)). */
function chamfer(seed: Uint8Array): Float32Array {
  const W = MASK_W, H = MASK_H, INF = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : INF;
  const wx = new Float32Array(H), wd = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    wx[y] = Math.max(0.06, Math.cos((0.5 - (y + 0.5) / H) * Math.PI));
    wd[y] = Math.hypot(wx[y], 1);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + wx[y]);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 1);
      if (x > 0) v = Math.min(v, d[i - W - 1] + wd[y]);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + wd[y]);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + wx[y]);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 1);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + wd[y]);
      if (x > 0) v = Math.min(v, d[i + W - 1] + wd[y]);
    }
    d[i] = v;
  }
  return d;
}

const isLandAt = (mask: Uint8Array, lon: number, lat: number) => {
  const x = ((Math.floor(((lon + 180) / 360) * MASK_W) % MASK_W) + MASK_W) % MASK_W;
  const y = Math.max(0, Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H)));
  return mask[y * MASK_W + x] === 1;
};

/** Triangulated network over the land: coast samples + a jittered Fibonacci sphere, joined via a convex hull. */
function buildNetwork(mask: Uint8Array, coast: Float32Array) {
  const rnd = mulberry32(7);
  const nodes: Array<[number, number]> = [];
  const cells = new Set<number>();
  const CELL = 1.0;
  const cellKey = (lon: number, lat: number) => Math.floor((lat + 90) / CELL) * 1000 + Math.floor((lon + 180) / CELL);

  // coastline samples, so the mesh hugs the shore
  const thin = new Set<number>();
  for (let i = 0; i < coast.length; i += 4) {
    const lon = coast[i], lat = coast[i + 1];
    const tk = Math.floor((lat + 90) / 1.5) * 1000 + Math.floor((lon + 180) / 1.5);
    if (thin.has(tk)) continue;
    thin.add(tk);
    cells.add(cellKey(lon, lat));
    nodes.push([lon, lat]);
  }
  // interior
  const N = 12000, golden = Math.PI * (3 - Math.sqrt(5));
  const spacingDeg = Math.sqrt((4 * Math.PI) / N) / D2R;
  for (let i = 0; i < N; i++) {
    const s = 1 - (2 * (i + 0.5)) / N;
    let lat = Math.asin(s) / D2R;
    let lon = ((((i * golden) / D2R) % 360) + 360) % 360 - 180;
    lat += (rnd() - 0.5) * spacingDeg * 0.7;
    lon += ((rnd() - 0.5) * spacingDeg * 0.7) / Math.max(0.2, Math.cos(lat * D2R));
    if (lat > 89 || lat < -89 || !isLandAt(mask, lon, lat)) continue;
    const k = cellKey(lon, lat);
    if (cells.has(k)) continue;
    cells.add(k);
    nodes.push([lon, lat]);
  }

  const pts = nodes.map(([lon, lat]) => {
    const a = [0, 0, 0];
    lonLatToXYZ(lon, lat, 1, a, 0);
    return new THREE.Vector3(a[0], a[1], a[2]);
  });
  const hull = new ConvexHull().setFromPoints(pts);
  const index = new Map<THREE.Vector3, number>();
  pts.forEach((p, i) => index.set(p, i));

  const maxChord = 2 * Math.sin((4.4 * D2R) / 2);
  const seen = new Set<number>();
  const used = new Map<number, number>();
  const pairs: number[] = [];
  const mid = new THREE.Vector3();
  for (const face of hull.faces) {
    let e = face.edge;
    do {
      const a = index.get(e.tail()!.point), b = index.get(e.head().point);
      e = e.next;
      if (a === undefined || b === undefined) continue;
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      if (pts[a].distanceTo(pts[b]) > maxChord) continue;
      mid.addVectors(pts[a], pts[b]).normalize();
      const lat = Math.asin(mid.y) / D2R;
      // invert lonLatToXYZ: y = cosφ, x = -sinφ cosθ, z = sinφ sinθ
      const th = Math.atan2(mid.z, -mid.x);
      const lon = th / D2R - 180;
      if (!isLandAt(mask, ((lon + 540) % 360) - 180, lat)) continue;
      if (!used.has(a)) used.set(a, used.size);
      if (!used.has(b)) used.set(b, used.size);
      pairs.push(a, b);
    } while (e !== face.edge);
  }
  const netNodes = new Float32Array(used.size * 3);
  used.forEach((slot, src) => { netNodes[slot * 3] = pts[src].x; netNodes[slot * 3 + 1] = pts[src].y; netNodes[slot * 3 + 2] = pts[src].z; });
  const netEdges = new Uint32Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) netEdges[i] = used.get(pairs[i])!;
  return { netNodes, netEdges };
}

// ── loader ─────────────────────────────────────────────────────
let cache: Promise<WorldGeo> | null = null;

export function loadWorldGeo(): Promise<WorldGeo> {
  if (!cache) cache = build().catch(err => { cache = null; throw err; });
  return cache;
}

async function build(): Promise<WorldGeo> {
  const topo = (await import('world-atlas/countries-50m.json')).default as Topology;
  const countries = topo.objects.countries as GeometryCollection;

  const coastOut: number[] = [];
  const borderOut: number[] = [];
  for (const line of mesh(topo, countries, (a, b) => a === b).coordinates) pushLine(coastOut, line as LL);
  for (const line of mesh(topo, countries, (a, b) => a !== b).coordinates) pushLine(borderOut, line as LL);
  await tick();

  const land = feature(topo, topo.objects.land as GeometryCollection) as unknown as
    | { type: 'FeatureCollection'; features: Array<{ geometry: { type: string; coordinates: unknown } }> }
    | { type: 'Feature'; geometry: { type: string; coordinates: unknown } };
  const geoms = land.type === 'FeatureCollection' ? land.features.map(f => f.geometry) : [land.geometry];
  const mask = rasterMask(geoms);
  await tick();

  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const dist = chamfer(inv);   // land → distance to ocean
  const odist = chamfer(mask); // ocean → distance to land
  await tick();

  const coast = new Float32Array(coastOut);
  const { netNodes, netEdges } = buildNetwork(mask, coast);
  return { coast, borders: new Float32Array(borderOut), mask, dist, odist, netNodes, netEdges };
}

// ── textures ───────────────────────────────────────────────────
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

const terraceCache = new WeakMap<WorldGeo, { color: THREE.CanvasTexture; bump: THREE.CanvasTexture }>();

/**
 * Stacked-paper land: concentric plateaus inwards from every coast, wobbled by noise so they read like
 * contour terraces. Returns a colour map and a stepped height map (for bump shading).
 */
export function getTerraceTextures(g: WorldGeo) {
  const hit = terraceCache.get(g);
  if (hit) return hit;
  const W = MASK_W, H = MASK_H;
  const LEVELS = 8, BAND = 7.5;
  const n1 = makeNoise(11), n2 = makeNoise(23, 120, 60);
  const lv = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!g.mask[i]) continue;
    const u = x / W, v = y / H;
    const d = g.dist[i] * (0.8 + 0.5 * n1(u, v)) + 5 * n2(u, v);
    lv[i] = 1 + Math.min(LEVELS - 1, Math.floor(d / BAND));
  }

  const col = document.createElement('canvas'); col.width = W; col.height = H;
  const cctx = col.getContext('2d')!;
  const img = cctx.createImageData(W, H);
  const out = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    const l = lv[i];
    if (!l) { out[o] = 5; out[o + 1] = 7; out[o + 2] = 11; out[o + 3] = 255; continue; }
    const t = (l - 1) / (LEVELS - 1);
    let r = lerp(34, 112, t), gg = lerp(38, 118, t), b = lerp(45, 130, t);
    const right = x < W - 1 ? lv[i + 1] : l, below = y < H - 1 ? lv[i + W] : l;
    if (right !== l || below !== l) { r += 30; gg += 32; b += 36; }   // lit lip of each plateau
    out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = 255;
  }
  cctx.putImageData(img, 0, 0);

  const raw = document.createElement('canvas'); raw.width = W; raw.height = H;
  const rctx = raw.getContext('2d')!;
  const himg = rctx.createImageData(W, H);
  for (let i = 0; i < lv.length; i++) {
    const v = lv[i] ? 40 + lv[i] * 26 : 0;
    himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = v; himg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(himg, 0, 0);
  const bump = document.createElement('canvas'); bump.width = W; bump.height = H;
  const bctx = bump.getContext('2d')!;
  bctx.filter = 'blur(1.6px)';
  bctx.drawImage(raw, 0, 0);

  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const res = { color: mk(col, true), bump: mk(bump, false) };
  terraceCache.set(g, res);
  return res;
}

const basemapCache = new WeakMap<WorldGeo, HTMLCanvasElement>();

/** Stylised satellite-style basemap (ocean shelf, climate-banded land, ice caps) – shown when NASA imagery is unavailable. */
function getBasemap(g: WorldGeo): HTMLCanvasElement {
  const hit = basemapCache.get(g);
  if (hit) return hit;
  const W = MASK_W, H = MASK_H;
  const n1 = makeNoise(5, 64, 32), n2 = makeNoise(9, 200, 100), n3 = makeNoise(17, 144, 72);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const out = img.data;
  const mix = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const TROP = [31, 92, 48], ARID = [154, 134, 82], TEMP = [66, 106, 60], ICE = [226, 234, 240];
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180, alat = Math.abs(lat);
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4, u = x / W, v = y / H;
      let col: number[];
      if (g.mask[i]) {
        const wet = n1(u, v);
        let base: number[];
        if (alat < 11) base = TROP;
        else if (alat < 40) base = mix(TEMP, ARID, clamp01((0.35 + (1 - wet) * 1.1 - Math.abs(alat - 24) / 30)) * clamp01((40 - alat) / 10));
        else base = TEMP;
        base = mix(base, [118, 106, 84], clamp01(g.dist[i] / 140) * 0.45 * n3(u, v));  // interior uplands
        col = mix(base, ICE, clamp01((alat - 58) / 10));
        const shade = 0.92 + 0.16 * n2(u, v);
        col = col.map(k => k * shade);
      } else {
        const shelf = Math.exp(-g.odist[i] / 12);
        col = mix([4, 22, 44], [14, 86, 128], shelf);
        col = mix(col, [3, 14, 30], clamp01(alat / 90) * 0.5);
      }
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  basemapCache.set(g, c);
  return c;
}

/** Paint the bundled basemap (plus vector coast/borders/graticule at full resolution) into an existing canvas. */
export function paintBasemap(ctx: CanvasRenderingContext2D, g: WorldGeo, w: number, h: number) {
  ctx.drawImage(getBasemap(g), 0, 0, w, h);
  const X = (lon: number) => ((lon + 180) / 360) * w, Y = (lat: number) => ((90 - lat) / 180) * h;
  const strokeSegs = (segs: Float32Array, style: string, lw: number) => {
    ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(X(segs[i]), Y(segs[i + 1])); ctx.lineTo(X(segs[i + 2]), Y(segs[i + 3])); }
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let lat = -60; lat <= 60; lat += 30) { ctx.moveTo(0, Y(lat)); ctx.lineTo(w, Y(lat)); }
  for (let lon = -150; lon <= 150; lon += 30) { ctx.moveTo(X(lon), 0); ctx.lineTo(X(lon), h); }
  ctx.stroke();
  strokeSegs(g.borders, 'rgba(255,240,210,0.34)', Math.max(1, w / 4096));
  strokeSegs(g.coast, 'rgba(210,235,255,0.55)', Math.max(1, (w / 4096) * 1.2));
}
