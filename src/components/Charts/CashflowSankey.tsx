import { useMemo, useContext, useCallback, Component, ReactNode, useState, useEffect, useRef } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { WorkIncome, AnyIncome, PassiveIncome } from '../Objects/Income/models';
import { MortgageExpense, AnyExpense, CLASS_TO_CATEGORY } from '../Objects/Expense/models';
import { AnyAccount, InvestedAccount } from '../Objects/Accounts/models';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { CashflowDetail } from '../../services/simulation/types';

// Error Boundary to catch Nivo rendering errors
class SankeyErrorBoundary extends Component<
    { children: ReactNode; height: number; resetKey?: string },
    { hasError: boolean; error: any }
> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true, error };
    }

    componentDidUpdate(prevProps: { resetKey?: string }) {
        // Reset error state when resetKey changes (new data)
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null });
        }
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error('Sankey rendering error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{ height: `${this.props.height}px` }}
                    className="flex items-center justify-center bg-red-900/10 border border-red-700 rounded-lg"
                >
                    <div className="text-center p-6">
                        <div className="text-red-400 text-lg font-bold mb-2">Rendering Error</div>
                        <div className="text-gray-300 text-sm mb-2">
                            The chart failed to render. This is likely a data structure issue.
                        </div>
                        <details className="text-left">
                            <summary className="cursor-pointer text-gray-400 text-xs hover:text-gray-200">
                                Error Details
                            </summary>
                            <pre className="mt-2 text-xs text-red-400 overflow-auto max-h-48 bg-gray-900 p-2 rounded">
                                {this.state.error?.toString()}
                            </pre>
                        </details>
                    </div>
                </div>
            );
        }

        return (
            <div style={{ height: `${this.props.height}px` }}>
                {this.props.children}
            </div>
        );
    }
}

// --- Types ---
interface CashflowSankeyProps {
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    year: number;
    taxes: {
        fed: number;
        state: number;
        fica: number;
        capitalGains?: number; // From brokerage/ESPP withdrawals
        withdrawalOrdinaryTax?: number; // From Roth earnings (5-year rule), Traditional, HSA non-medical
        niit?: number; // Net Investment Income Tax (3.8% on net investment income)
    };
    bucketAllocations?: Record<string, number>;
    accounts?: AnyAccount[];
    withdrawals?: Record<string, number>; // Account name -> withdrawal amount
    rothConversion?: {
        amount: number;
        taxCost: number;
        fromAccounts: Record<string, number>;
        toAccounts: Record<string, number>;
    };
    livingExpenses?: number; // Actual living expenses from simulation (after spending cap adjustments)
    /**
     * Per-year breakdown produced by the simulation engine. When provided, the
     * chart sources income lines, contribution splits, mortgage breakdown, and
     * expense categories from this object instead of re-iterating the raw
     * incomes/expenses (which can drift from sim values).
     */
    cashflowDetail?: CashflowDetail;
    height?: number; // Optional height prop
    extraLeftPadding?: number; // Extra left margin for longer labels
    extraRightPadding?: number; // Extra right margin for longer labels
    onBalanceCheck?: (imbalances: SankeyImbalance[]) => void; // Callback to report node imbalances
}

// Type for reporting Sankey node imbalances
export interface SankeyImbalance {
    nodeName: string;
    inflows: number;
    outflows: number;
    difference: number;
}

// Minimum threshold for including a value in the chart (avoids $0 nodes)
const MIN_DISPLAY_THRESHOLD = 0.005;

