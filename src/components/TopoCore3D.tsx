/**
 * ============================================================
 * TopoCore3D – View Mode: TOPO_CORE_3D
 * ============================================================
 * The Topo tab. By default it is a directory of the events whose ground motion NASA's NISAR has measured; opening one loads
 * real terrain with the measured line-of-sight change draped on it. "OPEN IN 3D" on any event lands in the same view.
 * ============================================================
 */

'use client';

import { useStore } from '@/lib/store';
import { MeasuredTopoView } from '@/components/topo/measured-view';
import { TopoDirectory } from '@/components/topo/topo-directory';

export default function TopoCore3D() {
  const topoEvent = useStore(s => s.topoEvent);
  const setTopoEvent = useStore(s => s.setTopoEvent);
  if (topoEvent) return <MeasuredTopoView key={topoEvent.id} event={topoEvent} onExit={() => setTopoEvent(null)} />;
  return <TopoDirectory />;
}
