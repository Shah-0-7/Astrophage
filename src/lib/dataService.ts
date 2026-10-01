/**
 * ============================================================
 * NISAR Earth Watch – Data Service Layer
 * ============================================================
 * Abstracts all data fetching behind a clean API.  To switch
 * from mock data to real NISAR HDF5/GeoTIFF tile servers,
 * ONLY this file needs to change.
 * ============================================================
 */

import type { NISARDataPoint, NISARCategory, NISARScenario } from './types';
import { ALL_SCENARIOS, getAllDataPoints } from './mockData';
import type { FeatureCollection } from 'geojson';

/* ── Scenario queries ───────────────────────────────────────── */

export function getScenarios(): NISARScenario[] {
  return ALL_SCENARIOS;
}

export function getScenarioById(id: string): NISARScenario | undefined {
  return ALL_SCENARIOS.find(s => s.id === id);
}

export function getScenariosByCategory(category: NISARCategory): NISARScenario[] {
  return ALL_SCENARIOS.filter(s => s.category === category);
}

/* ── Data point queries ─────────────────────────────────────── */

export function getDataPoints(
  timeRange?: { start: string; end: string },
  category?: NISARCategory | 'all'
): NISARDataPoint[] {
  let points = getAllDataPoints();

  if (category && category !== 'all') {
    points = points.filter(p => p.category === category);
  }

  if (timeRange) {
    const startMs = new Date(timeRange.start).getTime();
    const endMs = new Date(timeRange.end).getTime();
    points = points.filter(p => {
      const ts = new Date(p.timestamp).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  return points;
}

/* ── GeoJSON filtered by timestamp ──────────────────────────── */

export function getFilteredFeatures(
  scenario: NISARScenario,
  currentTimestamp: string
): FeatureCollection {
  const currentMs = new Date(currentTimestamp).getTime();

  const filtered = scenario.features.features.filter(f => {
    const props = f.properties as Record<string, unknown>;
    const featureTs = props.timestamp as string | undefined;
    if (!featureTs) return true; // always-visible features
    return new Date(featureTs).getTime() <= currentMs;
  });

  return {
    type: 'FeatureCollection',
    features: filtered,
  };
}

/* ── Time-series chart data ─────────────────────────────────── */

export function getChartData(scenario: NISARScenario, upToTimestamp?: string) {
  const { timestamps, values, metricName, unit } = scenario.timeSeries;
  const upToMs = upToTimestamp ? new Date(upToTimestamp).getTime() : Infinity;

  return timestamps
    .map((ts, i) => ({
      date: ts,
      value: values[i],
      label: `${values[i]} ${unit}`,
    }))
    .filter(d => new Date(d.date).getTime() <= upToMs);
}

/* ── Timestamp utilities ────────────────────────────────────── */

export function getTimelineSteps(scenario: NISARScenario): string[] {
  return scenario.timeSeries.timestamps;
}

export function getTimestampIndex(scenario: NISARScenario, timestamp: string): number {
  const ts = scenario.timeSeries.timestamps;
  const targetMs = new Date(timestamp).getTime();
  let closest = 0;
  let minDiff = Infinity;
  ts.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  });
  return closest;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
