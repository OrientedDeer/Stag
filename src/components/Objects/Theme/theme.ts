import { createContext, useContext } from "react";

/**
 * Theme system — Layer 2 config + context (non-component module).
 * The <ThemeProvider> component lives in ThemeContext.tsx; everything that is
 * not a component (config, types, context object, hook) lives here so the
 * provider file stays fast-refresh friendly.
 */

export type ThemeId = "default" | "elite";

export interface ThemeConfig {
  id: ThemeId;
  label: string;
  /** CSS font-family applied at the root; undefined keeps the app default. */
  font?: string;
  flags: {
    /** Amber glow on accents/borders. */
    glow: boolean;
    /** HUD scanline overlay. */
    scanlines: boolean;
    /** Square off rounded corners for an angular HUD look. */
    angular: boolean;
  };
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  default: {
    id: "default",
    label: "Default",
    flags: { glow: false, scanlines: false, angular: false },
  },
  elite: {
    id: "elite",
    label: "Elite Dangerous",
    font: "'Orbitron', 'Chakra Petch', ui-sans-serif, system-ui, sans-serif",
    flags: { glow: true, scanlines: true, angular: true },
  },
};

export const THEME_STORAGE_KEY = "stag-theme";

export function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "elite" || stored === "default" ? stored : "default";
}

export interface ThemeContextValue {
  theme: ThemeId;
  config: ThemeConfig;
  setTheme: (id: ThemeId) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
