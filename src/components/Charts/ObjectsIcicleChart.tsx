import { useRef, useState, useEffect } from 'react';
import { ResponsiveIcicle } from "@nivo/icicle";

const MIN_CHART_WIDTH = 300;

// --- Types ---
interface ObjectsIcicleChartProps {
    data: any; // Hierarchical data structure
    valueFormat?: string; // Format string for values (default: ">-$0,.0f")
    height?: number; // Height in pixels (default: 192px which is h-48)
}

// --- Helpers ---
// Helper to convert Tailwind class "bg-chart-Name-10" -> CSS var "var(--color-chart-Name-10)"
const tailwindToCssVar = (className: string) => {
    if (!className) return '#ccc';
    return `var(--color-${className.replace('bg-', '')})`;
};

// Gradient distribution logic for color palettes
function getDistributedColors<T extends string>(palette: T[], count: number): T[] {
    if (count <= 1) return [palette[Math.floor(palette.length / 2)]]; // Use middle color for single item
    return Array.from({ length: count }, (_, i) => {
        const index = Math.round((i * (palette.length - 1)) / (count - 1));
        return palette[index];
    });
}

// --- Component ---
export const ObjectsIcicleChart = ({
    data,
    valueFormat = ">-$0,.0f",
    height = 192
}: ObjectsIcicleChartProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    // Track container width to prevent negative SVG dimensions
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    const isNarrow = containerWidth !== null && containerWidth < MIN_CHART_WIDTH;
    const isMeasured = containerWidth !== null;

    // Show loading state until measured
    if (!isMeasured) {
        return (
            <div ref={containerRef} className="w-full bg-gray-900 flex items-center justify-center" style={{ height: `${height}px` }}>
                <p className="text-gray-400 text-sm">Loading chart...</p>
            </div>
        );
    }

    // Show message when container is too narrow for the chart
    if (isNarrow) {
        return (
            <div ref={containerRef} className="w-full bg-gray-900 flex items-center justify-center border-2 border-dashed border-gray-700 rounded-xl" style={{ height: `${height}px` }}>
                <p className="text-gray-400 text-sm text-center px-4">Expand window to view chart</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="w-full bg-gray-900" style={{ height: `${height}px` }}>
            <ResponsiveIcicle
                data={data}
                // Tell Nivo to use the 'color' key we added to the data objects
                colors={(node: any) => node.data.color}

                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                valueFormat={valueFormat}
                borderRadius={8}

                // Layout & Labels
                enableLabels={true}
                labelSkipWidth={30}
                labelTextColor={{ from: 'color', modifiers: [['darker', 2.5]] }} // Dark text for contrast

                // Tooltip - unified and generic
                tooltip={(node) => {
                    const { id, value, data: nodeData } = node;
                    const customData = nodeData as any;

                    // Use netWorth if available (for account root node), otherwise use value
                    const displayValue = customData.netWorth !== undefined ? customData.netWorth : value;

                    // Calculate percentage of total assets (sum of all absolute values in chart)
                    // Using netWorth would be wrong when debt exists (e.g., $500k assets - $400k debt = $100k networth
                    // would show a $250k account as 250% instead of 50%)
                    const totalAssets = data.totalAssets || data.value || value || 1;
                    const percentage = (value / totalAssets) * 100;

                    // Don't show percentage for root node (it's always 100%)
                    const isRoot = id === data.id;

                    return (
                        <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl z-50 text-xs min-w-max">
                            <div className="font-bold text-gray-200 mb-1">{id}</div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-green-400 font-mono">
                                    ${displayValue.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                                </span>
                                {!isRoot && (
                                    <span className="text-gray-400">
                                        ({percentage.toFixed(1)}%)
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                }}
            />
        </div>
    );
};

// Export helper functions for use in tab files
export { tailwindToCssVar, getDistributedColors };
