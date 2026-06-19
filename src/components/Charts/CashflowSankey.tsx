import { memo, useMemo, useContext, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
    SankeyProvenanceDirection,
} from './cashflowSankeyData';

export type { SankeyImbalance } from './cashflowSankeyData';

/** Human-readable header for each provenance direction. */
const DIRECTION_LABEL: Record<SankeyProvenanceDirection, string> = {
    sources: 'Sources',
    destinations: 'Destinations',
    breakdown: 'Breakdown',
};

/** One-line hint under the header clarifying what the rows mean. */
const DIRECTION_HINT: Record<SankeyProvenanceDirection, string> = {
    sources: 'What flows in',
    destinations: 'Where it flows',
    breakdown: 'Sub-split of this node',
};

/** A node selected for the provenance drill-down panel. */
interface SelectedSankeyNode {
    id: string;
    label: string;
    value: number;
    /** Click position in viewport (client) coordinates; the popover anchors here. */
    anchorX: number;
    anchorY: number;
}

/**
 * The shape Nivo hands to the Sankey `onClick`. It fires for both nodes and
 * links; links carry `source`/`target`, which lets us filter to node clicks.
 * `x/y/width/height` are the node's SVG bounds within the chart's inner area.
 */
interface SankeyClickTarget {
    id?: string;
    label?: string;
    value?: number;
    source?: unknown;
    target?: unknown;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
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

    // Node ids that have a drill-down breakdown — used to render the clickable
    // affordance (cursor + hover ring) on exactly those nodes. Declared before
    // the early returns below so the hook order stays stable.
    const drillableIds = useMemo(() => new Set(Object.keys(provenance)), [provenance]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);

    // Node clicked for the provenance drill-down panel. A stale selection (one
    // whose node no longer exists after the data changed, e.g. a different year)
    // is dropped during render via `selectedProvenance` below rather than reset
    // in an effect — that also covers callers that pass inline default props
    // (e.g. {}) and mint a fresh `data` object every render.
    const [selectedNode, setSelectedNode] = useState<SelectedSankeyNode | null>(null);

    const handleNodeClick = useCallback((target: SankeyClickTarget, event?: { clientX: number; clientY: number }) => {
        // Nivo's onClick fires for both nodes and links; links carry source/target.
        // Ignore link clicks — provenance is a node-level concept.
        if (!target || target.source || target.target || typeof target.id !== 'string') return;
        // Only composite nodes have a breakdown; ignore clicks on leaf nodes.
        if (!provenance[target.id]) {
            setSelectedNode(null);
            return;
        }
        const id = target.id;

        // Anchor the popover at the click point (viewport coords). If no event is
        // available (e.g. a synthetic/test invocation), fall back to the centre of
        // the chart container so the popover still appears tied to the chart.
        let anchorX = event?.clientX ?? 0;
        let anchorY = event?.clientY ?? 0;
        if (event == null && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            anchorX = rect.left + rect.width / 2;
            anchorY = rect.top + rect.height / 2;
        }

        setSelectedNode(prev =>
            prev?.id === id
                ? null
                : { id, label: target.label ?? id, value: target.value ?? 0, anchorX, anchorY },
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
                    onClick={(node: SankeyClickTarget, event) => handleNodeClick(node, event)}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nivo's colors accessor omits `color`/`label` from its param type even though they're populated at call time; `any` avoids fighting the library's types.
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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see colors accessor above; Nivo omits `label` from the param type.
                    label={(node: any) => node.label}
                    labelPosition="outside"
                    labelPadding={isNarrow ? 8 : 16}
                    sort="input"
                    // Insert a custom layer above the nodes that draws the
                    // drill-down affordance (pointer cursor + hover ring) and
                    // handles clicks for nodes that have a breakdown.
                    layers={['links', 'nodes', 'labels', 'legends', (props: { nodes: readonly DrillableNode[] }) => (
                        <DrillableNodeOverlay
                            nodes={props.nodes}
                            drillableIds={drillableIds}
                            ringColor={resolve('var(--c-accent-soft)')}
                            formatValue={currencyFormatter}
                            onNodeClick={handleNodeClick}
                        />
                    )]}
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
                    direction={selectedProvenance.direction}
                    items={selectedProvenance.items}
                    anchorX={selectedNode.anchorX}
                    anchorY={selectedNode.anchorY}
                    formatValue={currencyFormatter}
                    onClose={() => setSelectedNode(null)}
                />
            )}
        </SankeyErrorBoundary>
    );
};

