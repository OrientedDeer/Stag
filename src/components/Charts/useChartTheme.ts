import { useContext, useMemo } from "react";
import { ThemeContext } from "../Objects/Theme/theme";
import { resolveColor } from "./chartColors";

/**
 * Hook for theme-aware chart colors. Consuming it makes the chart re-render on
 * theme switch; `resolve()` turns `var(--token)` strings into concrete colors
 * (Nivo needs real colors for gradients/modifiers — see resolveColor). Use the
 * returned `theme` as a React `key` on the Nivo component to force a clean
 * remount so internal color caches are rebuilt.
 *
 * Reads the context directly (not the throwing `useTheme`) so charts can also
 * render outside a ThemeProvider (tests, isolated previews) — falling back to
 * the default theme.
 */
export function useChartTheme() {
  const theme = useContext(ThemeContext)?.theme ?? "default";
  return useMemo(
    () => ({
      theme,
      resolve: (value: string | undefined) => resolveColor(value),
    }),
    [theme],
  );
}
