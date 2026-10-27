/**
 * Shared SVG filters that turn solid text into an outer-only outline: the glyph is grown by N px and its own
 * shape is cut out, so no stroke ever appears inside a letter (variable fonts overlap contours, which text-stroke exposes).
 */
export function OutlineDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        {([['ol-1', 0.8], ['ol-2', 1.5], ['ol-3', 2.2]] as const).map(([id, r]) => (
          <filter key={id} id={id} x="-8%" y="-12%" width="116%" height="124%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceGraphic" operator="dilate" radius={r} result="grown" />
            <feComponentTransfer in="SourceAlpha" result="solid">
              <feFuncA type="linear" slope="6" intercept="-0.4" />
            </feComponentTransfer>
            <feComposite in="grown" in2="solid" operator="out" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