/** The subset of Nivo's computed node datum the overlay needs. */
interface DrillableNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    value: number;
}

interface DrillableNodeOverlayProps {
    nodes: readonly DrillableNode[];
    drillableIds: Set<string>;
    ringColor: string;
    formatValue: (value: number) => string;
    onNodeClick: (target: SankeyClickTarget, event: { clientX: number; clientY: number }) => void;
}

/**
 * Transparent SVG overlay drawn above the Sankey nodes. For nodes that have a
 * drill-down breakdown it shows a pointer cursor and a hover ring, and forwards
 * clicks to open the detail panel — giving users an affordance for which nodes
 * are clickable. Non-drillable nodes are skipped entirely (no overlay rect over
 * them), so they keep their plain cursor and Nivo's own hover tooltip.
 *
 * Since the overlay rect sits on top of the node it intercepts the node's hover,
 * so a native <title> restates the value and signals clickability on hover.
 */
const DrillableNodeOverlay = ({ nodes, drillableIds, ringColor, formatValue, onNodeClick }: DrillableNodeOverlayProps) => {
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    return (
        <>
            {nodes.filter(n => drillableIds.has(n.id)).map(node => {
                const isHovered = hoveredId === node.id;
                return (
                    <rect
                        key={node.id}
                        x={node.x - 2}
                        y={node.y - 2}
                        width={node.width + 4}
                        height={node.height + 4}
                        rx={4}
                        ry={4}
                        fill="transparent"
                        stroke={ringColor}
                        strokeWidth={isHovered ? 2 : 0}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredId(node.id)}
                        onMouseLeave={() => setHoveredId(prev => (prev === node.id ? null : prev))}
                        onClick={(e) => onNodeClick(
                            { id: node.id, label: node.label, value: node.value, x: node.x, y: node.y, width: node.width, height: node.height },
                            { clientX: e.clientX, clientY: e.clientY },
                        )}
                    >
                        <title>{`${node.label}: ${formatValue(node.value)} — click to break down`}</title>
                    </rect>
                );
            })}
        </>
    );
};

interface SankeyDetailPanelProps {
    label: string;
    total: number;
    direction: SankeyProvenanceDirection;
    items: SankeyProvenanceItem[];
    anchorX: number;
    anchorY: number;
    formatValue: (value: number) => string;
    onClose: () => void;
}

const POPOVER_WIDTH = 288; // matches w-72
const POPOVER_GAP = 14; // distance from the click point
const VIEWPORT_MARGIN = 10;

/**
 * Drill-down popover anchored next to the clicked Sankey node. Lists the
 * constituent rows with their amount and share of the node total, headed by an
 * explicit direction label (Sources / Destinations / Breakdown). Rendered via a
 * portal in fixed positioning so it escapes the chart's overflow/stacking
 * context, with viewport-edge clamping so it stays on-screen. Dismisses on
 * outside-click, Escape, and the close button; focuses itself on open.
 */
