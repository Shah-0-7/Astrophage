'use client';

import { useEffect, useRef } from 'react';
import type { GlobalEvent } from '@/lib/globalEvents';
import { EVENT_TYPE_CONFIG } from '@/lib/eventDirectoryTypes';
import { MASK_H, MASK_W, type WorldGeo } from '@/lib/worldGeo';
import { useWorldGeo } from '@/lib/useWorldGeo';

const D2R = Math.PI / 180;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Longitude span (degrees) shown around the event: bigger events get a wider view. */
function spanFor(e: GlobalEvent): number {
  const m = e.magnitude;
  if (e.type === 'volcanic' || e.type === 'landslide' || e.type === 'mining') return 9;
  if (m == null) return 14;
  if (m >= 7.5) return 46;
  if (m >= 6.5) return 30;
  if (m >= 5.5) return 18;
  return 11;
}

function niceStep(span: number): number {
  const raw = span / 5;
  for (const s of [0.5, 1, 2, 5, 10, 15, 20]) if (raw <= s) return s;
  return 30;
}

/** Draws the static layer (land tinted in the event's tone, coast, borders, graticule, neighbours). */
function paintBase(
  ctx: CanvasRenderingContext2D, w: number, h: number, geo: WorldGeo | null,
  event: GlobalEvent, neighbors: GlobalEvent[],
) {
  const tone = EVENT_TYPE_CONFIG[event.type].color;
  const [tr, tg, tb] = hexToRgb(tone);
  const lat0 = Math.max(-80, Math.min(80, event.lat)), lon0 = event.lon;
  const spanLon = spanFor(event);
  const cosL = Math.max(0.25, Math.cos(lat0 * D2R));
  const k = w / (spanLon * cosL);                       // px per degree of latitude
  const X = (lon: number) => {
    let d = lon - lon0; if (d > 180) d -= 360; if (d < -180) d += 360;
    return w / 2 + d * cosL * k;
  };
  const Y = (lat: number) => h / 2 - (lat - lat0) * k;

  // background wash in the event's tone
  const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  bg.addColorStop(0, `rgba(${tr},${tg},${tb},0.20)`);
  bg.addColorStop(1, 'rgba(4,6,10,0.92)');
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  if (geo) {
    // land mask sampled per pixel at half resolution, tinted by distance inland (soft terraces)
    const sw = Math.ceil(w / 2), sh = Math.ceil(h / 2);
    const img = ctx.createImageData(sw, sh);
    const out = img.data;
    for (let y = 0; y < sh; y++) {
      const lat = lat0 - ((y * 2 - h / 2) / k);
      const my = Math.max(0, Math.min(MASK_H - 1, Math.floor(((90 - lat) / 180) * MASK_H)));
      for (let x = 0; x < sw; x++) {
        const lon = lon0 + ((x * 2 - w / 2) / (k * cosL));
        const mx = ((Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * MASK_W)) % MASK_W + MASK_W) % MASK_W;
        const i = my * MASK_W + mx, o = (y * sw + x) * 4;
        if (geo.mask[i]) {
          const d = Math.min(1, geo.dist[i] / 90);
          const step = Math.floor(d * 5) / 5;               // stacked bands inland
          const a = 0.20 + 0.34 * step;
          out[o] = 12 + (tr - 12) * a; out[o + 1] = 14 + (tg - 14) * a; out[o + 2] = 18 + (tb - 18) * a; out[o + 3] = 255;
        } else {
          const near = Math.max(0, 1 - geo.odist[i] / 7);   // faint glow just off the shore
          const a = 0.05 + 0.10 * near;
          out[o] = 5 + (tr - 5) * a; out[o + 1] = 7 + (tg - 7) * a; out[o + 2] = 11 + (tb - 11) * a; out[o + 3] = 255;
        }
      }
    }
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, w, h);

    const stroke = (segs: Float32Array, style: string, lw: number) => {
      ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        const x0 = X(segs[i]), y0 = Y(segs[i + 1]), x1 = X(segs[i + 2]), y1 = Y(segs[i + 3]);
        if ((x0 < -20 && x1 < -20) || (x0 > w + 20 && x1 > w + 20) || (y0 < -20 && y1 < -20) || (y0 > h + 20 && y1 > h + 20)) continue;
        if (Math.abs(x1 - x0) > w) continue;
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    stroke(geo.borders, `rgba(${tr},${tg},${tb},0.38)`, 0.9);
    ctx.save(); ctx.shadowColor = tone; ctx.shadowBlur = 6;
    stroke(geo.coast, `rgba(${Math.min(255, tr + 60)},${Math.min(255, tg + 60)},${Math.min(255, tb + 60)},0.9)`, 1.2);
    ctx.restore();
  }

  // graticule with degree ticks
  const step = niceStep(spanLon);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.font = '9px ui-monospace, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.38)';
  const latTop = lat0 + h / 2 / k, latBot = lat0 - h / 2 / k;
  for (let lat = Math.ceil(latBot / step) * step; lat <= latTop; lat += step) {
    const y = Math.round(Y(lat)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y);
    ctx.fillText(`${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, 6, y - 3);
  }
  const lonL = lon0 - w / 2 / (k * cosL), lonR = lon0 + w / 2 / (k * cosL);
  for (let lon = Math.ceil(lonL / step) * step; lon <= lonR; lon += step) {
    const x = Math.round(X(lon)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h);
    const L = ((lon + 540) % 360) - 180;
    ctx.fillText(`${Math.abs(L)}°${L >= 0 ? 'E' : 'W'}`, x + 3, h - 6);
  }
  ctx.stroke();

  // storm track: earlier positions joined up to the current one
  if (event.track?.length) {
    const pts = [...event.track, [event.lon, event.lat] as [number, number]];
    ctx.save(); ctx.strokeStyle = tone; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.beginPath();
    pts.forEach(([lo, la], i) => (i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la)))); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = tone;
    event.track.forEach(([lo, la]) => { ctx.beginPath(); ctx.arc(X(lo), Y(la), 2.2, 0, 7); ctx.fill(); });
    ctx.restore();
  }

  // neighbouring events, each in its own tone
  for (const n of neighbors) {
    const x = X(n.lon), y = Y(n.lat);
    if (x < 0 || x > w || y < 0 || y > h) continue;
    ctx.fillStyle = EVENT_TYPE_CONFIG[n.type].color;
    ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, y, 2 + Math.max(0, ((n.magnitude ?? 3) - 3)) * 0.7, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // scale bar
  const pxPerKm = k / 111.32;
  const target = (w * 0.22) / pxPerKm;
  const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const len = nice * pxPerKm;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(w - 14 - len, h - 22); ctx.lineTo(w - 14, h - 22); ctx.moveTo(w - 14 - len, h - 26); ctx.lineTo(w - 14 - len, h - 18); ctx.moveTo(w - 14, h - 26); ctx.lineTo(w - 14, h - 18);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right';
  ctx.fillText(`${nice} KM`, w - 14, h - 31); ctx.textAlign = 'left';

  return { X, Y, tone };
}

export interface RegionMapProps {
  event: GlobalEvent;
  /** Other events to show faintly around it. */
  neighbors?: GlobalEvent[];
  className?: string;
  /** Pulse the marker (default true; respects reduced motion). */
  animate?: boolean;
}

/** A regional cut-out of the world around one event, drawn in that event's tone with a pulsing marker. */
export function RegionMap({ event, neighbors = [], className = 'lg-locator', animate = true }: RegionMapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useWorldGeo();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || !animate;
    let raf = 0, base: HTMLCanvasElement | null = null, marker = { x: 0, y: 0, tone: '#fff' }, bw = 0, bh = 0;

    const build = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const b = document.createElement('canvas'); b.width = canvas.width; b.height = canvas.height;
      const bctx = b.getContext('2d')!;
      bctx.scale(dpr, dpr);
      const r = paintBase(bctx, w, h, geo, event, neighbors);
      marker = { x: r.X(event.lon), y: r.Y(event.lat), tone: r.tone };
      base = b; bw = w; bh = h;
    };

    const draw = (time: number) => {
      if (!base) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { x, y, tone } = marker;
      // crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(0, y + 0.5); ctx.lineTo(bw, y + 0.5); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, bh); ctx.stroke();
      // expanding rings
      const t = reduce ? 0.35 : (time / 1800) % 1;
      for (let i = 0; i < 3; i++) {
        const p = (t + i / 3) % 1;
        ctx.strokeStyle = tone; ctx.globalAlpha = (1 - p) * 0.8; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 6 + p * 46, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 24);
      g.addColorStop(0, tone); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.5; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill();
      ctx.strokeStyle = tone; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, 7); ctx.stroke();
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    build();
    if (reduce) draw(0); else raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => { build(); if (reduce) draw(0); });
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [event, neighbors, geo, animate]);

  return <canvas ref={ref} className={className} role="img" aria-label={`Map around ${event.title}`} />;
}
