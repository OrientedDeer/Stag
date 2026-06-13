/**
 * Pure data-transform for the Cashflow Sankey chart.
 *
 * Builds the Nivo-friendly { nodes, links } graph plus diagnostic info
 * (imbalances, debug data, error string). Lifted out of CashflowSankey.tsx
 * so the chart component can stay focused on rendering.
 */
import { WorkIncome, AnyIncome, PassiveIncome } from '../Objects/Income/models';
import { MortgageExpense, AnyExpense, CLASS_TO_CATEGORY } from '../Objects/Expense/models';
import { AnyAccount, InvestedAccount } from '../Objects/Accounts/models';
import { CashflowDetail } from '../../services/simulation/types';

// Minimum threshold for including a value in the chart (avoids $0 nodes)
const MIN_DISPLAY_THRESHOLD = 0.005;

export interface SankeyImbalance {
    nodeName: string;
    inflows: number;
    outflows: number;
    difference: number;
}

export interface SankeyTaxBreakdown {
    fed: number;
    state: number;
    fica: number;
    capitalGains?: number;
    withdrawalOrdinaryTax?: number;
    niit?: number;
    irmaa?: number;
}

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

interface SankeyNode {
    id: string;
    color: string;
    label: string;
}

interface SankeyLink {
    source: string;
    target: string;
    value: number;
}

export interface BuildCashflowSankeyResult {
    data: { nodes: SankeyNode[]; links: SankeyLink[] };
    error: string | null;
    debugData: { nodes: SankeyNode[]; links: SankeyLink[] } | null;
    imbalances: SankeyImbalance[];
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
        const reinvestedIncomeItems: Array<{ name: string; amount: number; accountName: string }> = [];

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
                    reinvestedIncomeItems.push({
                        name: inc.name,
                        amount,
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
        const totalReinvested = reinvestedIncomeItems.reduce((s, i) => s + i.amount, 0);

        const mortgageInterestAndEscrow = totalMortgagePayment - totalPrincipal;
        const totalTaxes = taxes.fed + taxes.state + taxes.fica + (taxes.capitalGains || 0) + (taxes.withdrawalOrdinaryTax || 0) + (taxes.niit || 0) + (taxes.irmaa || 0);
        const totalBucketSavings = Object.values(bucketAllocations).reduce((a, b) => a + b, 0);

        // Brokerage LTCG paid out of the gross-up never lands as user cash — the
        // planner routes it directly to the government. Subtract from brokerage
        // withdrawal entries so the cash inflow shown to the user is the net
        // they actually received. (The LTCG tax outflow in the Taxes node still
        // shows the auth LTCG separately for visibility.) When the planner uses
        // a 0% LTCG rate, brokerageLTCGFromGross is 0 and this is a no-op.
        const brokerageLTCGFromGross = cashflowDetail?.brokerageLTCGFromGross ?? 0;
        const brokerageNames = new Set(
            accounts
                .filter(acc => acc instanceof InvestedAccount && acc.taxType === 'Brokerage')
                .map(acc => acc.name)
        );
        const brokerageGrossTotal = Object.entries(withdrawals)
            .filter(([name]) => brokerageNames.has(name))
            .reduce((sum, [, amt]) => sum + amt, 0);
        const withdrawalsNet: Record<string, number> = {};
        for (const [name, gross] of Object.entries(withdrawals)) {
            if (brokerageNames.has(name) && brokerageGrossTotal > 0) {
                const share = gross / brokerageGrossTotal;
                withdrawalsNet[name] = gross - brokerageLTCGFromGross * share;
            } else {
                withdrawalsNet[name] = gross;
            }
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
            .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
            .sort(([a], [b]) => a.localeCompare(b));

        withdrawalItems.forEach(([accountName]) => {
            nodes.push({ id: `Withdraw: ${accountName}`, color: 'var(--c-cat-purple-soft)', label: `From ${accountName}` });
        });

        // Roth conversion sources (Traditional accounts being converted - flows into Gross Pay)
        const conversionSourceItems = rothConversion
            ? Object.entries(rothConversion.fromAccounts)
                .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
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

        // Priority bucket savings (sorted for stability)
        const bucketItems = Object.entries(bucketAllocations)
            .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
            .map(([accountId, amount]) => {
                const account = accounts.find(a => a.id === accountId);
                return { id: accountId, name: account ? account.name : 'Savings', amount };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        bucketItems.forEach(item => {
            nodes.push({ id: `Save: ${item.name}`, color: 'var(--color-chart-money)', label: item.name });
        });

        // Expenses (sorted by category for stability - added AFTER savings)
        const sortedExpenseCategories = Array.from(expenseCatTotals.entries())
            .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
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
                .filter(([_, amount]) => amount * conversionScale >= MIN_DISPLAY_THRESHOLD)
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
                links.push({ source: 'Net Pay', target: `Save: ${item.name}`, value: item.amount });
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

            // Reinvested income flows from Net Pay back to the savings account
            // This shows interest being reinvested rather than appearing as "Remaining"
            reinvestedIncomeItems.forEach(item => {
                links.push({ source: 'Net Pay', target: `Reinvested: ${item.accountName}`, value: item.amount });
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
            return { data: { nodes: [], links: [] }, error: null, debugData: null, imbalances: [] };
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

        return { data: result, error: null, debugData: result, imbalances };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
            data: { nodes: [], links: [] },
            error: message,
            debugData: null,
            imbalances: [],
        };
    }
}
