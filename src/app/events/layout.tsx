/**
 * /events layout – slim standalone layout with back-to-globe header.
 * globals.css is already imported by the root layout (src/app/layout.tsx).
 */

import type { Metadata } from 'next';
import EventsChrome from './events-chrome';

export const metadata: Metadata = {
  title: 'Event Directory – NISAR Earth Watch',
  description: 'Browse, search and filter real-time global geophysical events: earthquakes, volcanic eruptions, landslides, cryosphere events, subsidence, mining and induced seismicity.',
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <EventsChrome>{children}</EventsChrome>;
}
