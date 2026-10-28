/**
 * ============================================================
 * useGlobalEvents – React hook for the Global Schematic view
 * ============================================================
 * Orchestrates parallel fetching from all five data sources,
 * provides reactive source health, filtering helpers, and
 * geolocation "near me" functionality.
 * ============================================================
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAllGlobalEvents,
  type GlobalEvent,
  type SourceHealth,
  type EventType,
  type EventCause,
} from './globalEvents';

export type { GlobalEvent, SourceHealth, EventType, EventCause };

// ── Cause filter ──────────────────────────────────────────────

export type CauseFilter = 'all' | 'natural' | 'human';

// ── Time window (driven by pass scrubber or own control) ───────

export interface TimeWindow {
  start: number; // epoch ms
  end:   number;
}

// ── Hook return ────────────────────────────────────────────────

export interface UseGlobalEventsReturn {
  events:          GlobalEvent[];
  filteredEvents:  GlobalEvent[];
  sourceHealth:    SourceHealth[];
  loading:         boolean;
  causeFilter:     CauseFilter;
  setCauseFilter:  (f: CauseFilter) => void;
  timeWindow:      TimeWindow | null;
  setTimeWindow:   (w: TimeWindow | null) => void;
  naturalCount:    number;
  humanCount:      number;
  userLocation:    [number, number] | null;  // [lat, lon]
  locationError:   string | null;
  requestLocation: () => void;
  nearbyEvents:    (GlobalEvent & { distanceKm: number })[];
  refresh:         () => void;
}

// ── Haversine ─────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Hook ──────────────────────────────────────────────────────

export function useGlobalEvents(): UseGlobalEventsReturn {
  const [events,       setEvents]       = useState<GlobalEvent[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [causeFilter,  setCauseFilter]  = useState<CauseFilter>('all');
  const [timeWindow,   setTimeWindow]   = useState<TimeWindow | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<boolean>(false);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  // ── Main fetch effect ────────────────────────────────────────
  useEffect(() => {
    abortRef.current = false;
    if (tick === 0) setLoading(true);   // later refreshes are silent, so the views never flash

    // Safety timeout: never leave the globe in skeleton state > 12s
    const safetyTimer = setTimeout(() => {
      if (!abortRef.current) setLoading(false);
    }, 12_000);

    fetchAllGlobalEvents((health) => {
      if (!abortRef.current) setSourceHealth(health);
    }).then(evts => {
      if (!abortRef.current) {
        setEvents(evts);
        setLoading(false);
      }
    }).catch(err => {
      console.error('[useGlobalEvents] fatal fetch error:', err);
      if (!abortRef.current) setLoading(false);
    }).finally(() => {
      clearTimeout(safetyTimer);
    });

    return () => {
      abortRef.current = true;
      clearTimeout(safetyTimer);
    };
  }, [tick]);

  // ── Filtered events ──────────────────────────────────────────
  const filteredEvents = events.filter(ev => {
    if (causeFilter !== 'all' && ev.cause !== causeFilter) return false;
    if (timeWindow) {
      if (ev.time < timeWindow.start || ev.time > timeWindow.end) return false;
    }
    return true;
  });

  const naturalCount = events.filter(e => e.cause === 'natural').length;
  const humanCount   = events.filter(e => e.cause === 'human').length;

  // ── Geolocation ──────────────────────────────────────────────
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      pos => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
      err => {
        if (err.code === 1) setLocationError('Location permission denied.');
        else setLocationError('Unable to retrieve your location.');
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  }, []);

  // ── Nearby events (sorted by distance, top 10) ───────────────
  const nearbyEvents = userLocation
    ? filteredEvents
        .map(ev => ({
          ...ev,
          distanceKm: haversineKm(userLocation[0], userLocation[1], ev.lat, ev.lon),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 10)
    : [];

  return {
    events,
    filteredEvents,
    sourceHealth,
    loading,
    causeFilter,
    setCauseFilter,
    timeWindow,
    setTimeWindow,
    naturalCount,
    humanCount,
    userLocation,
    locationError,
    requestLocation,
    nearbyEvents,
    refresh,
  };
}
