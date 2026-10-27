/**
 * worldVector – land polygons and country borders as GeoJSON for the radar basemap (Natural Earth 1:50m via world-atlas).
 * Bundled, so the radar basemap draws offline and its colours are ours to choose.
 */
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson';

export interface WorldVector { land: FeatureCollection; borders: Feature<MultiLineString> }

type Ring = number[][];
/** Make a ring continuous across the antimeridian by letting longitudes run past ±180. */
function unwrap(ring: Ring): Ring {
  const out: Ring = []; let shift = 0;
  ring.forEach(([x, y], i) => {
    if (i > 0) { const prev = ring[i - 1][0]; if (x - prev > 180) shift -= 360; else if (x - prev < -180) shift += 360; }
    out.push([x + shift, y]);
  });
  return out;
}
const shiftRing = (r: Ring, dx: number): Ring => r.map(([x, y]) => [x + dx, y]);

/** Polygons that straddle ±180 are drawn as one continuous shape plus a copy on the other side, so no edge spans the world. */
function fixAntimeridian(fc: FeatureCollection): FeatureCollection {
  const polys: number[][][][] = [];
  const add = (poly: number[][][]) => {
    const xs = poly[0].map(c => c[0]); const ys = poly[0].map(c => c[1]);
    const wide = Math.max(...xs) - Math.min(...xs) > 180;
    if (!wide || Math.min(...ys) < -60) { polys.push(poly); return; }
    const u = poly.map(unwrap); polys.push(u);
    const ux = u[0].map(c => c[0]);
    if (Math.max(...ux) > 180) polys.push(u.map(r => shiftRing(r, -360)));
    if (Math.min(...ux) < -180) polys.push(u.map(r => shiftRing(r, 360)));
  };
  fc.features.forEach(f => {
    const g = f.geometry as Geometry;
    if (g.type === 'Polygon') add(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(add);
  });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polys } }] };
}

let cache: Promise<WorldVector> | null = null;

export function loadWorldVector(): Promise<WorldVector> {
  cache ??= (async () => {
    const topo = (await import('world-atlas/countries-50m.json')).default as unknown as Topology;
    const land = feature(topo, topo.objects.land as GeometryCollection) as unknown as Feature<Geometry> | FeatureCollection;
    const fc: FeatureCollection = land.type === 'FeatureCollection' ? land : { type: 'FeatureCollection', features: [land] };
    const borders = mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b) as MultiLineString;
    return { land: fixAntimeridian(fc), borders: { type: 'Feature', properties: {}, geometry: borders } };
  })();
  return cache;
}
