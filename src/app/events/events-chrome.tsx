'use client';

/**
 * The ledger (/events) lives inside the observatory shell and the report (/events/[id]) draws its own header,
 * so this layout just passes children through.
 */
export default function EventsChrome({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
