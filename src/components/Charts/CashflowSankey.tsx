import { useMemo, Component, ReactNode } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { WorkIncome } from '../Objects/Income/models';
import { MortgageExpense, CLASS_TO_CATEGORY } from '../Objects/Expense/models';
import { AnyAccount } from '../Objects/Accounts/models';

// Error Boundary to catch Nivo rendering errors
class SankeyErrorBoundary extends Component<
    { children: ReactNode; height: number },
    { hasError: boolean; error: any }
> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true, error };
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
                        <div className="text-red-400 text-lg font-bold mb-2">⚠️ Rendering Error</div>
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

        return this.props.children;
    }
}

// --- Types ---
interface CashflowSankeyProps {
    incomes: any[];
    expenses: any[];
    year: number;
    taxes: {
        fed: number;
        state: number;
        fica: number;
    };
    bucketAllocations?: Record<string, number>;
    accounts?: AnyAccount[];
    height?: number; // Optional height prop
}

// --- Helper: Currency Formatter ---
const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

// --- Component ---
export const CashflowSankey = ({
    incomes,
    expenses,
    year,
    taxes,
    bucketAllocations = {},
    accounts = [],
    height = 300
}: CashflowSankeyProps) => {
    // 1. Logic Block (The "Util" part)
    // Refactored to return { data, error, debugData } directly to avoid infinite loops
    const { data, error, debugData } = useMemo(() => {
        try {
            const nodes: any[] = [];
            const links: any[] = [];

            // --- Aggregation ---
            let employee401k = 0;
            let employeeRoth = 0;
            let totalInsurance = 0;
            
            let totalEmployerMatch = 0;
            let totalEmployerMatchForRoth = 0;
            let totalEmployerMatchForTrad = 0;

            let totalPrincipal = 0;
            let totalMortgagePayment = 0;
            let grossPayCalculated = 0;

            incomes.forEach(inc => {
                const amount = inc.getProratedAnnual ? inc.getProratedAnnual(inc.amount, year) : 0;
                if (amount > 0) grossPayCalculated += amount;

                if (inc instanceof WorkIncome) {
                    let empMatch = 0;
                    employee401k += inc.getProratedAnnual(inc.preTax401k, year);
                    totalInsurance += inc.getProratedAnnual(inc.insurance, year);
                    employeeRoth += inc.getProratedAnnual(inc.roth401k, year);
                    
                    // @ts-ignore
                    if (inc.employerMatch != null) {
                        empMatch = inc.getProratedAnnual(inc.employerMatch, year);
                        totalEmployerMatch += empMatch;
                    }

                    // @ts-ignore
                    if (inc.matchIsRoth || inc.taxType === 'Roth 401k') {
                        totalEmployerMatchForRoth += empMatch;
                    } else {
                        totalEmployerMatchForTrad += empMatch;
                    }
                }
            });

            expenses.forEach(exp => {
                if (exp instanceof MortgageExpense) {
                    const amort = exp.calculateAnnualAmortization(year);
                    totalPrincipal += amort.totalPrincipal;
                    totalMortgagePayment += amort.totalPayment;
                }
            });

            const mortgageInterestAndEscrow = totalMortgagePayment - totalPrincipal;
            const totalTaxes = taxes.fed + taxes.state + taxes.fica;
            const totalBucketSavings = Object.values(bucketAllocations).reduce((a, b) => a + b, 0);

            // --- Waterfall Math ---
            const grossPayNodeValue = grossPayCalculated + totalEmployerMatch;
            const totalTradSavings = employee401k + totalEmployerMatchForTrad;
            const totalRothSavings = employeeRoth + totalEmployerMatchForRoth;

            const netPayFlow = grossPayNodeValue 
                - totalTradSavings
                - totalInsurance
                - totalTaxes;
                // Note: Roth Match flows through Net Pay

            // --- Nodes ---
            nodes.push({ id: 'Gross Pay', color: '#3b82f6', label: 'Gross Pay' });
            if (totalEmployerMatch > 0) nodes.push({ id: 'Employer Contributions', color: '#10b981', label: 'Employer Contrib.' });

            if (totalTradSavings > 0) nodes.push({ id: '401k Savings', color: '#10b981', label: '401k Savings' });
            if (totalInsurance > 0) nodes.push({ id: 'Benefits', color: '#6366f1', label: 'Benefits' });
            nodes.push({ id: 'Federal Tax', color: '#f59e0b', label: 'Federal Tax' });
            nodes.push({ id: 'State Tax', color: '#fbbf24', label: 'State Tax' });
            nodes.push({ id: 'FICA Tax', color: '#d97706', label: 'FICA Tax' });

            nodes.push({ id: 'Net Pay', color: '#3b82f6', label: 'Net Pay' });

            if (totalRothSavings > 0) nodes.push({ id: 'Roth Savings', color: '#10b981', label: 'Roth Savings' });
            if (totalPrincipal > 0) nodes.push({ id: 'Principal Payments', color: '#10b981', label: 'Principal Payments' });
            if (mortgageInterestAndEscrow > 0) nodes.push({ id: 'Mortgage Payments', color: '#ef4444', label: 'Mortgage Payments' });

            const expenseCatTotals = new Map<string, number>();
            expenses.forEach(exp => {
                const amount = exp.getAnnualAmount(year);
                if (amount <= 0 || exp instanceof MortgageExpense) return;
                const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
                expenseCatTotals.set(category, (expenseCatTotals.get(category) || 0) + amount);
            });

            expenseCatTotals.forEach((_, cat) => nodes.push({ id: cat, color: '#ef4444', label: cat }));

            Object.entries(bucketAllocations).forEach(([accountId, amount]) => {
                if (amount > 0) {
                    const account = accounts.find(a => a.id === accountId);
                    const name = account ? account.name : 'Savings';
                    nodes.push({ id: `Save: ${name}`, color: '#10b981', label: name });
                }
            });

            const totalExpenses = Array.from(expenseCatTotals.values()).reduce((a, b) => a + b, 0);
            const remaining = netPayFlow - totalRothSavings - totalExpenses - mortgageInterestAndEscrow - totalPrincipal - totalBucketSavings;

            if (remaining > 1) nodes.push({ id: 'Remaining', color: '#10b981', label: 'Remaining' });
            else if (remaining < -1) nodes.push({ id: 'Deficit', color: '#ef4444', label: 'Deficit' });

            // --- Links ---
            if (totalEmployerMatch > 0) links.push({ source: 'Employer Contributions', target: 'Gross Pay', value: totalEmployerMatch });
            
            incomes.forEach(inc => {
                const amount = inc.getProratedAnnual ? inc.getProratedAnnual(inc.amount, year) : 0;
                if (amount > 0) {
                    nodes.push({ id: inc.name, color: '#10b981', label: inc.name });
                    links.push({ source: inc.name, target: 'Gross Pay', value: amount });
                }
            });

            if (totalTradSavings > 0) links.push({ source: 'Gross Pay', target: '401k Savings', value: totalTradSavings });
            if (totalInsurance > 0) links.push({ source: 'Gross Pay', target: 'Benefits', value: totalInsurance });
            if (taxes.fed > 0) links.push({ source: 'Gross Pay', target: 'Federal Tax', value: taxes.fed });
            if (taxes.state > 0) links.push({ source: 'Gross Pay', target: 'State Tax', value: taxes.state });
            if (taxes.fica > 0) links.push({ source: 'Gross Pay', target: 'FICA Tax', value: taxes.fica });
            if (netPayFlow > 0) links.push({ source: 'Gross Pay', target: 'Net Pay', value: netPayFlow });

            if (netPayFlow > 0) {
                if (totalRothSavings > 0) links.push({ source: 'Net Pay', target: 'Roth Savings', value: totalRothSavings });
                if (totalPrincipal > 0) links.push({ source: 'Net Pay', target: 'Principal Payments', value: totalPrincipal });
                if (mortgageInterestAndEscrow > 0) links.push({ source: 'Net Pay', target: 'Mortgage Payments', value: mortgageInterestAndEscrow });

                expenseCatTotals.forEach((total, cat) => links.push({ source: 'Net Pay', target: cat, value: total }));
                
                Object.entries(bucketAllocations).forEach(([accountId, amount]) => {
                    if (amount > 0) {
                        const account = accounts.find(a => a.id === accountId);
                        const name = account ? account.name : 'Savings';
                        links.push({ source: 'Net Pay', target: `Save: ${name}`, value: amount });
                    }
                });

                if (remaining > 1) links.push({ source: 'Net Pay', target: 'Remaining', value: remaining });
                else if (remaining < -1) links.push({ source: 'Deficit', target: 'Net Pay', value: Math.abs(remaining) });
            }

            const uniqueNodes = Array.from(new Map(nodes.map(node => [node.id, node])).values())
                .filter(node => links.some(l => l.target === node.id || l.source === node.id));

            const validLinks = links.filter(l => l.value > 0);

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
                return { data: { nodes: [], links: [] }, error: null, debugData: null };
            }

            if (validLinks.length === 0) {
                console.warn('No links generated for Sankey chart');
                return { data: { nodes: [], links: [] }, error: null, debugData: null };
            }

            const result = { nodes: uniqueNodes, links: validLinks };

            // Log data for debugging
            console.log('Sankey data generated:', {
                nodeCount: uniqueNodes.length,
                linkCount: validLinks.length,
                nodes: uniqueNodes.map(n => n.id),
                links: validLinks.map(l => `${l.source} -> ${l.target} (${l.value})`)
            });

            return { data: result, error: null, debugData: result };

        } catch (err: any) {
            console.error('Error generating Sankey data:', err);
            return { 
                data: { nodes: [], links: [] }, 
                error: err.message || 'Unknown error', 
                debugData: null 
            };
        }
    }, [incomes, expenses, year, taxes, bucketAllocations, accounts]);

    // 2. Render Block (The "Renderer" part)

    // Show error state
    if (error) {
        return (
            <div style={{ height: `${height}px` }} className="flex items-center justify-center bg-red-900/10 border border-red-700 rounded-lg">
                <div className="text-center p-6 max-w-lg">
                    <div className="text-red-400 text-lg font-bold mb-2">⚠️ Chart Error</div>
                    <div className="text-gray-300 text-sm mb-4">{error}</div>
                    {debugData && (
                        <details className="text-left">
                            <summary className="cursor-pointer text-gray-400 text-xs hover:text-gray-200">Debug Info</summary>
                            <pre className="mt-2 text-xs text-gray-500 overflow-auto max-h-48 bg-gray-900 p-2 rounded">
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
            <div style={{ height: `${height}px` }} className="flex items-center justify-center text-gray-500">
                No data available for chart
            </div>
        );
    }

    return (
        <SankeyErrorBoundary height={height}>
            <div style={{ height: `${height}px` }}>
                <ResponsiveSankey
                    data={data}
                    margin={{ top: 20, right: 150, bottom: 20, left: 150 }}
                    align="justify"
                    colors={(node: any) => node.color}
                    nodeOpacity={1}
                    nodeThickness={15}
                    nodeSpacing={12}
                    nodeBorderRadius={3}
                    enableLinkGradient={true}
                    linkBlendMode="normal"
                    linkOpacity={0.15}
                    labelTextColor="#e5e7eb"
                    valueFormat={formatCurrency}
                    label={(node: any) => node.label}
                    labelPosition="outside"
                    labelPadding={16}
                    sort="input"
                    nodeTooltip={({ node }) => (
                        <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 shadow-2xl min-w-37.5">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: node.color }} />
                                <span className="font-bold text-gray-100 text-sm">{node.label}</span>
                            </div>
                            <div className="text-2xl font-mono text-green-400 font-medium">
                                {node.formattedValue}
                            </div>
                        </div>
                    )}
                    linkTooltip={({ link }) => (
                        <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 shadow-2xl">
                            <div className="flex items-center gap-2 mb-2 text-xs text-gray-400 uppercase tracking-wider font-semibold">
                                <span>{link.source.label}</span>
                                <span className="text-gray-600">&rarr;</span>
                                <span>{link.target.label}</span>
                            </div>
                            <div className="text-xl font-mono text-green-400 font-medium">
                                {link.formattedValue}
                            </div>
                        </div>
                    )}
                    theme={{
                        tooltip: { container: { background: '#111827', color: '#fff', borderRadius: '8px' } },
                        labels: { text: { fontSize: 11, fontWeight: 600, fill: '#e5e7eb' } }
                    }}
                />
            </div>
        </SankeyErrorBoundary>
    );
};