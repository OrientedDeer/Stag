import { useMemo } from "react";
import { ResponsiveIcicle } from "@nivo/icicle";
import { 
    AnyAccount, 
    PropertyAccount,
    CLASS_TO_CATEGORY, 
    CATEGORY_PALETTES,
    ACCOUNT_CATEGORIES,
    DebtAccount,
    InvestedAccount
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

const getAccountValue = (account: AnyAccount): number => {
    if (account instanceof PropertyAccount) {
        return account.amount - account.loanAmount;
    }
    if (account instanceof InvestedAccount) {
        return account.amount - account.employerBalance;
    }
    if (account instanceof DebtAccount) {
        return -account.amount;
    }
    return account.amount;
};

type AccountIcicleChartProps = {
    accountList: AnyAccount[]
}

export default function AccountIcicleChart({ accountList }: AccountIcicleChartProps) {

    const hierarchicalData = useMemo(() => {
        // Calculate real Net Worth (subtracting debts)
        const totalNetWorth = accountList.reduce((sum, acc) => sum + getAccountValue(acc), 0);

        const grouped: Record<string, AnyAccount[]> = {};

        // 1. Group accounts
        accountList.forEach((acc) => {
            const category = CLASS_TO_CATEGORY[acc.constructor.name] || 'Other';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(acc);
        });

        // 2. Build Children with Colors
        const categoryChildren = ACCOUNT_CATEGORIES.map((category) => {
            const accounts = grouped[category] || [];
            if (accounts.length === 0) return null;

            // Get gradient colors for this specific group of accounts
            const palette = CATEGORY_PALETTES[category];
            const accountColors = getDistributedColors(palette, accounts.length);
            // Pick a representative color for the Category header (approx middle of palette)
            const categoryColor = palette[50] || palette[Math.floor(palette.length/2)];

            return {
                id: category,
                color: tailwindToCssVar(categoryColor), // Parent Color
                isDebt: category === 'Debt',
                children: accounts.map((acc, i) => ({
                    id: acc.name,
                    value: Math.abs(getAccountValue(acc)),
                    color: tailwindToCssVar(accountColors[i]), // Child Gradient Color
                    // Metadata for tooltip
                    originalAmount: acc.amount,
                    isProperty: acc instanceof PropertyAccount,
                    isDebt: acc instanceof DebtAccount,
                    loanAmount: acc instanceof PropertyAccount ? acc.loanAmount : 0,
                    employerBalance: acc instanceof InvestedAccount ? acc.employerBalance : 0,
                }))
            };
        }).filter(Boolean); // Remove empty categories

        return {
            id: "Net Worth",
            color: "#10b981", // Root node color
            children: categoryChildren,
            netWorth: totalNetWorth
        };
    }, [accountList]);

    return (
        <div className="h-48 w-full bg-gray-900">
            <ResponsiveIcicle
                data={hierarchicalData}
                // Tell Nivo to use the 'color' key we added to the data objects
                colors={(node: any) => node.data.color}
                
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                valueFormat=">-$0,.0f"
                borderRadius={8}
                
                // Layout & Labels
                enableLabels={true}
                labelSkipWidth={30}
                labelTextColor={{ from: 'color', modifiers: [['darker', 2.5]] }} // Dark text for contrast
                
                // Tooltip
                tooltip={(node) => {
                    const { id, value, data } = node;
                    // node.data contains the raw object from hierarchicalData.
                    // We cast to any to access the custom props (isProperty, originalAmount) safely.
                    const customData = data as any;

                    const displayValue = customData.netWorth !== undefined ? customData.netWorth : value;

                    return (
                        <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl z-50 text-xs min-w-max">
                            <div className="font-bold text-gray-200 mb-1">{id}</div>
                            {customData.isProperty && (
                                <>
                                    <div className="text-gray-400">Value: ${customData.originalAmount?.toLocaleString()}</div>
                                    <div className="text-red-400">Loan: ${customData.loanAmount?.toLocaleString()}</div>
                                </>
                            )}
                            {customData.isDebt && (
                                <div className="text-red-400 font-mono">
                                    Debt: ${displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                            {customData.NonVestedAmount > 0 && (
                                <>
                                    <div className="text-gray-400">Overall: ${customData.originalAmount?.toLocaleString()}</div>
                                    <div className="text-red-400">Vested: ${customData.NonVestedAmount?.toLocaleString()}</div>
                                </>
                            )}
                            {!customData.isDebt && (
                                <div className="text-green-400 font-mono">
                                    Net: ${displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            )}
                        </div>
                    );
                }}
            />
        </div>
    )
}
