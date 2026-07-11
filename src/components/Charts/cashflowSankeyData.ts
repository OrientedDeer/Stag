/**
 * Pure data-transform for the Cashflow Sankey chart.
 *
 * Builds the Nivo-friendly { nodes, links } graph plus diagnostic info
 * (imbalances, debug data, error string). Lifted out of CashflowSankey.tsx
 * so the chart component can stay focused on rendering.
 */
import { WorkIncome, type AnyIncome, PassiveIncome } from '../Objects/Income/models';
import { MortgageExpense, type AnyExpense, CLASS_TO_CATEGORY } from '../Objects/Expense/models';
import { type AnyAccount, InvestedAccount, DebtAccount, DeficitDebtAccount } from '../Objects/Accounts/models';
import { type CashflowDetail } from '../../services/simulation/types';
import { totalTaxesOf, type TaxComponents } from './taxTotals';

// Minimum threshold for including a value in the chart (avoids $0 nodes)
const MIN_DISPLAY_THRESHOLD = 0.005;

/**
 * Collapse a node's constituent rows for the drill-down panel.
 *
 * Items whose magnitude is at/above `MIN_DISPLAY_THRESHOLD` are listed
 * individually (including any negatives — those are real contributors, not
 * noise). Tiny *positive* items below the threshold are rolled into a single
 * synthetic "Other (+N smaller)" row, but only when their combined sum is itself
 * worth a row; otherwise they're dropped as rounding dust. Non-finite values
 * (NaN/Infinity) are always dropped so the panel never renders "$NaN".
 *
 * The rows are built purely from `items` — the helper does NOT fabricate a
 * remainder to match an external node total. The provenance lists are built from
 * the same per-source values the chart renders (so items already sum to the node
 * by construction); genuine inflow/outflow drift is surfaced separately by the
 * engine's imbalance detector, not papered over here.
 *
 * Exported for unit testing.
 */
export function reconcileProvenanceItems(
    items: SankeyProvenanceItem[],
): SankeyProvenanceItem[] {
    const listed: SankeyProvenanceItem[] = [];
    let smallCount = 0;
    let smallSum = 0;

    for (const item of items) {
        const v = item.value;
        if (!Number.isFinite(v)) continue; // drop NaN/Infinity — unrenderable
        if (Math.abs(v) >= MIN_DISPLAY_THRESHOLD) {
            listed.push(item); // real row (incl. meaningful negatives)
        } else if (v > 0) {
            smallCount += 1; // tiny positive — fold into "Other"
            smallSum += v;
        }
        // |v| < threshold and v <= 0: negligible, drop.
    }

    if (smallSum >= MIN_DISPLAY_THRESHOLD) {
        listed.push({ label: `Other (+${smallCount} smaller)`, value: smallSum, isRemainder: true });
    }
    return listed;
}

export interface SankeyImbalance {
    nodeName: string;
    inflows: number;
    outflows: number;
    difference: number;
}

/**
 * The Sankey's per-year tax breakdown. Structurally identical to (and now an alias
 * of) `TaxComponents` in taxTotals.ts — the 8-component shape `totalTaxesOf` sums —
 * so the two can't drift. taxTotals owns the canonical definition (it must not import
 * from this module, to avoid a cycle).
 */
export type SankeyTaxBreakdown = TaxComponents;

export interface SankeyRothConversion {
    amount: number;
    fromAccounts: Record<string, number>;
    toAccounts: Record<string, number>;
}

export interface BuildCashflowSankeyInput {
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    year: number;
    taxes: SankeyTaxBreakdown;
    bucketAllocations: Record<string, number>;
    accounts: AnyAccount[];
    withdrawals: Record<string, number>;
    rothConversion?: SankeyRothConversion;
    /** Per-source classification from the simulation engine. Preferred path. */
    cashflowDetail?: CashflowDetail;
    /** Living expenses (used by Dashboard's pre-simulation fallback path). */
    livingExpenses?: number;
}

export interface SankeyNode {
    id: string;
    color: string;
    label: string;
}

export interface SankeyLink {
    source: string;
    target: string;
    value: number;
}

/**
 * One constituent source object behind a Sankey node, used by the click-to-drill
 * detail panel. `value` is the dollar amount this source contributes to the node;
 * the panel derives each item's share of the node total.
 */
export interface SankeyProvenanceItem {
    label: string;
    value: number;
    /** True for the synthetic "Other (+N smaller)" remainder row. */
    isRemainder?: boolean;
}

