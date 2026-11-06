/** Marks readouts that come from the built-in simulated scenarios, not from NISAR or any other live source. */
export function DemoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-mono ${className}`}
      title="Simulated scenario data built into the app. Not a live NISAR product. See the NISAR layer and event reports for real NASA records."
      style={{ fontSize: 8, letterSpacing: '0.14em', padding: '2px 7px', borderRadius: 999, border: '1px solid rgba(251,191,36,.55)', color: '#fbbf24', background: 'rgba(251,191,36,.1)', whiteSpace: 'nowrap' }}
    >
      DEMO · SIMULATED
    </span>
  );
}
