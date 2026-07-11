import { useMemo, useState } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { type AnyAccount, SavedAccount, InvestedAccount, ESPPAccount, RSUAccount, PropertyAccount, DebtAccount } from '../Objects/Accounts/models';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { SunburstLegend } from './SunburstLegend';
import { contrastInk, sunburstItemShade } from './chartColors';

interface AssetSunburstProps {
  accounts: AnyAccount[];
  importKey: string | number;
  forceExact: boolean;
}

const getAccountCategory = (acc: AnyAccount): string => {
  if (acc instanceof SavedAccount) return 'Cash';
  if (acc instanceof InvestedAccount) return 'Invested';
  if (acc instanceof ESPPAccount) return 'Invested';
  if (acc instanceof RSUAccount) return 'Invested';
  if (acc instanceof PropertyAccount) return 'Property';
  return 'Other';
};

// Fixed categorical slots from the themeable series palette (same 1/2/4 trio as
// the tax donut): the old purple-500/blue-500/status-yellow mix read as
// near-identical purples plus an alarm color. Slot 3 (elite money gold) skipped.
const accountCategoryColors: Record<string, string> = {
  'Invested': 'var(--color-chart-series-1)',
  'Cash': 'var(--color-chart-series-2)',
  'Property': 'var(--color-chart-series-4)',
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

    // Outer ring: per-account tint ramp of the category color (largest first)
    // so adjacent accounts are distinguishable — the old uniform childColor
    // modifier rendered every account of a category the exact same shade.
    const shaded = children.map(cat => {
      const base = resolve(cat.color);
      const items = [...cat.children].sort((a, b) => b.value - a.value);
      return {
        ...cat,
        children: items.map((item, i) => ({
          ...item,
          color: sunburstItemShade(base, i, items.length),
        })),
      };
    });

    return { name: 'Assets', children: shaded };
  }, [accounts, resolve]);

  const activeAssetData = useMemo(() => {
    if (!assetDrilldown) return assetSunburstData;
    const cat = assetSunburstData.children.find(c => c.name === assetDrilldown);
    if (!cat) return assetSunburstData;
    return {
      name: cat.name,
      children: cat.children.map(item => ({
        ...item, // keeps the item's own ramp tint
        children: [] as { name: string; value: number; color?: string }[],
      })),
    };
  }, [assetSunburstData, assetDrilldown]);

  if (assetSunburstData.children.length === 0) return null;

  const activeTotal = activeAssetData.children.reduce(
    (sum, cat) => sum + (cat.children?.length
      ? cat.children.reduce((s, i) => s + i.value, 0)
      : (cat as { value?: number }).value || 0), 0
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
          <SunburstLegend
            entries={assetSunburstData.children.map(cat => ({ name: cat.name, color: cat.color }))}
            className="justify-end"
          />
        )}
      </div>
      {assetDrilldown && (
        <SunburstLegend
          entries={activeAssetData.children.map(c => ({ name: c.name, color: c.color }))}
          className="mb-1"
        />
      )}
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
          // Every datum (category AND account) carries its own color — accounts
          // get a spread tint ramp — so parent inheritance is disabled.
          inheritColorFromParent={false}
          colors={(node) => resolve((node.data as { color?: string })?.color || 'var(--c-content-subtle)')}
          enableArcLabels={true}
          arcLabelsSkipAngle={18}
          arcLabelsTextColor={(d) => contrastInk(d.color)}
          arcLabel={(node) => `${((node.value / activeTotal) * 100).toFixed(0)}%`}
          onClick={(node) => {
            if (!assetDrilldown && node.depth === 1) {
              setAssetDrilldown(String(node.id));
            }
          }}
          tooltip={({ id, value }) => (
            <div className="bg-surface-raised px-3 py-2 rounded-lg border border-border-default shadow-lg">
              <p className="text-sm font-semibold text-content-strong">{String(id)}</p>
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
