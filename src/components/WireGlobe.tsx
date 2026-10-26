'use client';

/**
 * WireGlobe – the WIRES view of the globe.
 *
 * A near-black sphere whose land is cut into stacked terraces, wrapped in glowing white coastlines and country
 * borders, a triangulated network over the continents, a bright limb, a faint lat/lon graticule (drawn by the
 * parent), drifting plexus and warped grids in the void, and a small satellite on a near-polar orbit.
 * Everything comes from bundled data (see lib/worldGeo) so it never depends on a network request.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { getTerraceTextures, loadWorldGeo, lonLatToPositions, type WorldGeo } from '@/lib/worldGeo';

export function useWorldGeo(): WorldGeo | null {
  const [geo, setGeo] = useState<WorldGeo | null>(null);
  useEffect(() => {
    let alive = true;
    loadWorldGeo().then(g => { if (alive) setGeo(g); }).catch(err => console.warn('[worldGeo] failed to build', err));
    return () => { alive = false; };
  }, []);
  return geo;
}

const RIM_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const RIM_FRAG = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = 1.0 - max(dot(normalize(vN), normalize(vV)), 0.0);
    float rim = pow(f, 4.2);
    float haze = pow(f, 2.0) * 0.10;
    vec3 col = mix(vec3(0.55, 0.72, 1.0), vec3(1.0), rim);
    gl_FragColor = vec4(col, clamp(rim * 1.25 + haze, 0.0, 1.0));
  }`;

function glowLines(positions: Float32Array, width: number, opacity: number, color: string) {
  const g = new LineSegmentsGeometry();
  g.setPositions(positions);
  const m = new LineMaterial({
    color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new LineSegments2(g, m);
}

function coreLines(positions: Float32Array, opacity: number, color: string) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

/** Country outlines + coast, each as a crisp 1px core with a soft wide halo behind it. */
function Outlines({ geo, radius }: { geo: WorldGeo; radius: number }) {
  const size = useThree(s => s.size);
  const objs = useMemo(() => {
    const coast = lonLatToPositions(geo.coast, radius + 0.004);
    const borders = lonLatToPositions(geo.borders, radius + 0.0035);
    const both = new Float32Array(coast.length + borders.length);
    both.set(coast, 0); both.set(borders, coast.length);
    return {
      halo: glowLines(both, 3.4, 0.13, '#9cc4ff'),
      coast: coreLines(coast, 1, '#ffffff'),
      borders: coreLines(borders, 0.6, '#e6eefb'),
    };
  }, [geo, radius]);

  useEffect(() => {
    (objs.halo.material as LineMaterial).resolution.set(size.width, size.height);
  }, [objs, size]);
  useEffect(() => () => {
    objs.halo.geometry.dispose(); (objs.halo.material as THREE.Material).dispose();
    objs.coast.geometry.dispose(); (objs.coast.material as THREE.Material).dispose();
    objs.borders.geometry.dispose(); (objs.borders.material as THREE.Material).dispose();
  }, [objs]);

  return (
    <>
      <primitive object={objs.halo} />
      <primitive object={objs.borders} />
      <primitive object={objs.coast} />
    </>
  );
}

/** The triangulated "network" laid over the land masses. */
function LandNetwork({ geo, radius }: { geo: WorldGeo; radius: number }) {
  const { lines, dots } = useMemo(() => {
    const r = radius + 0.0025;
    const nodes = new Float32Array(geo.netNodes.length);
    for (let i = 0; i < nodes.length; i++) nodes[i] = geo.netNodes[i] * r;
    const seg = new Float32Array(geo.netEdges.length * 3);
    for (let i = 0; i < geo.netEdges.length; i++) {
      const n = geo.netEdges[i] * 3;
      seg[i * 3] = nodes[n]; seg[i * 3 + 1] = nodes[n + 1]; seg[i * 3 + 2] = nodes[n + 2];
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(seg, 3));
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(nodes, 3));
    return { lines: lg, dots: dg };
  }, [geo, radius]);
  useEffect(() => () => { lines.dispose(); dots.dispose(); }, [lines, dots]);
  return (
    <>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#c9dcff" transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points geometry={dots}>
        <pointsMaterial color="#ffffff" size={1.6} sizeAttenuation={false} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  );
}

