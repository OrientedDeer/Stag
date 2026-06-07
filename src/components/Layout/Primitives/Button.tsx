import type { ComponentPropsWithRef } from "react";

/**
 * Button — themeable action button (Layer 3 primitive).
 * Variants map to semantic tokens so they recolor per theme; a heavy reskin
 * can also restyle every button (shape/glow) from here. See docs/THEMING_PLAN.md.
 */
type Variant =
  | "primary"
  | "positive"
  | "negative"
  | "warning"
  | "secondary"
  | "ghost";
type Size = "sm" | "md" | "lg" | "none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent hover:bg-accent-hover text-accent-contrast",
  positive: "bg-positive-solid hover:bg-positive-strong text-white",
  negative: "bg-negative-solid hover:bg-negative-strong text-white",
  warning: "bg-warning-solid hover:bg-warning-strong text-white",
  secondary: "bg-surface-input hover:bg-surface-hover text-white",
  ghost: "text-content-muted hover:text-white hover:bg-surface-overlay",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5",
  none: "", // caller controls padding/text via className
};

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`stag-button rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
