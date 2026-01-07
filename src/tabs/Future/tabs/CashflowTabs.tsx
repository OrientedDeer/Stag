import { useState, useMemo, useContext } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { MortgageExpense, CLASS_TO_CATEGORY as EXPENSE_CLASS_TO_CAT } from '../../../components/Objects/Expense/models';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { DebtAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider'; // Import RangeSlider

const formatCurrency = (value: number) => {
    if (value === undefined || value === null) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

const calculateNetWorth = (accounts: AnyAccount[]) => {
    let assets = 0;
    let liabilities = 0;
    accounts.forEach(acc => {
        const val = acc.amount || 0;
        if (acc instanceof DebtAccount) liabilities += val;
        else {
            assets += val;
             // @ts-ignore
            if (acc.loanAmount) liabilities += acc.loanAmount;
        }
    });
    return assets - liabilities;
};

export const CashflowTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    
    // --- SLIDER STATE ---
    const startYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const endYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : startYear;
    const [selectedYear, setSelectedYear] = useState(startYear);

    // --- GET DATA FOR SELECTED YEAR ---
    const selectedYearIndex = simulationData.findIndex(s => s.year === selectedYear);
    const yearData = simulationData[selectedYearIndex];
    
    // Derived Stats
    const age = assumptions.personal.startAge + selectedYearIndex;
    const netWorth = yearData ? calculateNetWorth(yearData.accounts) : 0;

    // --- CHART DATA CONSTRUCTION (Unchanged) ---
    const chartData = useMemo(() => {
        if (!yearData) return { nodes: [], links: [] };

        const nodes: any[] = [];
        const links: any[] = [];

        let employee401k = 0;
        let employeeRoth = 0;
        let totalInsurance = 0;
        
        let totalEmployerMatch = 0;
        let totalEmployerMatchForRoth = 0;
        let totalEmployerMatchForTrad = 0;

        yearData.incomes.forEach(inc => {
            if (inc instanceof WorkIncome) {
                const currentYear = yearData.year;
                
                employee401k += inc.getProratedAnnual(inc.preTax401k, currentYear);
                employeeRoth += inc.getProratedAnnual(inc.roth401k, currentYear);
                totalInsurance += inc.getProratedAnnual(inc.insurance, currentYear);

                const empMatch = inc.employerMatch;
                if (empMatch > 0) {
                    const proratedMatch = inc.getProratedAnnual(empMatch, currentYear);
                    if (proratedMatch > 0) {
                        totalEmployerMatch += proratedMatch;
                        // @ts-ignore
                        if (inc.matchIsRoth || inc.taxType === 'Roth 401k') {
                            totalEmployerMatchForRoth += proratedMatch;
                        } else {
                            totalEmployerMatchForTrad += proratedMatch;
                        }
                    }
                }
            }
        });

        let totalPrincipal = 0;
        let totalMortgagePayment = 0;
        const expenseCatTotals = new Map<string, number>();

        yearData.expenses.forEach(exp => {
            if (exp instanceof MortgageExpense) {
                const amort = exp.calculateAnnualAmortization(yearData.year);
                totalPrincipal += amort.totalPrincipal;
                totalMortgagePayment += exp.getAnnualAmount(yearData.year);
            } else {
                const amount = exp.getAnnualAmount(yearData.year);
                if (amount > 0) {
                    const category = EXPENSE_CLASS_TO_CAT[exp.constructor.name] || 'Other';
                    expenseCatTotals.set(category, (expenseCatTotals.get(category) || 0) + amount);
                }
            }
        });

        const totalMortgageExpense = totalMortgagePayment - totalPrincipal;
        const annualFedTax = yearData.taxDetails.fed;
        const annualStateTax = yearData.taxDetails.state;
        const annualFicaTax = yearData.taxDetails.fica;
        const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;

        const grossPayNodeValue = yearData.cashflow.totalIncome + totalEmployerMatchForTrad;
        const salaryValue = yearData.cashflow.totalIncome; 
        const totalTradSavings = employee401k + totalEmployerMatchForTrad;
        const totalRothSavings = employeeRoth + totalEmployerMatchForRoth;
        const bucketAllocations = yearData.cashflow.bucketDetail || {};
        const totalBucketSavings = Object.values(bucketAllocations).reduce((a, b) => a + b, 0);

        const netPayFlow = grossPayNodeValue - totalTradSavings - totalInsurance - totalTaxes;

        // --- DEFINE NODES ---
        if (totalEmployerMatch > 0) nodes.push({ id: 'Employer Contributions', color: '#10b981', label: 'Employer Contrib.' });
        if (salaryValue > 0) nodes.push({ id: 'Salary', color: '#10b981', label: 'Salary' });
        nodes.push({ id: 'Gross Pay', color: '#3b82f6', label: 'Gross Pay' });
        
        if (totalTradSavings > 0) nodes.push({ id: '401k Savings', color: '#10b981', label: '401k Savings' });
        if (totalInsurance > 0) nodes.push({ id: 'Benefits', color: '#6366f1', label: 'Benefits' });
        if (annualFedTax > 0) nodes.push({ id: 'Federal Tax', color: '#f59e0b', label: 'Federal Tax' });
        if (annualStateTax > 0) nodes.push({ id: 'State Tax', color: '#fbbf24', label: 'State Tax' });
        if (annualFicaTax > 0) nodes.push({ id: 'FICA Tax', color: '#d97706', label: 'FICA Tax' });

        nodes.push({ id: 'Net Pay', color: '#3b82f6', label: 'Net Pay' });

        if (totalRothSavings > 0) nodes.push({ id: 'Roth Savings', color: '#10b981', label: 'Roth Savings' });
        if (totalPrincipal > 0) nodes.push({ id: 'Principal Payments', color: '#10b981', label: 'Principal Payments' });
        if (totalMortgageExpense > 0) nodes.push({ id: 'Mortgage Payments', color: '#ef4444', label: 'Mortgage Payments' });

        expenseCatTotals.forEach((_, cat) => {
            nodes.push({ id: cat, color: '#ef4444', label: cat });
        });

        Object.entries(bucketAllocations).forEach(([accountId, amount]) => {
            if (amount > 0) {
                const account = yearData.accounts.find(a => a.id === accountId);
                const name = account ? account.name : 'Unknown Account';
                const nodeId = `Save: ${name}`; 
                nodes.push({ id: nodeId, color: '#10b981', label: name });
            }
        });

        const totalAllocated = totalRothSavings + totalMortgagePayment + 
                               Array.from(expenseCatTotals.values()).reduce((a, b) => a + b, 0) + 
                               totalBucketSavings;

        const remaining = netPayFlow - totalAllocated;

        if (remaining > 1) {
            nodes.push({ id: 'Remaining', color: '#10b981', label: 'Remaining Cash' });
        } else if (remaining < -1) {
            nodes.push({ id: 'Deficit', color: '#ef4444', label: 'Deficit' });
        }

        // --- DEFINE LINKS ---
        if (totalEmployerMatch > 0) links.push({ source: 'Employer Contributions', target: 'Gross Pay', value: totalEmployerMatch });
        if (salaryValue > 0) links.push({ source: 'Salary', target: 'Gross Pay', value: salaryValue });

        if (totalTradSavings > 0) links.push({ source: 'Gross Pay', target: '401k Savings', value: totalTradSavings });
        if (totalInsurance > 0) links.push({ source: 'Gross Pay', target: 'Benefits', value: totalInsurance });
        if (annualFedTax > 0) links.push({ source: 'Gross Pay', target: 'Federal Tax', value: annualFedTax });
        if (annualStateTax > 0) links.push({ source: 'Gross Pay', target: 'State Tax', value: annualStateTax });
        if (annualFicaTax > 0) links.push({ source: 'Gross Pay', target: 'FICA Tax', value: annualFicaTax });

        if (netPayFlow > 0) links.push({ source: 'Gross Pay', target: 'Net Pay', value: netPayFlow });

        if (netPayFlow > 0) {
            if (totalRothSavings > 0) links.push({ source: 'Net Pay', target: 'Roth Savings', value: totalRothSavings });
            if (totalPrincipal > 0) links.push({ source: 'Net Pay', target: 'Principal Payments', value: totalPrincipal });
            if (totalMortgageExpense > 0) links.push({ source: 'Net Pay', target: 'Mortgage Payments', value: totalMortgageExpense });

            expenseCatTotals.forEach((val, cat) => {
                links.push({ source: 'Net Pay', target: cat, value: val });
            });

            Object.entries(bucketAllocations).forEach(([accountId, amount]) => {
                if (amount > 0) {
                    const account = yearData.accounts.find(a => a.id === accountId);
                    const name = account ? account.name : 'Unknown';
                    const nodeId = `Save: ${name}`;
                    links.push({ source: 'Net Pay', target: nodeId, value: amount });
                }
            });

            if (remaining > 1) {
                links.push({ source: 'Net Pay', target: 'Remaining', value: remaining });
            } else if (remaining < -1) {
                links.push({ source: 'Deficit', target: 'Net Pay', value: Math.abs(remaining) });
            }
        }

        const activeNodeIds = new Set();
        links.forEach(l => { 
            if (l.value > 0) { 
                activeNodeIds.add(l.source); 
                activeNodeIds.add(l.target); 
            } 
        });
        const finalNodes = nodes.filter(n => activeNodeIds.has(n.id));
        const finalLinks = links.filter(l => l.value > 0);

        return { nodes: finalNodes, links: finalLinks };

    }, [yearData]); 

    if (!yearData) return <div className="p-4 text-white">No data available.</div>;

    return (
        <div className="flex flex-col gap-4 h-full">
            {/* 1. SANKEY CHART */}
            <div className="h-[400px]">
                <ResponsiveSankey
                    data={chartData}
                    margin={{ top: 20, right: 150, bottom: 20, left: 150 }}
                    align="justify"
                    colors={(node: any) => node.color || '#888'}
                    nodeOpacity={1}
                    nodeThickness={15}
                    nodeSpacing={12}
                    nodeBorderRadius={3}
                    enableLinkGradient={true}
                    linkBlendMode="normal"
                    linkOpacity={0.2}
                    labelPosition="outside"
                    labelPadding={16}
                    labelTextColor="#e5e7eb"
                    valueFormat={formatCurrency}
                    sort="input"
                    theme={{
                        tooltip: { container: { background: '#111827', color: '#fff', borderRadius: '4px' } },
                        labels: { text: { fontSize: 11, fontWeight: 600 } }
                    }}
                    nodeTooltip={({ node }) => (
                        <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl">
                            <span className="font-bold text-gray-200">{node.label}</span>
                            <div className="text-green-400 font-mono mt-1">{node.formattedValue}</div>
                        </div>
                    )}
                    linkTooltip={({ link }) => (
                        <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl">
                            <span className="font-bold text-gray-200">
                                {link.source.label} &rarr; {link.target.label}
                            </span>
                            <div className="text-green-400 font-mono mt-1">{link.formattedValue}</div>
                        </div>
                    )}
                />
            </div>

            {/* 2. SLIDER CONTROL (Updated to use RangeSlider) */}
            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg mt-auto">
                <h3 className="text-lg font-bold text-white mb-2">Year Details: {selectedYear}</h3>
                <div className='flex items-center gap-6'>
                    
                    {/* Replaced invisible <input> with <RangeSlider> */}
                    <div className="w-full">
                        <RangeSlider
                            value={selectedYear}
                            min={startYear}
                            max={endYear}
                            onChange={(val) => setSelectedYear(val as number)}
                            hideHeader={true} // Hides internal label to use your custom header above
                        />
                    </div>
                    
                    <div className="flex gap-4 text-white min-w-fit">
                        <div>
                            <span className="font-bold">Net Worth:</span>
                            <span className='text-green-400'> {formatCurrency(netWorth)}</span>
                        </div>
                        <div>
                            <span className="font-bold">Age:</span> {age}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};