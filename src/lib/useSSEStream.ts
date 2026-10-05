/**
 * ============================================================
 * useSSEStream – Unified SSE Telemetry Hook
 * ============================================================
 * Subscribes to /api/stream and maintains typed state for
 * every geospatial source. Uses a Web Worker to parse large
 * payloads off the main thread.
 *
 * Returns:
 *   seismic       – UnifiedFeature[] (seismic events, tagged)
 *   gnss          – UnifiedFeature[] (GPS deformation stations)
 *   sentinel      – UnifiedFeature[] (Sentinel-1 swath polygons)
 *   volcanism     – UnifiedFeature[] (GVP thermal anomalies)
 *   cryosphere    – UnifiedFeature[] (NSIDC ice extent)
 *   tsunami       – UnifiedFeature[] (PTWC threat zones)
 *   connected     – boolean (SSE connection health)
 *   lastUpdated   – Date | null
 * ============================================================
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { StreamPayload, UnifiedFeature } from '@/lib/types';

interface SSEState {
  seismic:    UnifiedFeature[];
  gnss:       UnifiedFeature[];
  sentinel:   UnifiedFeature[];
  volcanism:  UnifiedFeature[];
  cryosphere: UnifiedFeature[];
  tsunami:    UnifiedFeature[];
  connected:  boolean;
  lastUpdated: Date | null;
}

const INITIAL_STATE: SSEState = {
  seismic:    [],
  gnss:       [],
  sentinel:   [],
  volcanism:  [],
  cryosphere: [],
  tsunami:    [],
  connected:  false,
  lastUpdated: null,
};

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useSSEStream(): SSEState {
  const [state, setState] = useState<SSEState>(INITIAL_STATE);
  const workerRef         = useRef<Worker | null>(null);
  const esRef             = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePayload = useCallback((payload: StreamPayload) => {
    if (payload.type === 'heartbeat') {
      setState(prev => ({ ...prev, connected: true, lastUpdated: new Date() }));
      return;
    }

    setState(prev => ({
      ...prev,
      connected:   true,
      lastUpdated: new Date(),
      [payload.type]: payload.features,
    }));
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Initialise Web Worker once
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('./workers/geoparse.worker.ts', import.meta.url),
      );
      workerRef.current.onmessage = (e: MessageEvent<StreamPayload | { error: string }>) => {
        if ('error' in e.data) {
          console.warn('[SSEStream] worker parse error:', e.data.error);
          return;
        }
        handlePayload(e.data);
      };
    }

    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.onopen = () => {
      reconnectAttempts.current = 0;
      setState(prev => ({ ...prev, connected: true }));
    };

    es.onmessage = (event) => {
      // Offload parsing to the Web Worker
      workerRef.current?.postMessage(event.data);
    };

    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
      es.close();
      esRef.current = null;

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current++;
        const delay = RECONNECT_DELAY_MS * Math.min(reconnectAttempts.current, 4);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
  }, [handlePayload]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      esRef.current?.close();
      workerRef.current?.terminate();
    };
  }, [connect]);

  return state;
}
