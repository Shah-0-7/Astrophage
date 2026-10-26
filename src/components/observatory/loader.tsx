"use client";

import * as React from "react";
import { animate, reach, setIris } from "./iris";

const MESSAGES = ["Contacting USGS", "Reading NASA EONET", "Indexing volcano reports", "Aligning radar epochs", "Calibrating baselines", "Ready"];
const DISPLAY = 'var(--font-display), "Arial Black", system-ui, sans-serif';
const SIZE = 340;

const stars = Array.from({ length: 60 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12345.6789;
  return `${((a - Math.floor(a)) * 100).toFixed(2)}vw ${((b - Math.floor(b)) * 100).toFixed(2)}vh 0 ${i % 9 === 0 ? 1 : 0}px rgba(160,180,255,${(0.18 + (i % 5) * 0.08).toFixed(2)})`;
}).join(",");

/** Soft wobbling outline: a circle bent by a few slow harmonics. */
function blobPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: number, seed: number, energy: number) {
  const steps = 160;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      0.1 * energy * Math.cos(2 * a + t * 0.9 + seed) +
      0.07 * energy * Math.cos(3 * a - t * 1.15 + seed * 2.1) +
      0.04 * energy * Math.cos(5 * a + t * 1.6 + seed * 3.7);
    const r = R * (1 + wobble);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Loading screen: a glass-like orb that keeps changing shape, edged in blue and violet light, with the
 * percentage counting up inside it. When it reaches 100% an iris opens from the orb to reveal the app.
 */
export function Loader({ onDone, minimumMs = 3200 }: { onDone: () => void; minimumMs?: number }) {
  const veil = React.useRef<HTMLDivElement>(null);
  const ring = React.useRef<HTMLDivElement>(null);
  const orb = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const progressRef = React.useRef(0);
  const [progress, setProgress] = React.useState(0);

  // Orb animation
  React.useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = SIZE * dpr; cv.height = SIZE * dpr;
    let raf = 0, alive = true;
    const start = performance.now();
    const draw = (now: number) => {
      if (!alive) return;
      const t = reduce ? 2 : (now - start) / 1000;
      const p = progressRef.current / 100;
      const energy = 0.75 + 0.35 * Math.sin(t * 0.8) * 0.5 + 0.3 * p;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      const cx = SIZE / 2, cy = SIZE / 2, R = SIZE * 0.29;
      const spin = t * 0.35;

      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(spin); ctx.translate(-cx, -cy);

      // flares: thin magenta/violet streaks crossing the orb
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 2; k++) {
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(k * 1.2 + Math.PI / 4 - spin * 1.4);
        const len = SIZE * (0.5 + 0.06 * Math.sin(t * 1.3 + k));
        const g = ctx.createLinearGradient(-len, 0, len, 0);
        g.addColorStop(0, "rgba(120,60,255,0)"); g.addColorStop(0.5, `rgba(210,80,255,${0.34 + 0.2 * p})`); g.addColorStop(1, "rgba(120,60,255,0)");
        ctx.fillStyle = g; ctx.fillRect(-len, -1, len * 2, 2);
        ctx.restore();
      }
      ctx.globalCompositeOperation = "source-over";

      // outer haze
      const haze = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2);
      haze.addColorStop(0, `rgba(60,90,255,${0.22 + 0.14 * p})`); haze.addColorStop(1, "rgba(30,20,90,0)");
      ctx.fillStyle = haze; ctx.beginPath(); ctx.arc(cx, cy, R * 2, 0, 7); ctx.fill();

      // two overlapping lobes give the shape its depth
      for (let layer = 0; layer < 2; layer++) {
        const seed = layer * 2.4;
        const scale = layer === 0 ? 1 : 0.9;
        blobPath(ctx, cx + (layer ? 5 : 0), cy + (layer ? -4 : 0), R * scale, t, seed, energy);
        const fill = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.15);
        fill.addColorStop(0, "rgba(3,4,12,0.96)"); fill.addColorStop(0.7, "rgba(8,14,40,0.9)"); fill.addColorStop(1, `rgba(40,90,255,${layer ? 0.22 : 0.4})`);
        ctx.fillStyle = fill; ctx.fill();
        const rim = ctx.createConicGradient(t * 0.5 + layer, cx, cy);
        rim.addColorStop(0, "#4fa3ff"); rim.addColorStop(0.3, "#7a5cff"); rim.addColorStop(0.55, "#c04dff"); rim.addColorStop(0.8, "#3a7bff"); rim.addColorStop(1, "#4fa3ff");
        ctx.save();
        ctx.shadowColor = layer ? "rgba(122,92,255,0.8)" : "rgba(79,163,255,0.95)"; ctx.shadowBlur = 22 + 18 * p;
        ctx.strokeStyle = rim; ctx.lineWidth = layer ? 1.2 : 2; ctx.globalAlpha = layer ? 0.75 : 1; ctx.stroke();
        ctx.restore();
      }
      // fine inner rim, like frosted glass
      blobPath(ctx, cx, cy, R * 0.93, t, 0, energy);
      ctx.strokeStyle = "rgba(120,160,255,0.18)"; ctx.lineWidth = 6; ctx.stroke();
      ctx.restore();

      // specular dot
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(cx + R * 0.35, cy - R * 0.55, 1.6, 0, 7); ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  // Progress, then the reveal
  React.useEffect(() => {
    let cancelled = false;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 500 : minimumMs;
    const start = performance.now();
    function frame(now: number) {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const stall = t > 0.38 && t < 0.46 ? 0.012 : t > 0.74 && t < 0.8 ? -0.01 : 0;
      const value = Math.min(100, Math.max(0, (eased + stall) * 100));
      progressRef.current = value;
      setProgress(value);
      if (t < 1) requestAnimationFrame(frame); else finish();
    }
    async function finish() {
      const v = veil.current, rg = ring.current, o = orb.current;
      progressRef.current = 100; setProgress(100);
      await new Promise(r => setTimeout(r, reduce ? 0 : 420));
      if (cancelled || !v) return;
      const box = o?.getBoundingClientRect();
      const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
      const y = box ? box.top + box.height / 2 : window.innerHeight / 2;
      const max = reach(x, y);
      onDone();
      await animate(1000, "inOut", t => setIris(v, rg, x, y, max * t));
      v.style.display = "none";
      if (rg) rg.style.opacity = "0";
    }
    requestAnimationFrame(frame);
    return () => { cancelled = true; };
  }, [minimumMs, onDone]);

  const p = Math.round(progress);
  const message = MESSAGES[Math.min(MESSAGES.length - 1, Math.floor((progress / 100) * (MESSAGES.length - 0.01)))];

  return (
    <>
      <div
        ref={veil}
        role="status"
        aria-label={`Loading ${p} percent`}
        style={{ position: "fixed", inset: 0, zIndex: 90, background: "radial-gradient(60% 50% at 50% 46%, #070b1f 0%, #02030a 60%, #000 100%)", color: "#fff", display: "grid", placeItems: "center", overflow: "hidden" }}
      >
        <div aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, left: 0, top: 0, boxShadow: stars, borderRadius: "50%" }} />
        <div style={{ position: "relative", display: "grid", justifyItems: "center", transform: "translateY(-18px)" }}>
          <div ref={orb} style={{ position: "relative", width: SIZE, height: SIZE, maxWidth: "92vw" }}>
            <canvas ref={canvas} aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }} />
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, fontFamily: DISPLAY, fontWeight: 700, textShadow: "0 0 24px rgba(110,140,255,0.7)" }}>
                <span style={{ fontSize: 46, lineHeight: 1, fontVariantNumeric: "tabular-nums", minWidth: "2ch", textAlign: "right" }}>{String(p).padStart(2, "0")}</span>
                <span style={{ fontSize: 13, opacity: 0.6 }}>%</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: -26, fontFamily: "var(--ob-mono)", fontSize: 11, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(150,170,230,0.6)", height: 14 }}>
            {message}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 32, fontFamily: DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: "0.32em", opacity: 0.85 }}>
          ASTROPHAGE
        </div>
      </div>
      <div
        ref={ring}
        aria-hidden="true"
        style={{
          position: "fixed", zIndex: 91, borderRadius: "50%", pointerEvents: "none", opacity: 0, transform: "translate(-50%, -50%)",
          border: "1px solid rgba(140,170,255,0.9)", boxShadow: "0 0 50px rgba(90,110,255,0.6), inset 0 0 40px rgba(170,80,255,0.3)",
        }}
      />
    </>
  );
}
