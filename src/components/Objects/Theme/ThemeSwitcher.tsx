import { THEMES, useTheme, type ThemeId } from "./theme";

const ORDER: ThemeId[] = ["default", "elite"];

/**
 * Compact theme cycle button for the sidebar footer.
 * Styled with semantic token utilities (bg-surface-*, text-content-*,
 * border-border-*) so it both follows the active theme and serves as a live
 * check that the Layer 1 `@theme inline` utilities are generated.
 */
export default function ThemeSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { theme, config, setTheme } = useTheme();

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
  };

  return (
    <button
      onClick={cycle}
      title={`Theme: ${config.label} (click to switch)`}
      className="flex items-center gap-2 w-full p-2 rounded text-sm transition-colors text-content-muted hover:bg-surface-hover"
    >
      <span className="relative shrink-0 inline-flex">
        {/* palette / swatch icon */}
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 3c4.97 0 9 3.582 9 8 0 2.5-2 4-4 4h-1.5a1.5 1.5 0 0 0-1.06 2.56c.36.36.56.85.56 1.36 0 1.04-.84 1.58-1.94 1.55A9 9 0 1 1 12 3Z"
          />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" />
          <circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
        </svg>
      </span>
      <span
        className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
          collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
        }`}
      >
        {THEMES[theme].label}
      </span>
    </button>
  );
}
