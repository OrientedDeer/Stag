import { Account, ACCOUNT_CATEGORIES, CATEGORY_PALETTES} from '../types';
import { useMemo} from 'react';

type HorizontalBarChartProps = {
  type: string,
  accountList: Account[];
};

export default function HorizontalBarChart({type, accountList}: HorizontalBarChartProps ) {
    //const {getCatTotal} = useAccounts();


	// const { categoryTotals, totalAssetsMagnitude } = useMemo(() => {
	// 	const totals = ACCOUNT_CATEGORIES.reduce((acc, category) => {
	// 	acc[category] = accountList
	// 		.filter(a => a.category === category)
	// 		.reduce((sum, a) => sum + a.balance, 0);
	// 	return acc;
	// 	}, {} as Record<Account['category'], number>);
		
	// 	const assetsMagnitude = ACCOUNT_CATEGORIES.reduce((sum, category) => sum + Math.abs(totals[category]), 0);

	// 	const absoluteTotals = Object.values(totals).map(Math.abs);
	// 	const max = Math.max(...absoluteTotals, 1); 

	// 	return { 
	// 		categoryTotals: totals,
	// 		maxBalance: max,
	// 		totalAssetsMagnitude: assetsMagnitude
	// 	};
	// }, [accountList]);

	function getDistributedColors<T extends string>(palette: T[], count: number): T[] {
		if (count <= 1) return [palette[0]];

		return Array.from({ length: count }, (_, i) => {
			const index = Math.round(i * (palette.length - 1) / (count - 1));
			return palette[index];
		});
	}

	const { chartData, totalAssets } = useMemo(() => {
		const grouped: Record<Account['category'], Account[]> = ACCOUNT_CATEGORIES
			.reduce((acc, c) => ({ ...acc, [c]: [] }), {} as Record<Account['category'], Account[]>);

		for (const acc of accountList) grouped[acc.category].push(acc);

		// category totals
		const categoryTotals = Object.fromEntries(
			ACCOUNT_CATEGORIES.map(c => [
				c,
				grouped[c].reduce((s, a) => s + a.balance, 0)
			])
		) as Record<Account['category'], number>;

		const totalAssets = Object.values(categoryTotals).reduce((s, v) => s + v, 0);

		const chartData = ACCOUNT_CATEGORIES.flatMap(category => {
			const accounts = grouped[category];
			const colors = getDistributedColors(CATEGORY_PALETTES[category], accounts.length);

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
			<div className='flex justify-center'>
				{type} ${totalAssets.toLocaleString()}
			</div>
			<div className="w-full h-3 flex rounded-lg overflow-hidden">
				{chartData.map(seg => (
					<div
						key={seg.account}
						className={`${seg.color} transition-all duration-700 ease-out border-l border-gray-950`}
						style={{ width: `${seg.percent}%` }}
						title={`${seg.category} - ${seg.account}: ${seg.balance.toLocaleString()}`}
					/>
				))}
			</div>
			{/* <div className="mt-2 flex flex-wrap gap-x-4 gap-y-3 text-sm justify-center">

				{Object.entries(
					chartData.reduce((acc, seg) => {
						if (!acc[seg.category]) acc[seg.category] = [];
						acc[seg.category].push(seg);
						return acc;
					}, {} as Record<string, typeof chartData>)
				).map(([category, items]) => (
					<div key={category} className="flex flex-col items-start min-w-[140px]">
						<span className="font-medium underline mb-1">{category}</span>

						{items.map(item => (
							<div key={item.account} className="flex items-center gap-2">
								<span
									className="w-3 h-3 rounded-full"
									style={{ backgroundColor: item.color }} // ← hex color
								/>
								<span>{item.account} (${item.balance.toLocaleString()})</span>
							</div>
						))}
					</div>
				))}
			</div> */}
		</div>
	);
}
