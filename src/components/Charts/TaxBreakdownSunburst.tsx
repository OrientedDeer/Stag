import { useMemo } from 'react';
import { ResponsiveSunburst } from '@nivo/sunburst';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { SunburstLegend } from './SunburstLegend';
import { contrastInk } from './chartColors';

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
  const { resolve } = useChartTheme();
  const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;

  const data = useMemo(() => {
    // Categorical identity, not status: red/yellow status colors made Federal
    // read as an alarm. Series slots 1/2/4 stay distinct in both themes (slot 3
    // is the elite theme's money gold, so it's skipped).
    const children: { name: string; value: number; color: string }[] = [];
    if (annualFedTax > 0) children.push({ name: 'Federal', value: annualFedTax, color: 'var(--color-chart-series-1)' });
    if (annualStateTax > 0) children.push({ name: 'State', value: annualStateTax, color: 'var(--color-chart-series-2)' });
    if (annualFicaTax > 0) children.push({ name: 'FICA', value: annualFicaTax, color: 'var(--color-chart-series-4)' });
    return { name: 'Taxes', children };
  }, [annualFedTax, annualStateTax, annualFicaTax]);

  if (totalTaxes <= 0) return null;

  return (
    <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-content-emphasis">Tax Breakdown</h2>
        <SunburstLegend entries={data.children} className="justify-end" />
      </div>
      <div className="h-40 relative">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-sm font-bold text-content-emphasis">{formatCompactCurrency(totalTaxes, { forceExact })}</span>
        </div>
        <ChartFrame><ResponsiveSunburst
          key={`tax-sunburst-${importKey}`}
          data={data}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          id="name"
          value="value"
          cornerRadius={3}
          borderWidth={1}
          borderColor={{ theme: 'background' }}
          colors={(node) => resolve((node.data as { color?: string })?.color || 'var(--c-content-subtle)')}
          enableArcLabels={true}
          arcLabelsSkipAngle={18}
          arcLabelsTextColor={(d) => contrastInk(d.color)}
          arcLabel={(node) => `${((node.value / totalTaxes) * 100).toFixed(0)}%`}
          tooltip={({ id, value }) => (
            <div className="bg-surface-raised px-3 py-2 rounded-lg border border-border-default shadow-lg">
              <p className="text-sm font-semibold text-content-strong">{String(id)}</p>
              <p className="text-sm text-content-default">{formatCompactCurrency(value, { forceExact })}/yr</p>
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