// --- Component ---
export const CashflowSankey = ({
    incomes,
    expenses,
    year,
    taxes,
    bucketAllocations = {},
    accounts = [],
    withdrawals = {},
    rothConversion,
    livingExpenses: providedLivingExpenses,
    cashflowDetail,
    height = 300,
    extraLeftPadding = 0,
    extraRightPadding = 0,
    onBalanceCheck
}: CashflowSankeyProps) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;

    // Memoized currency formatter that respects user settings
    const currencyFormatter = useCallback((value: number) => {
        // For very small values that would round to $0, show a more informative label
        if (value > 0.005 && value < 0.5) {
            return '<$1';
        }
        return formatCompactCurrency(value, { forceExact });
    }, [forceExact]);

    // 1. Logic Block (The "Util" part)
    // Refactored to return { data, error, debugData } directly to avoid infinite loops
    const { data, error, debugData, imbalances } = useMemo(() => {
        try {
            const nodes: any[] = [];
            const links: any[] = [];

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
            const totalTaxes = taxes.fed + taxes.state + taxes.fica + (taxes.capitalGains || 0) + (taxes.withdrawalOrdinaryTax || 0) + (taxes.niit || 0);
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
            const totalExpenses = providedLivingExpenses !== undefined
                ? providedLivingExpenses - totalMortgagePayment  // Mortgage is shown as separate nodes
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
            // workIncomeItems / otherIncomeItems / reinvestedIncomeItems were populated above.
            // Sort here for stable visual ordering.
            workIncomeItems.sort((a, b) => a.name.localeCompare(b.name));
            otherIncomeItems.sort((a, b) => a.name.localeCompare(b.name));

            // Add work income nodes first
            workIncomeItems.forEach(item => {
                nodes.push({ id: item.name, color: '#10b981', label: item.name });
            });

            // Employer contributions (if any)
            if (totalEmployerMatch >= MIN_DISPLAY_THRESHOLD) {
                nodes.push({ id: 'Employer Contributions', color: '#10b981', label: 'Employer Contrib.' });
            }

            // Other income (passive, interest, etc.)
            otherIncomeItems.forEach(item => {
                nodes.push({ id: item.name, color: '#10b981', label: item.name });
            });

            // Reinvested income sources (e.g., "Savings Interest")
            // These flow through Gross Pay for tax purposes but go directly to savings
            reinvestedIncomeItems.forEach(item => {
                nodes.push({ id: item.name, color: '#06b6d4', label: item.name }); // Cyan color for reinvested
            });

            // Withdrawals (sorted by account name for stability). Use net amounts
            // (gross - LTCG-from-gross-up share) so per-account inflow links to
            // Gross Pay sum to the same gross-pay total used in the waterfall math.
            const withdrawalItems = Object.entries(withdrawalsNet)
                .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
                .sort(([a], [b]) => a.localeCompare(b));

            withdrawalItems.forEach(([accountName]) => {
                nodes.push({ id: `Withdraw: ${accountName}`, color: '#8b5cf6', label: `From ${accountName}` });
            });

            // Roth conversion sources (Traditional accounts being converted - flows into Gross Pay)
            const conversionSourceItems = rothConversion
                ? Object.entries(rothConversion.fromAccounts)
                    .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
                    .sort(([a], [b]) => a.localeCompare(b))
                : [];

            conversionSourceItems.forEach(([accountName]) => {
                nodes.push({ id: `Convert: ${accountName}`, color: '#ec4899', label: `Convert ${accountName}` });
            });

            // Deficit node (if needed, flows into Net Pay to cover expenses)
            if (remaining < -1) {
                nodes.push({ id: 'Deficit', color: '#ef4444', label: 'Deficit' });
            }

            // --- Column 2: Gross Pay ---
            nodes.push({ id: 'Gross Pay', color: '#3b82f6', label: 'Gross Pay' });

            // --- Column 3: Deductions from Gross Pay (consistent order) ---
            if (totalTradSavings >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: '401k Savings', color: '#10b981', label: '401k Savings' });
            if (totalInsurance >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Benefits', color: '#6366f1', label: 'Benefits' });
            if (totalTaxes >= MIN_DISPLAY_THRESHOLD) {
                nodes.push({ id: 'Taxes', color: '#f59e0b', label: 'Taxes' });
                if (taxes.fed >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Federal Tax', color: '#f59e0b', label: 'Federal Tax' });
                if (taxes.state >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'State Tax', color: '#fbbf24', label: 'State Tax' });
                if (taxes.fica >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'FICA Tax', color: '#d97706', label: 'FICA Tax' });
                if ((taxes.capitalGains || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Cap Gains Tax', color: '#ca8a04', label: 'Cap Gains Tax' });
                if ((taxes.niit || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'NIIT', color: '#b45309', label: 'NIIT' });
                if ((taxes.withdrawalOrdinaryTax || 0) >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Withdrawal Tax', color: '#a855f7', label: 'Withdrawal Tax' });
            }

            // --- Column 4: Net Pay ---
            nodes.push({ id: 'Net Pay', color: '#3b82f6', label: 'Net Pay' });

            // --- Column 5: Outflows from Net Pay ---
            // Order: Savings first (stable), then expenses (may change), then remaining

            // Post-tax savings (Roth)
            if (totalRothSavings >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Roth Savings', color: '#10b981', label: 'Roth Savings' });

            // Mortgage (principal is savings, interest is expense)
            if (totalPrincipal >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Principal Payments', color: '#10b981', label: 'Principal Payments' });
            if (mortgageInterestAndEscrow >= MIN_DISPLAY_THRESHOLD) nodes.push({ id: 'Mortgage Payments', color: '#ef4444', label: 'Mortgage Payments' });

            // Priority bucket savings (sorted for stability)
            const bucketItems = Object.entries(bucketAllocations)
                .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
                .map(([accountId, amount]) => {
                    const account = accounts.find(a => a.id === accountId);
                    return { id: accountId, name: account ? account.name : 'Savings', amount };
                })
                .sort((a, b) => a.name.localeCompare(b.name));

            bucketItems.forEach(item => {
                nodes.push({ id: `Save: ${item.name}`, color: '#10b981', label: item.name });
            });

            // Expenses (sorted by category for stability - added AFTER savings)
            // Filter out categories below threshold
            const sortedExpenseCategories = Array.from(expenseCatTotals.entries())
                .filter(([_, amount]) => amount >= MIN_DISPLAY_THRESHOLD)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cat]) => cat);
            sortedExpenseCategories.forEach(cat => {
                nodes.push({ id: cat, color: '#ef4444', label: cat });
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
                nodes.push({ id: `To Roth: ${accountName}`, color: '#10b981', label: `To ${accountName}` });
            });

            // Reinvested income destinations (e.g., "Reinvested: Savings")
            // This shows interest flowing back into the savings account
            reinvestedIncomeItems.forEach(item => {
                nodes.push({ id: `Reinvested: ${item.accountName}`, color: '#06b6d4', label: `→ ${item.accountName}` }); // Cyan color
            });

            // Remaining (always last)
            if (remaining > 1) {
                nodes.push({ id: 'Remaining', color: '#10b981', label: 'Remaining' });
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

            // Validation: Check for issues that could cause Nivo to crash
            const nodeIds = new Set(uniqueNodes.map(n => n.id));
            const invalidLinks = validLinks.filter(l => !nodeIds.has(l.source) || !nodeIds.has(l.target));

            if (invalidLinks.length > 0) {
                console.error('Invalid links found (missing source or target nodes):', invalidLinks);
                throw new Error(`Found ${invalidLinks.length} invalid link(s). Check console for details.`);
            }

            // Check for circular dependencies or other issues
            if (uniqueNodes.length === 0) {
                console.warn('No nodes generated for Sankey chart');
                return { data: { nodes: [], links: [] }, error: null, debugData: null, imbalances: [] };
            }

            if (validLinks.length === 0) {
                console.warn('No links generated for Sankey chart');
                return { data: { nodes: [], links: [] }, error: null, debugData: null, imbalances: [] };
            }

            const result = { nodes: uniqueNodes, links: validLinks };

            // Validate intermediate nodes (nodes with BOTH inflows AND outflows)
            // Source nodes only have outflows, sink nodes only have inflows
            // Intermediate nodes should have inflows = outflows (within $1 tolerance)
            const imbalances: SankeyImbalance[] = [];

            for (const node of uniqueNodes) {
                const nodeName = node.id;

                const inflows = validLinks
                    .filter(l => l.target === nodeName)
                    .reduce((sum, l) => sum + l.value, 0);
                const outflows = validLinks
                    .filter(l => l.source === nodeName)
                    .reduce((sum, l) => sum + l.value, 0);

                // Only check nodes that have BOTH inflows and outflows (intermediate nodes)
                // Source nodes (inflows = 0) and sink nodes (outflows = 0) are excluded
                if (inflows > 0 && outflows > 0) {
                    const difference = Math.abs(inflows - outflows);
                    if (difference > 1) {
                        imbalances.push({ nodeName, inflows, outflows, difference });
                    }
                }
            }

            return { data: result, error: null, debugData: result, imbalances };

        } catch (err: any) {
            console.error('Error generating Sankey data:', err);
            return {
                data: { nodes: [], links: [] },
                error: err.message || 'Unknown error',
                debugData: null,
                imbalances: []
            };
        }
    }, [incomes, expenses, year, taxes, bucketAllocations, accounts, withdrawals, rothConversion, cashflowDetail, providedLivingExpenses]);

    // Call balance check callback when imbalances change
    useEffect(() => {
        if (onBalanceCheck) {
            onBalanceCheck(imbalances);
        }
    }, [imbalances, onBalanceCheck]);

    // 2. Render Block (The "Renderer" part)

    // Show error state
    if (error) {
        return (
            <div style={{ height: `${height}px` }} className="flex items-center justify-center bg-red-900/10 border border-red-700 rounded-lg">
                <div className="text-center p-6 max-w-lg">
                    <div className="text-red-400 text-lg font-bold mb-2">Chart Error</div>
                    <div className="text-gray-300 text-sm mb-4">{error}</div>
                    {debugData && (
                        <details className="text-left">
                            <summary className="cursor-pointer text-gray-400 text-xs hover:text-gray-200">Debug Info</summary>
                            <pre className="mt-2 text-xs text-gray-400 overflow-auto max-h-48 bg-gray-900 p-2 rounded">
                                {JSON.stringify(debugData, null, 2)}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
        );
    }

    // Show empty state
    if (!data.nodes || data.nodes.length === 0) {
        return (
            <div style={{ height: `${height}px` }} className="flex items-center justify-center text-gray-400">
                No data available for chart
            </div>
        );
    }

    // Responsive margin detection
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

    // Responsive margins: smaller on narrow screens
    const isNarrow = containerWidth < 500;
    const margins = isNarrow
        ? { top: 10, right: 80 + extraRightPadding, bottom: 10, left: 80 + extraLeftPadding }
        : { top: 20, right: 150 + extraRightPadding, bottom: 20, left: 150 + extraLeftPadding };

    // Generate a reset key from the data to force error boundary reset when data changes
    const resetKey = `${incomes.length}-${expenses.length}-${year}-${Object.keys(withdrawals).length}`;

    return (
        <SankeyErrorBoundary height={height} resetKey={resetKey}>
            <div ref={containerRef} style={{ height: `${height}px` }}>
                <ResponsiveSankey
                    data={data}
                    margin={margins}
                    align="justify"
                    colors={(node: any) => node.color}
                    nodeOpacity={1}
                    nodeThickness={isNarrow ? 12 : 15}
                    nodeSpacing={isNarrow ? 8 : 12}
                    nodeBorderRadius={3}
                    enableLinkGradient={true}
                    linkBlendMode="normal"
                    linkOpacity={0.15}
                    labelTextColor="#e5e7eb"
                    valueFormat={currencyFormatter}
                    label={(node: any) => node.label}
                    labelPosition="outside"
                    labelPadding={isNarrow ? 8 : 16}
                    sort="input"
                    nodeTooltip={({ node }) => (
                        <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 shadow-2xl max-w-87.5">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
                                <span className="font-bold text-gray-100 text-sm truncate">{node.label}</span>
                            </div>
                            <div className="text-2xl font-mono text-green-400 font-medium">
                                {node.formattedValue}
                            </div>
                        </div>
                    )}
                    linkTooltip={({ link }) => (
                        <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 shadow-2xl max-w-87.5">
                            <div className="flex items-center gap-2 mb-2 text-xs text-gray-400 uppercase tracking-wider font-semibold">
                                <span className="truncate">{link.source.label}</span>
                                <span className="text-gray-400 shrink-0">&rarr;</span>
                                <span className="truncate">{link.target.label}</span>
                            </div>
                            <div className="text-xl font-mono text-green-400 font-medium">
                                {link.formattedValue}
                            </div>
                        </div>
                    )}
                    theme={{
                        tooltip: { container: { background: '#111827', color: '#fff', borderRadius: '8px', zIndex: 9999 } },
                        labels: { text: { fontSize: 11, fontWeight: 600, fill: '#e5e7eb' } }
                    }}
                />
            </div>
        </SankeyErrorBoundary>
    );
};