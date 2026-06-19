import { memo, useMemo, useContext, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ResponsiveSankey } from '@nivo/sankey';
import type { CustomSankeyLayerProps, SankeyNodeDatum } from '@nivo/sankey';
import { AnyIncome } from '../Objects/Income/models';
import { AnyExpense } from '../Objects/Expense/models';
import { AnyAccount } from '../Objects/Accounts/models';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { CashflowDetail } from '../../services/simulation/types';
import { SankeyErrorBoundary } from './SankeyErrorBoundary';
import { useChartTheme } from './useChartTheme';
import { ChartFrame } from "./ChartFrame";
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { useClickOutside } from '../../hooks/useClickOutside';
import { placePopover } from './popoverPosition';
import {
    buildCashflowSankeyData,
    SankeyImbalance,
    SankeyRothConversion,
    SankeyTaxBreakdown,
    SankeyProvenanceItem,
    SankeyProvenanceDirection,
    SankeyNode,
    SankeyLink,
} from './cashflowSankeyData';

export type { SankeyImbalance } from './cashflowSankeyData';

/** Nivo's fully-computed node datum for our Sankey (adds x/y/width/height/value). */
type SankeyNodeDatumT = SankeyNodeDatum<SankeyNode, SankeyLink>;

/** Header label + one-line hint shown for each provenance direction. */
const DIRECTION_META: Record<SankeyProvenanceDirection, { label: string; hint: string }> = {
    sources: { label: 'Sources', hint: 'What flows in' },
    destinations: { label: 'Destinations', hint: 'Where it flows' },
    breakdown: { label: 'Breakdown', hint: 'Sub-split of this node' },
};

