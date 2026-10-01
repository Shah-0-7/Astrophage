/**
 * ============================================================
 * NISAR SAR Telemetry Platform – Target Node Data
 * ============================================================
 * Global target matrix nodes for the GLOBAL_SCHEMATIC view.
 * 12-day pass epochs for the time-series scrubber.
 * ============================================================
 */

import type { TargetNode, PassEpoch, SatelliteTelemetry, NISARScenario, NISARDataPoint } from './types';

/* ── Satellite telemetry (static mission params) ─────────────── */
export const SATELLITE_TELEMETRY: SatelliteTelemetry = {
  altitude: 747,
  inclination: 98.4,
  swath: 240,
  downlink: 4.0,
  podStatus: 'NOMINAL',
};

/* ── Global target matrix ───────────────────────────────────── */
export const TARGET_NODES: TargetNode[] = [
  {
    id: 'TC-89',
    label: 'SAN ANDREAS',
    category: 'TECTONIC',
    coords: [-120.35, 35.72],
    deformationVelocity: 34.2,
    coherence: 0.96,
    status: 'ELEVATED',
    description: 'Critical crustal shear transect along the San Andreas Fault system, NISAR L-band primary target.',
    locationDetail: '35.7202° N, 120.3503° W // CARRIZO PLAIN',
    fringe: '20.4mm repeat displacement',
  },
  {
    id: 'EQ-99',
    label: 'SUNDA',
    category: 'TECTONIC',
    coords: [105.2, -6.4],
    deformationVelocity: 58.7,
    coherence: 0.87,
    status: 'CRITICAL',
    description: 'Post-seismic subsidence monitoring across the Sunda megathrust convergent margin.',
    locationDetail: '6.4° S, 105.2° E // JAVA TRENCH',
    fringe: '28.0mm repeat displacement',
  },
  {
    id: 'CR-14',
    label: 'JAKOBSHAVN',
    category: 'CRYOSPHERE',
    coords: [-49.85, 69.15],
    deformationVelocity: -4200,
    coherence: 0.81,
    status: 'ELEVATED',
    description: 'Jakobshavn Isbræ terminus retreat and ice flow velocity mapping, Greenland Ice Sheet.',
    locationDetail: '69.15° N, 49.85° W // DISKO BAY',
    fringe: 'Ice velocity 46 m/yr',
  },
  {
    id: 'CR-07',
    label: 'THWAITES',
    category: 'CRYOSPHERE',
    coords: [-106.8, -75.5],
    deformationVelocity: -3800,
    coherence: 0.74,
    status: 'CRITICAL',
    description: 'Thwaites "Doomsday Glacier" grounding line retreat, West Antarctica.',
    locationDetail: '75.5° S, 106.8° W // WEST ANTARCTICA',
    fringe: 'Grounding line -3.8 km/yr',
  },
  {
    id: 'VL-22',
    label: 'KILAUEA',
    category: 'VOLCANIC',
    coords: [-155.28, 19.42],
    deformationVelocity: 180,
    coherence: 0.62,
    status: 'ELEVATED',
    description: 'Active inflation/deflation cycle monitoring at Kilauea caldera, Hawaii.',
    locationDetail: '19.42° N, 155.28° W // HAWAII BIG ISLAND',
    fringe: '+18cm INFL cycle',
  },
  {
    id: 'VL-08',
    label: 'MERAPI',
    category: 'VOLCANIC',
    coords: [110.44, -7.54],
    deformationVelocity: 220,
    coherence: 0.58,
    status: 'CRITICAL',
    description: 'Dome growth monitoring at Merapi stratovolcano, Java. High-priority life safety target.',
    locationDetail: '7.54° S, 110.44° E // JAVA, INDONESIA',
    fringe: '+22cm dome inflation',
  },
  {
    id: 'BM-03',
    label: 'AMAZON',
    category: 'BIOMASS',
    coords: [-62.3, -3.8],
    deformationVelocity: -1.4,
    coherence: 0.44,
    status: 'NOMINAL',
    description: 'Tropical forest biomass change and deforestation front mapping in central Amazon basin.',
    locationDetail: '3.8° S, 62.3° W // AMAZONAS STATE',
    fringe: '-140t/ha biomass loss',
  },
  {
    id: 'BM-11',
    label: 'BORNEO',
    category: 'BIOMASS',
    coords: [114.2, 1.5],
    deformationVelocity: -0.9,
    coherence: 0.41,
    status: 'NOMINAL',
    description: 'Peat swamp and tropical forest carbon stock monitoring, Kalimantan.',
    locationDetail: '1.5° N, 114.2° E // KALIMANTAN, BORNEO',
    fringe: '-90t/ha peat loss',
  },
  {
    id: 'TC-44',
    label: 'HIMALAYA',
    category: 'TECTONIC',
    coords: [86.9, 28.0],
    deformationVelocity: 42.1,
    coherence: 0.79,
    status: 'ELEVATED',
    description: 'India-Eurasia continental collision zone interseismic strain accumulation monitoring.',
    locationDetail: '28.0° N, 86.9° E // NEPAL HIMALAYA',
    fringe: '21.5mm repeat displacement',
  },
  {
    id: 'TC-31',
    label: 'CASCADIA',
    category: 'TECTONIC',
    coords: [-124.3, 47.2],
    deformationVelocity: 12.8,
    coherence: 0.83,
    status: 'NOMINAL',
    description: 'Cascadia subduction zone slow-slip event detection, Pacific Northwest.',
    locationDetail: '47.2° N, 124.3° W // PUGET SOUND REGION',
    fringe: '12.3mm slow-slip',
  },
  {
    id: 'CR-21',
    label: 'GANGOTRI',
    category: 'CRYOSPHERE',
    coords: [79.07, 30.93],
    deformationVelocity: -2200,
    coherence: 0.69,
    status: 'ELEVATED',
    description: 'Gangotri Glacier retreat in Indian Himalayas, primary source of Ganges River meltwater.',
    locationDetail: '30.93° N, 79.07° E // UTTARAKHAND, INDIA',
    fringe: 'Retreat -22m/yr',
  },
  {
    id: 'VL-15',
    label: 'ETNA',
    category: 'VOLCANIC',
    coords: [14.99, 37.75],
    deformationVelocity: 95,
    coherence: 0.71,
    status: 'NOMINAL',
    description: 'Mt. Etna flank deformation and magmatic intrusion pathway monitoring, Sicily.',
    locationDetail: '37.75° N, 14.99° E // SICILY, ITALY',
    fringe: '+9.5cm seasonal INFL',
  },
];

