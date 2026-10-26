"use client";

import * as React from "react";

const ease = {
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/** Paint a circular hole of radius r in `veil` (transparent inside), with a glowing rim on `ring`. */
export function setIris(veil: HTMLElement, ring: HTMLElement | null, x: number, y: number, r: number) {
  const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${Math.max(r - 0.5, 0)}px, #000 ${r + 0.5}px)`;
  veil.style.maskImage = mask;
  veil.style.setProperty("-webkit-mask-image", mask);
  if (ring) {
    ring.style.opacity = r < 2 ? "0" : "1";
    ring.style.width = ring.style.height = `${r * 2}px`;
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
  }
}

export function reach(x: number, y: number) {
  return Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 40;
}

export function animate(duration: number, curve: keyof typeof ease, step: (t: number) => void) {
  return new Promise<void>(resolve => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || duration <= 0) { step(1); resolve(); return; }
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      step(ease[curve](t));
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export interface IrisHandle {
  /** Close an iris on (x, y), run `swap`, then open it again. */
  transition: (x: number, y: number, swap: () => void) => Promise<void>;
}

/** Full-screen curtain used between views: the screen irises shut around a point, the view swaps, then opens. */
export const Iris = React.forwardRef<IrisHandle>(function Iris(_, ref) {
  const veil = React.useRef<HTMLDivElement>(null);
  const ring = React.useRef<HTMLDivElement>(null);
  const busy = React.useRef(false);

  React.useImperativeHandle(ref, () => ({
    async transition(x, y, swap) {
      const v = veil.current, rg = ring.current;
      if (!v || busy.current) { swap(); return; }
      busy.current = true;
      const max = reach(x, y);
      v.style.display = "block";
      setIris(v, rg, x, y, max);
      await animate(360, "in", t => setIris(v, rg, x, y, max * (1 - t)));
      swap();
      await new Promise(r => setTimeout(r, 60));
      await animate(620, "out", t => setIris(v, rg, x, y, max * t));
      v.style.display = "none";
      if (rg) rg.style.opacity = "0";
      busy.current = false;
    },
  }));

  return (
    <>
      <div ref={veil} aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 80, background: "#000", display: "none", pointerEvents: "none" }} />
      <div
        ref={ring}
        aria-hidden="true"
        style={{
          position: "fixed", zIndex: 81, borderRadius: "50%", pointerEvents: "none", opacity: 0, transform: "translate(-50%, -50%)",
          border: "1px solid rgba(255,196,160,0.9)",
          boxShadow: "0 0 42px rgba(255,140,100,0.55), inset 0 0 36px rgba(255,100,140,0.28)",
        }}
      />
    </>
  );
});
