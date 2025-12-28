import { useMemo } from "react";
import { ResponsiveIcicle } from "@nivo/icicle";
import { 
    AnyIncome,
    CLASS_TO_CATEGORY, 
    CATEGORY_PALETTES,
    INCOME_CATEGORIES,
    getIncomeActiveMultiplier,
    isIncomeActiveInCurrentMonth
} from "./models";

// Helper to convert Tailwind class "bg-chart-Name-10" -> CSS var "var(--color-chart-Name-10)"
const tailwindToCssVar = (className: string) => {
    if (!className) return '#ccc';
    return `var(--color-${className.replace('bg-', '')})`;
};

// Your original gradient distribution logic
function getDistributedColors<T extends string>(palette: T[], count: number): T[] {
    if (count <= 1) return [palette[Math.floor(palette.length / 2)]]; // Use middle color for single item
    return Array.from({ length: count }, (_, i) => {
        const index = Math.round((i * (palette.length - 1)) / (count - 1));
        return palette[index];
    });
}

type IncomeIcicleChartProps = {
    incomeList: AnyIncome[]
}

export default function IncomeIcicleChart({ incomeList }: IncomeIcicleChartProps) {
    const hierarchicalData = useMemo(() => {
        const grouped: Record<string, AnyIncome[]> = {};

        // 1. Group incomes
        incomeList
            .filter(isIncomeActiveInCurrentMonth)
            .forEach((inc) => {
            const category = CLASS_TO_CATEGORY[inc.constructor.name] || 'Other';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(inc);
        });

        // 2. Build Children with Colors
        const categoryChildren = INCOME_CATEGORIES.map((category) => {
            const incomes = grouped[category] || [];
            if (incomes.length === 0) return null;

            // Get gradient colors for this specific group of incomes
            const palette = CATEGORY_PALETTES[category];
            const incomeColors = getDistributedColors(palette, incomes.length);
            // Pick a representative color for the Category header (approx middle of palette)
            const categoryColor = palette[50] || palette[Math.floor(palette.length/2)];

            return {
                id: category,
                color: tailwindToCssVar(categoryColor), // Parent Color
                children: incomes.map((inc, i) => ({
                    id: inc.name,
                    value: inc.getMonthlyAmount(),
                    color: tailwindToCssVar(incomeColors[i]), // Child Gradient Color
                    // Metadata
                    originalAmount: inc.amount,
                    frequency: inc.frequency
                }))
            };
        }).filter(Boolean); // Remove empty categories

        return {
            id: "Total Incomes",
            color: "#10b981", // Root node color (usually hidden or white)
            children: categoryChildren
        };
    }, [incomeList]);

    return (
        <div className="h-48 w-full bg-gray-900">
            <ResponsiveIcicle
                data={hierarchicalData}
                // Tell Nivo to use the 'color' key we added to the data objects
                colors={(node: any) => node.data.color}
                
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                valueFormat=">+$0,.0f"
                borderRadius={8}
                
                // Layout & Labels
                enableLabels={true}
                labelSkipWidth={30}
                labelTextColor={{ from: 'color', modifiers: [['darker', 2.5]] }} // Dark text for contrast
                
                // Tooltip
                tooltip={(node) => {
                    return (
                        <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl z-50 text-xs min-w-max">
                            <div className="font-bold text-gray-200 mb-1">{node.id}</div>
                            <div className="text-green-400 font-mono">
                                ${node.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                            </div>
                        </div>
                    );
                }}
            />
        </div>
    )
}