/* ── Helper: seeded random for SSR hydration ────────────────── */
let seed = 98765;
function rng() {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

/* ── Generate 18 × 12-day pass epochs ──────────────────────── */
function generatePassEpochs(): PassEpoch[] {
  const baseDate = new Date('2024-10-15T00:00:00Z');
  const epochs: PassEpoch[] = [];
  let cumDisp = 0;
  for (let i = 0; i < 18; i++) {
    const passDate = new Date(baseDate.getTime() + i * 12 * 24 * 60 * 60 * 1000);
    const delta = -(1.8 + rng() * 1.4);        // mm per pass
    cumDisp += delta;
    epochs.push({
      index: i + 1,
      label: `PASS ${String(i + 1).padStart(2, '0')}`,
      date: passDate.toISOString(),
      accumDisplacement: parseFloat(cumDisp.toFixed(1)),
      residualError: parseFloat((0.8 + rng() * 1.2).toFixed(1)),
    });
  }
  return epochs;
}

export const PASS_EPOCHS: PassEpoch[] = generatePassEpochs();

/* ── Spatial bounding boxes for jumpToNodeView ──────────────── */
export const NODE_BOUNDING_BOXES: Record<string, {
  center: [number, number];
  zoom2D: number;
  zoom3D: number;
  pitch: number;
  bearing: number;
}> = {
  'TC-89': { center: [-120.35, 35.72], zoom2D: 9, zoom3D: 11, pitch: 50, bearing: -15 },
  'EQ-99': { center: [105.2, -6.4],   zoom2D: 8, zoom3D: 10, pitch: 45, bearing: 20 },
  'CR-14': { center: [-49.85, 69.15], zoom2D: 10, zoom3D: 11, pitch: 45, bearing: -20 },
  'CR-07': { center: [-106.8, -75.5], zoom2D: 7, zoom3D: 9, pitch: 40, bearing: 0 },
  'VL-22': { center: [-155.28, 19.42],zoom2D: 10, zoom3D: 12, pitch: 55, bearing: 30 },
  'VL-08': { center: [110.44, -7.54], zoom2D: 10, zoom3D: 12, pitch: 50, bearing: -10 },
  'BM-03': { center: [-62.3, -3.8],   zoom2D: 8, zoom3D: 10, pitch: 35, bearing: 0 },
  'BM-11': { center: [114.2, 1.5],    zoom2D: 8, zoom3D: 10, pitch: 35, bearing: 0 },
  'TC-44': { center: [86.9, 28.0],    zoom2D: 8, zoom3D: 10, pitch: 60, bearing: 25 },
  'TC-31': { center: [-124.3, 47.2],  zoom2D: 8, zoom3D: 10, pitch: 45, bearing: -5 },
  'CR-21': { center: [79.07, 30.93],  zoom2D: 9, zoom3D: 11, pitch: 55, bearing: 15 },
  'VL-15': { center: [14.99, 37.75],  zoom2D: 10, zoom3D: 12, pitch: 50, bearing: -20 },
};

/* ── Backscatter dB values per polarisation ─────────────────── */
export const BACKSCATTER_VALUES: Record<string, number> = {
  HH: -14.2,
  HV: -21.8,
  VH: -22.1,
  VV: -16.7,
};

/* ── Helper: monthly timestamp generator ────────────────────── */
function monthlyTimestamps(startYear: number, startMonth: number, count: number): string[] {
  const out: string[] = [];
  let y = startYear, m = startMonth;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01T00:00:00Z`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function seasonalTimestamps(year: number, startMonth: number, endMonth: number): string[] {
  const out: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    out.push(`${year}-${String(m).padStart(2, '0')}-15T00:00:00Z`);
  }
  return out;
}

let seed2 = 12345;
function random() {
  const x = Math.sin(seed2++) * 10000;
  return x - Math.floor(x);
}

function noisyLinear(start: number, end: number, count: number, noise: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return +(start + (end - start) * t + (random() - 0.5) * noise).toFixed(2);
  });
}

function seasonalCurve(min: number, max: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return +(min + (max - min) * Math.sin(t * Math.PI)).toFixed(1);
  });
}

/* ── Scenario 1: Jakobshavn Glacier ────────────────────────── */
const glacierTimestamps = monthlyTimestamps(2020, 1, 60);
const glacierValues = noisyLinear(0, -1420, 60, 35);

const glacierPolygonsByYear: Record<string, number[][][]> = {
  '2020': [[[-49.95, 69.18], [-49.85, 69.18], [-49.80, 69.17], [-49.78, 69.15], [-49.82, 69.13], [-49.90, 69.12], [-49.97, 69.14], [-49.98, 69.16], [-49.95, 69.18]]],
  '2021': [[[-49.93, 69.175], [-49.84, 69.175], [-49.79, 69.165], [-49.77, 69.148], [-49.81, 69.128], [-49.89, 69.118], [-49.96, 69.138], [-49.97, 69.158], [-49.93, 69.175]]],
  '2022': [[[-49.91, 69.17], [-49.83, 69.17], [-49.78, 69.16], [-49.76, 69.145], [-49.80, 69.125], [-49.88, 69.115], [-49.95, 69.135], [-49.96, 69.155], [-49.91, 69.17]]],
  '2023': [[[-49.89, 69.165], [-49.82, 69.165], [-49.77, 69.155], [-49.75, 69.142], [-49.79, 69.122], [-49.87, 69.112], [-49.94, 69.132], [-49.95, 69.152], [-49.89, 69.165]]],
  '2024': [[[-49.87, 69.16], [-49.81, 69.16], [-49.76, 69.15], [-49.74, 69.139], [-49.78, 69.119], [-49.86, 69.109], [-49.93, 69.129], [-49.94, 69.149], [-49.87, 69.16]]],
};

const glacierFeatures = Object.entries(glacierPolygonsByYear).map(([year, coords], i) => ({
  type: 'Feature' as const,
  properties: {
    id: `glacier-${year}`, timestamp: `${year}-06-01T00:00:00Z`, year: parseInt(year),
    retreatMeters: Math.abs(glacierValues[i * 12] || 0), category: 'glacier' as const,
    metricName: 'Glacier Front Retreat (m)', metricValue: glacierValues[i * 12] || 0,
    opacity: 0.3 + i * 0.15, color: [0, 200 - i * 30, 255],
  },
  geometry: { type: 'Polygon' as const, coordinates: coords },
}));

const glacierFlowVectors = [
  { from: [-49.92, 69.17], to: [-49.88, 69.155], speed: 42 },
  { from: [-49.88, 69.16], to: [-49.84, 69.145], speed: 46 },
  { from: [-49.84, 69.15], to: [-49.80, 69.135], speed: 51 },
  { from: [-49.90, 69.14], to: [-49.86, 69.125], speed: 38 },
  { from: [-49.86, 69.13], to: [-49.82, 69.115], speed: 44 },
].map((v, i) => ({
  type: 'Feature' as const,
  properties: {
    id: `glacier-flow-${i}`, category: 'glacier' as const, speed: v.speed,
    metricName: 'Flow Speed (m/yr)', metricValue: v.speed, timestamp: '2024-06-01T00:00:00Z',
  },
  geometry: { type: 'LineString' as const, coordinates: [v.from, v.to] },
}));

export const glacierScenario: NISARScenario = {
  id: 'greenland-glacier', title: 'Jakobshavn Glacier Retreat',
  subtitle: 'Greenland Ice Sheet, 2020 – 2025', category: 'glacier',
  description: 'The Jakobshavn Isbræ is one of the fastest-moving glaciers on Earth. NISAR L+S band SAR reveals terminus retreat and ice flow velocity changes signaling accelerating mass loss from the Greenland Ice Sheet.',
  center: [-49.85, 69.15], zoom: 10.5, pitch: 45, bearing: -20,
  timeRange: { start: '2020-01-01T00:00:00Z', end: '2024-12-01T00:00:00Z' },
  timeSeries: { timestamps: glacierTimestamps, values: glacierValues, metricName: 'Cumulative Terminus Retreat', unit: 'meters' },
  features: { type: 'FeatureCollection', features: [...glacierFeatures, ...glacierFlowVectors] },
  educationalContent: {
    headline: 'Why Glaciers Matter',
    body: 'Glaciers contain ~69% of the world\'s fresh water. As climate warms, Jakobshavn alone contributes ~6.5% of Greenland\'s total ice discharge. NISAR\'s 12-day repeat cycle lets scientists measure ice velocity changes with millimeter precision.',
    funFact: 'Jakobshavn produces icebergs so large that the one suspected of sinking the Titanic likely originated from this glacier!',
  },
};

/* ── Scenario 2: Istanbul Earthquake ───────────────────────── */
const eqTimestamps = monthlyTimestamps(2024, 3, 18);
const subsidenceValues = noisyLinear(0, -28.5, 18, 2.5);

const subsidenceGrid: Array<{ coord: [number, number]; maxDisplacement: number }> = [];
for (let lat = 40.95; lat <= 41.10; lat += 0.012) {
  for (let lng = 28.85; lng <= 29.10; lng += 0.015) {
    const distFromEpicenter = Math.sqrt(Math.pow(lat - 41.02, 2) + Math.pow(lng - 28.97, 2));
    const maxDisp = Math.max(0, -32 * Math.exp(-distFromEpicenter * 18) + (random() - 0.5) * 3);
    subsidenceGrid.push({ coord: [lng, lat], maxDisplacement: +maxDisp.toFixed(2) });
  }
}

const subsidenceFeatures = subsidenceGrid.map((pt, i) => ({
  type: 'Feature' as const,
  properties: {
    id: `subsidence-${i}`, category: 'earthquake' as const, timestamp: '2024-03-15T00:00:00Z',
    metricName: 'Ground Displacement (cm)', metricValue: pt.maxDisplacement, displacement: pt.maxDisplacement,
  },
  geometry: { type: 'Point' as const, coordinates: pt.coord },
}));

const faultLine = {
  type: 'Feature' as const,
  properties: { id: 'istanbul-fault', category: 'earthquake' as const, metricName: 'Fault Trace', metricValue: 0, timestamp: '2024-03-15T00:00:00Z' },
  geometry: { type: 'LineString' as const, coordinates: [[28.70, 40.98], [28.80, 41.00], [28.90, 41.015], [29.00, 41.025], [29.10, 41.03], [29.20, 41.02]] },
};

const impactZones = [2, 5, 10].map((radius, i) => ({
  type: 'Feature' as const,
  properties: {
    id: `impact-zone-${i}`, category: 'earthquake' as const, radius,
    severity: ['critical', 'moderate', 'minor'][i], metricName: 'Impact Zone',
    metricValue: radius, timestamp: '2024-03-15T00:00:00Z',
  },
  geometry: { type: 'Point' as const, coordinates: [28.97, 41.02] },
}));

export const earthquakeScenario: NISARScenario = {
  id: 'istanbul-earthquake', title: 'Post-Seismic Land Subsidence',
  subtitle: 'Istanbul, Turkey – March 2024', category: 'earthquake',
  description: 'Following a magnitude 7.1 earthquake along the North Anatolian Fault, NISAR InSAR data reveals ongoing ground deformation with centimeter-scale land subsidence in urban areas, critical for assessing structural integrity.',
  center: [28.97, 41.02], zoom: 11, pitch: 40, bearing: 15,
  timeRange: { start: '2024-03-01T00:00:00Z', end: '2025-08-01T00:00:00Z' },
  timeSeries: { timestamps: eqTimestamps, values: subsidenceValues, metricName: 'Cumulative Ground Displacement', unit: 'cm' },
  features: { type: 'FeatureCollection', features: [...subsidenceFeatures, faultLine, ...impactZones] },
  educationalContent: {
    headline: 'Reading the Earth\'s Scars',
    body: 'InSAR works by comparing two radar images taken at different times. Phase differences create interferograms — each fringe represents ~2.8 cm of ground movement. NISAR\'s dual-frequency design penetrates vegetation and urban structures.',
    funFact: 'Istanbul sits directly on the North Anatolian Fault — moving ~25mm per year.',
  },
};

/* ── Scenario 3: Iowa Agriculture ──────────────────────────── */
const agTimestamps = seasonalTimestamps(2025, 4, 10);
const biomassValues = seasonalCurve(12, 85, 7);

const agGrid: Array<{ coord: [number, number]; biomass: number[] }> = [];
for (let lat = 41.5; lat <= 42.2; lat += 0.08) {
  for (let lng = -93.8; lng <= -93.0; lng += 0.1) {
    const basePeak = 60 + random() * 30;
    const values = seasonalCurve(8 + random() * 10, basePeak, 7);
    agGrid.push({ coord: [lng, lat], biomass: values });
  }
}

const agFeatures = agGrid.flatMap((cell, cellIdx) =>
  cell.biomass.map((val, timeIdx) => ({
    type: 'Feature' as const,
    properties: {
      id: `ag-${cellIdx}-t${timeIdx}`, category: 'agriculture' as const,
      timestamp: agTimestamps[timeIdx], metricName: 'Biomass Index (%)', metricValue: val,
      biomass: val, cellIndex: cellIdx,
    },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[cell.coord[0], cell.coord[1]], [cell.coord[0] + 0.09, cell.coord[1]], [cell.coord[0] + 0.09, cell.coord[1] + 0.07], [cell.coord[0], cell.coord[1] + 0.07], [cell.coord[0], cell.coord[1]]]],
    },
  }))
);

const moistureStations = [
  { coord: [-93.65, 41.7], name: 'Ames Station' },
  { coord: [-93.3, 41.9], name: 'Marshalltown Station' },
  { coord: [-93.5, 42.05], name: 'Story City Station' },
  { coord: [-93.1, 41.65], name: 'Newton Station' },
].map((station, i) => ({
  type: 'Feature' as const,
  properties: {
    id: `moisture-station-${i}`, category: 'agriculture' as const, stationName: station.name,
    metricName: 'Soil Moisture (%)', metricValue: 25 + random() * 20, timestamp: '2025-07-15T00:00:00Z',
  },
  geometry: { type: 'Point' as const, coordinates: station.coord },
}));

export const agricultureScenario: NISARScenario = {
  id: 'iowa-agriculture', title: 'Crop Biomass Monitoring',
  subtitle: 'Central Iowa, USA – Growing Season 2025', category: 'agriculture',
  description: 'NISAR\'s radar penetrates cloud cover and works day or night, making it ideal for continuous crop monitoring. Radar backscatter changes map biomass accumulation, detect crop stress, and estimate yield.',
  center: [-93.4, 41.85], zoom: 9, pitch: 30, bearing: 0,
  timeRange: { start: '2025-04-15T00:00:00Z', end: '2025-10-15T00:00:00Z' },
  timeSeries: { timestamps: agTimestamps, values: biomassValues, metricName: 'Average Biomass Index', unit: '%' },
  features: { type: 'FeatureCollection', features: [...agFeatures, ...moistureStations] },
  educationalContent: {
    headline: 'Feeding the World from Space',
    body: 'NISAR\'s L-band SAR estimates crop biomass by measuring radar wave scatter off plant structures. Combined with soil moisture from S-band, this dual-frequency approach lets farmers optimize irrigation.',
    funFact: 'Iowa produces roughly 2.5 billion bushels of corn annually — enough to fill the Empire State Building over 4,000 times!',
  },
};

export const ALL_SCENARIOS: NISARScenario[] = [glacierScenario, earthquakeScenario, agricultureScenario];

export function getAllDataPoints(): NISARDataPoint[] {
  const points: NISARDataPoint[] = [];
  for (const scenario of ALL_SCENARIOS) {
    for (const feature of scenario.features.features) {
      const props = feature.properties as Record<string, unknown>;
      points.push({
        id: props.id as string,
        timestamp: (props.timestamp as string) || scenario.timeRange.start,
        category: props.category as NISARDataPoint['category'],
        coordinates: feature.geometry.type === 'Point'
          ? (feature.geometry.coordinates as [number, number])
          : [scenario.center[0], scenario.center[1]],
        metricName: (props.metricName as string) || '',
        metricValue: (props.metricValue as number) || 0,
        geoJsonGeometry: feature.geometry,
      });
    }
  }
  return points;
}
