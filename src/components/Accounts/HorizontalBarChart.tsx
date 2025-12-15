import { useMemo } from "react";
import { AnyAccount, ACCOUNT_CATEGORIES, AccountCategory, CATEGORY_PALETTES, CLASS_TO_CATEGORY } from "./models";

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

	const { chartData, totalAssets } = useMemo(() => {
		const grouped: Record<AccountCategory, AnyAccount[]> =
			ACCOUNT_CATEGORIES.reduce(
				(acc, c) => ({ ...acc, [c]: [] }),
				{} as Record<AccountCategory, AnyAccount[]>
			);

		for (const acc of accountList) {
			const categoryName = CLASS_TO_CATEGORY[acc.constructor.name];

			if (categoryName) {
				grouped[categoryName].push(acc);
			}
		}

		const categoryTotals = Object.fromEntries(
			ACCOUNT_CATEGORIES.map((c) => [
				c,
				grouped[c].reduce((s, a) => s + a.balance, 0),
			])
		) as Record<AccountCategory, number>;

		const totalAssets = Object.values(categoryTotals).reduce(
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
				balance: acc.balance,
				percent: totalAssets === 0 ? 0 : (acc.balance / totalAssets) * 100,
				color: colors[i],
			}));
		});

		return { chartData, totalAssets };
	}, [accountList]);

	return (
		<div className="mb-2">
			<div className="flex justify-center text-white">
				{type} $
				{totalAssets.toLocaleString(undefined, {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})}
			</div>
			<div className="w-full h-3 flex rounded-lg overflow-hidden mt-1">
				{chartData.map((seg) => (
					<div
						key={`${seg.category}-${seg.account}`}
						className={`${seg.color} transition-all duration-700 ease-out border-l border-gray-950`}
						style={{ width: `${seg.percent}%` }}
						title={`${seg.category} - ${
							seg.account
						}: ${seg.balance.toLocaleString()}`}
					/>
				))}
			</div>
		</div>
	);
}