/**
 * Which way the breakdown reads relative to the clicked node:
 * - `sources`      — what flows IN (upstream inputs, e.g. Gross Pay's income lines)
 * - `destinations` — where it flows OUT (downstream outputs, e.g. where Net Pay goes)
 * - `breakdown`    — a same-column sub-split of one node (e.g. Taxes → fed/state/FICA)
 *
 * The panel turns this into an explicit header ("Sources" / "Destinations" /
 * "Breakdown") so the user knows what they're looking at instead of silently
 * flipping direction between nodes.
 */
export type SankeyProvenanceDirection = 'sources' | 'destinations' | 'breakdown';

/**
 * A node's drill-down breakdown: its direction plus the constituent rows.
 */
export interface SankeyProvenanceEntry {
    direction: SankeyProvenanceDirection;
    items: SankeyProvenanceItem[];
}

/**
 * Maps a node id to its drill-down breakdown. Only composite nodes (aggregators
 * like Gross Pay, Taxes, an expense category) get an entry; leaf source nodes
 * are omitted because they have no breakdown.
 */
export type SankeyProvenance = Record<string, SankeyProvenanceEntry>;

export interface BuildCashflowSankeyResult {
    data: { nodes: SankeyNode[]; links: SankeyLink[] };
    error: string | null;
    debugData: { nodes: SankeyNode[]; links: SankeyLink[] } | null;
    imbalances: SankeyImbalance[];
    /** Node id → drill-down breakdown (direction + rows), for the detail panel. */
    provenance: SankeyProvenance;
}

