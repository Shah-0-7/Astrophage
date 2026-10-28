import type { Metadata } from 'next';

// The report page is a client component that resolves the event in the browser, so the head carries the generic
// report title; the visible title is set once the event loads.
export const metadata: Metadata = {
  title: 'Event report',
  description: 'Magnitude, depth, affected area, expected damage and surface displacement for a single Earth-observation event, summarised from public APIs.',
};

export default function EventReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
