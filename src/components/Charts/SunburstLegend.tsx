interface SunburstLegendEntry {
  name: string;
  color: string;
}

interface SunburstLegendProps {
  entries: SunburstLegendEntry[];
  /** Truncate to this many entries, with a muted "+N more" for the rest. */
  max?: number;
  /** Optional muted prefix, e.g. "Largest". */
  label?: string;
  className?: string;
}

/**
 * Compact swatch legend for the dashboard sunbursts, so slice identity is
 * readable without hovering. Text stays in content tokens — the swatch alone
 * carries the series color.
 */
export const SunburstLegend = ({ entries, max = 6, label, className }: SunburstLegendProps) => {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, max);
  const hidden = entries.length - shown.length;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ''}`}>
      {label && (
        <span className="text-[10px] uppercase tracking-wide text-content-faint">{label}</span>
      )}
      {shown.map(e => (
        <span key={e.name} className="flex items-center gap-1 text-xs text-content-muted">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
          {e.name}
        </span>
      ))}
      {hidden > 0 && <span className="text-xs text-content-faint">+{hidden} more</span>}
    </div>
  );
};
