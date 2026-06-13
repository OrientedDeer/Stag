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
import { ChartFrame } from "./ChartFrame";
import {
    buildCashflowSankeyData,
    SankeyImbalance,
    SankeyRothConversion,
    SankeyTaxBreakdown,
    SankeyProvenanceItem,
} from './cashflowSankeyData';

export type { SankeyImbalance } from './cashflowSankeyData';

/** A node selected for the provenance drill-down panel. */
interface SelectedSankeyNode {
    id: string;
    label: string;
    value: number;
}

/**
 * The shape Nivo hands to the Sankey `onClick`. It fires for both nodes and
 * links; links carry `source`/`target`, which lets us filter to node clicks.
 */
interface SankeyClickTarget {
    id?: string;
    label?: string;
    value?: number;
    source?: unknown;
    target?: unknown;
}

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
    const { resolve } = useChartTheme();
    const forceExact = assumptions.display?.useCompactCurrency === false;

    const currencyFormatter = useCallback((value: number) => {
        // For very small values that would round to $0, show a more informative label
        if (value > 0.005 && value < 0.5) {
            return '<$1';
        }
        return formatCompactCurrency(value, { forceExact });
    }, [forceExact]);

    const { data, error, debugData, imbalances, provenance } = useMemo(
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

    // Node clicked for the provenance drill-down panel. A stale selection (one
    // whose node no longer exists after the data changed, e.g. a different year)
    // is dropped during render via `selectedProvenance` below rather than reset
    // in an effect — that also covers callers that pass inline default props
    // (e.g. {}) and mint a fresh `data` object every render.
    const [selectedNode, setSelectedNode] = useState<SelectedSankeyNode | null>(null);

    const handleNodeClick = useCallback((target: SankeyClickTarget) => {
        // Nivo's onClick fires for both nodes and links; links carry source/target.
        // Ignore link clicks — provenance is a node-level concept.
        if (!target || target.source || target.target || typeof target.id !== 'string') return;
        // Only composite nodes have a breakdown; ignore clicks on leaf nodes.
        if (!provenance[target.id]) {
            setSelectedNode(null);
            return;
        }
        const id = target.id;
        setSelectedNode(prev =>
            prev?.id === id
                ? null
                : { id, label: target.label ?? id, value: target.value ?? 0 },
        );
    }, [provenance]);

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

    // Drop a stale selection whose node no longer exists in the current data.
    const selectedProvenance = selectedNode ? provenance[selectedNode.id] : undefined;

    return (
        <SankeyErrorBoundary height={height} resetKey={resetKey}>
            <div ref={containerRef} style={{ height: `${height}px` }}>
                <ChartFrame><ResponsiveSankey
                    data={data}
                    margin={margins}
                    align="justify"
                    onClick={(node: SankeyClickTarget) => handleNodeClick(node)}
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
                /></ChartFrame>
            </div>
            {selectedNode && selectedProvenance && (
                <SankeyDetailPanel
                    label={selectedNode.label}
                    total={selectedNode.value}
                    items={selectedProvenance}
                    formatValue={currencyFormatter}
                    onClose={() => setSelectedNode(null)}
                />
            )}
        </SankeyErrorBoundary>
    );
};

interface SankeyDetailPanelProps {
    label: string;
    total: number;
    items: SankeyProvenanceItem[];
    formatValue: (value: number) => string;
    onClose: () => void;
}

/**
 * Drill-down panel rendered below the Sankey when a composite node is clicked.
 * Lists the constituent source objects with their amount and share of the node.
 */
const SankeyDetailPanel = ({ label, total, items, formatValue, onClose }: SankeyDetailPanelProps) => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const sum = sorted.reduce((s, i) => s + i.value, 0);
    // Prefer the node's own value for shares; fall back to the item sum if the
    // node value is unavailable (e.g. a consumer that doesn't supply it).
    const denominator = total > 0 ? total : sum;

    return (
        <div className="mt-3 bg-surface-raised border border-border-default rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <div className="text-sm font-bold text-content-bright">{label}</div>
                    <div className="text-lg font-mono text-positive font-medium">{formatValue(total > 0 ? total : sum)}</div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close detail panel"
                    className="text-content-muted hover:text-content-emphasis text-lg leading-none px-1"
                >
                    &times;
                </button>
            </div>
            <ul className="space-y-1.5">
                {/* key includes idx on purpose: provenance labels derive from
                    user-named objects (income/bucket names) and can repeat, so
                    label alone can collide. These rows are stateless text, so the
                    reorder churn from an index key is harmless. */}
                {sorted.map((item, idx) => {
                    const share = denominator > 0 ? (item.value / denominator) * 100 : 0;
                    return (
                        <li key={`${item.label}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-content-default truncate">{item.label}</span>
                            <span className="flex items-baseline gap-2 shrink-0">
                                <span className="font-mono text-content-emphasis">{formatValue(item.value)}</span>
                                <span className="text-xs text-content-muted w-10 text-right">{share.toFixed(0)}%</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

// Memoize: during a CashflowTab drag, the selectedYear (and therefore the
// year-derived props passed here) don't change, so the entire Sankey subtree
// can bail out via shallow-equal prop check. Without this, every drag tick
// would re-walk ~100+ fibers inside the Nivo Sankey tree.
export const CashflowSankey = memo(CashflowSankeyInner);
