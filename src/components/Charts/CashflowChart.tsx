import { useContext, useMemo } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { AnyIncome, WorkIncome } from '../Income/models';
import { AnyExpense, LoanExpense, MortgageExpense, CLASS_TO_CATEGORY as EXPENSE_CLASS_TO_CAT } from '../Expense/models';
import { TAX_DATABASE } from '../Taxes/TaxData';
import { 
    calculateFicaTax,
    calculateFederalTax,
    calculateStateTax,
    getGrossIncome
} from '../Taxes/TaxService';
import { TaxContext } from '../Taxes/TaxContext';
import { IncomeContext } from '../Income/IncomeContext';
import { ExpenseContext } from '../Expense/ExpenseContext';

const getYearlyAmount = (item: AnyIncome | AnyExpense) => {
    let amount = item.amount;
    if (item instanceof LoanExpense || item instanceof MortgageExpense) amount = item.payment;
 
    switch (item.frequency) {
        case 'Weekly': return amount * 52;
        case 'Monthly': return amount * 12;
        case 'Annually': return amount;
        case 'Daily': return amount * 365;
        default: return 0;
    }
};

const getYearlyDeduction = (amount: number, frequency: string) => {
    switch (frequency) {
        case 'Weekly': return amount * 52;
        case 'Monthly': return amount * 12;
        case 'Annually': return amount;
        default: return 0;
    }
}

