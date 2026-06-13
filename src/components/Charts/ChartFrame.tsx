import { Fragment, type ReactNode } from "react";
import { useChartTheme } from "./useChartTheme";

/**
 * Remounts its chart children whenever the theme changes. Nivo caches resolved
 * colors internally, so a fresh mount is needed for a chart to recolour on
 * theme switch. Wrapping a chart's Nivo element in <ChartFrame> centralises
 * that concern (a keyed Fragment — no extra DOM/layout) so individual charts
 * don't each have to remember `key={theme}`.
 */
export function ChartFrame({ children }: { children: ReactNode }) {
  const { theme } = useChartTheme();
  return <Fragment key={theme}>{children}</Fragment>;
}
