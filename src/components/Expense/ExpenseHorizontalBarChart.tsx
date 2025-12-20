import { useMemo } from "react";
import { 
    AnyExpense, 
    EXPENSE_CATEGORIES, 
    ExpenseCategory, 
    CATEGORY_PALETTES, 
    CLASS_TO_CATEGORY,
    LoanExpense // 1. Import LoanExpense
} from "./models";

type ExpenseHorizontalBarChartProps = {
	type: string;
	expenseList: AnyExpense[];
};

const getMonthlyAmount = (Expense: AnyExpense) => {
    // 2. Determine the basis for the calculation
    // For Loans, 'amount' is the Balance, so we use 'payment' for the cash flow.
    // For all others, 'amount' is the periodic cost.
    let periodicCost = Expense.amount;

    if (Expense instanceof LoanExpense) {
        periodicCost = Expense.payment;
    }

    // 3. Normalize based on frequency
    switch (Expense.frequency) {
        case 'Weekly': return periodicCost * 52 / 12;
        case 'Monthly': return periodicCost;
        case 'Annually': return periodicCost / 12;
        // Handle 'Daily' or 'BiWeekly' if they exist in your types, otherwise default
        case 'Daily': return periodicCost * 30.4167; // Approx days in month
        default: return 0;
    }
};

export default function ExpenseHorizontalBarChart({
	type,
	expenseList,
}: ExpenseHorizontalBarChartProps) {
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

	const { chartData, totalMonthlyExpense } = useMemo(() => {
		const grouped: Record<ExpenseCategory, AnyExpense[]> =
			EXPENSE_CATEGORIES.reduce(
				(acc, c) => ({ ...acc, [c]: [] }),
				{} as Record<ExpenseCategory, AnyExpense[]>
			);

		for (const inc of expenseList) {
			const categoryName = CLASS_TO_CATEGORY[inc.constructor.name];

			if (categoryName) {
				grouped[categoryName].push(inc);
			}
		}

		const categoryTotals = Object.fromEntries(
			EXPENSE_CATEGORIES.map((c) => [
				c,
				grouped[c].reduce((s, a) => s + getMonthlyAmount(a), 0),
			])
		) as Record<ExpenseCategory, number>;

		const totalMonthlyExpense = Object.values(categoryTotals).reduce(
			(s, v) => s + v,
			0
		);

		const chartData = EXPENSE_CATEGORIES.flatMap((category) => {
			const Expenses = grouped[category];
			const colors = getDistributedColors(
				CATEGORY_PALETTES[category],
				Expenses.length
			);

			return Expenses.map((inc, i) => {
                const monthlyVal = getMonthlyAmount(inc);
                
                // For tooltip display: Use payment for loans, amount for others
                const displayOriginalAmount = inc instanceof LoanExpense ? inc.payment : inc.amount;

                return {
                    category,
                    name: inc.name,
                    monthlyAmount: monthlyVal,
                    percent: totalMonthlyExpense === 0 ? 0 : (monthlyVal / totalMonthlyExpense) * 100,
                    color: colors[i],
                    originalAmount: displayOriginalAmount, // Updated for tooltip
                    frequency: inc.frequency
                };
			});
		});

		return { chartData, totalMonthlyExpense };
	}, [expenseList]);

	return (
		<div className="mb-1">
			<div className="flex justify-center text-white text-xs">
				{type} (Monthly) $
				{totalMonthlyExpense.toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})}
			</div>
			<div className="w-full h-2 flex rounded-lg overflow-hidden mt-1">
				{chartData.map((seg) => (
					<div
						key={`${seg.category}-${seg.name}`}
						className={`${seg.color} transition-all duration-700 ease-out border-l border-gray-950`}
						style={{ width: `${seg.percent}%` }}
						title={`${seg.category} - ${seg.name}: $${seg.originalAmount.toLocaleString()} (${seg.frequency}) -> ~$${seg.monthlyAmount.toLocaleString(undefined, {maximumFractionDigits: 0})}/mo`}
					/>
				))}
			</div>
		</div>
	);
}