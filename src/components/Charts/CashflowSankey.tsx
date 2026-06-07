import { memo, useMemo, useContext, useCallback, useState, useEffect, useRef } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { AnyIncome } from '../Objects/Income/models';
import { AnyExpense } from '../Objects/Expense/models';
import { AnyAccount } from '../Objects/Accounts/models';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { CashflowDetail } from '../../services/simulation/types';
import { SankeyErrorBoundary } from './SankeyErrorBoundary';
import { useChartTheme } from './useChartTheme';
import {
    buildCashflowSankeyData,
    SankeyImbalance,
    SankeyRothConversion,
    SankeyTaxBreakdown,
} from './cashflowSankeyData';

export type { SankeyImbalance } from './cashflowSankeyData';

interface CashflowSankeyProps {
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    year: number;
    taxes: SankeyTaxBreakdown;
    bucketAllocations?: Record<string, number>;
    accounts?: AnyAccount[];
    withdrawals?: Record<string, number>;
    rothConversion?: SankeyRothConversion;
    /**
     * Living expenses for the current year, used by the Dashboard's
     * pre-simulation chart. Sim-driven consumers should pass `cashflowDetail`
     * (and the sim's per-source classification) rather than re-deriving from
     * raw incomes/expenses (which can drift from sim values).
     */
    livingExpenses?: number;
    /**
     * Per-source breakdown of cashflow components from the simulation engine.
     * Sim-driven consumers should always pass this rather than relying on raw
     * incomes/expenses, which can drift from sim values.
     */
    cashflowDetail?: CashflowDetail;
    height?: number;
    extraLeftPadding?: number;
    extraRightPadding?: number;
    onBalanceCheck?: (imbalances: SankeyImbalance[]) => void;
}

const CashflowSankeyInner = ({
    incomes,
    expenses,
    year,
    taxes,
    bucketAllocations = {},
    accounts = [],
    withdrawals = {},
    rothConversion,
    livingExpenses,
    cashflowDetail,
    height = 300,
    extraLeftPadding = 0,
    extraRightPadding = 0,
    onBalanceCheck
}: CashflowSankeyProps) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { theme: themeKey, resolve } = useChartTheme();
    const forceExact = assumptions.display?.useCompactCurrency === false;

    const currencyFormatter = useCallback((value: number) => {
        // For very small values that would round to $0, show a more informative label
        if (value > 0.005 && value < 0.5) {
            return '<$1';
        }
        return formatCompactCurrency(value, { forceExact });
    }, [forceExact]);

    const { data, error, debugData, imbalances } = useMemo(
        () => buildCashflowSankeyData({
            incomes,
            expenses,
            year,
            taxes,
            bucketAllocations,
            accounts,
            withdrawals,
            rothConversion,
            cashflowDetail,
            livingExpenses,
        }),
        [incomes, expenses, year, taxes, bucketAllocations, accounts, withdrawals, rothConversion, cashflowDetail, livingExpenses],
    );

    useEffect(() => {
        if (onBalanceCheck) {
            onBalanceCheck(imbalances);
        }
    }, [imbalances, onBalanceCheck]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                setContainerWidth(containerRef.current.offsetWidth);
            }
        };
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, []);

    if (error) {
        return (
            <div style={{ height: `${height}px` }} className="flex items-center justify-center bg-negative-tint/10 border border-negative-strong rounded-lg">
                <div className="text-center p-6 max-w-lg">
                    <div className="text-negative text-lg font-bold mb-2">Chart Error</div>
                    <div className="text-content-default text-sm mb-4">{error}</div>
                    {debugData && (
                        <details className="text-left">
                            <summary className="cursor-pointer text-content-muted text-xs hover:text-content-emphasis">Debug Info</summary>
                            <pre className="mt-2 text-xs text-content-muted overflow-auto max-h-48 bg-surface-raised p-2 rounded">
                                {JSON.stringify(debugData, null, 2)}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
        );
    }

    if (!data.nodes || data.nodes.length === 0) {
        return (
            <div style={{ height: `${height}px` }} className="flex items-center justify-center text-content-muted">
                No data available for chart
            </div>
        );
    }

    const isNarrow = containerWidth < 500;
    const margins = isNarrow
        ? { top: 10, right: 80 + extraRightPadding, bottom: 10, left: 80 + extraLeftPadding }
        : { top: 20, right: 150 + extraRightPadding, bottom: 20, left: 150 + extraLeftPadding };

    // Reset key forces the error boundary to retry when data changes
    const resetKey = `${incomes.length}-${expenses.length}-${year}-${Object.keys(withdrawals).length}`;

    return (
        <SankeyErrorBoundary height={height} resetKey={resetKey}>
            <div ref={containerRef} style={{ height: `${height}px` }}>
                <ResponsiveSankey
                    key={themeKey}
                    data={data}
                    margin={margins}
                    align="justify"
                    colors={(node: any) => resolve(node.color)}
                    nodeOpacity={1}
                    nodeThickness={isNarrow ? 12 : 15}
                    nodeSpacing={isNarrow ? 8 : 12}
                    nodeBorderRadius={3}
                    enableLinkGradient={true}
                    linkBlendMode="normal"
                    linkOpacity={0.15}
                    labelTextColor="var(--c-content-emphasis)"
                    valueFormat={currencyFormatter}
                    label={(node: any) => node.label}
                    labelPosition="outside"
                    labelPadding={isNarrow ? 8 : 16}
                    sort="input"
                    nodeTooltip={({ node }) => (
                        <div className="bg-surface-raised p-3 rounded-lg border border-border-default shadow-2xl max-w-87.5">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
                                <span className="font-bold text-content-bright text-sm truncate">{node.label}</span>
                            </div>
                            <div className="text-2xl font-mono text-positive font-medium">
                                {node.formattedValue}
                            </div>
                        </div>
                    )}
                    linkTooltip={({ link }) => (
                        <div className="bg-surface-raised p-3 rounded-lg border border-border-default shadow-2xl max-w-87.5">
                            <div className="flex items-center gap-2 mb-2 text-xs text-content-muted uppercase tracking-wider font-semibold">
                                <span className="truncate">{link.source.label}</span>
                                <span className="text-content-muted shrink-0">&rarr;</span>
                                <span className="truncate">{link.target.label}</span>
                            </div>
                            <div className="text-xl font-mono text-positive font-medium">
                                {link.formattedValue}
                            </div>
                        </div>
                    )}
                    theme={{
                        tooltip: { container: { background: 'var(--c-surface-raised)', color: '#fff', borderRadius: '8px', zIndex: 9999 } },
                        labels: { text: { fontSize: 11, fontWeight: 600, fill: 'var(--c-content-emphasis)' } }
                    }}
                />
            </div>
        </SankeyErrorBoundary>
    );
};

// Memoize: during a CashflowTab drag, the selectedYear (and therefore the
// year-derived props passed here) don't change, so the entire Sankey subtree
// can bail out via shallow-equal prop check. Without this, every drag tick
// would re-walk ~100+ fibers inside the Nivo Sankey tree.
export const CashflowSankey = memo(CashflowSankeyInner);
