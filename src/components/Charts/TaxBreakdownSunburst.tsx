import { useMemo } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { useChartTheme } from './useChartTheme';

interface TaxBreakdownSunburstProps {
  annualFedTax: number;
  annualStateTax: number;
  annualFicaTax: number;
  importKey: string | number;
  forceExact: boolean;
}

export const TaxBreakdownSunburst = ({
  annualFedTax,
  annualStateTax,
  annualFicaTax,
  importKey,
  forceExact,
}: TaxBreakdownSunburstProps) => {
  const { theme: themeKey, resolve } = useChartTheme();
  const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;

  const data = useMemo(() => {
    const children: { name: string; value: number; color: string }[] = [];
    if (annualFedTax > 0) children.push({ name: 'Federal', value: annualFedTax, color: 'var(--c-negative-soft)' });
    if (annualStateTax > 0) children.push({ name: 'State', value: annualStateTax, color: 'var(--c-warning-soft)' });
    if (annualFicaTax > 0) children.push({ name: 'FICA', value: annualFicaTax, color: 'var(--c-cat-orange-soft)' });
    return { name: 'Taxes', children };
  }, [annualFedTax, annualStateTax, annualFicaTax]);

  if (totalTaxes <= 0) return null;

  return (
    <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-content-emphasis">Tax Breakdown</h2>
        <div className="flex flex-wrap gap-2 justify-end">
          {data.children.map(t => (
            <div key={t.name} className="flex items-center gap-1 text-xs text-content-muted">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              {t.name}
            </div>
          ))}
        </div>
      </div>
      <div className="h-40 relative">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-sm font-bold text-content-emphasis">{formatCompactCurrency(totalTaxes, { forceExact })}</span>
        </div>
        <ResponsiveSunburst
          key={`tax-sunburst-${importKey}-${themeKey}`}
          data={data}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          id="name"
          value="value"
          cornerRadius={3}
          borderWidth={1}
          borderColor={{ theme: 'background' }}
          colors={(node) => resolve((node.data as any)?.color || 'var(--c-content-subtle)')}
          enableArcLabels={true}
          arcLabelsSkipAngle={15}
          arcLabelsTextColor="#fff"
          arcLabel={(node) => `${((node.value / totalTaxes) * 100).toFixed(0)}%`}
          tooltip={({ id, value }) => (
            <div className="bg-surface-raised px-3 py-2 rounded-lg border border-border-default shadow-lg">
              <p className="text-sm font-semibold text-white">{String(id)}</p>
              <p className="text-sm text-content-default">{formatCompactCurrency(value, { forceExact })}/yr</p>
            </div>
          )}
          theme={{
            labels: { text: { fontSize: 10, fontWeight: 600 } },
          }}
        />
      </div>
    </div>
  );
};
