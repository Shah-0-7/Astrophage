"use client";

import * as React from "react";

export interface OutlineWordmarkProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

const FILL = "rgba(255,255,255,0.94)";

/**
 * Large wordmark. Letters keep a solid fill; the letter nearest the pointer swells slightly and
 * does a short wobble. Pointer tracking uses window events, so the wordmark never blocks what lies beneath it.
 */
export function OutlineWordmark({ text, className, style }: OutlineWordmarkProps) {
  const root = React.useRef<HTMLHeadingElement>(null);
  const cells = React.useRef<Array<HTMLSpanElement | null>>([]);
  const letters = React.useMemo(() => Array.from(text), [text]);

  React.useEffect(() => {
    const host = root.current;
    if (!host) return;
    let active = -1;

    function show(next: number) {
      if (next === active) return;
      active = next;
      cells.current.forEach((cell, i) => {
        if (!cell) return;
        if (i === next) {
          cell.dataset.hot = "1";
          // restart the wobble each time a letter is entered
          cell.dataset.wob = "0"; void cell.offsetWidth; cell.dataset.wob = "1";
        } else {
          delete cell.dataset.hot;
          cell.dataset.wob = "0";
        }
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

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", clear);
    return () => {
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
        .outline-wordmark > span { display: inline-block; transform-origin: 50% 70%; transition: transform .35s cubic-bezier(.34,1.56,.64,1); will-change: transform; }
        .outline-wordmark > span[data-hot="1"] { transform: scale(1.12); }
        .outline-wordmark > span[data-wob="1"] { animation: ow-wobble .7s ease-in-out; }
        @keyframes ow-wobble {
          0% { rotate: 0deg; } 18% { rotate: -7deg; } 38% { rotate: 6deg; } 58% { rotate: -4deg; } 78% { rotate: 2deg; } 100% { rotate: 0deg; }
        }
        @media (prefers-reduced-motion: reduce) { .outline-wordmark > span { transition: none; } .outline-wordmark > span[data-wob="1"] { animation: none; } }
      `}</style>
      {letters.map((char, i) => (
        <span
          key={`${char}-${i}`}
          ref={node => { cells.current[i] = node; }}
          aria-hidden="true"
          style={{ color: FILL }}
        >
          {char}
        </span>
      ))}
    </h1>
  );
}
