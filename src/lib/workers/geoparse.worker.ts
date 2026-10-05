/**
 * ============================================================
 * GeoJSON Parse Web Worker
 * ============================================================
 * Offloads heavy payload parsing from the main thread.
 * Receives raw SSE JSON strings; posts typed StreamPayload back.
 *
 * Usage (from useSSEStream):
 *   const worker = new Worker(new URL('./geoparse.worker.ts', import.meta.url));
 *   worker.postMessage(rawString);
 *   worker.onmessage = (e) => { ... use e.data as StreamPayload }
 * ============================================================
 */

import type { StreamPayload } from '@/lib/types';

self.onmessage = (event: MessageEvent<string>) => {
  try {
    const payload = JSON.parse(event.data) as StreamPayload;

    // Validate top-level shape
    if (!payload.type || !Array.isArray(payload.features)) {
      self.postMessage({ error: 'Invalid payload shape', raw: event.data });
      return;
    }

    // Filter out features with null or degenerate geometry
    payload.features = payload.features.filter(f => {
      if (!f.geometry || !f.geometry.type) return false;
      if (f.geometry.type === 'Point') {
        const [lng, lat] = (f.geometry as any).coordinates;
        if (isNaN(lng) || isNaN(lat)) return false;
      }
      return true;
    });

    self.postMessage(payload);
  } catch (err) {
    self.postMessage({ error: String(err), raw: event.data });
  }
};

export {};
