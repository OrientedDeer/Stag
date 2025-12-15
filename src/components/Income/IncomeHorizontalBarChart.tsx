import { useMemo } from "react";
import { AnyIncome, INCOME_CATEGORIES, IncomeCategory, CATEGORY_PALETTES, CLASS_TO_CATEGORY } from "./models";

type IncomeHorizontalBarChartProps = {
	type: string;
	incomeList: AnyIncome[];
};

const getMonthlyAmount = (income: AnyIncome) => {
    switch (income.frequency) {
        case 'Weekly': return income.amount * 52 / 12;
        case 'BiWeekly': return income.amount * 26 / 12;
        case 'Monthly': return income.amount;
        case 'Annually': return income.amount / 12;
        default: return 0;
    }
};

export default function IncomeHorizontalBarChart({
	type,
	incomeList,
}: IncomeHorizontalBarChartProps) {
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

	const { chartData, totalMonthlyIncome } = useMemo(() => {
		const grouped: Record<IncomeCategory, AnyIncome[]> =
			INCOME_CATEGORIES.reduce(
				(acc, c) => ({ ...acc, [c]: [] }),
				{} as Record<IncomeCategory, AnyIncome[]>
			);

		for (const inc of incomeList) {
			const categoryName = CLASS_TO_CATEGORY[inc.constructor.name];

			if (categoryName) {
				grouped[categoryName].push(inc);
			}
		}

        // Calculate totals based on Normalized Monthly Amount
		const categoryTotals = Object.fromEntries(
			INCOME_CATEGORIES.map((c) => [
				c,
				grouped[c].reduce((s, a) => s + getMonthlyAmount(a), 0),
			])
		) as Record<IncomeCategory, number>;

		const totalMonthlyIncome = Object.values(categoryTotals).reduce(
			(s, v) => s + v,
			0
		);

		const chartData = INCOME_CATEGORIES.flatMap((category) => {
			const incomes = grouped[category];
			const colors = getDistributedColors(
				CATEGORY_PALETTES[category],
				incomes.length
			);

			return incomes.map((inc, i) => {
                const monthlyVal = getMonthlyAmount(inc);
                return {
                    category,
                    name: inc.name,
                    monthlyAmount: monthlyVal,
                    percent: totalMonthlyIncome === 0 ? 0 : (monthlyVal / totalMonthlyIncome) * 100,
                    color: colors[i],
                    originalAmount: inc.amount,
                    frequency: inc.frequency
                };
			});
		});

		return { chartData, totalMonthlyIncome };
	}, [incomeList]);

	return (
		<div className="mb-2">
			<div className="flex justify-center text-white">
				{type} (Monthly) $
				{totalMonthlyIncome.toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})}
			</div>
			<div className="w-full h-3 flex rounded-lg overflow-hidden mt-1">
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