export function buildCashflowSankeyData(input: BuildCashflowSankeyInput): BuildCashflowSankeyResult {
    const {
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
    } = input;

    try {
        const nodes: SankeyNode[] = [];
        const links: SankeyLink[] = [];

        // --- Aggregation ---
        // Per-source income lines for chart nodes.
        const workIncomeItems: Array<{ name: string; amount: number }> = [];
        const otherIncomeItems: Array<{ name: string; amount: number }> = [];
        // `amount` is the GROSS recognized income (flows through Gross Pay so any
        // sell-at-source withholding has a tax source); `net` is what actually
        // reinvests into the account (gross − withheld). They differ only for RSU
        // vests; for ordinary reinvested income (interest) net === amount.
        const reinvestedIncomeItems: Array<{ name: string; amount: number; net: number; accountName: string }> = [];

        let employee401k = 0;
        let employeeRoth = 0;
        let totalInsurance = 0;

        let totalEmployerMatchForRoth = 0;
        let totalEmployerMatchForTrad = 0;

        let totalPrincipal = 0;
        let totalMortgagePayment = 0;

        // Expense category totals (excludes mortgage; mortgage is split into principal + interest+escrow).
        const expenseCatTotals = new Map<string, number>();

        if (cashflowDetail) {
            // --- Sim-provided values (preferred path) ---
            // The simulation engine has already done the per-source classification, so
            // re-deriving these here would just be an opportunity for drift.
            for (const src of cashflowDetail.incomeBySource) {
                if (src.amount < MIN_DISPLAY_THRESHOLD) continue;
                if (src.kind === 'work') {
                    workIncomeItems.push({ name: src.name, amount: src.amount });
                } else if (src.kind === 'reinvested') {
                    reinvestedIncomeItems.push({
                        name: src.name,
                        amount: src.amount,
                        net: src.reinvestedNet ?? src.amount,
                        accountName: src.accountName ?? src.name,
                    });
                } else {
                    otherIncomeItems.push({ name: src.name, amount: src.amount });
                }
            }
            employee401k = cashflowDetail.userPreTax401k;
            employeeRoth = cashflowDetail.userRoth401k;
            totalEmployerMatchForTrad = cashflowDetail.employerMatchPreTax;
            totalEmployerMatchForRoth = cashflowDetail.employerMatchRoth;
            totalInsurance = cashflowDetail.insurance;
            totalPrincipal = cashflowDetail.mortgagePrincipal;
            totalMortgagePayment = cashflowDetail.mortgagePrincipal + cashflowDetail.mortgageInterestEscrow;
            for (const [cat, amt] of Object.entries(cashflowDetail.expensesByCategory)) {
                expenseCatTotals.set(cat, amt);
            }
        } else {
            // --- Fallback: derive from raw incomes/expenses ---
            // Used by the Dashboard's pre-simulation "current year" chart, which doesn't
            // have a SimulationYear yet. Sim-driven consumers should pass cashflowDetail.
            incomes.forEach(inc => {
                const amount = inc.getProratedAnnual ? inc.getProratedAnnual(inc.amount, year) : 0;
                if (amount < MIN_DISPLAY_THRESHOLD && !(inc instanceof WorkIncome)) return;

                if (inc instanceof WorkIncome) {
                    if (amount >= MIN_DISPLAY_THRESHOLD) {
                        workIncomeItems.push({ name: inc.name, amount });
                    }
                    employee401k += inc.getProratedAnnual(inc.preTax401k, year);
                    totalInsurance += inc.getProratedAnnual(inc.insurance, year);
                    employeeRoth += inc.getProratedAnnual(inc.roth401k, year);

                    if (inc.matchAccountId) {
                        const empMatch = inc.getEffectiveAnnualEmployerMatch(year);
                        // Match destination is determined by the matchAccount's taxType,
                        // not the income's taxType. Approximate using inc.taxType for the
                        // fallback path since we lack the account lookup here.
                        if (inc.taxType === 'Roth 401k') {
                            totalEmployerMatchForRoth += empMatch;
                        } else {
                            totalEmployerMatchForTrad += empMatch;
                        }
                    }
                } else if (inc instanceof PassiveIncome && inc.isReinvested) {
                    // Fallback path (no cashflowDetail, e.g. Dashboard pre-sim): the
                    // RSU vest withholding isn't available here, so net === gross.
                    // In practice the sim-projected years that carry RSU vests always
                    // provide cashflowDetail (the preferred path above).
                    reinvestedIncomeItems.push({
                        name: inc.name,
                        amount,
                        net: amount,
                        accountName: inc.name.replace(' Interest', ''),
                    });
                } else {
                    otherIncomeItems.push({ name: inc.name, amount });
                }
            });

            expenses.forEach(exp => {
                if (exp instanceof MortgageExpense) {
                    const amort = exp.calculateAnnualAmortization(year);
                    totalPrincipal += amort.totalPrincipal;
                    totalMortgagePayment += amort.totalPayment;
                    return;
                }
                const amount = exp.getAnnualAmount(year);
                if (amount <= 0) return;
                const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
                expenseCatTotals.set(category, (expenseCatTotals.get(category) || 0) + amount);
            });
        }

        const totalEmployerMatch = totalEmployerMatchForTrad + totalEmployerMatchForRoth;
        const grossPayCalculated =
            workIncomeItems.reduce((s, i) => s + i.amount, 0) +
            otherIncomeItems.reduce((s, i) => s + i.amount, 0) +
            reinvestedIncomeItems.reduce((s, i) => s + i.amount, 0);
        // Gross flows into Gross Pay (above); only the NET reinvests out of Net Pay.
        // The gross−net gap (the RSU sell-to-cover withholding) was sold off at vest,
        // so it does NOT land in the account — counting gross here would make Net Pay's
        // outflow exceed its inflow by that gap. (Where the withheld dollars go: toward
        // the year's tax, with any over-withholding returned as spendable cash; that
        // split nets out in the residual `remaining` below, which is why Net Pay still
        // balances even when the withholding rate ≠ the vest's effective marginal rate.)
        const totalReinvested = reinvestedIncomeItems.reduce((s, i) => s + i.net, 0);

        const mortgageInterestAndEscrow = totalMortgagePayment - totalPrincipal;
        const totalTaxes = totalTaxesOf(taxes);
        const totalBucketSavings = Object.values(bucketAllocations).reduce((a, b) => a + b, 0);

        // Brokerage LTCG paid out of the gross-up never lands as user cash — the
        // planner routes it directly to the government. Subtract from brokerage
        // withdrawal entries so the cash inflow shown to the user is the net
        // they actually received. (The LTCG tax outflow in the Taxes node still
        // shows the auth LTCG separately for visibility.) When the planner uses
        // a 0% LTCG rate, brokerageLTCGFromGross is 0 and this is a no-op.
        // `withdrawals` is keyed by account id (#142). Resolve id -> display name
        // (so Sankey node labels read as account names) and flag which ids are
        // brokerage accounts for the LTCG-net adjustment.
        const idToName = new Map(accounts.map(acc => [acc.id, acc.name] as const));
        const brokerageIds = new Set(
            accounts
                .filter(acc => acc instanceof InvestedAccount && acc.taxType === 'Brokerage')
                .map(acc => acc.id)
        );
        const brokerageLTCGFromGross = cashflowDetail?.brokerageLTCGFromGross ?? 0;
        const brokerageGrossTotal = Object.entries(withdrawals)
            .filter(([id]) => brokerageIds.has(id))
            .reduce((sum, [, amt]) => sum + amt, 0);
        const withdrawalsNet: Record<string, number> = {};
        for (const [id, gross] of Object.entries(withdrawals)) {
            const displayName = idToName.get(id) ?? id;
            const net = brokerageIds.has(id) && brokerageGrossTotal > 0
                ? gross - brokerageLTCGFromGross * (gross / brokerageGrossTotal)
                : gross;
            // Keyed by display name for the node label; same-named accounts merge
            // into one node (unchanged from the prior name-keyed behavior).
            withdrawalsNet[displayName] = (withdrawalsNet[displayName] ?? 0) + net;
        }
        const netWithdrawals = Object.values(withdrawalsNet).reduce((a, b) => a + b, 0);

        // Roth conversions flow through Gross Pay → Net Pay for visualization (shows tax
        // impact), but they are NOT subtracted from remaining because they're internal
        // transfers, not spendable cash outflows.
        const rothConversionAmount = rothConversion?.amount || 0;

        // --- Waterfall Math ---
        const grossPayNodeValue = grossPayCalculated + totalEmployerMatch + netWithdrawals + rothConversionAmount;
        const totalTradSavings = employee401k + totalEmployerMatchForTrad;
        const totalRothSavings = employeeRoth + totalEmployerMatchForRoth;

        const netPayFlow = grossPayNodeValue
            - totalTradSavings
            - totalInsurance
            - totalTaxes;
            // Note: Roth Match flows through Net Pay

        // expenseCatTotals was already populated above (from cashflowDetail or fallback iteration).
        const totalExpenses = livingExpenses !== undefined
            ? livingExpenses - totalMortgagePayment  // Mortgage is shown as separate nodes
            : Array.from(expenseCatTotals.values()).reduce((a, b) => a + b, 0);

        // Compute "remaining" by closing the balance equation against Net Pay.
        // Inputs to this equation come from the simulation (via cashflowDetail),
        // so it isn't recomputing sim values — it's just deriving the residual
        // node so the diagram stays balanced. This naturally surfaces LTCG
        // over-withdrawal residuals that the sim's `discretionary` doesn't capture.
        let remaining = netPayFlow - totalRothSavings - totalExpenses - mortgageInterestAndEscrow - totalPrincipal - totalBucketSavings - rothConversionAmount - totalReinvested;
        if (remaining < -1 && totalBucketSavings > 0) {
            remaining = 0;
        }

        // =================================================================
        // NODES - Order matters for visual stability!
        // Nodes are organized by "column" in the Sankey diagram:
        // Col 1: Income sources (work, passive, withdrawals)
        // Col 2: Gross Pay
        // Col 3: Deductions (taxes, benefits, 401k)
        // Col 4: Net Pay
        // Col 5: Outflows (savings, expenses, remaining)
        // =================================================================

        // --- Column 1: Income Sources (add in consistent order) ---
        workIncomeItems.sort((a, b) => a.name.localeCompare(b.name));
        otherIncomeItems.sort((a, b) => a.name.localeCompare(b.name));

        workIncomeItems.forEach(item => {
            nodes.push({ id: item.name, color: 'var(--color-chart-money)', label: item.name });
        });

        if (totalEmployerMatch >= MIN_DISPLAY_THRESHOLD) {
            nodes.push({ id: 'Employer Contributions', color: 'var(--color-chart-money)', label: 'Employer Contrib.' });
        }

        otherIncomeItems.forEach(item => {
            nodes.push({ id: item.name, color: 'var(--color-chart-money)', label: item.name });
        });

        // Reinvested income sources (e.g., "Savings Interest")
        // These flow through Gross Pay for tax purposes but go directly to savings
        reinvestedIncomeItems.forEach(item => {
            nodes.push({ id: item.name, color: 'var(--c-cat-cyan-soft)', label: item.name });
        });

        // Withdrawals (sorted by account name for stability). Use net amounts
        // (gross - LTCG-from-gross-up share) so per-account inflow links to
        // Gross Pay sum to the same gross-pay total used in the waterfall math.
        const withdrawalItems = Object.entries(withdrawalsNet)
            .filter(([, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
            .sort(([a], [b]) => a.localeCompare(b));

        withdrawalItems.forEach(([accountName]) => {
            nodes.push({ id: `Withdraw: ${accountName}`, color: 'var(--c-cat-purple-soft)', label: `From ${accountName}` });
        });

        // Roth conversion sources (Traditional accounts being converted - flows into Gross Pay)
        const conversionSourceItems = rothConversion
            ? Object.entries(rothConversion.fromAccounts)
                .filter(([, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
                .sort(([a], [b]) => a.localeCompare(b))
            : [];

        conversionSourceItems.forEach(([accountName]) => {
            nodes.push({ id: `Convert: ${accountName}`, color: 'var(--c-cat-fuchsia-soft)', label: `Convert ${accountName}` });
        });

        // Deficit node (if needed, flows into Net Pay to cover expenses)
        if (remaining < -1) {
            nodes.push({ id: 'Deficit', color: 'var(--c-negative-soft)', label: 'Deficit' });
        }

        // --- Column 2: Gross Pay ---
        nodes.push({ id: 'Gross Pay', color: 'var(--c-accent-soft)', label: 'Gross Pay' });

        // --- Column 3: Deductions from Gross Pay (consistent order) ---
        if (totalTradSavings >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: '401k Savings', color: 'var(--color-chart-money)', label: '401k Savings' });
        if (totalInsurance >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Benefits', color: 'var(--c-cat-purple-soft)', label: 'Benefits' });
        if (totalTaxes >= MIN_DISPLAY_THRESHOLD) {
            nodes.push({ id: 'Taxes', color: 'var(--c-warning-soft)', label: 'Taxes' });
            if (taxes.fed >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Federal Tax', color: 'var(--c-warning-soft)', label: 'Federal Tax' });
            if (taxes.state >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'State Tax', color: 'var(--c-warning)', label: 'State Tax' });
            if (taxes.fica >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'FICA Tax', color: 'var(--c-warning-solid)', label: 'FICA Tax' });
            if ((taxes.capitalGains || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Cap Gains Tax', color: 'var(--c-warning-solid)', label: 'Cap Gains Tax' });
            if ((taxes.niit || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'NIIT', color: 'var(--c-warning-strong)', label: 'NIIT' });
            if ((taxes.irmaa || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'IRMAA', color: 'var(--c-warning-strong)', label: 'IRMAA' });
            if ((taxes.aca || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'ACA Subsidy Loss', color: 'var(--c-warning-strong)', label: 'ACA Subsidy Loss' });
            if ((taxes.withdrawalOrdinaryTax || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Withdrawal Tax', color: 'var(--c-cat-purple-soft)', label: 'Withdrawal Tax' });
        }

        // --- Column 4: Net Pay ---
        nodes.push({ id: 'Net Pay', color: 'var(--c-accent-soft)', label: 'Net Pay' });

        // --- Column 5: Outflows from Net Pay ---
        // Order: Savings first (stable), then expenses (may change), then remaining

        // Post-tax savings (Roth)
        if (totalRothSavings >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Roth Savings', color: 'var(--color-chart-money)', label: 'Roth Savings' });

        // Mortgage (principal is savings, interest is expense)
        if (totalPrincipal >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Principal Payments', color: 'var(--color-chart-money)', label: 'Principal Payments' });
        if (mortgageInterestAndEscrow >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Mortgage Payments', color: 'var(--c-negative-soft)', label: 'Mortgage Payments' });

        // Priority bucket allocations (sorted for stability). #60: a bucket whose
        // account is a user DebtAccount is a surplus DEBT PAYDOWN, not savings —
        // labeled "Pay Down: <name>" in the debt/negative color so the user doesn't
        // misread it as money saved. The system DeficitDebtAccount is excluded ([4]).
        // [2] The node id is keyed on the UNIQUE account id (not the display name)
        // so two buckets sharing a name — or two deleted→"Savings" fallbacks — can't
        // collide into a duplicate node id. [8] Pre-fix the nodes were deduped by id
        // downstream, so a name collision SILENTLY MERGED two buckets into one node
        // (their flows summed under one label) — not a crash, but wrong.
        // [5] The LABEL (what the user sees) carries the "Pay Down:" prefix too, not
        // just the id.
        // [9] The user-debt-vs-DeficitDebt check is inlined (not isOfferableDebt):
        // this is a DISPLAY decision, and isOfferableDebt additionally requires a
        // backing loan — which would wrongly stop an unlinked debt's flow from
        // rendering as a paydown. Display ≠ payability, so the predicates don't fit.
        const bucketItems = Object.entries(bucketAllocations)
            .filter(([, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
            .map(([accountId, amount]) => {
                const account = accounts.find(a => a.id === accountId);
                const isDebt = account instanceof DebtAccount && !(account instanceof DeficitDebtAccount);
                const name = account ? account.name : 'Savings';
                return {
                    name,
                    amount,
                    nodeId: isDebt ? `Pay Down: ${accountId}` : `Save: ${accountId}`, // [2] unique
                    label: isDebt ? `Pay Down: ${name}` : name,                       // [5] visible
                    color: isDebt ? 'var(--c-negative-soft)' : 'var(--color-chart-money)',
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        bucketItems.forEach(item => {
            nodes.push({ id: item.nodeId, color: item.color, label: item.label });
        });

        // Expenses (sorted by category for stability - added AFTER savings)
        const sortedExpenseCategories = Array.from(expenseCatTotals.entries())
            .filter(([, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cat]) => cat);
        sortedExpenseCategories.forEach(cat => {
            nodes.push({ id: cat, color: 'var(--c-negative-soft)', label: cat });
        });

        // Roth conversion destinations (flows out of Net Pay to Roth accounts)
        // Use full conversion amount (not net-after-withholding) because the tax
        // is already deducted at Gross Pay → Tax nodes. Using net amounts would
        // double-count the tax and create a deficit at the Net Pay node.
        const toAccountsTotal = rothConversion
            ? Object.values(rothConversion.toAccounts).reduce((a, b) => a + b, 0)
            : 0;
        const conversionScale = toAccountsTotal > 0 ? rothConversionAmount / toAccountsTotal : 1;
        const conversionDestItems = rothConversion
            ? Object.entries(rothConversion.toAccounts)
                .filter(([, amount]) => amount * conversionScale >= MIN_DISPLAY_THRESHOLD)
                .sort(([a], [b]) => a.localeCompare(b))
            : [];

        conversionDestItems.forEach(([accountName]) => {
            nodes.push({ id: `To Roth: ${accountName}`, color: 'var(--color-chart-money)', label: `To ${accountName}` });
        });

        // Reinvested income destinations (e.g., "Reinvested: Savings")
        // This shows interest flowing back into the savings account
        reinvestedIncomeItems.forEach(item => {
            nodes.push({ id: `Reinvested: ${item.accountName}`, color: 'var(--c-cat-cyan-soft)', label: `→ ${item.accountName}` });
        });

        // Remaining (always last)
        if (remaining > 1) {
            nodes.push({ id: 'Remaining', color: 'var(--color-chart-money)', label: 'Remaining' });
        }

        // =================================================================
        // LINKS - Same order as nodes for visual consistency
        // =================================================================

        // --- Links TO Gross Pay (income sources) ---
        workIncomeItems.forEach(item => {
            links.push({ source: item.name, target: 'Gross Pay', value: item.amount });
        });

        if (totalEmployerMatch >= MIN_DISPLAY_THRESHOLD) {
            links.push({ source: 'Employer Contributions', target: 'Gross Pay', value: totalEmployerMatch });
        }

        otherIncomeItems.forEach(item => {
            links.push({ source: item.name, target: 'Gross Pay', value: item.amount });
        });

        // Reinvested income flows through Gross Pay (for tax visualization)
        reinvestedIncomeItems.forEach(item => {
            links.push({ source: item.name, target: 'Gross Pay', value: item.amount });
        });

        withdrawalItems.forEach(([accountName, amount]) => {
            links.push({ source: `Withdraw: ${accountName}`, target: 'Gross Pay', value: amount });
        });

        // Roth conversion sources flow into Gross Pay (taxable income)
        conversionSourceItems.forEach(([accountName, amount]) => {
            links.push({ source: `Convert: ${accountName}`, target: 'Gross Pay', value: amount });
        });

        // --- Links FROM Gross Pay (deductions) ---
        if (totalTradSavings >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Gross Pay', target: '401k Savings', value: totalTradSavings });
        if (totalInsurance >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Gross Pay', target: 'Benefits', value: totalInsurance });
        if (totalTaxes >= MIN_DISPLAY_THRESHOLD) {
            links.push({ source: 'Gross Pay', target: 'Taxes', value: totalTaxes });
            if (taxes.fed >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'Federal Tax', value: taxes.fed });
            if (taxes.state >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'State Tax', value: taxes.state });
            if (taxes.fica >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'FICA Tax', value: taxes.fica });
            if ((taxes.capitalGains || 0) >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'Cap Gains Tax', value: taxes.capitalGains! });
            if ((taxes.niit || 0) >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'NIIT', value: taxes.niit! });
            if ((taxes.irmaa || 0) >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'IRMAA', value: taxes.irmaa! });
            if ((taxes.aca || 0) >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'ACA Subsidy Loss', value: taxes.aca! });
            if ((taxes.withdrawalOrdinaryTax || 0) >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Taxes', target: 'Withdrawal Tax', value: taxes.withdrawalOrdinaryTax! });
        }

        // Always show Gross Pay → Net Pay if there's any positive net pay
        if (netPayFlow >= MIN_DISPLAY_THRESHOLD) {
            links.push({ source: 'Gross Pay', target: 'Net Pay', value: netPayFlow });
        }

        // Deficit flows into Net Pay to cover expenses that can't be paid from income
        if (remaining < -1) {
            links.push({ source: 'Deficit', target: 'Net Pay', value: Math.abs(remaining) });
        }

        // --- Links FROM Net Pay (outflows) ---
        // Show outflows if there's any cash going through Net Pay (from income or deficit coverage)
        const hasNetPayFlow = netPayFlow >= MIN_DISPLAY_THRESHOLD || remaining < -1;
        if (hasNetPayFlow) {
            if (totalRothSavings >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Net Pay', target: 'Roth Savings', value: totalRothSavings });
            if (totalPrincipal >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Net Pay', target: 'Principal Payments', value: totalPrincipal });
            if (mortgageInterestAndEscrow >= MIN_DISPLAY_THRESHOLD) links.push({ source: 'Net Pay', target: 'Mortgage Payments', value: mortgageInterestAndEscrow });

            bucketItems.forEach(item => {
                links.push({ source: 'Net Pay', target: item.nodeId, value: item.amount });
            });

            sortedExpenseCategories.forEach(cat => {
                const total = expenseCatTotals.get(cat) || 0;
                if (total >= MIN_DISPLAY_THRESHOLD) {
                    links.push({ source: 'Net Pay', target: cat, value: total });
                }
            });

            if (remaining > 1) {
                links.push({ source: 'Net Pay', target: 'Remaining', value: remaining });
            }

            // Roth conversion destinations: Net Pay flows to Roth accounts
            // Use scaled amount so links match the full rothConversionAmount
            conversionDestItems.forEach(([accountName, amount]) => {
                links.push({ source: 'Net Pay', target: `To Roth: ${accountName}`, value: amount * conversionScale });
            });

            // Reinvested income flows from Net Pay back to the savings account.
            // Use NET (gross − sell-at-source withholding): the gross entered via
            // Gross Pay and the withheld slice was sold off at vest (it does not land
            // in the account), so only the net reinvests. Routing gross here would make
            // Net Pay's outflow exceed its inflow by the withholding (the RSU vest
            // imbalance). See the `totalReinvested` note above for where the gap goes.
            reinvestedIncomeItems.forEach(item => {
                links.push({ source: 'Net Pay', target: `Reinvested: ${item.accountName}`, value: item.net });
            });
        }

        const uniqueNodes = Array.from(new Map(nodes.map(node => [node.id, node])).values())
            .filter(node => links.some(l => l.target === node.id || l.source === node.id));

        const validLinks = links.filter(l => l.value >= MIN_DISPLAY_THRESHOLD);

        // Validation: surface invalid links so the error boundary shows the user something
        // actionable instead of Nivo crashing on missing source/target.
        const nodeIds = new Set(uniqueNodes.map(n => n.id));
        const invalidLinks = validLinks.filter(l => !nodeIds.has(l.source) || !nodeIds.has(l.target));
        if (invalidLinks.length > 0) {
            throw new Error(`Found ${invalidLinks.length} invalid Sankey link(s) (missing source or target node).`);
        }

        if (uniqueNodes.length === 0 || validLinks.length === 0) {
            return { data: { nodes: [], links: [] }, error: null, debugData: null, imbalances: [], provenance: {} };
        }

        // --- Provenance: node id → drill-down breakdown ---
        // Powers the click-to-drill detail panel. Built from the same per-source
        // values used above (cashflowDetail when available), so the breakdown
        // never drifts from the rendered flows. Only composite nodes with real
        // sub-structure get an entry; leaf source nodes are omitted.
        //
        // Each entry carries a `direction` so the panel can label what it's
        // showing — Sources (flows in), Destinations (flows out), or Breakdown
        // (a same-column sub-split) — instead of silently flipping between them.
        // Rows are reconciled (see reconcileProvenanceItems) so sub-threshold
        // contributors roll into an explicit "Other" row.
        //
        // A node is only drillable when it has at least one real (non-remainder)
        // row: a node whose total just clears the display threshold but whose
        // every constituent is sub-threshold would otherwise become "clickable"
        // with nothing but an "Other 100%" row, which isn't a useful breakdown.
        const provenance: SankeyProvenance = {};
        const addProvenance = (
            nodeId: string,
            direction: SankeyProvenanceDirection,
            items: SankeyProvenanceItem[],
        ) => {
            const reconciled = reconcileProvenanceItems(items);
            if (reconciled.some(i => !i.isRemainder)) {
                provenance[nodeId] = { direction, items: reconciled };
            }
        };

        // Gross Pay: every income line that feeds it (work, other, reinvested,
        // withdrawals, conversion sources, plus the aggregated employer match).
        const grossPayItems: SankeyProvenanceItem[] = [
            ...workIncomeItems.map(i => ({ label: i.name, value: i.amount })),
            ...(totalEmployerMatch >= MIN_DISPLAY_THRESHOLD
                ? [{ label: 'Employer Contrib.', value: totalEmployerMatch }]
                : []),
            ...otherIncomeItems.map(i => ({ label: i.name, value: i.amount })),
            ...reinvestedIncomeItems.map(i => ({ label: i.name, value: i.amount })),
            ...withdrawalItems.map(([name, amount]) => ({ label: `From ${name}`, value: amount })),
            ...conversionSourceItems.map(([name, amount]) => ({ label: `Convert ${name}`, value: amount })),
        ];
        addProvenance('Gross Pay', 'sources', grossPayItems);

        // Taxes: the individual tax components that the chart also breaks out as
        // child nodes. Listed here so a single click on the umbrella node shows
        // the full split.
        addProvenance('Taxes', 'breakdown', [
            { label: 'Federal Tax', value: taxes.fed },
            { label: 'State Tax', value: taxes.state },
            { label: 'FICA Tax', value: taxes.fica },
            { label: 'Cap Gains Tax', value: taxes.capitalGains || 0 },
            { label: 'NIIT', value: taxes.niit || 0 },
            { label: 'IRMAA', value: taxes.irmaa || 0 },
            { label: 'ACA Subsidy Loss', value: taxes.aca || 0 },
            { label: 'Withdrawal Tax', value: taxes.withdrawalOrdinaryTax || 0 },
        ]);

        // 401k / Roth / Employer Contributions split employee vs. employer money.
        addProvenance('401k Savings', 'breakdown', [
            { label: 'Your contributions', value: employee401k },
            { label: 'Employer match', value: totalEmployerMatchForTrad },
        ]);
        addProvenance('Roth Savings', 'breakdown', [
            { label: 'Your contributions', value: employeeRoth },
            { label: 'Employer match', value: totalEmployerMatchForRoth },
        ]);
        addProvenance('Employer Contributions', 'breakdown', [
            { label: 'Pre-tax match', value: totalEmployerMatchForTrad },
            { label: 'Roth match', value: totalEmployerMatchForRoth },
        ]);

        // Net Pay: where the take-home cash goes (savings, expenses, remaining).
        const netPayItems: SankeyProvenanceItem[] = [
            { label: 'Roth Savings', value: totalRothSavings },
            { label: 'Principal Payments', value: totalPrincipal },
            { label: 'Mortgage Payments', value: mortgageInterestAndEscrow },
            ...bucketItems.map(item => ({ label: item.label, value: item.amount })), // [3] use the "Pay Down:" label, not the bare name
            ...sortedExpenseCategories.map(cat => ({ label: cat, value: expenseCatTotals.get(cat) || 0 })),
            ...(remaining > 1 ? [{ label: 'Remaining', value: remaining }] : []),
            ...conversionDestItems.map(([name, amount]) => ({ label: `To ${name}`, value: amount * conversionScale })),
            ...reinvestedIncomeItems.map(item => ({ label: `→ ${item.accountName}`, value: item.net })),
        ];
        addProvenance('Net Pay', 'destinations', netPayItems);

        // Only keep provenance for nodes that actually rendered.
        for (const id of Object.keys(provenance)) {
            if (!nodeIds.has(id)) delete provenance[id];
        }

        const result = { nodes: uniqueNodes, links: validLinks };

        // Validate intermediate nodes (nodes with BOTH inflows AND outflows).
        // Source nodes only have outflows, sink nodes only have inflows.
        // Intermediate nodes should have inflows ≈ outflows (within $1 tolerance).
        const imbalances: SankeyImbalance[] = [];
        for (const node of uniqueNodes) {
            const nodeName = node.id;
            const inflows = validLinks
                .filter(l => l.target === nodeName)
                .reduce((sum, l) => sum + l.value, 0);
            const outflows = validLinks
                .filter(l => l.source === nodeName)
                .reduce((sum, l) => sum + l.value, 0);
            if (inflows > 0 && outflows > 0) {
                const difference = Math.abs(inflows - outflows);
                if (difference > 1) {
                    imbalances.push({ nodeName, inflows, outflows, difference });
                }
            }
        }

        return { data: result, error: null, debugData: result, imbalances, provenance };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
            data: { nodes: [], links: [] },
            error: message,
            debugData: null,
            imbalances: [],
            provenance: {},
        };
    }
}
