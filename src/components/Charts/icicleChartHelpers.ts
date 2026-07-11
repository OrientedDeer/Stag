// Helpers shared between the icicle chart and the tab files that build its data.
// Kept in a component-free module so ObjectsIcicleChart.tsx stays a clean
// fast-refresh boundary (react-refresh/only-export-components).

// Convert a Tailwind class "bg-chart-Name-10" -> CSS var "var(--color-chart-Name-10)"
export const tailwindToCssVar = (className: string) => {
    if (!className) return '#ccc';
    return `var(--color-${className.replace('bg-', '')})`;
};

// Gradient distribution logic for color palettes
export function getDistributedColors<T extends string>(palette: T[], count: number): T[] {
    if (count <= 1) return [palette[Math.floor(palette.length / 2)]]; // Use middle color for single item
    return Array.from({ length: count }, (_, i) => {
        const index = Math.round((i * (palette.length - 1)) / (count - 1));
        return palette[index];
    });
}
