import type { ReactNode } from "react";

/**
 * SectionHeader — the uppercase, wide-tracked label used above panels/sections
 * (Layer 3 primitive). Centralises the `text-content-muted text-xs font-bold
 * uppercase tracking-widest` pattern so the Elite theme can give it a HUD
 * readout treatment in one place. See docs/THEMING_PLAN.md.
 */
interface SectionHeaderProps {
  children: ReactNode;
  className?: string;
}

export function SectionHeader({ children, className = "" }: SectionHeaderProps) {
  return (
    <h3
      className={`stag-section-header text-content-muted text-xs font-bold uppercase tracking-widest ${className}`}
    >
      {children}
    </h3>
  );
}
