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

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, Marker, Source, Layer, useControl, NavigationControl } from 'react-map-gl/maplibre';
import { loadWorldVector, type WorldVector } from '@/lib/worldVector';
import PLACES from '@/data/places.json';
import type { MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { MapboxOverlayProps } from '@deck.gl/mapbox';
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { useStore } from '@/lib/store';
import { EventReticle } from '@/components/observatory/event-reticle';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import { globalEventToFeature } from '@/lib/eventFeature';
import { useRadarEvents } from '@/lib/useRadarEvents';
import type { GlobalEvent } from '@/lib/globalEvents';
import { useNISARData } from '@/lib/useNISARData';
import { TARGET_NODES, NODE_BOUNDING_BOXES, PASS_EPOCHS } from '@/lib/mockData';
import { filterByPlayback, windowRange } from '@/lib/playbackFilter';
import { useEarthquakeData, type USGSEarthquake } from '@/lib/useEarthquakeData';
import { useSSEStream } from '@/lib/useSSEStream';
import { buildSeismicHeatmapLayer } from '@/components/map-layers/SeismicHeatmapLayer';
import { buildKinematicVectorLayers } from '@/components/map-layers/KinematicVectorLayer';
import { buildTemporalDecayLayers } from '@/components/map-layers/TemporalDecayLayer';
import type { MapLayerConfig } from '@/lib/types';
import { useNisarScenes } from '@/lib/useNisarScenes';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/lib/ThemeProvider';

// Serve the MapLibre worker from /public to avoid Next.js bundling issues
if (typeof window !== 'undefined') {
  setWorkerUrl('/maplibre-gl-worker.mjs');
}

// ESRI World Gray Base (Dark / Light) - free raster basemap
// Dark theme: bundled vector basemap (grey land (as before) on a near-black ocean) drawn from world-atlas. See <WorldBase />.
export const OCEAN_COLOR = '#06080c';
export const LAND_COLOR = '#3a3a3d';
const getMapStyle = (isLight: boolean): any => isLight ? ({
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: [
        isLight
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'
          : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
    },
  },
  layers: [
    {
      id: 'esri-basemap',
      type: 'raster',
      source: 'esri',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
}) : ({
  version: 8,
  sources: {},
  layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': OCEAN_COLOR } }],
});

function WorldBase({ data }: { data: WorldVector | null }) {
  if (!data) return null;
  return (
    <>
      <Source id="wb-land" type="geojson" data={data.land}>
        <Layer id="wb-land-fill" type="fill" paint={{ 'fill-color': LAND_COLOR, 'fill-antialias': true }} />
      </Source>
      <Source id="wb-borders" type="geojson" data={data.borders}>
        <Layer id="wb-borders-line" type="line" paint={{ 'line-color': '#6b6b72', 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 6, 1], 'line-opacity': 0.7 }} />
      </Source>
    </>
  );
}

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

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// ── Magnitude → RGBA colour (green→yellow→orange→red) ───────
function magToColor(mag: number): [number, number, number, number] {
  if (mag >= 7.0) return [239, 68,  68,  230];
  if (mag >= 6.0) return [251, 146, 60,  220];
  if (mag >= 5.0) return [250, 204, 21,  200];
  return                 [74,  222, 128, 180];
}

// ── Directory events: colour by type, size by magnitude ──────
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function eventRadiusPx(e: GlobalEvent): number {
  if (e.type === 'tectonic' || e.type === 'induced_seismicity' || e.type === 'mining') return Math.max(3, Math.min(17, 3 + (((e.magnitude ?? 4.5) - 4) * 2.6)));
  if (e.type === 'volcanic') return 6 + Math.min(6, e.magnitude ?? 0);
  return 6;
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
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const mapStyle = useMemo(() => getMapStyle(isLight), [isLight]);
  const [worldVec, setWorldVec] = useState<WorldVector | null>(null);
  useEffect(() => { let alive = true; loadWorldVector().then(v => { if (alive) setWorldVec(v); }).catch(() => {}); return () => { alive = false; }; }, []);

  const activeNodeId    = useStore(s => s.activeNodeId);
  const setActiveNodeId = useStore(s => s.setActiveNodeId);
  const phaseFilterMode    = useStore(s => s.phaseFilterMode);
  const coherenceThreshold = useStore(s => s.coherenceThreshold);
  const currentPassIndex   = useStore(s => s.currentPassIndex);
  const playbackWindow     = useStore(s => s.playbackWindow);
  const playbackAnchor     = useStore(s => s.playbackAnchor);
  const flyToCoords        = useStore(s => s.flyToCoords);
  const setFlyToCoords     = useStore(s => s.setFlyToCoords);
  const selectedGlobalEvent = useStore(s => s.selectedGlobalEvent);
  const setSelectedGlobalEvent = useStore(s => s.setSelectedGlobalEvent);
  const setCurrentPassIndex = useStore(s => s.setCurrentPassIndex);
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
  const { faultLines } = useEarthquakeData(4.5, 300);

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
   
  }, [currentPassIndex]);

  const activeNode = TARGET_NODES.find(n => n.id === activeNodeId);
  const bb = activeNodeId ? NODE_BOUNDING_BOXES[activeNodeId] : null;

  // SSE unified stream – real-time telemetry from all Phase 2 sources
  const stream = useSSEStream();
  const directoryEvents = useStore(s => s.directoryEvents);
  const selectedId = useStore(s => (s.selectedGlobalEvent?.properties as { global_id?: string } | undefined)?.global_id ?? s.selectedGlobalEvent?.id ?? null);

  // Layer toggle state
  const [layerConfig, setLayerConfig] = useState<MapLayerConfig>({
    seismicHeatmap:    true,
    kinematicVectors:  true,
    temporalDecay:     true,
    gnssStations:      false,
    sentinelSwaths:    false,
    nisarScenes:       false,
    volcanismAlerts:   true,
    cryosphereExtent:  false,
    tsunamiZones:      true,
  });
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);

  // Real NISAR scene footprints (NASA CMR) for the area in view, only while that layer is switched on.
  const [viewBox, setViewBox] = useState<[number, number, number, number] | null>(null);
  const setMapViewBox = useStore(s => s.setMapViewBox);
  useEffect(() => { setMapViewBox(viewBox); }, [viewBox, setMapViewBox]);
  const nisar = useNisarScenes(layerConfig.nisarScenes, viewBox);

  // MapLibre map ref for programmatic flyTo
  const mapRef = useRef<MapRef>(null);

  // ── Coarse zoom for layer toggling (only updates on threshold crossing) ──
  // Never updated during panning — zero re-renders from map movement.
  const HEATMAP_THRESHOLD = 4;
  const [aboveHeatmapZoom, setAboveHeatmapZoom] = useState(false);
  // Label zoom, quantised to quarter steps so labels re-tier only when it matters.
  const [labelZoom, setLabelZoom] = useState(1.5);
  const flyToZoomRef = useRef(bb?.zoom2D ?? 0);

  // Initial viewport — world-view, fully zoomed out.
  // MapLibre owns the viewport from here on; React is NOT involved in
  // frame-by-frame rendering. DeckGLOverlay syncs directly with MapLibre's GL context.
  const initialViewState = useRef({
    longitude: 0,
    latitude:  20,
    zoom:      1.5,
    pitch:     0,
    bearing:   0,
  }).current;

  useEffect(() => {
    if (!activeNodeId) return; // Stay max zoomed out initially
    const bbox = NODE_BOUNDING_BOXES[activeNodeId];
    if (!bbox) return;
    const center = [bbox.center[0], bbox.center[1]] as [number, number];
    const zoom   = bbox.zoom2D;
    flyToZoomRef.current = zoom;
    mapRef.current?.flyTo({ center, zoom, duration: 2000, essential: true });
  }, [activeNodeId]);

  // Fly to a requested coordinate. If the map instance is not ready yet (the radar was just opened), remember the
  // request and run it as soon as the map has loaded, so "open in radar" always lands on the event.
  const pendingFly = useRef<[number, number] | null>(null);
  const doFly = useCallback((c: [number, number]) => {
    const map = mapRef.current;
    if (!map) { pendingFly.current = c; return false; }
    map.flyTo({ center: c, zoom: Math.max(flyToZoomRef.current, 7), pitch: 0, bearing: 0, duration: 1600, essential: true });
    return true;
  }, []);

  useEffect(() => {
    if (!flyToCoords) return;
    if (doFly(flyToCoords as [number, number])) setFlyToCoords(null);
  }, [flyToCoords, doFly, setFlyToCoords]);

  // Place names: countries first, then cities by importance (Natural Earth min_zoom), small towns only once well zoomed in.
  const labelLayers = useMemo(() => {
    if (isLight) return [];
    const countries = (worldVec?.countries ?? []).filter(c => labelZoom >= c.minZoom && labelZoom < 6.75);
    const cities = (PLACES as Array<[string, number, number, number, number]>)
      .filter(p => labelZoom >= p[3] + (p[3] >= 6.5 ? 1.6 : 0.9));
    const common = {
      fontFamily: 'Inter, system-ui, sans-serif', fontSettings: { sdf: true }, outlineColor: [6, 8, 12, 255] as [number, number, number, number],
      outlineWidth: 2, pickable: false, getTextAnchor: 'middle' as const, getAlignmentBaseline: 'center' as const,
    };
    return [
      new TextLayer<{ name: string; lon: number; lat: number }>({
        ...common, id: 'label-countries', data: countries, getPosition: d => [d.lon, d.lat], getText: d => d.name.toUpperCase(),
        getSize: 11, getColor: [255, 255, 255, 105], fontWeight: 600, sizeUnits: 'pixels',
      }),
      new TextLayer<[string, number, number, number, number]>({
        ...common, id: 'label-cities', data: cities, getPosition: d => [d[1], d[2]], getText: d => d[0],
        getSize: d => (d[4] ? 13 : 12), getColor: d => (d[4] ? [255, 255, 255, 225] : [255, 255, 255, 170]), sizeUnits: 'pixels',
        updateTriggers: { getText: cities.length },
      }),
    ];
  }, [isLight, worldVec, labelZoom]);

  const { listed } = useRadarEvents();

  const layers = useMemo(() => {
    const isFiltered  = phaseFilterMode === 'FILTERED';
    const epochFactor = currentPassIndex / 17;
    const threatRadius = 10000 + epochFactor * 14000;

    // Playback cutoff: map scrubber progress onto each feed's actual time span
    const progress = currentPassIndex / Math.max(1, PASS_EPOCHS.length - 1);
    const range = windowRange(playbackWindow, playbackAnchor);
    const visibleSeismic = filterByPlayback(
      stream.seismic,
      f => new Date((f.properties as any).event_time).getTime(),
      progress,
      range,
    );

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

      // ── Phase 3: Seismic density heatmap (global zoom only) ───
      ...(buildSeismicHeatmapLayer({
        // Pass aboveHeatmapZoom so no zoom-dep needed in useMemo
        features: visibleSeismic.slice(0, 300),
        visible:  layerConfig.seismicHeatmap && !aboveHeatmapZoom,
        zoom:     aboveHeatmapZoom ? 99 : 0, // force show/hide
      }) ? [buildSeismicHeatmapLayer({
        features: visibleSeismic.slice(0, 300),
        visible:  layerConfig.seismicHeatmap && !aboveHeatmapZoom,
        zoom:     aboveHeatmapZoom ? 99 : 0,
      })!] : []),

      // ── Phase 3: Kinematic slip-rate vectors (static, no rAF) ─
      ...buildKinematicVectorLayers({
        visible:    layerConfig.kinematicVectors,
        animOffset: 0, // static – no 60fps setState
      }),

      // ── Phase 3: Temporal decay rings (epoch-bound) ─────────
      ...buildTemporalDecayLayers({
        features:  visibleSeismic.slice(0, 80), // cap for perf
        passIndex: currentPassIndex,
        visible:   layerConfig.temporalDecay,
      }),

      // ── Real NISAR scenes from NASA CMR (footprints of what NISAR observed in the last 14 days) ──
      ...(layerConfig.nisarScenes && nisar.scenes ? [new GeoJsonLayer({
        id: 'nisar-real-scenes',
        data: nisar.scenes as any,
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: (f: any) => (f.properties.insar ? [251, 191, 36, 30] : [94, 234, 212, 20]) as [number, number, number, number],
        getLineColor: (f: any) => (f.properties.insar ? [251, 191, 36, 210] : [94, 234, 212, 170]) as [number, number, number, number],
        lineWidthMinPixels: 1,
      })] : []),

      // ── NISAR InSAR scenario overlay (SIMULATED demo scenarios) ────────────────────────
      ...(activeNodeId ? [
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
        })
      ] : []),

      // ── Directory events (the same ones the Events page lists), inside the timeline's period ──
      new ScatterplotLayer<GlobalEvent>({
        id: 'radar-events',
        data: listed,
        getPosition: (d) => [d.lon, d.lat],
        getRadius:   (d) => eventRadiusPx(d),
        getFillColor:(d) => [...hexToRgb(EVENT_TYPE_CONFIG[d.type]?.color ?? '#ffffff'), 200] as [number, number, number, number],
        getLineColor: (d) => (d.id === selectedId ? [255, 255, 255, 255] : [255, 255, 255, 70]) as [number, number, number, number],
        getLineWidth: (d) => (d.id === selectedId ? 2 : 1),
        stroked: true,
        filled: true,
        lineWidthUnits: 'pixels',
        radiusUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        onClick: ({ object }) => {
          if (!object) return;
          setSelectedGlobalEvent(globalEventToFeature(object));
          setFlyToCoords([object.lon, object.lat]);
        },
        updateTriggers: { getLineColor: selectedId, getLineWidth: selectedId, getFillColor: listed.length, getRadius: listed.length },
        // New events swell from nothing and fade in rather than snapping into place.
        transitions: {
          getRadius: { duration: 700, easing: easeOutBack, enter: () => [0] },
          getFillColor: { duration: 600, easing: easeOutCubic, enter: (v: number[]) => [v[0], v[1], v[2], 0] },
        },
      }),

      // ── Active node threat rings ─────────────────────────────
      ...(activeNode && seismicAlert.includes(activeNode.id) ? Array.from({ length: 4 }).map((_, i) => {
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
      ...(activeNode && seismicAlert.includes(activeNode.id) ? [
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
  }, [filteredFeatures, activeScenario.id, phaseFilterMode, coherenceThreshold, activeNode, currentPassIndex, playbackWindow, playbackAnchor, faultLines, stream.seismic, layerConfig, aboveHeatmapZoom, nisar.scenes, listed, selectedId]);


  // Stable tooltip callback — memoized so DeckGLOverlay doesn't rebuild each render
  const getTooltip = useCallback(({ object }: any) => {
    if (!object) return null;
    if (object.properties && typeof object.properties.productName === 'string' && typeof object.properties.maturity === 'string') {
      const p = object.properties as Record<string, any>;
      const d = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      const pair = p.pairReference && p.pairSecondary ? `<div>Pair: ${new Date(p.pairReference).toISOString().slice(0, 10)} → ${new Date(p.pairSecondary).toISOString().slice(0, 10)}</div>` : '';
      return {
        html: `<div style="font-family:'Roboto Mono',monospace;font-size:11px;line-height:1.6;">
          <div style="font-weight:700;letter-spacing:.14em;font-size:9px;color:${p.insar ? '#fbbf24' : '#5eead4'};">NISAR ${p.product}${p.insar ? ' · INSAR' : ''} · ${String(p.maturity).toUpperCase()}</div>
          <div style="color:white;margin:2px 0;">${p.productName}</div>
          <div style="color:rgba(255,255,255,.6);font-size:9px;">${d(p.start)}${p.track != null ? ` · track ${p.track}` : ''}${p.frame != null ? ` · frame ${p.frame}` : ''}</div>${pair}
          <div style="color:rgba(255,255,255,.35);font-size:8px;margin-top:3px;letter-spacing:.1em;">NISAR RECORD</div></div>`,
        style: { backgroundColor: 'rgba(9,9,11,.92)', border: '1px solid rgba(255,255,255,.2)', borderRadius: '2px', color: 'white', padding: '10px 12px' },
      };
    }
    if ('cause' in object && 'type' in object && 'lat' in object) {
      const ev = object as GlobalEvent;
      const cfg = EVENT_TYPE_CONFIG[ev.type];
      const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
      return {
        html: `<div style="font-family:'Roboto Mono',monospace;font-size:11px;line-height:1.6;">
          <div style="font-weight:700;letter-spacing:.14em;font-size:9px;color:${cfg?.color ?? '#fff'};text-transform:uppercase;">${esc(cfg?.label ?? ev.type)}${ev.magnitude != null ? ` · ${ev.source === 'Smithsonian GVP' ? 'VEI ' + Math.round(ev.magnitude) : 'M' + ev.magnitude.toFixed(1)}` : ''}</div>
          <div style="color:white;max-width:220px;margin:2px 0;">${esc(ev.title)}</div>
          <div style="color:rgba(255,255,255,.45);font-size:8px;letter-spacing:.08em;">${new Date(ev.time).toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
          <div style="color:rgba(255,255,255,.3);font-size:8px;margin-top:3px;letter-spacing:.1em;">Click for details</div></div>`,
        style: { backgroundColor: 'rgba(9,9,11,.92)', border: `1px solid ${cfg?.color ?? '#fff'}66`, borderRadius: '2px', color: 'white', backdropFilter: 'blur(16px)', padding: '10px 12px' },
      };
    }
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
   
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ background: 'var(--bg-primary)' }}>

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

      {/* ── Events in the timeline's period ───────────────────── */}
      <div className="absolute z-30 flex items-center gap-2" style={{ top: 8, right: 130, pointerEvents: 'none' }}>
        <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'rgba(9,9,11,0.82)', border: '1px solid rgba(255,255,255,0.10)', backdropFilter: 'blur(12px)' }}>
          <div className={`w-1.5 h-1.5 rounded-full ${directoryEvents.length === 0 ? 'animate-pulse' : ''}`} style={{ background: directoryEvents.length > 0 ? '#4ade80' : '#fb923c' }} />
          <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em' }}>EVENTS</span>
          <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em' }}>
            {directoryEvents.length === 0 ? 'LOADING' : `${listed.length} OF ${directoryEvents.length}`}
          </span>
        </div>
      </div>

      <MapLibreMap
        ref={mapRef}
        initialViewState={initialViewState}
        onLoad={() => {
          const z = mapRef.current?.getZoom();
          const lb = mapRef.current?.getBounds();
          if (lb) setViewBox([lb.getWest(), lb.getSouth(), lb.getEast(), lb.getNorth()]);
          if (typeof z === 'number') setLabelZoom(Math.round(z * 4) / 4);
          const c = pendingFly.current;
          if (c) { pendingFly.current = null; doFly(c); setFlyToCoords(null); }
        }}
        onMoveEnd={(evt) => {
          const b = evt.target.getBounds();
          setViewBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        }}
        onZoom={(evt) => {
          // Only fire a React state update when crossing the heatmap zoom threshold
          const nowAbove = evt.viewState.zoom > HEATMAP_THRESHOLD;
          setAboveHeatmapZoom(prev => (prev !== nowAbove ? nowAbove : prev));
          const lz = Math.round(evt.viewState.zoom * 4) / 4;
          setLabelZoom(prev => (prev !== lz ? lz : prev));
        }}
        mapStyle={mapStyle}
        attributionControl={false}
        renderWorldCopies={false}
        minZoom={minZoom}
        maxZoom={18}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      >
        {!isLight && <WorldBase data={worldVec} />}
        <NavigationControl position="top-right" visualizePitch={true} />
        {/* DeckGL layers injected into MapLibre’s WebGL context — guaranteed in-sync */}
        <DeckGLOverlay
          layers={[...labelLayers, ...layers]}
          getTooltip={getTooltip}
          interleaved={false}
        />
        {TARGET_NODES.map(node => {
          const isActive   = node.id === activeNodeId;
          const cat        = CATEGORY_COLOR[node.category] ?? CATEGORY_COLOR.TECTONIC;
          const pulseColor = STATUS_PULSE[node.status] ?? '#4ade80';
          const isSeismic  = seismicAlert.includes(node.id);

          // Only show TARGET_NODE markers when there is an active seismic alert on that node
          if (!isSeismic) return null;

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

        {/* ── Selected Global Event Marker ── */}
        {selectedGlobalEvent && selectedGlobalEvent.geometry.type === 'Point' && (
          <Marker
            longitude={(selectedGlobalEvent.geometry as any).coordinates[0]}
            latitude={(selectedGlobalEvent.geometry as any).coordinates[1]}
            anchor="center"
          >
            <EventReticle feature={selectedGlobalEvent} />
          </Marker>
        )}
      </MapLibreMap>


      {/* ── HUD: Layer Controls ──────────────────────────────────── */}
      <div
        className="absolute"
        style={{ left: 20, top: 80, zIndex: 40 }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setLayerPanelOpen(o => !o)}
          style={{
            background: 'rgba(9,9,11,0.88)',
            border: '1px solid rgba(255,255,255,0.14)',
            padding: '5px 10px',
            backdropFilter: 'blur(12px)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/* SSE connection dot */}
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: stream.connected ? '#4ade80' : '#ef4444',
            display: 'inline-block',
            boxShadow: stream.connected ? '0 0 6px #4ade80' : 'none',
          }} />
          <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.15em' }}>
            LAYERS
          </span>
        </button>

        {/* Panel */}
        {layerPanelOpen && (
          <div style={{
            marginTop: 2,
            background: 'rgba(9,9,11,0.92)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(16px)',
            padding: '8px 0',
            minWidth: 170,
          }}>
            {([
              { key: 'seismicHeatmap',   label: 'SEISMIC HEATMAP',   color: '#ef4444' },
              { key: 'kinematicVectors', label: 'PLATE VECTORS',      color: '#fb923c' },
              { key: 'temporalDecay',    label: 'EPOCH DECAY RINGS',  color: '#facc15' },
              { key: 'volcanismAlerts',  label: 'VOLCANISM',          color: '#f97316' },
              { key: 'tsunamiZones',     label: 'TSUNAMI ZONES',      color: '#60a5fa' },
              { key: 'cryosphereExtent', label: 'CRYOSPHERE',         color: '#7dd3fc' },
              { key: 'nisarScenes',      label: 'NISAR SCENES (REAL)', color: '#5eead4' },
            ] as { key: keyof MapLayerConfig; label: string; color: string }[]).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setLayerConfig(prev => ({ ...prev, [key]: !prev[key] }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '4px 12px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: 10, height: 10,
                  borderRadius: '1px',
                  background: layerConfig[key] ? color : 'transparent',
                  border: `1px solid ${color}`,
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }} />
                <span className="font-mono" style={{
                  fontSize: 9, letterSpacing: '0.12em',
                  color: layerConfig[key] ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
                }}>
                  {label}
                </span>
              </button>
            ))}
            {layerConfig.nisarScenes && (
              <div className="font-mono" role="status" style={{ padding: '2px 12px 0 30px', fontSize: 8, letterSpacing: '0.08em', color: nisar.status === 'error' ? '#fca5a5' : 'rgba(255,255,255,0.45)', maxWidth: 200 }}>
                {nisar.status === 'zoom' && 'Zoom in to load NISAR scenes (last 14 days).'}
                {nisar.status === 'loading' && 'Loading NISAR scenes…'}
                {nisar.status === 'error' && 'NASA catalogue not responding.'}
                {nisar.status === 'ok' && (nisar.count === 0 ? 'No NISAR scenes in view in the last 14 days.' : `${nisar.count} scene${nisar.count === 1 ? '' : 's'} in view${nisar.truncated ? ' (capped, zoom in)' : ''}. Amber = InSAR products.`)}
              </div>
            )}
            {/* SSE status footer */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6, padding: '5px 12px 2px' }}>
              <span className="font-mono" style={{ fontSize: 8, color: stream.connected ? '#4ade80' : '#ef4444', letterSpacing: '0.12em' }}>
                {stream.connected ? '● STREAM LIVE' : '● RECONNECTING...'}
              </span>
              {stream.lastUpdated && (
                <span className="font-mono" style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', display: 'block', marginTop: 2 }}>
                  {stream.lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        )}
      </div>



      {/* ── HUD: Category Legend ────────────────────────────────── */}
      <div
        className="map-legend absolute pointer-events-none"
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
          Event type
        </p>
        {(Object.keys(EVENT_TYPE_CONFIG) as Array<keyof typeof EVENT_TYPE_CONFIG>).filter(t => directoryEvents.some(e => e.type === t)).map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: EVENT_TYPE_CONFIG[t].color, flexShrink: 0 }} />
            <span className="font-mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.48)' }}>{EVENT_TYPE_CONFIG[t].label}</span>
          </div>
        ))}
        <p className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Dot size = magnitude</p>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8, paddingTop: 8 }}>
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
