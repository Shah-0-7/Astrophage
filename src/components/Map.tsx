/**
 * ============================================================
 * Map Component – 2D Radar Map for EVENT_RADAR_2D view
 * ============================================================
 * Real data sources:
 *   • USGS FDSN Event API  – live M4.5+ earthquakes (30 days)
 *   • PB2002 boundaries    – fraxen/tectonicplates GeoJSON
 * ============================================================
 */

'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, useControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { useStore } from '@/lib/store';
import { useNISARData } from '@/lib/useNISARData';
import { TARGET_NODES, NODE_BOUNDING_BOXES } from '@/lib/mockData';
import { useEarthquakeData, type USGSEarthquake } from '@/lib/useEarthquakeData';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Serve the MapLibre worker from /public to avoid Next.js bundling issues
if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre-gl-worker.mjs');
}

// ESRI World Dark Gray Base - totally free, no API keys, pure raster
const MAP_STYLE: any = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256
    }
  },
  layers: [
    {
      id: 'esri-basemap',
      type: 'raster',
      source: 'esri',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

const CATEGORY_COLOR: Record<string, { fill: string; stroke: string; icon: string }> = {
  TECTONIC:  { fill: 'rgba(239,68,68,0.18)',  stroke: '#ef4444', icon: '▲' },
  CRYOSPHERE:{ fill: 'rgba(96,165,250,0.18)', stroke: '#60a5fa', icon: '◆' },
  VOLCANIC:  { fill: 'rgba(251,146,60,0.18)', stroke: '#fb923c', icon: '⬡' },
  BIOMASS:   { fill: 'rgba(74,222,128,0.18)', stroke: '#4ade80', icon: '●' },
};

const STATUS_PULSE: Record<string, string> = {
  CRITICAL: '#ef4444',
  ELEVATED: '#fb923c',
  NOMINAL:  '#4ade80',
};

// ── Magnitude → radius (metres) ─────────────────────────────
function magToRadius(mag: number): number {
  return Math.pow(10, (mag - 3.5) * 0.6) * 18000;
}

// ── Magnitude → RGBA colour (green→yellow→orange→red) ───────
function magToColor(mag: number): [number, number, number, number] {
  if (mag >= 7.0) return [239, 68,  68,  230];
  if (mag >= 6.0) return [251, 146, 60,  220];
  if (mag >= 5.0) return [250, 204, 21,  200];
  return                 [74,  222, 128, 180];
}

// ── Format epoch ms as human-readable date/time ─────────────
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

/** DeckGL overlay injected into MapLibre's own WebGL context — zero drift guaranteed */
function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

/** Compute minimum zoom: stop when first dimension (W or H) fills the viewport */
function computeMinZoom(width: number, height: number): number {
  const zoomForWidth  = Math.log2(width  / 512);
  const zoomForHeight = Math.log2(height / 512);
  return Math.max(0, Math.min(zoomForWidth, zoomForHeight));
}

export default function MapComponent() {
  const activeNodeId    = useStore(s => s.activeNodeId);
  const setActiveNodeId = useStore(s => s.setActiveNodeId);
  const phaseFilterMode    = useStore(s => s.phaseFilterMode);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);
  const currentPassIndex   = useStore(s => s.currentPassIndex);
  const flyToCoords        = useStore(s => s.flyToCoords);
  const { activeScenario, filteredFeatures } = useNISARData();

  // Dynamic minZoom based on container size
  const containerRef = useRef<HTMLDivElement>(null);
  const [minZoom, setMinZoom] = useState(1.0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = (w: number, h: number) => setMinZoom(computeMinZoom(w, h));
    update(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) update(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Live earthquake + fault data
  const { earthquakes, faultLines, status, lastUpdated, refetch } = useEarthquakeData(4.5, 300);
  const [selectedEq, setSelectedEq] = useState<USGSEarthquake | null>(null);

  // Seismic event triggers: which passes fire events on which nodes
  const SEISMIC_EVENTS: Record<number, string[]> = {
    2:  ['TC-89'],
    5:  ['EQ-99', 'TC-44'],
    8:  ['TC-31'],
    11: ['TC-89', 'EQ-99'],
    14: ['TC-44', 'TC-31'],
    17: ['EQ-99'],
  };
  const seismicNodeIds: string[] = SEISMIC_EVENTS[currentPassIndex] ?? [];
  const [seismicAlert, setSeismicAlert] = useState<string[]>([]);
  useEffect(() => {
    if (seismicNodeIds.length > 0) {
      setSeismicAlert(seismicNodeIds);
      const t = setTimeout(() => setSeismicAlert([]), 4000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPassIndex]);

  const activeNode = TARGET_NODES.find(n => n.id === activeNodeId);
  const bb = activeNodeId ? NODE_BOUNDING_BOXES[activeNodeId] : null;

  // MapLibre map ref for programmatic flyTo
  const mapRef = useRef<MapRef>(null);

  const [viewState, setViewState] = useState({
    longitude: bb?.center[0] ?? activeScenario.center[0],
    latitude:  bb?.center[1] ?? activeScenario.center[1],
    zoom:      bb?.zoom2D    ?? activeScenario.zoom,
    pitch:     0,
    bearing:   0,
  });

  useEffect(() => {
    const bbox = activeNodeId ? NODE_BOUNDING_BOXES[activeNodeId] : null;
    const target = {
      center: [bbox?.center[0] ?? activeScenario.center[0], bbox?.center[1] ?? activeScenario.center[1]] as [number, number],
      zoom:   bbox?.zoom2D ?? activeScenario.zoom,
    };
    mapRef.current?.flyTo({ ...target, duration: 2000, essential: true });
    setViewState(prev => ({ ...prev, longitude: target.center[0], latitude: target.center[1], zoom: target.zoom }));
  }, [activeNodeId, activeScenario]);

  useEffect(() => {
    if (flyToCoords) {
      mapRef.current?.flyTo({
        center: flyToCoords as [number, number],
        zoom: Math.max(viewState.zoom, 6),
        duration: 1500,
        essential: true,
      });
    }
  }, [flyToCoords]);

  const layers = useMemo(() => {
    const isFiltered  = phaseFilterMode === 'FILTERED';
    const epochFactor = currentPassIndex / 17;
    const threatRadius = 10000 + epochFactor * 14000;

    return [
      // ── PB2002 tectonic plate boundary fault lines ──────────
      ...(faultLines ? [new GeoJsonLayer({
        id: 'pb2002-faults',
        data: faultLines,
        pickable: false,
        stroked: true,
        filled: false,
        getLineColor: [251, 146, 60, 100] as [number, number, number, number],
        getLineWidth: 1,
        lineWidthMinPixels: 1,
        lineWidthMaxPixels: 2,
      })] : []),

      // ── NISAR InSAR scenario overlay ────────────────────────
      new GeoJsonLayer({
        id: `nisar-insar-${activeScenario.id}-${phaseFilterMode}`,
        data: filteredFeatures,
        pickable: true,
        stroked: true,
        filled: true,
        extruded: false,
        wireframe: !isFiltered,
        lineWidthScale: 20,
        lineWidthMinPixels: 1,
        getElevation: (f: any) => {
          const p = f.properties;
          if (p.category === 'glacier')    return (p.velocity || 0) * 10;
          if (p.category === 'earthquake') return Math.abs(p.displacement || 0) * 50;
          return 40;
        },
        getFillColor: (f: any) => {
          const p = f.properties;
          if (p.color) return [...(p.color as [number, number, number]), Math.floor((p.opacity || 0.6) * 255)] as [number, number, number, number];
          if (isFiltered) {
            if (p.category === 'earthquake') {
              const coh = p.displacement ? Math.min(Math.abs(p.displacement) / 30, 1) : 0;
              if (coh < coherenceThreshold) return [0, 0, 0, 0];
              return [239, 68, 68, Math.floor(coh * 220) + 35];
            }
            if (p.category === 'glacier')     return [96, 165, 250, 180];
            if (p.category === 'agriculture') return [74, 222, 128, 160];
          } else {
            if (p.category === 'earthquake') {
              const phase = (Math.abs(p.displacement || 0) * 3.14) % (2 * Math.PI);
              const v = Math.floor((Math.sin(phase) + 1) * 0.5 * 200);
              return [v, v, v, 180];
            }
          }
          if (p.category === 'glacier')     return [96, 165, 250, 180];
          if (p.category === 'agriculture') return [74, 222, 128, 150];
          if (p.category === 'wildfire')    return [239, 68, 68, 200];
          return [255, 255, 255, 80];
        },
        getLineColor: (f: any) => {
          if (f.geometry.type === 'LineString') return [239, 68, 68, 220];
          return [255, 255, 255, 40];
        },
        getLineWidth: 1,
        getPointRadius: (f: any) => {
          const p = f.properties;
          if (p.radius)                    return p.radius * 100;
          if (p.category === 'earthquake') return Math.abs(p.displacement || 5) * 50;
          return 80;
        },
        pointRadiusMinPixels: 2,
        pointRadiusMaxPixels: 18,
        transitions: { getFillColor: 400, getElevation: 400, getPointRadius: 400 },
      }),

      // ── USGS live earthquake scatter dots ───────────────────
      new ScatterplotLayer<USGSEarthquake>({
        id: 'usgs-earthquakes',
        data: earthquakes,
        getPosition: (d) => d.coords,
        getRadius:   (d) => magToRadius(d.magnitude),
        getFillColor:(d) => magToColor(d.magnitude),
        getLineColor: [255, 255, 255, 60] as [number, number, number, number],
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        radiusUnits: 'meters',
        radiusMinPixels: 3,
        radiusMaxPixels: 28,
        pickable: true,
        onClick: ({ object }) => { if (object) setSelectedEq(object); },
        updateTriggers: { getRadius: earthquakes.length, getFillColor: earthquakes.length },
      }),

      // ── Active node threat rings ─────────────────────────────
      ...(activeNode ? Array.from({ length: 4 }).map((_, i) => {
        const t = i / 3;
        return new ScatterplotLayer({
          id: `threat-ring-${i}`,
          data: [{ position: activeNode.coords }],
          getPosition: (d: any) => d.position,
          getRadius: threatRadius * (1 - t * 0.55),
          getFillColor: [239, 68, 68, 6 + Math.round(epochFactor * 20) + i * 12],
          getLineColor: i === 0 ? [239, 68, 68, 200] : [239, 68, 68, Math.max(0, 80 - i * 18)],
          stroked: true,
          filled: true,
          lineWidthMinPixels: i === 0 ? 2 : 1,
          radiusUnits: 'meters',
          pickable: false,
          updateTriggers: { getRadius: currentPassIndex, getFillColor: currentPassIndex },
        });
      }) : []),

      // ── Active node epicentre dot ────────────────────────────
      ...(activeNode ? [
        new ScatterplotLayer({
          id: 'epicenter-dot',
          data: [{ position: activeNode.coords }],
          getPosition: (d: any) => d.position,
          getRadius: 350,
          getFillColor: [255, 255, 255, 255],
          stroked: false,
          radiusUnits: 'meters',
          pickable: false,
        }),
      ] : []),
    ];
  }, [filteredFeatures, activeScenario.id, phaseFilterMode, coherenceThreshold, activeNode, currentPassIndex, earthquakes, faultLines]);

  // Tooltip handler for DeckGLOverlay
  const getTooltip = ({ object }: any) => {
    if (!object) return null;
    if ('magnitude' in object) {
      const eq = object as USGSEarthquake;
      return {
        html: `
          <div style="font-family:'Roboto Mono',monospace;font-size:11px;line-height:1.6;">
            <div style="font-weight:700;margin-bottom:3px;letter-spacing:.14em;color:rgb(${magToColor(eq.magnitude).slice(0,3).join(',')});text-transform:uppercase;font-size:9px;">
              M${eq.magnitude.toFixed(1)} EARTHQUAKE
            </div>
            <div style="color:white;font-size:11px;max-width:200px;margin-bottom:3px;">${eq.place}</div>
            <div style="color:rgba(255,255,255,.45);font-size:8px;letter-spacing:.08em;">
              ${new Date(eq.time).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
              &nbsp;·&nbsp; Depth ${eq.coords[2].toFixed(0)} km
            </div>
            <div style="color:rgba(255,255,255,.3);font-size:8px;margin-top:3px;letter-spacing:.1em;">Click for details</div>
          </div>
        `,
        style: {
          backgroundColor: 'rgba(9,9,11,.92)',
          border: `1px solid rgba(${magToColor(eq.magnitude).slice(0,3).join(',')}, .4)`,
          boxShadow: '0 8px 32px rgba(0,0,0,.6)',
          borderRadius: '2px',
          color: 'white',
          backdropFilter: 'blur(16px)',
          padding: '10px 12px',
        },
      };
    }
    return {
      html: `
        <div style="font-family:'Roboto Mono',monospace;font-size:11px;line-height:1.6;">
          <div style="font-weight:700;margin-bottom:4px;letter-spacing:.12em;color:#ef4444;text-transform:uppercase;font-size:9px;">
            ${(object as any).properties?.category ?? 'UNKNOWN'}
          </div>
          <div style="color:rgba(255,255,255,.55);font-size:9px;">${(object as any).properties?.metricName ?? ''}:</div>
          <div style="color:white;font-weight:700;font-size:13px;">${(object as any).properties?.metricValue ?? ''}</div>
          <div style="color:rgba(255,255,255,.3);font-size:8px;margin-top:4px;letter-spacing:.1em;">
            ${new Date((object as any).properties?.timestamp ?? '').toLocaleDateString()}
          </div>
        </div>
      `,
      style: {
        backgroundColor: 'rgba(9,9,11,.92)',
        border: '1px solid rgba(255,255,255,.10)',
        boxShadow: '0 8px 32px rgba(0,0,0,.6)',
        borderRadius: '2px',
        color: 'white',
        backdropFilter: 'blur(16px)',
        padding: '10px 12px',
      },
    };
  };

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full bg-black">

      {/* ── Seismic Event HUD Alert ───────────────────────────── */}
      {seismicAlert.length > 0 && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ top: 12, left: '50%', transform: 'translateX(-50%)' }}
        >
          <div
            className="flex items-center gap-3 px-4 py-2"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.6)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 0 32px rgba(239,68,68,0.3)',
              animation: 'pulse 1s ease-in-out infinite',
            }}
          >
            <div className="w-2 h-2 rounded-full animate-ping" style={{ background: '#ef4444', flexShrink: 0 }} />
            <span className="font-mono" style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, letterSpacing: '0.22em' }}>⚠ SEISMIC EVENT DETECTED</span>
            <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.12em' }}>
              {seismicAlert.map(id => TARGET_NODES.find(n => n.id === id)?.label ?? id).join(' · ')}
            </span>
            <span className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>PASS {String(currentPassIndex + 1).padStart(2,'0')}</span>
          </div>
        </div>
      )}

      {/* ── USGS feed status badge ───────────────────────────── */}
      <div
        className="absolute z-30 flex items-center gap-2"
        style={{ top: 8, right: 130, pointerEvents: 'none' }}
      >
        <div
          className="flex items-center gap-1.5 px-2 py-1"
          style={{
            background: 'rgba(9,9,11,0.82)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${status === 'loading' ? 'animate-pulse' : ''}`}
            style={{
              background: status === 'ok' ? '#4ade80'
                        : status === 'error' ? '#ef4444'
                        : '#fb923c',
            }}
          />
          <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em' }}>
            USGS M4.5+
          </span>
          <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
            {status === 'ok' ? `${earthquakes.length} EVT` : status.toUpperCase()}
          </span>
          {lastUpdated && (
            <span className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
              · {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          onClick={refetch}
          className="tac-btn text-[8px] h-6 px-2"
          style={{ pointerEvents: 'auto' }}
          title="Refresh earthquake feed"
        >
          ↺
        </button>
      </div>

      {/* ── Selected earthquake event panel ─────────────────── */}
      {selectedEq && (
        <div
          className="absolute z-30"
          style={{
            top: 56, right: 12,
            width: 268,
            background: 'rgba(9,9,11,0.94)',
            border: '1px solid rgba(239,68,68,0.35)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 0 24px rgba(239,68,68,0.15)',
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: magToColor(selectedEq.magnitude).slice(0,3).map(v=>`${v}`).join('') ? `rgb(${magToColor(selectedEq.magnitude).slice(0,3).join(',')})` : '#ef4444' }}
              />
              <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.18em' }}>SEISMIC EVENT</span>
            </div>
            <button
              onClick={() => setSelectedEq(null)}
              className="font-mono text-[11px] text-white/40 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Magnitude hero */}
          <div className="px-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-end gap-3">
              <div>
                <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', marginBottom: 2 }}>MAGNITUDE</p>
                <p
                  className="font-mono font-bold leading-none"
                  style={{
                    fontSize: 42,
                    color: `rgb(${magToColor(selectedEq.magnitude).slice(0,3).join(',')})`,
                    textShadow: `0 0 20px rgb(${magToColor(selectedEq.magnitude).slice(0,3).join(',')})`,
                  }}
                >
                  {selectedEq.magnitude.toFixed(1)}
                </p>
              </div>
              <div className="mb-2">
                {selectedEq.tsunami === 1 && (
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 mb-1"
                    style={{ background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.4)' }}
                  >
                    <span style={{ fontSize: 10 }}>🌊</span>
                    <span className="font-mono" style={{ fontSize: 8, color: '#60a5fa', letterSpacing: '0.12em' }}>TSUNAMI WARNING</span>
                  </div>
                )}
                <div className="flex items-center gap-1 px-2 py-0.5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>SIG</span>
                  <span className="font-mono font-bold" style={{ fontSize: 11, color: 'white' }}>{selectedEq.sig}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Event details */}
          <div className="px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em', marginBottom: 4 }}>LOCATION</p>
            <p className="font-mono" style={{ fontSize: 11, color: 'white', lineHeight: 1.4 }}>{selectedEq.place}</p>
          </div>

          <div className="px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em', marginBottom: 4 }}>ORIGIN TIME</p>
            <p className="font-mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)' }}>{fmtTime(selectedEq.time)}</p>
          </div>

          {/* Grid: coords + depth */}
          <div className="grid grid-cols-3 px-3 py-2.5" style={{ gap: '1px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {[
              { label: 'LAT', value: selectedEq.coords[1].toFixed(3) + '°' },
              { label: 'LON', value: selectedEq.coords[0].toFixed(3) + '°' },
              { label: 'DEPTH', value: selectedEq.coords[2].toFixed(1) + ' km' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px' }}>
                <p className="font-mono" style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', marginBottom: 2 }}>{label}</p>
                <p className="font-mono font-bold" style={{ fontSize: 10, color: 'white' }}>{value}</p>
              </div>
            ))}
          </div>

          {/* USGS link */}
          <div className="px-3 py-2">
            <a
              href={selectedEq.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              style={{ fontSize: 9, color: 'rgba(239,68,68,0.7)', letterSpacing: '0.12em' }}
            >
              <span>↗</span> VIEW ON USGS
            </a>
          </div>
        </div>
      )}

      <MapLibreMap
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle={MAP_STYLE}
        attributionControl={false}
        renderWorldCopies={false}
        minZoom={minZoom}
        maxZoom={18}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      >
        {/* DeckGL layers injected into MapLibre’s WebGL context — guaranteed in-sync */}
        <DeckGLOverlay
          layers={layers}
          getTooltip={getTooltip}
          interleaved={false}
        />
        {TARGET_NODES.map(node => {
          const isActive   = node.id === activeNodeId;
          const cat        = CATEGORY_COLOR[node.category] ?? CATEGORY_COLOR.TECTONIC;
          const pulseColor = STATUS_PULSE[node.status] ?? '#4ade80';
          const isSeismic  = seismicAlert.includes(node.id);

          return (
            <Marker
              key={node.id}
              longitude={node.coords[0]}
              latitude={node.coords[1]}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setActiveNodeId(node.id);
              }}
            >
              <div
                className="relative flex items-center justify-center cursor-pointer"
                style={{ width: isActive ? 36 : isSeismic ? 32 : 24, height: isActive ? 36 : isSeismic ? 32 : 24, zIndex: isSeismic ? 60 : isActive ? 50 : 10 }}
                title={`${node.label} [${node.id}]`}
              >
                {/* Seismic event burst rings */}
                {isSeismic && [
                  { s: '0s', sz: 60 },
                  { s: '0.4s', sz: 90 },
                  { s: '0.8s', sz: 120 },
                ].map(({ s, sz }, ri) => (
                  <div
                    key={ri}
                    className="absolute rounded-full animate-ping pointer-events-none"
                    style={{
                      width: sz, height: sz,
                      background: 'transparent',
                      border: '1.5px solid #ef4444',
                      opacity: 0.6,
                      animationDuration: '1.2s',
                      animationDelay: s,
                    }}
                  />
                ))}
                {/* Seismic label callout */}
                {isSeismic && (
                  <div
                    className="absolute whitespace-nowrap pointer-events-none"
                    style={{
                      bottom: '110%',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.7)',
                      padding: '4px 10px',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 0 16px rgba(239,68,68,0.4)',
                      zIndex: 70,
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: 8, color: '#ef4444', fontWeight: 700, letterSpacing: '0.18em' }}>⚠ SEISMIC EVENT</span>
                    <span className="font-mono" style={{ fontSize: 9, color: 'white', marginLeft: 6 }}>{node.label}</span>
                  </div>
                )}
                {(isActive || node.status === 'CRITICAL') && (
                  <div
                    className="absolute rounded-full animate-ping"
                    style={{
                      width: isActive ? 36 : 20,
                      height: isActive ? 36 : 20,
                      background: 'transparent',
                      border: `1.5px solid ${pulseColor}`,
                      opacity: 0.5,
                      animationDuration: isActive ? '1.5s' : '2.5s',
                    }}
                  />
                )}
                <div
                  style={{
                    width: isActive ? 26 : 18,
                    height: isActive ? 26 : 18,
                    background: isActive ? cat.fill : 'rgba(9,9,11,0.75)',
                    border: `${isActive ? 2 : 1.5}px solid ${cat.stroke}`,
                    boxShadow: isActive ? `0 0 16px ${cat.stroke}55, 0 0 32px ${cat.stroke}22` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '2px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ color: cat.stroke, fontSize: isActive ? 11 : 8, lineHeight: 1 }}>
                    {cat.icon}
                  </span>
                </div>
                {isActive && (
                  <div
                    className="absolute whitespace-nowrap pointer-events-none"
                    style={{
                      bottom: '100%',
                      marginBottom: 6,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(9,9,11,0.92)',
                      border: `1px solid ${cat.stroke}55`,
                      padding: '3px 8px',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: 9, color: cat.stroke, fontWeight: 700, letterSpacing: '0.12em' }}>
                      {node.id}
                    </span>
                    <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', marginLeft: 5 }}>
                      {node.label}
                    </span>
                  </div>
                )}
                {!isActive && node.status !== 'NOMINAL' && (
                  <div
                    className="absolute whitespace-nowrap pointer-events-none"
                    style={{
                      bottom: '100%',
                      marginBottom: 3,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(9,9,11,0.80)',
                      border: `1px solid ${cat.stroke}30`,
                      padding: '1px 5px',
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>
                      {node.id}
                    </span>
                  </div>
                )}
              </div>
            </Marker>
          );
        })}

        {/* ── Active node: spinning crosshair reticle overlay ── */}
        {activeNode && (
          <Marker
            longitude={activeNode.coords[0]}
            latitude={activeNode.coords[1]}
            anchor="center"
          >
            <div className="relative pointer-events-none" style={{ width: 100, height: 100 }}>
              <div
                className="absolute inset-0 rounded-full border border-red-500/25 animate-spin"
                style={{ animationDuration: '10s' }}
              >
                <div className="w-[3px] h-4 bg-red-500/70 absolute top-0 left-1/2 -translate-x-1/2" />
                <div className="w-[3px] h-4 bg-red-500/70 absolute bottom-0 left-1/2 -translate-x-1/2" />
                <div className="w-4 h-[3px] bg-red-500/70 absolute left-0 top-1/2 -translate-y-1/2" />
                <div className="w-4 h-[3px] bg-red-500/70 absolute right-0 top-1/2 -translate-y-1/2" />
              </div>
              <div className="absolute inset-[18px] rounded-full border border-red-500/35" />
              <div
                className="absolute flex items-center gap-1 whitespace-nowrap"
                style={{
                  bottom: '108%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(9,9,11,0.90)',
                  border: '1px solid rgba(239,68,68,0.45)',
                  padding: '3px 8px',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 0 12px rgba(239,68,68,0.25)',
                }}
              >
                <span className="font-mono text-[9px] text-white/50">Displacement</span>
                <span className="font-mono text-[10px] text-white font-bold">
                  {currentPassIndex > 0 ? `-${(currentPassIndex * 0.6).toFixed(1)} CM` : '0.0 CM'}
                </span>
              </div>
              <div
                className="absolute whitespace-nowrap"
                style={{
                  top: '50%',
                  left: '108%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(9,9,11,0.85)',
                  border: '1px solid rgba(239,68,68,0.28)',
                  padding: '2px 7px',
                }}
              >
                <span className="font-mono text-[9px]" style={{ color: '#fb923c' }}>▲</span>
                <span className="font-mono text-[9px] text-white/70 ml-1">Low -82%</span>
              </div>
            </div>
          </Marker>
        )}
      </MapLibreMap>


      {/* ── HUD: North Arrow ────────────────────────────────────── */}
      <div
        className="absolute pointer-events-none"
        style={{ left: 20, bottom: 60, zIndex: 30 }}
      >
        <div
          style={{
            background: 'rgba(9,9,11,0.82)',
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '8px 10px',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ position: 'relative', width: 24, height: 24 }}>
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: '12px solid rgba(255,255,255,0.85)',
              position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
            }} />
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '12px solid rgba(255,255,255,0.22)',
              position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            }} />
          </div>
          <span className="font-mono mt-1" style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.2em' }}>N</span>
        </div>
      </div>

      {/* ── HUD: Category Legend ────────────────────────────────── */}
      <div
        className="absolute pointer-events-none"
        style={{
          right: 16, bottom: 36, zIndex: 30,
          background: 'rgba(9,9,11,0.82)',
          border: '1px solid rgba(255,255,255,0.10)',
          padding: '8px 10px',
          backdropFilter: 'blur(12px)',
          minWidth: 128,
        }}
      >
        <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.38)', letterSpacing: '0.2em', marginBottom: 6, textTransform: 'uppercase' }}>
          Node Matrix
        </p>
        {Object.entries(CATEGORY_COLOR).map(([cat, c]) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <span style={{ color: c.stroke, fontSize: 9 }}>{c.icon}</span>
            <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.48)' }}>{cat}</span>
          </div>
        ))}

        {/* Magnitude scale */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8, paddingTop: 8 }}>
          <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.38)', letterSpacing: '0.2em', marginBottom: 6, textTransform: 'uppercase' }}>
            Magnitude
          </p>
          {[
            { label: 'M7.0+', color: '#ef4444' },
            { label: 'M6.0–6.9', color: '#fb923c' },
            { label: 'M5.0–5.9', color: '#facc15' },
            { label: 'M4.5–4.9', color: '#4ade80' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.48)' }}>{label}</span>
            </div>
          ))}
          {/* Fault line key */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
            <div style={{ width: 16, height: 2, background: '#fb923c', opacity: 0.6, flexShrink: 0 }} />
            <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.48)' }}>PB2002 Faults</span>
          </div>
        </div>
      </div>
    </div>
  );
}
