// src/components/Accounts/HorizontalBarChart.tsx

import { useMemo } from "react";
import { 
    AnyAccount, 
    ACCOUNT_CATEGORIES, 
    AccountCategory, 
    CATEGORY_PALETTES, 
    CLASS_TO_CATEGORY, 
    PropertyAccount, 
    DebtAccount,
} from "./models";

type HorizontalBarChartProps = {
	type: string;
	accountList: AnyAccount[];
};

export default function HorizontalBarChart({
	type,
	accountList,
}: HorizontalBarChartProps) {
	function getDistributedColors<T extends string>(
		palette: T[],
		count: number
	): T[] {
		if (count <= 1) return [palette[0]];

		return Array.from({ length: count }, (_, i) => {
			const index = Math.round((i * (palette.length - 1)) / (count - 1));
			return palette[index];
		});
	}

	const { chartData, displayTotal } = useMemo(() => {
        // --- 1. Calculate Actual Net Worth (The number to display) ---
        let netWorth = 0;
        for (const acc of accountList) {
            if (acc instanceof PropertyAccount) {
                // For Property: Add Asset Value, Subtract Loan
                netWorth += (acc.amount - acc.loanAmount);
            } else if (acc instanceof DebtAccount) {
                // For Debt: Subtract Amount
                netWorth -= acc.amount;
            } else {
                // For Savings/Investments: Add Amount
                netWorth += acc.amount;
            }
        }

        // --- 2. Calculate Chart Data (The visual bars) ---
		const grouped: Record<AccountCategory, AnyAccount[]> =
			ACCOUNT_CATEGORIES.reduce(
				(acc, c) => ({ ...acc, [c]: [] }),
				{} as Record<AccountCategory, AnyAccount[]>
			);

		for (const acc of accountList) {
			const categoryName = CLASS_TO_CATEGORY[acc.constructor.name];

			if (categoryName) {
				if (acc instanceof PropertyAccount && acc.loanAmount > 0) {
                    // Split Property into Equity and Debt for visualization
					const equityEntry = {
						...acc,
                        id: `${acc.id}-equity`,
						name: acc.name,
						amount: acc.amount - acc.loanAmount, 
					} as unknown as AnyAccount;
					
					grouped[categoryName].push(equityEntry);

					const loanEntry = {
						id: `${acc.id}-loan`,
						name: `${acc.name} (Loan)`,
						amount: acc.loanAmount,
					} as unknown as AnyAccount;

					grouped['Debt'].push(loanEntry);

				} else {
					grouped[categoryName].push(acc);
				}
			}
		}

		const categoryTotals = Object.fromEntries(
			ACCOUNT_CATEGORIES.map((c) => [
				c,
				grouped[c].reduce((s, a) => s + a.amount, 0),
			])
		) as Record<AccountCategory, number>;

        // This 'visualTotal' is the sum of all bars (Assets + Liabilities). 
        // We use this for the width % so the bars stack nicely to 100% of the container.
		const visualTotal = Object.values(categoryTotals).reduce(
			(s, v) => s + v,
			0
		);

		const chartData = ACCOUNT_CATEGORIES.flatMap((category) => {
			const accounts = grouped[category];
			const colors = getDistributedColors(
				CATEGORY_PALETTES[category],
				accounts.length
			);

			return accounts.map((acc, i) => ({
				category,
				account: acc.name,
				amount: acc.amount,
                // Use visualTotal for the percent calculation
				percent: visualTotal === 0 ? 0 : (acc.amount / visualTotal) * 100,
				color: colors[i],
			}));
		});

        // Return chartData and the netWorth (as displayTotal)
		return { chartData, displayTotal: netWorth };
	}, [accountList]);

	return (
		<div className="mb-1">
			<div className="flex justify-center text-white text-xs">
				{type} $
                {/* Display the Net Worth, not the Visual Total */}
				{displayTotal.toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})}
			</div>
			<div className="w-full h-2 flex rounded-lg overflow-hidden mt-1">
				{chartData.map((seg) => (
					<div
						key={`${seg.category}-${seg.account}`}
						className={`${seg.color} transition-all duration-700 ease-out border-l border-gray-950`}
						style={{ width: `${seg.percent}%` }}
						title={`${seg.category} - ${
							seg.account
						}: ${seg.amount.toLocaleString()}`}
					/>
				))}
			</div>
		</div>
	);
}