export const CashflowChart = () => {
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);

    const data = useMemo(() => {
        const nodes: any[] = [];
        const links: any[] = [];

        // 1. Core Totals
        const totalAnnualIncome = getGrossIncome(incomes);

        // 2. Tax Calculations
        const year = 2025;
        const fedParams = TAX_DATABASE.federal[year]?.[taxState.filingStatus];
        const stateParams = TAX_DATABASE.states[taxState.stateResidency]?.[year]?.[taxState.filingStatus];

        let annualFedTax = fedParams ? calculateFederalTax(taxState, incomes, expenses, year) : 0;
        let annualStateTax = stateParams ? calculateStateTax(taxState, incomes, expenses, year): 0;
        let annualFicaTax = fedParams ? calculateFicaTax(taxState, incomes, year): 0;

        // Apply Overrides
        if (taxState.fedOverride !== null) annualFedTax = taxState.fedOverride;
        if (taxState.ficaOverride !== null) annualFicaTax = taxState.ficaOverride;
        if (taxState.stateOverride !== null) annualStateTax = taxState.stateOverride;

        // 3. Detailed Deduction Breakdown
        let total401k = 0;
        let totalInsurance = 0;
        let totalRoth = 0;
        let totalPrincipal = 0
        let totalMortgage = 0;


        incomes.forEach(inc => {
            if (inc instanceof WorkIncome) {
                total401k += getYearlyDeduction(inc.preTax401k, inc.frequency);
                totalInsurance += getYearlyDeduction(inc.insurance, inc.frequency);
                totalRoth += getYearlyDeduction(inc.roth401k, inc.frequency);
            }
        });

        expenses.forEach(exp => {
            if (exp instanceof MortgageExpense) {
                totalPrincipal += exp.calculateAnnualAmortization(year).totalPrincipal;
            }
            if (exp instanceof MortgageExpense) {
                totalMortgage += exp.calculateAnnualAmortization(year).totalPayment;
            }
        });
        totalMortgage -= totalPrincipal
        const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;
        
        // --- WATERFALL MATH ---
        // netPayFlow is what remains after Deductions and Taxes
        const netPayFlow = totalAnnualIncome - total401k - totalInsurance - totalTaxes;

        // --- DEFINE NODES ---
        // 1. Gross Aggregator
        nodes.push({ id: 'Gross Pay', color: '#3b82f6', label: 'Gross Pay' });

        // 2. Pre-Tax Layer
        if (total401k > 0) nodes.push({ id: '401k Savings', color: '#10b981', label: '401k Savings' });
        if (totalInsurance > 0) nodes.push({ id: 'Benefits', color: '#6366f1', label: 'Benefits' });
        
        // 3. Tax Layer
        nodes.push({ id: 'Federal Tax', color: '#f59e0b', label: 'Federal Tax' });
        nodes.push({ id: 'State Tax', color: '#fbbf24', label: 'State Tax' });
        nodes.push({ id: 'FICA Tax', color: '#d97706', label: 'FICA Tax' });

        // 4. Net Pay Layer
        nodes.push({ id: 'Net Pay', color: '#3b82f6', label: 'Net Pay' });

        // 5. Post-Tax Layer
        if (totalRoth > 0) nodes.push({ id: 'Roth Savings', color: '#10b981', label: 'Roth Savings' });
        if (totalPrincipal > 0) nodes.push({ id: 'Principal Payments', color: '#10b981', label: 'Principal Payments' });
        if (totalMortgage > 0) nodes.push({ id: 'Mortgage Payments', color: '#ef4444', label: 'Mortgage Payments' });

        // Level 0: Incomes -> Gross Pay
        incomes.forEach(inc => {
             const amount = getYearlyAmount(inc);
             if (amount > 0) {
                 nodes.push({ id: inc.name, color: '#10b981', label: inc.name });
                 links.push({ source: inc.name, target: 'Gross Pay', value: amount });
             }
        });

        // Level 1: Gross Pay splits directly into Deductions, Taxes, and Net Pay
        if (total401k > 0) links.push({ source: 'Gross Pay', target: '401k Savings', value: total401k });
        if (totalInsurance > 0) links.push({ source: 'Gross Pay', target: 'Benefits', value: totalInsurance });
        
        if (annualFedTax > 0) links.push({ source: 'Gross Pay', target: 'Federal Tax', value: annualFedTax });
        if (annualStateTax > 0) links.push({ source: 'Gross Pay', target: 'State Tax', value: annualStateTax });
        if (annualFicaTax > 0) links.push({ source: 'Gross Pay', target: 'FICA Tax', value: annualFicaTax });
        
        if (netPayFlow > 0) links.push({ source: 'Gross Pay', target: 'Net Pay', value: netPayFlow });

        // Level 2: Net Pay -> Roth, Expenses, Remaining
        if (netPayFlow > 0) {
            if (totalRoth > 0) links.push({ source: 'Net Pay', target: 'Roth Savings', value: totalRoth });
            
            if (totalPrincipal > 0) links.push({ source: 'Net Pay', target: 'Principal Payments', value: totalPrincipal });
            if (totalMortgage > 0) links.push({ source: 'Net Pay', target: 'Mortgage Payments', value: totalMortgage });

            let totalYearlyExpenses = 0;
            const expenseCatTotals = new Map<string, number>();

            expenses.forEach(exp => {
                const amount = getYearlyAmount(exp);
                if (amount <= 0) return;
                if(exp instanceof MortgageExpense) return;
                const category = EXPENSE_CLASS_TO_CAT[exp.constructor.name] || 'Other';
                expenseCatTotals.set(category, (expenseCatTotals.get(category) || 0) + amount);
                totalYearlyExpenses += amount;
            });

            expenseCatTotals.forEach((total, cat) => {
                nodes.push({ id: cat, color: '#ef4444', label: cat });
                links.push({ source: 'Net Pay', target: cat, value: total });
            });

            const remaining = netPayFlow - totalRoth - totalYearlyExpenses - totalMortgage - totalPrincipal;
            
            if (remaining > 0) {
                nodes.push({ id: 'Remaining', color: '#10b981', label: 'Remaining' });
                links.push({ source: 'Net Pay', target: 'Remaining', value: remaining });
            } else if (remaining < 0) {
                 nodes.push({ id: 'Deficit', color: '#ef4444', label: 'Deficit' });
                 links.push({ source: 'Deficit', target: 'Net Pay', value: Math.abs(remaining) });
            }
        }

        const uniqueNodes = Array.from(new Map(nodes.map(node => [node.id, node])).values())
            .filter(node => links.some(l => l.target === node.id || l.source === node.id));

        return { nodes: uniqueNodes, links: links.filter(l => l.value > 0) };
    }, [incomes, expenses, taxState]);

    return (
        <div className='h-[300px]'>
            <ResponsiveSankey
                data={data}
                margin={{ top: 5, right: 120, bottom: 10, left: 130 }}
                align="justify"
                colors={(node: any) => node.color}
                nodeOpacity={1}
                nodeThickness={15}
                nodeSpacing={10}
                enableLinkGradient={true}
                linkBlendMode="normal"
                linkOpacity={0.15}
                label={(node: any) => node.label}
                labelPosition="outside"
                labelPadding={16}
                sort="input"
                nodeTooltip={({ node }) => (
                    <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl">
                        <span className="font-bold text-gray-200">{node.label}</span>
                        <div className="text-green-400 font-mono mt-1">
                            ${node.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                    </div>
                )}
                linkTooltip={({ link }) => (
                    <div className="bg-gray-900 p-2 rounded border border-gray-700 shadow-xl">
                        <span className="font-bold text-gray-200">
                            {(link.source as any).label} &rarr; {(link.target as any).label}
                        </span>
                    </div>
                )}
                theme={{
                    labels: { text: { fill: '#e5e7eb', fontSize: 11, fontWeight: 600 } }
                }}
            />
        </div>
    );
};