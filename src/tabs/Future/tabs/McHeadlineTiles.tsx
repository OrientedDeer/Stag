import { MonteCarloSummary } from '../../../services/MonteCarloTypes';
import { formatCompactCurrency } from './FutureUtils';
import { Tooltip } from '../../../components/Layout/InputFields/Tooltip';

/**
 * Headline tile row for the Monte Carlo tab (#162 D1): Success Rate plus the
 * AFTER-TAX terminal distribution (bad case / median / good case / certainty
 * equivalent) — the numbers a conversion strategy should actually be judged
 * by. Gross percentiles are demoted to the fan-chart card.
 *
 * FALLBACK: `afterTaxPercentiles` / `certaintyEquivalents` are optional on the
 * summary type (stale persisted summaries predate them). When after-tax data
 * is absent this renders the legacy GROSS tiles unchanged.
 */
interface McHeadlineTilesProps {
    summary: MonteCarloSummary;
    forceExact: boolean;
}

const getSuccessRateColor = (rate: number) => {
    if (rate >= 95) return 'text-positive';
    if (rate >= 80) return 'text-warning';
    if (rate >= 60) return 'text-cat-orange';
    return 'text-negative';
};

interface TileProps {
    label: string;
    value: string;
    valueClassName: string;
    sub?: string;
    tooltip?: string;
}

const Tile = ({ label, value, valueClassName, sub, tooltip }: TileProps) => (
    <div className="bg-surface-overlay/50 rounded-xl p-4 border border-border-default">
        <div className="text-content-muted text-xs uppercase tracking-wider mb-1">
            {tooltip ? (
                <span className="inline-flex items-center gap-1">
                    {label}
                    <Tooltip text={tooltip} />
                </span>
            ) : label}
        </div>
        <div className={`font-bold ${valueClassName}`}>{value}</div>
        {sub && <div className="text-content-muted text-xs mt-1">{sub}</div>}
    </div>
);

export const McHeadlineTiles = ({ summary, forceExact }: McHeadlineTilesProps) => {
    const fmt = (n: number) => formatCompactCurrency(n, { forceExact });

    const successTile = (
        <Tile
            label="Success Rate"
            value={`${summary.successRate.toFixed(1)}%`}
            valueClassName={`text-2xl lg:text-3xl ${getSuccessRateColor(summary.successRate)}`}
            sub={`${summary.successfulScenarios} of ${summary.totalScenarios} scenarios`}
        />
    );

    const afterTax = summary.afterTaxPercentiles;
    if (!afterTax) {
        // Legacy gross tiles for stale persisted summaries that predate the
        // after-tax valuation (fp-review F4).
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {successTile}
                <Tile
                    label="10th Percentile"
                    value={fmt(summary.percentiles.p10[summary.percentiles.p10.length - 1]?.netWorth ?? 0)}
                    valueClassName="text-xl lg:text-2xl text-negative"
                    sub="Worst reasonable case"
                />
                <Tile
                    label="Median"
                    value={fmt(summary.percentiles.p50[summary.percentiles.p50.length - 1]?.netWorth ?? 0)}
                    valueClassName="text-xl lg:text-2xl text-positive"
                    sub="50th percentile"
                />
                <Tile
                    label="90th Percentile"
                    value={fmt(summary.percentiles.p90[summary.percentiles.p90.length - 1]?.netWorth ?? 0)}
                    valueClassName="text-xl lg:text-2xl text-info"
                    sub="Best reasonable case"
                />
                <Tile
                    label="Trimmed Avg"
                    value={fmt(summary.averageFinalNetWorth)}
                    valueClassName="text-xl lg:text-2xl text-content-default"
                    sub="Excludes top/bottom 5%"
                />
            </div>
        );
    }

    // CRRA certainty equivalent (fp-review F13 / #160). Solvent-only by
    // convention — CRRA is undefined at ≤$0 wealth. γ=2 is the headline; γ=4
    // lives in the tooltip (it's dominated by the single worst surviving path
    // and reads alarmist as a headline).
    const ce = summary.certaintyEquivalents;
    const solventPct = ce ? ((ce.solventCount / ce.totalCount) * 100).toFixed(0) : '';
    const ceTooltip = ce
        ? `The "gamble" is the plan itself: the same plan run through ${ce.totalCount.toLocaleString()} `
        + `simulated market histories ends ${ce.totalCount.toLocaleString()} different ways, and you `
        + `only get to live one of them. This tile prices that draw as a single sure number — the `
        + `guaranteed amount a moderately risk-averse person would accept instead of taking it `
        + `(${fmt(ce.gamma2)}, γ=2; a very risk-averse person: ${fmt(ce.gamma4)}, γ=4, which is `
        + `dominated by the single worst surviving path). It is always below the solvent-path `
        + `AVERAGE — that shortfall is the price of the uncertainty — but it can legitimately sit `
        + `above the Median tile: long upside tails pull the average far above the median, and the `
        + `CE counts only the ${solventPct}% of runs that stay solvent while the median counts `
        + `every path.`
        : undefined;

    return (
        <div>
            <p className="text-content-muted text-xs mb-2">
                <span className="inline-flex items-center gap-1">
                    After-tax terminal net worth — ending balances minus taxes still owed
                    <Tooltip text={
                        `Each path's ending balances minus the taxes still owed to access them `
                        + `(deferred ordinary tax on Traditional balances, capital gains on unrealized `
                        + `growth), so plans with different Traditional/Roth mixes are comparable. `
                        + `The fan chart below plots gross (pre-tax) net worth per year.`
                    } />
                </span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {successTile}
                <Tile
                    label="Bad Case"
                    value={fmt(afterTax.p10)}
                    valueClassName="text-xl lg:text-2xl text-negative"
                    sub="10th percentile after-tax"
                />
                <Tile
                    label="Median"
                    value={fmt(afterTax.p50)}
                    valueClassName="text-xl lg:text-2xl text-positive"
                    sub="50th percentile after-tax"
                />
                <Tile
                    label="Good Case"
                    value={fmt(afterTax.p90)}
                    valueClassName="text-xl lg:text-2xl text-info"
                    sub="90th percentile after-tax"
                />
                <Tile
                    label="Certainty Equivalent"
                    value={ce ? fmt(ce.gamma2) : '—'}
                    valueClassName="text-xl lg:text-2xl text-content-default"
                    sub={ce ? 'This spread of outcomes, priced as a sure thing' : 'No solvent paths'}
                    tooltip={ceTooltip}
                />
            </div>
        </div>
    );
};