/** Drifting constellations and warped grids in the void around the globe. */
const Backdrop = memo(function Backdrop() {
  const group = useRef<THREE.Group>(null);
  const { net, sheets } = useMemo(() => {
    let s = 91;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pts: THREE.Vector3[] = [];
    const cam = new THREE.Vector3(0, 0, 3.75);
    while (pts.length < 200) {
      const r = 3.2 + rnd() * 3.6, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
      const p = new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.8, r * Math.sin(ph) * Math.sin(th));
      if (p.distanceTo(cam) < 2.4) continue;
      pts.push(p);
    }
    const seg: number[] = [];
    pts.forEach((a, i) => {
      let links = 0;
      for (let j = i + 1; j < pts.length && links < 3; j++) {
        if (a.distanceTo(pts[j]) < 1.5) { seg.push(a.x, a.y, a.z, pts[j].x, pts[j].y, pts[j].z); links++; }
      }
    });
    const nodeArr = new Float32Array(pts.flatMap(p => [p.x, p.y, p.z]));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(nodeArr, 3));

    const makeSheet = (seed: number) => {
      const N = 40, size = 8;
      const z = (x: number, y: number) => 0.55 * Math.sin(x * 1.3 + seed) * Math.cos(y * 1.1 - seed * 0.7) + 0.25 * Math.sin((x + y) * 2.1 + seed * 2);
      const v: number[] = [];
      for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const x = (i / N - 0.5) * size, y = (j / N - 0.5) * size;
        if (i < N) v.push(x, y, z(x, y), ((i + 1) / N - 0.5) * size, y, z(((i + 1) / N - 0.5) * size, y));
        if (j < N) v.push(x, y, z(x, y), x, ((j + 1) / N - 0.5) * size, z(x, ((j + 1) / N - 0.5) * size));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      return g;
    };
    return { net: { lg, pg }, sheets: [makeSheet(1.3), makeSheet(4.1)] };
  }, []);

  useEffect(() => () => { net.lg.dispose(); net.pg.dispose(); sheets.forEach(s => s.dispose()); }, [net, sheets]);
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.012; });

  return (
    <group ref={group}>
      <lineSegments geometry={net.lg}>
        <lineBasicMaterial color="#d6e4ff" transparent opacity={0.13} depthWrite={false} />
      </lineSegments>
      <points geometry={net.pg}>
        <pointsMaterial color="#ffffff" size={2} sizeAttenuation={false} transparent opacity={0.5} depthWrite={false} />
      </points>
      <lineSegments geometry={sheets[0]} position={[-5.6, -2.2, -4.2]} rotation={[-1.05, 0.65, 0.2]}>
        <lineBasicMaterial color="#9fb6d4" transparent opacity={0.085} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={sheets[1]} position={[5.8, 1.4, -4.8]} rotation={[-1.1, -0.55, -0.3]}>
        <lineBasicMaterial color="#9fb6d4" transparent opacity={0.085} depthWrite={false} />
      </lineSegments>
    </group>
  );
});

/** A small line-art satellite on a near-polar orbit (NISAR flies ~98°). */
const OrbitSatellite = memo(function OrbitSatellite({ radius }: { radius: number }) {
  const sat = useRef<THREE.Group>(null);
  const orbitR = radius * 1.46;
  const ring = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR)); }
    return pts;
  }, [orbitR]);
  const geos = useMemo(() => ({
    body: new THREE.BoxGeometry(0.07, 0.05, 0.05),
    panel: new THREE.BoxGeometry(0.15, 0.003, 0.055),
    dish: new THREE.ConeGeometry(0.022, 0.025, 14, 1, true),
  }), []);
  const edges = useMemo(() => ({
    body: new THREE.EdgesGeometry(geos.body),
    panel: new THREE.EdgesGeometry(geos.panel),
    dish: new THREE.EdgesGeometry(geos.dish),
  }), [geos]);
  useEffect(() => () => { Object.values(geos).forEach(g => g.dispose()); Object.values(edges).forEach(g => g.dispose()); }, [geos, edges]);

  useFrame(({ clock }) => {
    const a = clock.elapsedTime * 0.16 + 2.2;
    if (sat.current) sat.current.position.set(Math.cos(a) * orbitR, 0, Math.sin(a) * orbitR);
  });

  const lineMat = <lineBasicMaterial color="#ffffff" transparent opacity={0.9} />;
  const fill = <meshBasicMaterial color="#0d1015" />;
  return (
    <group rotation={[0.5, 0.95, Math.PI / 2 - 0.1]}>
      <Line points={ring} color="#cfe0ff" lineWidth={0.6} transparent opacity={0.16} dashed dashSize={0.05} gapSize={0.05} />
      <group ref={sat} scale={1.25}>
        <mesh geometry={geos.body}>{fill}</mesh>
        <lineSegments geometry={edges.body}>{lineMat}</lineSegments>
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.115, 0, 0]}>
            <mesh geometry={geos.panel}>{fill}</mesh>
            <lineSegments geometry={edges.panel}>{lineMat}</lineSegments>
          </group>
        ))}
        <group position={[0, -0.04, 0]} rotation={[Math.PI, 0, 0]}>
          <lineSegments geometry={edges.dish}>{lineMat}</lineSegments>
        </group>
      </group>
    </group>
  );
});

/** Everything that makes up WIRES mode (the graticule and event markers are drawn by the parent scene). */
export function WireGlobe({ radius }: { radius: number }) {
  const geo = useWorldGeo();
  const tex = useMemo(() => (geo ? getTerraceTextures(geo) : null), [geo]);
  return (
    <>
      <mesh>
        <sphereGeometry args={[radius, 128, 128]} />
        <meshStandardMaterial
          key={tex ? 'terraced' : 'plain'}
          color={tex ? '#ffffff' : '#07090d'}
          map={tex?.color ?? null}
          bumpMap={tex?.bump ?? null}
          bumpScale={tex ? 2.2 : 0}
          roughness={0.92}
          metalness={0}
        />
      </mesh>

      {geo && <Outlines geo={geo} radius={radius} />}
      {geo && <LandNetwork geo={geo} radius={radius} />}

      {/* bright limb */}
      <mesh>
        <sphereGeometry args={[radius * 1.004, 96, 96]} />
        <shaderMaterial
          vertexShader={RIM_VERT}
          fragmentShader={RIM_FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <Backdrop />
      <OrbitSatellite radius={radius} />
    </>
  );
}
