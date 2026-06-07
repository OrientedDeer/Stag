import { useEffect, useState, type ReactNode } from "react";
import {
  THEMES,
  ThemeContext,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "./theme";

/**
 * Theme system — Layer 2 provider (runtime switch).
 * Writes the active theme onto <html> (data-theme + effect flags + --app-font)
 * so the Layer 1 CSS tokens in src/index.css take effect, and persists the
 * choice to localStorage. Config/types/hook live in ./theme.
 * See docs/THEMING_PLAN.md.
 */
/** Apply the theme's attributes/font to <html>. Called synchronously on switch
 *  so that components reading resolved CSS-var colors (charts) see fresh values
 *  on the same render, and once on mount. */
function applyTheme(theme: ThemeId) {
  const config = THEMES[theme];
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.glow = String(config.flags.glow);
  root.dataset.scanlines = String(config.flags.scanlines);
  root.dataset.angular = String(config.flags.angular);
  if (config.font) {
    root.style.setProperty("--app-font", config.font);
  } else {
    root.style.removeProperty("--app-font");
  }
}

// Apply the persisted theme once at module load — before React renders the tree
// — so charts that resolve CSS-var colors via getComputedStyle on first mount
// see the correct theme even when Elite is persisted. The provider's effect
// alone runs after paint, which would leave first-render charts default-coloured.
if (typeof document !== "undefined") {
  applyTheme(readStoredTheme());
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (id: ThemeId) => {
    applyTheme(id); // sync: charts resolve fresh CSS-var colors on next render
    setThemeState(id);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* localStorage unavailable (private mode, etc.) — non-fatal. */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, config: THEMES[theme], setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