/** Fallback popover dimensions used before the panel is measured. */
const POPOVER_WIDTH = 288; // matches w-72
const POPOVER_FALLBACK_HEIGHT = 200;

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

    const handleNodeClick = useCallback((target: SankeyClickTarget, event: { clientX: number; clientY: number }) => {
        // Nivo's onClick fires for both nodes and links; links carry source/target.
        // Ignore link clicks — provenance is a node-level concept.
        if (!target || target.source || target.target || typeof target.id !== 'string') return;
        // Only composite nodes have a breakdown; ignore clicks on leaf nodes.
        if (!provenance[target.id]) {
            setSelectedNode(null);
            return;
        }
        const id = target.id;
        // Toggle: clicking the already-open node closes it. (A click on a chart
        // node is treated as "inside" by useClickOutside below, so the outside
        // dismissal doesn't race this toggle — this stays the sole authority for
        // node clicks.) Anchor the popover at the click point (viewport coords).
        setSelectedNode(prev =>
            prev?.id === id
                ? null
                : { id, label: target.label ?? id, value: target.value ?? 0, anchorX: event.clientX, anchorY: event.clientY },
        );
    }, [provenance]);

    // Stable close handler so the popover's dismiss listeners aren't re-armed on
    // every parent re-render (e.g. resize ticks bumping containerWidth).
    const closePanel = useCallback(() => setSelectedNode(null), []);

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
                    // handles clicks for nodes that have a breakdown. It forwards
                    // hover to Nivo's setCurrentNode so drillable nodes keep the
                    // same connected-link highlight as leaf nodes.
                    layers={['links', 'nodes', 'labels', 'legends', (props: SankeyLayerProps) => (
                        <DrillableNodeOverlay
                            nodes={props.nodes}
                            currentNode={props.currentNode}
                            setCurrentNode={props.setCurrentNode}
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
            {/* Always mounted (not conditionally rendered) so useModalAccessibility
                can observe the open→closed transition and restore focus to the
                trigger. It renders null while closed. */}
            <SankeyDetailPanel
                isOpen={!!(selectedNode && selectedProvenance)}
                label={selectedNode?.label ?? ''}
                total={selectedNode?.value ?? 0}
                direction={selectedProvenance?.direction ?? 'sources'}
                items={selectedProvenance?.items ?? EMPTY_ITEMS}
                anchorX={selectedNode?.anchorX ?? 0}
                anchorY={selectedNode?.anchorY ?? 0}
                chartContainerRef={containerRef}
                formatValue={currencyFormatter}
                onClose={closePanel}
            />
        </SankeyErrorBoundary>
    );
};

/** Stable empty array so the closed panel doesn't churn its memo deps. */
const EMPTY_ITEMS: SankeyProvenanceItem[] = [];

/** Props Nivo passes to a custom Sankey layer (typed to our node/link shape). */
type SankeyLayerProps = CustomSankeyLayerProps<SankeyNode, SankeyLink>;

interface DrillableNodeOverlayProps {
    nodes: readonly SankeyNodeDatumT[];
    currentNode: SankeyNodeDatumT | null;
    setCurrentNode: (node: SankeyNodeDatumT | null) => void;
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
 * The overlay rect sits on top of the node and intercepts its hover, so it
 * forwards enter/leave to Nivo's `setCurrentNode` — that keeps the connected-
 * link highlight identical to leaf nodes. A native <title> restates the value
 * and signals clickability on hover (Nivo's styled tooltip is driven internally
 * by the node layer and isn't reachable from a custom layer).
 */
const DrillableNodeOverlay = ({ nodes, currentNode, setCurrentNode, drillableIds, ringColor, formatValue, onNodeClick }: DrillableNodeOverlayProps) => {
    // Only the drillable nodes get an overlay rect; memoised so hover-driven
    // re-renders (currentNode changing) don't re-filter the full node list.
    const drillableNodes = useMemo(
        () => nodes.filter(n => drillableIds.has(n.id)),
        [nodes, drillableIds],
    );
    return (
        <>
            {drillableNodes.map(node => {
                const isHovered = currentNode?.id === node.id;
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
                        onMouseEnter={() => setCurrentNode(node)}
                        onMouseLeave={() => setCurrentNode(null)}
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
    isOpen: boolean;
    label: string;
    total: number;
    direction: SankeyProvenanceDirection;
    items: SankeyProvenanceItem[];
    anchorX: number;
    anchorY: number;
    /** The chart container; treated as "inside" so node clicks don't auto-dismiss. */
    chartContainerRef: React.RefObject<HTMLDivElement | null>;
    formatValue: (value: number) => string;
    onClose: () => void;
}

/**
 * Drill-down popover anchored next to the clicked Sankey node. Lists the
 * constituent rows with their amount and share of the node total, headed by an
 * explicit direction label (Sources / Destinations / Breakdown). Rendered via a
 * portal in fixed positioning so it escapes the chart's overflow/stacking
 * context, with viewport-edge clamping (shared placePopover) so it stays
 * on-screen. Accessibility (focus trap, Escape, focus-first, restore focus to
 * the trigger) comes from useModalAccessibility; outside-click dismissal from
 * useClickOutside. Repositions on scroll/resize so a fixed popover doesn't drift
 * away from its anchor.
 */
const SankeyDetailPanel = ({ isOpen, label, total, direction, items, anchorX, anchorY, chartContainerRef, formatValue, onClose }: SankeyDetailPanelProps) => {
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    useClickOutside([modalRef, chartContainerRef], onClose, isOpen);

    // Measure then clamp into the viewport, writing position directly to the
    // element's style (no extra render) — mirrors ChartTooltipPortal. Runs on
    // open and whenever the anchor/content changes; also re-runs on scroll and
    // resize so the fixed popover tracks its anchor instead of going stale.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const reposition = () => {
            const el = modalRef.current;
            if (!el) return;
            const { left, top } = placePopover({
                anchorX,
                anchorY,
                width: el.offsetWidth || POPOVER_WIDTH,
                height: el.offsetHeight || POPOVER_FALLBACK_HEIGHT,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
            });
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            el.style.visibility = 'visible';
        };
        reposition();
        // `true` (capture) so we also catch scrolls inside nested scroll
        // containers (the chart sits in scrollable tabs), not just window scroll.
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [isOpen, anchorX, anchorY, items, label, modalRef]);

    if (!isOpen) return null;

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
    const { label: dirLabel, hint: dirHint } = DIRECTION_META[direction];

    return createPortal(
        <div
            ref={modalRef}
            role="dialog"
            aria-modal="false"
            aria-label={`${label} ${dirLabel}`}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
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
                        <span className="text-xs uppercase tracking-wider font-semibold text-content-muted">{dirLabel}</span>
                        <span className="text-[10px] text-content-faint">{dirHint}</span>
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
