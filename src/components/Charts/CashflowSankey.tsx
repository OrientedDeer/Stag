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

/**
 * What the user clicked, stored as stable identifiers (plus the click anchor)
 * rather than a snapshot of the resolved values. The display data is re-derived
 * from the current graph at render time (see `resolved` below) so the panel
 * survives data changes (e.g. a different year) and callers that mint a fresh
 * `data` object every render.
 */
type SankeySelection =
    | { kind: 'node'; id: string; anchorX: number; anchorY: number }
    | { kind: 'flow'; sourceId: string; targetId: string; anchorX: number; anchorY: number };

const selectionKey = (s: SankeySelection): string =>
    s.kind === 'node' ? `node:${s.id}` : `flow:${s.sourceId}->${s.targetId}`;

/** Fully-resolved panel content, derived from the live graph for rendering. */
type ResolvedPanel =
    | {
          kind: 'node';
          label: string;
          value: number;
          direction: SankeyProvenanceDirection;
          items: SankeyProvenanceItem[];
          anchorX: number;
          anchorY: number;
      }
    | {
          kind: 'flow';
          sourceLabel: string;
          targetLabel: string;
          value: number;
          /** This flow as a fraction (0–1) of the source node's total outflow. */
          shareOfSource: number;
          /** This flow as a fraction (0–1) of the target node's total inflow. */
          shareOfTarget: number;
          anchorX: number;
          anchorY: number;
      };

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

    // Node ids that have a curated drill-down breakdown — used to draw the hover
    // ring on exactly those nodes. Every node is clickable (leaves open a flow
    // panel) and every node keeps Nivo's styled hover tooltip; the ring is just an
    // extra cue on the composite nodes. Declared before the early returns below so
    // the hook order stays stable.
    const drillableIds = useMemo(() => new Set(Object.keys(provenance)), [provenance]);

    // Link/connection maps off the built graph, used to (a) open a flow panel for
    // a clicked link or leaf node and (b) compute a flow's share of the source's
    // outflow / target's inflow. Rebuilt only when the graph changes.
    const graphMaps = useMemo(() => {
        const nodeLabel = new Map<string, string>();
        for (const n of data.nodes) nodeLabel.set(n.id, n.label);
        const inflowsByNode = new Map<string, SankeyLink[]>();
        const outflowsByNode = new Map<string, SankeyLink[]>();
        const inflowTotal = new Map<string, number>();
        const outflowTotal = new Map<string, number>();
        for (const l of data.links) {
            (outflowsByNode.get(l.source) ?? outflowsByNode.set(l.source, []).get(l.source)!).push(l);
            outflowTotal.set(l.source, (outflowTotal.get(l.source) ?? 0) + l.value);
            (inflowsByNode.get(l.target) ?? inflowsByNode.set(l.target, []).get(l.target)!).push(l);
            inflowTotal.set(l.target, (inflowTotal.get(l.target) ?? 0) + l.value);
        }
        const nodeValue = new Map<string, number>();
        for (const n of data.nodes) {
            nodeValue.set(n.id, Math.max(inflowTotal.get(n.id) ?? 0, outflowTotal.get(n.id) ?? 0));
        }
        return { nodeLabel, nodeValue, inflowsByNode, outflowsByNode, inflowTotal, outflowTotal };
    }, [data]);

    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(800);

    // Set true for the duration of a click that makes a chart selection (node or
    // link). The popover's outside-click handler checks this so switching/toggling
    // selections doesn't dismiss, while a click anywhere else — including empty
    // chart space — closes the panel.
    const selectionClickRef = useRef(false);

    // What the user clicked (node or link), stored as ids. A stale selection
    // (whose node/link no longer exists after the data changed, e.g. a different
    // year) is dropped during render via `resolved` below rather than reset in an
    // effect — that also covers callers that pass inline default props (e.g. {})
    // and mint a fresh `data` object every render.
    const [selected, setSelected] = useState<SankeySelection | null>(null);

    // Toggle helper: clicking the already-open node/link closes it. Flags the
    // in-flight click as a selection so the chart-background click handler below
    // doesn't treat the same click as a dismissal (the selection element's click
    // bubbles up to the container). React guarantees the selection handler runs
    // before the ancestor container handler, so the flag is always set in time;
    // it's also cleared on the next tick as a backstop.
    const toggleSelection = useCallback((next: SankeySelection | null) => {
        selectionClickRef.current = true;
        window.setTimeout(() => { selectionClickRef.current = false; }, 0);
        setSelected(prev => (prev && next && selectionKey(prev) === selectionKey(next) ? null : next));
    }, []);

    const handleNodeClick = useCallback((id: string | undefined, event: { clientX: number; clientY: number }) => {
        if (typeof id !== 'string') return;
        const { inflowsByNode, outflowsByNode } = graphMaps;
        const ins = inflowsByNode.get(id) ?? [];
        const outs = outflowsByNode.get(id) ?? [];
        // Curated composite node (Gross Pay, Net Pay, Taxes, 401k/Roth split): show
        // its breakdown. A leaf with a single connection: show that flow (its share
        // of the parent) — more useful than a trivial 100% one-row list. Otherwise
        // (non-curated node with several connections) fall back to a node list.
        if (!provenance[id] && ins.length + outs.length === 1) {
            const link = ins[0] ?? outs[0];
            toggleSelection({ kind: 'flow', sourceId: link.source, targetId: link.target, anchorX: event.clientX, anchorY: event.clientY });
            return;
        }
        if (provenance[id] || ins.length + outs.length > 0) {
            toggleSelection({ kind: 'node', id, anchorX: event.clientX, anchorY: event.clientY });
        }
    }, [provenance, graphMaps, toggleSelection]);

    const handleLinkClick = useCallback((sourceId: string | undefined, targetId: string | undefined, event: { clientX: number; clientY: number }) => {
        if (typeof sourceId !== 'string' || typeof targetId !== 'string') return;
        toggleSelection({ kind: 'flow', sourceId, targetId, anchorX: event.clientX, anchorY: event.clientY });
    }, [toggleSelection]);

    // Resolve the stored selection against the live graph for rendering. Returns
    // null when the clicked node/link no longer exists (stale selection dropped).
    const resolved = useMemo<ResolvedPanel | null>(() => {
        if (!selected) return null;
        const { nodeLabel, nodeValue, inflowsByNode, outflowsByNode, inflowTotal, outflowTotal } = graphMaps;
        if (selected.kind === 'flow') {
            const link = data.links.find(l => l.source === selected.sourceId && l.target === selected.targetId);
            if (!link) return null;
            const outT = outflowTotal.get(selected.sourceId) ?? 0;
            const inT = inflowTotal.get(selected.targetId) ?? 0;
            return {
                kind: 'flow',
                sourceLabel: nodeLabel.get(selected.sourceId) ?? selected.sourceId,
                targetLabel: nodeLabel.get(selected.targetId) ?? selected.targetId,
                value: link.value,
                shareOfSource: outT > 0 ? link.value / outT : 0,
                shareOfTarget: inT > 0 ? link.value / inT : 0,
                anchorX: selected.anchorX,
                anchorY: selected.anchorY,
            };
        }
        const id = selected.id;
        const label = nodeLabel.get(id) ?? id;
        const value = nodeValue.get(id) ?? 0;
        const prov = provenance[id];
        if (prov) {
            return { kind: 'node', label, value, direction: prov.direction, items: prov.items, anchorX: selected.anchorX, anchorY: selected.anchorY };
        }
        // Non-curated node with multiple connections: derive a list from its links.
        const ins = inflowsByNode.get(id) ?? [];
        const outs = outflowsByNode.get(id) ?? [];
        if (outs.length > 0 && ins.length === 0) {
            return { kind: 'node', label, value, direction: 'destinations', items: outs.map(l => ({ label: nodeLabel.get(l.target) ?? l.target, value: l.value })), anchorX: selected.anchorX, anchorY: selected.anchorY };
        }
        if (ins.length > 0) {
            return { kind: 'node', label, value, direction: 'sources', items: ins.map(l => ({ label: nodeLabel.get(l.source) ?? l.source, value: l.value })), anchorX: selected.anchorX, anchorY: selected.anchorY };
        }
        return null;
    }, [selected, data, provenance, graphMaps]);

    // Stable close handler so the popover's dismiss listeners aren't re-armed on
    // every parent re-render (e.g. resize ticks bumping containerWidth).
    const closePanel = useCallback(() => setSelected(null), []);

    // Clicks anywhere in the chart that aren't a node/link selection (empty space,
    // labels, legend) close the panel. A real selection sets `selectionClickRef`
    // on the same click — which bubbles here afterwards — so it's skipped. Clicks
    // fully outside the chart are handled by the popover's useClickOutside.
    const handleChartAreaClick = useCallback(() => {
        if (selectionClickRef.current) {
            selectionClickRef.current = false;
            return;
        }
        closePanel();
    }, [closePanel]);

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
            <div ref={containerRef} style={{ height: `${height}px` }} onClick={handleChartAreaClick}>
                <ChartFrame><ResponsiveSankey
                    data={data}
                    margin={margins}
                    align="justify"
                    onClick={(target: SankeyClickTarget, event) => {
                        // Nivo's onClick fires for both nodes and links; links carry
                        // source/target node datums. Route links to the flow panel
                        // and everything else (nodes — including leaves not covered
                        // by the overlay) to the node handler.
                        const src = target?.source as { id?: string } | undefined;
                        const tgt = target?.target as { id?: string } | undefined;
                        if (src && tgt) {
                            handleLinkClick(src.id, tgt.id, event);
                        } else {
                            handleNodeClick(target?.id, event);
                        }
                    }}
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
                    // drill-down hover-ring affordance on drillable nodes. It is
                    // pointer-events:none and just follows Nivo's currentNode, so
                    // Nivo keeps its styled tooltip + click handling on every node.
                    layers={['links', 'nodes', 'labels', 'legends', (props: SankeyLayerProps) => (
                        <DrillableNodeOverlay
                            currentNode={props.currentNode}
                            drillableIds={drillableIds}
                            ringColor={resolve('var(--c-accent-soft)')}
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
                            <div className="text-[10px] text-content-faint mt-1">Click for detail</div>
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
                            <div className="text-[10px] text-content-faint mt-1">Click to trace this flow</div>
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
                content={resolved}
                chartContainerRef={containerRef}
                formatValue={currencyFormatter}
                onClose={closePanel}
            />
        </SankeyErrorBoundary>
    );
};

/** Props Nivo passes to a custom Sankey layer (typed to our node/link shape). */
type SankeyLayerProps = CustomSankeyLayerProps<SankeyNode, SankeyLink>;

interface DrillableNodeOverlayProps {
    currentNode: SankeyNodeDatumT | null;
    drillableIds: Set<string>;
    ringColor: string;
}

/**
 * A hover ring drawn above the Sankey nodes for the currently-hovered drillable
 * node, as an affordance that it can be clicked to break down. It is purely
 * decorative: the rect is `pointer-events: none`, so it never intercepts hover or
 * clicks — Nivo's own node layer keeps its styled tooltip and click handling on
 * every node, and this layer just follows Nivo's `currentNode` to draw the ring.
 * (An earlier version put an interactive rect on top, which suppressed Nivo's
 * styled tooltip in favour of a native <title> — the regression this fixes.)
 */
const DrillableNodeOverlay = ({ currentNode, drillableIds, ringColor }: DrillableNodeOverlayProps) => {
    if (!currentNode || !drillableIds.has(currentNode.id)) return null;
    const node = currentNode;
    return (
        <rect
            x={node.x - 2}
            y={node.y - 2}
            width={node.width + 4}
            height={node.height + 4}
            rx={4}
            ry={4}
            fill="none"
            stroke={ringColor}
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
        />
    );
};

interface SankeyDetailPanelProps {
    /** Resolved panel content (node breakdown or link flow); null when closed. */
    content: ResolvedPanel | null;
    /** The chart container; treated as "inside" so chart clicks don't auto-dismiss (the chart's own click handler manages those). */
    chartContainerRef: React.RefObject<HTMLDivElement | null>;
    formatValue: (value: number) => string;
    onClose: () => void;
}

/** Threshold above which a flow's share is "the whole thing" and not worth a row. */
const FULL_SHARE = 0.9995;

/**
 * Drill-down popover anchored next to the clicked Sankey node or link. For a
 * node it lists the constituent rows with their amount and share of the node
 * total, headed by an explicit direction label (Sources / Destinations /
 * Breakdown). For a link it describes the single flow (source → target, amount)
 * and what fraction of the source's outflow / target's inflow it represents.
 * Rendered via a portal in fixed positioning so it escapes the chart's
 * overflow/stacking context, with viewport-edge clamping (shared placePopover)
 * so it stays on-screen. Accessibility (focus trap, Escape, focus-first, restore
 * focus to the trigger) comes from useModalAccessibility; outside-click
 * dismissal from useClickOutside. Repositions on scroll/resize so a fixed
 * popover doesn't drift away from its anchor.
 */
const SankeyDetailPanel = ({ content, chartContainerRef, formatValue, onClose }: SankeyDetailPanelProps) => {
    const isOpen = !!content;
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    // Dismiss when pressing outside both the popover and the chart. Clicks inside
    // the chart (nodes, links, empty space) are handled by the chart's own click
    // handler, which closes on non-selection clicks — so the chart counts as
    // "inside" here to avoid a double-handle/race on node selections.
    useClickOutside([modalRef, chartContainerRef], onClose, isOpen);

    const anchorX = content?.anchorX ?? 0;
    const anchorY = content?.anchorY ?? 0;
    // A primitive signature of the content so the layout effect re-measures when
    // the panel's size could change, without depending on the (re-derived every
    // render) content object identity.
    const signature = content
        ? content.kind === 'flow'
            ? `flow:${content.sourceLabel}->${content.targetLabel}:${content.value}`
            : `node:${content.label}:${content.items.length}`
        : '';

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
    }, [isOpen, anchorX, anchorY, signature, modalRef]);

    if (!content) return null;

    const shell = (ariaLabel: string, body: React.ReactNode) => createPortal(
        <div
            ref={modalRef}
            role="dialog"
            aria-modal="false"
            aria-label={ariaLabel}
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
            {body}
        </div>,
        document.body,
    );

    if (content.kind === 'flow') {
        // Drop a share row that is essentially the whole side (e.g. clicking a
        // leaf node's only inflow is trivially 100% of that node) — keep just the
        // informative side(s).
        const shareRows: Array<{ label: string; pct: number }> = [];
        if (content.shareOfSource > 0 && content.shareOfSource < FULL_SHARE) {
            shareRows.push({ label: `of ${content.sourceLabel}`, pct: content.shareOfSource * 100 });
        }
        if (content.shareOfTarget > 0 && content.shareOfTarget < FULL_SHARE) {
            shareRows.push({ label: `of ${content.targetLabel}`, pct: content.shareOfTarget * 100 });
        }
        return shell(`${content.sourceLabel} to ${content.targetLabel} flow`, (
            <>
                <div className="min-w-0 mb-2">
                    <div className="flex items-baseline gap-2">
                        <span className="text-xs uppercase tracking-wider font-semibold text-content-muted">Flow</span>
                        <span className="text-[10px] text-content-faint">One slice of the diagram</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-content-bright">
                        <span className="truncate">{content.sourceLabel}</span>
                        <span className="text-content-muted shrink-0">&rarr;</span>
                        <span className="truncate">{content.targetLabel}</span>
                    </div>
                    <div className="text-lg font-mono text-positive font-medium">{formatValue(content.value)}</div>
                </div>
                {shareRows.length > 0 && (
                    <ul className="space-y-1.5">
                        {shareRows.map((r, idx) => (
                            <li key={`${r.label}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
                                <span className="truncate text-content-default">{r.label}</span>
                                <span className="font-mono text-content-emphasis shrink-0">{r.pct.toFixed(0)}%</span>
                            </li>
                        ))}
                    </ul>
                )}
            </>
        ));
    }

    const sorted = [...content.items].sort((a, b) => {
        // Keep the synthetic "Other" remainder row last regardless of size.
        if (a.isRemainder) return 1;
        if (b.isRemainder) return -1;
        return b.value - a.value;
    });
    const sum = sorted.reduce((s, i) => s + i.value, 0);
    // Prefer the node's own value for shares; fall back to the item sum if the
    // node value is unavailable (e.g. a consumer that doesn't supply it).
    const denominator = content.value > 0 ? content.value : sum;
    const { label: dirLabel, hint: dirHint } = DIRECTION_META[content.direction];

    return shell(`${content.label} ${dirLabel}`, (
        <>
            <div className="min-w-0 mb-2">
                <div className="flex items-baseline gap-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-content-muted">{dirLabel}</span>
                    <span className="text-[10px] text-content-faint">{dirHint}</span>
                </div>
                <div className="text-sm font-bold text-content-bright truncate">{content.label}</div>
                <div className="text-lg font-mono text-positive font-medium">{formatValue(content.value > 0 ? content.value : sum)}</div>
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
        </>
    ));
};

// Memoize: during a CashflowTab drag, the selectedYear (and therefore the
// year-derived props passed here) don't change, so the entire Sankey subtree
// can bail out via shallow-equal prop check. Without this, every drag tick
// would re-walk ~100+ fibers inside the Nivo Sankey tree.
export const CashflowSankey = memo(CashflowSankeyInner);
