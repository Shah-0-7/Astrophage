"use client";

import * as React from "react";

export interface OutlineWordmarkProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

const FILL = "rgba(255,255,255,0.94)";
/** Border thickness: the larger of 1.6 CSS px and this fraction of the font size. */
const BORDER_EM = 0.018;

/**
 * Draws only the outer silhouette border of one letter onto `canvas`.
 * Enclosed counters (the hole in R, A, O, P...) are filled first, so no inner outline appears.
 */
function traceOuterBorder(cell: HTMLElement, canvas: HTMLCanvasElement, char: string) {
  const computed = getComputedStyle(cell);
  const fontSize = parseFloat(computed.fontSize);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const pad = fontSize * 0.12;
  const box = cell.getBoundingClientRect();
  const cssWidth = box.width + pad * 2, cssHeight = box.height + pad * 2;
  const width = Math.ceil(cssWidth * dpr), height = Math.ceil(cssHeight * dpr);
  canvas.width = width;
  canvas.height = height;
  canvas.style.left = `${-pad}px`;
  canvas.style.top = `${-pad}px`;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.font = `${computed.fontStyle} ${computed.fontWeight} ${fontSize * dpr}px ${computed.fontFamily}`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const metrics = context.measureText("M");
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize * dpr * 0.92;
  const descent = metrics.fontBoundingBoxDescent ?? fontSize * dpr * 0.24;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillText(char, pad * dpr, pad * dpr + (box.height * dpr) / 2 + (ascent - descent) / 2);

  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const total = width * height;

  // Everything reachable from the canvas edge without crossing ink is "outside". Whatever is not
  // outside (ink plus enclosed counters) is the silhouette.
  const outside = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const open = (p: number) => data[p * 4 + 3] < 24 && !outside[p];
  const seed = (p: number) => { if (open(p)) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < total - width) seed(p + width);
  }

  // Distance from every pixel to the nearest outside pixel (two-pass chamfer).
  const distance = new Float32Array(total);
  for (let p = 0; p < total; p++) distance[p] = outside[p] ? 0 : 1e9;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let best = distance[p];
      if (x > 0) best = Math.min(best, distance[p - 1] + D1);
      if (y > 0) {
        best = Math.min(best, distance[p - width] + D1);
        if (x > 0) best = Math.min(best, distance[p - width - 1] + D2);
        if (x < width - 1) best = Math.min(best, distance[p - width + 1] + D2);
      }
      distance[p] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      let best = distance[p];
      if (x < width - 1) best = Math.min(best, distance[p + 1] + D1);
      if (y < height - 1) {
        best = Math.min(best, distance[p + width] + D1);
        if (x < width - 1) best = Math.min(best, distance[p + width + 1] + D2);
        if (x > 0) best = Math.min(best, distance[p + width - 1] + D2);
      }
      distance[p] = best;
    }
  }

  const border = Math.max(1.6, fontSize * BORDER_EM) * dpr;
  for (let p = 0; p < total; p++) {
    const ink = data[p * 4 + 3] / 255;
    // Enclosed counters count as solid so the border is measured from the outer edge only.
    const cover = !outside[p] && ink < 0.1 ? 1 : ink;
    const band = Math.min(1, Math.max(0, border + 0.5 - distance[p]));
    data[p * 4] = 255; data[p * 4 + 1] = 255; data[p * 4 + 2] = 255;
    data[p * 4 + 3] = Math.round(255 * cover * band);
  }
  context.putImageData(image, 0, 0);
}

/**
 * Large wordmark. The letter under the pointer loses its fill and keeps only its outer white border.
 * Pointer tracking uses window events, so the wordmark never blocks what lies beneath it.
 */
export function OutlineWordmark({ text, className, style }: OutlineWordmarkProps) {
  const root = React.useRef<HTMLHeadingElement>(null);
  const cells = React.useRef<Array<HTMLSpanElement | null>>([]);
  const outlines = React.useRef<Array<HTMLCanvasElement | null>>([]);
  const letters = React.useMemo(() => Array.from(text), [text]);

  React.useEffect(() => {
    const host = root.current;
    if (!host) return;
    const drawn: boolean[] = letters.map(() => false);
    let active = -1;

    function show(next: number) {
      if (next === active) return;
      active = next;
      cells.current.forEach((cell, i) => {
        const outline = outlines.current[i];
        if (!cell || !outline) return;
        const on = i === next;
        if (on && !drawn[i]) { traceOuterBorder(cell, outline, letters[i]); drawn[i] = true; }
        cell.style.color = on ? "transparent" : FILL;
        outline.style.opacity = on ? "1" : "0";
      });
    }
    function move(event: PointerEvent) {
      const box = host!.getBoundingClientRect();
      const slack = box.height * 0.45;
      const inside = event.clientY >= box.top - slack && event.clientY <= box.bottom + slack
        && event.clientX >= box.left - box.height * 0.3 && event.clientX <= box.right + box.height * 0.3;
      if (!inside) { show(-1); return; }
      let nearest = -1, best = Infinity;
      cells.current.forEach((cell, i) => {
        if (!cell) return;
        const r = cell.getBoundingClientRect();
        const away = Math.abs(event.clientX - (r.left + r.width / 2));
        if (away < best) { best = away; nearest = i; }
      });
      show(nearest);
    }
    function clear() { show(-1); }
    function up(event: PointerEvent) { if (event.pointerType !== "mouse") show(-1); }
    // Outlines depend on the font and the size, so redraw them lazily after either changes.
    function invalidate() { drawn.fill(false); if (active >= 0) { const keep = active; active = -1; show(keep); } }

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", clear);
    const resize = new ResizeObserver(invalidate);
    resize.observe(host);
    document.fonts?.ready.then(invalidate);
    return () => {
      resize.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", clear);
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("pointerleave", clear);
    };
  }, [letters]);

  return (
    <h1
      ref={root}
      aria-label={text}
      className={`${className ?? ""} outline-wordmark`}
      style={{ margin: 0, display: "flex", justifyContent: "center", whiteSpace: "nowrap", lineHeight: 1, userSelect: "none", ...style }}
    >
      <style>{`
        .outline-wordmark > span { transition: color 0.28s ease; }
        .outline-wordmark > span > canvas { transition: opacity 0.28s ease; }
        @media (prefers-reduced-motion: reduce) { .outline-wordmark > span, .outline-wordmark > span > canvas { transition: none; } }
      `}</style>
      {letters.map((char, i) => (
        <span
          key={`${char}-${i}`}
          ref={node => { cells.current[i] = node; }}
          aria-hidden="true"
          style={{ position: "relative", display: "inline-block", color: FILL }}
        >
          {char}
          <canvas
            ref={node => { outlines.current[i] = node; }}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
        </span>
      ))}
    </h1>
  );
}
