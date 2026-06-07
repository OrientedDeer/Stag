import { useMemo, useState } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { AnyAccount, SavedAccount, InvestedAccount, ESPPAccount, PropertyAccount, DebtAccount } from '../Objects/Accounts/models';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";

interface AssetSunburstProps {
  accounts: AnyAccount[];
  importKey: string | number;
  forceExact: boolean;
}

const getAccountCategory = (acc: AnyAccount): string => {
  if (acc instanceof SavedAccount) return 'Cash';
  if (acc instanceof InvestedAccount) return 'Invested';
  if (acc instanceof ESPPAccount) return 'Invested';
  if (acc instanceof PropertyAccount) return 'Property';
  return 'Other';
};

const accountCategoryColors: Record<string, string> = {
  'Cash': 'var(--c-cat-purple-soft)',
  'Invested': 'var(--c-accent-soft)',
  'Property': 'var(--c-warning-soft)',
  'Other': 'var(--c-content-subtle)',
};

export const AssetSunburst = ({ accounts, importKey, forceExact }: AssetSunburstProps) => {
  const { resolve } = useChartTheme();
  const [assetDrilldown, setAssetDrilldown] = useState<string | null>(null);

  const assetSunburstData = useMemo(() => {
    const categoryMap = new Map<string, { name: string; value: number }[]>();
    accounts.forEach(acc => {
      if (acc instanceof DebtAccount) return;
      const cat = getAccountCategory(acc);
      const value = acc.amount;
      if (value <= 0) return;
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);

      if (acc instanceof InvestedAccount && acc.nonVestedAmount > 0) {
        const vested = acc.amount - acc.nonVestedAmount;
        if (vested > 0) categoryMap.get(cat)!.push({ name: `${acc.name} (Vested)`, value: vested });
        categoryMap.get(cat)!.push({ name: `${acc.name} (Unvested)`, value: acc.nonVestedAmount });
      } else {
        categoryMap.get(cat)!.push({ name: acc.name, value });
      }
    });

    const children = Array.from(categoryMap.entries())
      .map(([category, items]) => ({
        name: category,
        color: accountCategoryColors[category] || 'var(--c-content-subtle)',
        children: items,
      }))
      .filter(c => c.children.length > 0)
      .sort((a, b) => {
        const sumA = a.children.reduce((s, i) => s + i.value, 0);
        const sumB = b.children.reduce((s, i) => s + i.value, 0);
        return sumB - sumA;
      });

    return { name: 'Assets', children };
  }, [accounts]);

  const activeAssetData = useMemo(() => {
    if (!assetDrilldown) return assetSunburstData;
    const cat = assetSunburstData.children.find(c => c.name === assetDrilldown);
    if (!cat) return assetSunburstData;
    return {
      name: cat.name,
      children: cat.children.map(item => ({
        ...item,
        color: cat.color,
        children: [] as { name: string; value: number }[],
      })),
    };
  }, [assetSunburstData, assetDrilldown]);

  if (assetSunburstData.children.length === 0) return null;

  const activeTotal = activeAssetData.children.reduce(
    (sum, cat) => sum + (cat.children?.length
      ? cat.children.reduce((s, i) => s + i.value, 0)
      : (cat as any).value || 0), 0
  );

  return (
    <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-content-emphasis">
          {assetDrilldown ? (
            <>
              <button onClick={() => setAssetDrilldown(null)} className="text-content-subtle hover:text-content-default transition-colors">Assets</button>
              <span className="text-content-faint mx-1">/</span>
              {assetDrilldown}
            </>
          ) : 'Asset Breakdown'}
        </h2>
        {!assetDrilldown && (
          <div className="flex flex-wrap gap-2 justify-end">
            {assetSunburstData.children.map(cat => (
              <div key={cat.name} className="flex items-center gap-1 text-xs text-content-muted">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: (cat as any).color || 'var(--c-content-subtle)' }}
                />
                {cat.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="h-64 relative">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-sm font-bold text-content-emphasis">
            {formatCompactCurrency(activeTotal, { forceExact })}
          </span>
        </div>
        <ChartFrame><ResponsiveSunburst
          key={`asset-sunburst-${importKey}`}
          data={activeAssetData}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          id="name"
          value="value"
          cornerRadius={3}
          borderWidth={1}
          borderColor={{ theme: 'background' }}
          colors={(node) => {
            let current = node;
            while (current.depth > 1 && current.parent) {
              current = current.parent;
            }
            const catColor = (current.data as any)?.color;
            // resolve var()->concrete color (childColor modifier + d3 need it)
            return resolve(catColor || 'var(--c-content-subtle)');
          }}
          childColor={{ from: 'color', modifiers: [['brighter', 0.3]] }}
          enableArcLabels={true}
          arcLabelsSkipAngle={15}
          arcLabelsTextColor="#fff"
          arcLabel={(node) => `${((node.value / activeTotal) * 100).toFixed(0)}%`}
          onClick={(node) => {
            if (!assetDrilldown && node.depth === 1) {
              setAssetDrilldown(String(node.id));
            }
          }}
          tooltip={({ id, value }) => (
            <div className="bg-surface-raised px-3 py-2 rounded-lg border border-border-default shadow-lg">
              <p className="text-sm font-semibold text-white">{String(id)}</p>
              <p className="text-sm text-content-default">{formatCompactCurrency(value, { forceExact })}</p>
            </div>
          )}
          theme={{
            labels: { text: { fontSize: 10, fontWeight: 600 } },
          }}
        /></ChartFrame>
      </div>
    </div>
  );
};
