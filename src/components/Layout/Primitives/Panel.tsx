import type { ElementType, ReactNode, HTMLAttributes } from "react";

/**
 * Panel — the app's standard surface container (Layer 3 primitive).
 *
 * Replaces the repeated `bg-surface-raised border border-border-subtle
 * rounded-xl p-*` block (~70 sites). Centralising it means a heavy reskin
 * restyles every panel in one place — e.g. the Elite theme adds an angular HUD
 * frame to `.stag-panel` from src/index.css without touching call sites.
 */
type Padding = "none" | "sm" | "md" | "lg";

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

interface PanelProps extends HTMLAttributes<HTMLElement> {
  padding?: Padding;
  /** Adds a hover border highlight (for clickable cards). */
  interactive?: boolean;
  /** Render as a different element (e.g. "button", "section"). */
  as?: ElementType;
  children?: ReactNode;
}

export function Panel({
  padding = "md",
  interactive = false,
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: PanelProps) {
  return (
    <Tag
      className={`stag-panel bg-surface-raised border border-border-subtle rounded-xl ${PADDING[padding]}${
        interactive ? " hover:border-border-strong transition-colors" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