const SankeyDetailPanel = ({ label, total, direction, items, anchorX, anchorY, formatValue, onClose }: SankeyDetailPanelProps) => {
    const sorted = [...items].sort((a, b) => {
        // Keep the synthetic "Other" remainder row last regardless of size.
        if (a.isRemainder) return 1;
        if (b.isRemainder) return -1;
        return b.value - a.value;
    });
    const sum = sorted.reduce((s, i) => s + i.value, 0);
    // Prefer the node's own value for shares; fall back to the item sum if the
    // node value is unavailable (e.g. a consumer that doesn't supply it).
    const denominator = total > 0 ? total : sum;

    const panelRef = useRef<HTMLDivElement>(null);

    // Position after layout so we can measure the panel's real height and clamp
    // it within the viewport. Prefer placing to the right of the click; flip left
    // if it would overflow, then clamp vertically. Written directly to the
    // element's style (rather than React state) so positioning the popover
    // doesn't trigger an extra render — mirrors ChartTooltipPortal. The panel
    // starts at visibility:hidden to avoid a one-frame flash at the raw anchor.
    useLayoutEffect(() => {
        const el = panelRef.current;
        if (!el) return;
        const w = el.offsetWidth || POPOVER_WIDTH;
        const h = el.offsetHeight || 200;

        let left = anchorX + POPOVER_GAP;
        if (left + w > window.innerWidth - VIEWPORT_MARGIN) {
            left = anchorX - w - POPOVER_GAP; // flip to the left of the click
        }
        if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

        let top = anchorY - h / 2; // vertically centre on the click
        if (top + h > window.innerHeight - VIEWPORT_MARGIN) top = window.innerHeight - VIEWPORT_MARGIN - h;
        if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.visibility = 'visible';
        // Focus on open for keyboard accessibility (also serves the "focus the
        // panel, Esc closes" requirement).
        el.focus();
    }, [anchorX, anchorY, items, label]);

    // Dismiss on Escape and on a click outside the panel.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const onPointerDown = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('keydown', onKey);
        // Defer the outside-click listener a tick so the click that opened the
        // panel doesn't immediately close it.
        const id = window.setTimeout(() => document.addEventListener('mousedown', onPointerDown), 0);
        return () => {
            document.removeEventListener('keydown', onKey);
            window.clearTimeout(id);
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            aria-label={`${label} ${DIRECTION_LABEL[direction]}`}
            tabIndex={-1}
            style={{
                position: 'fixed',
                // Real left/top + visibility are written by the layout effect
                // after measuring; start hidden at the anchor to avoid a flash.
                left: anchorX,
                top: anchorY,
                width: POPOVER_WIDTH,
                visibility: 'hidden',
                zIndex: 9999,
            }}
            className="bg-surface-overlay border border-border-default rounded-lg p-4 shadow-2xl focus:outline-none focus:ring-2 focus:ring-border-faint"
        >
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                        <span className="text-xs uppercase tracking-wider font-semibold text-content-muted">{DIRECTION_LABEL[direction]}</span>
                        <span className="text-[10px] text-content-faint">{DIRECTION_HINT[direction]}</span>
                    </div>
                    <div className="text-sm font-bold text-content-bright truncate">{label}</div>
                    <div className="text-lg font-mono text-positive font-medium">{formatValue(total > 0 ? total : sum)}</div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close detail panel"
                    className="text-content-muted hover:text-content-emphasis text-lg leading-none px-1 shrink-0"
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
                            <span className={`truncate ${item.isRemainder ? 'text-content-muted italic' : 'text-content-default'}`}>{item.label}</span>
                            <span className="flex items-baseline gap-2 shrink-0">
                                <span className="font-mono text-content-emphasis">{formatValue(item.value)}</span>
                                <span className="text-xs text-content-muted w-10 text-right">{share.toFixed(0)}%</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>,
        document.body,
    );
};

// Memoize: during a CashflowTab drag, the selectedYear (and therefore the
// year-derived props passed here) don't change, so the entire Sankey subtree
// can bail out via shallow-equal prop check. Without this, every drag tick
// would re-walk ~100+ fibers inside the Nivo Sankey tree.
export const CashflowSankey = memo(CashflowSankeyInner);
