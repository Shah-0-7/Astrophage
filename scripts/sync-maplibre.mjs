// Copies MapLibre's worker files into public/. A node script instead of `cp` so it also works on Windows.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/${f}`);
}
