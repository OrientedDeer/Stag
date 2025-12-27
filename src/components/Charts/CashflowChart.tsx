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

        // 1. Core Totals (Salary Only)
        const salaryIncome = getGrossIncome(incomes);

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
        let employee401k = 0;
        let employeeRoth = 0;
        let totalInsurance = 0;
        
        let totalEmployerMatch = 0;
        let totalEmployerMatchForRoth = 0;
        let totalEmployerMatchForTrad = 0;

        let totalPrincipal = 0;
        let totalMortgage = 0;

        incomes.forEach(inc => {
            if (inc instanceof WorkIncome) {
                employee401k += getYearlyDeduction(inc.preTax401k, inc.frequency);
                totalInsurance += getYearlyDeduction(inc.insurance, inc.frequency);
                employeeRoth += getYearlyDeduction(inc.roth401k, inc.frequency);
                
                // Calculate Match
                const matchAmount = (inc as any).employerMatch || 0;
                const yearlyMatch = getYearlyDeduction(matchAmount, inc.frequency);
                totalEmployerMatch += yearlyMatch;

                // Detect Match Type (Assuming property exists or default to Trad)
                // @ts-ignore
                if ((inc as any).matchIsRoth || (inc as any).taxType === 'Roth 401k') {
                    totalEmployerMatchForRoth += yearlyMatch;
                } else {
                    totalEmployerMatchForTrad += yearlyMatch;
                }
            }
        });

        expenses.forEach(exp => {
            if (exp instanceof MortgageExpense) {
                const amort = exp.calculateAnnualAmortization(year);
                totalPrincipal += amort.totalPrincipal;
                totalMortgage += amort.totalPayment;
            }
        });
        totalMortgage -= totalPrincipal;
        const totalTaxes = annualFedTax + annualStateTax + annualFicaTax;
        
        // --- WATERFALL MATH ---
        
        // GROSS NODE VALUE = Salary + All Matches
        const grossPayNodeValue = salaryIncome;

        // TOTAL TRAD SAVINGS = Employee PreTax + Employer Trad Match
        const totalTradSavings = employee401k + totalEmployerMatchForTrad;

        // TOTAL ROTH SAVINGS = Employee Roth + Employer Roth Match
        const totalRothSavings = employeeRoth + totalEmployerMatchForRoth;

        // NET PAY CALCULATION
        // Gross Pay (Salary + Match)
        // MINUS: Trad Savings (Employee + EmployerTradMatch)  <-- Leaves Gross flow
        // MINUS: Insurance                                    <-- Leaves Gross flow
        // MINUS: Taxes                                        <-- Leaves Gross flow
        // EQUALS: Net Pay
        //
        // NOTE: We do NOT subtract EmployerRothMatch here. 
        // It stays in the flow to reach Net Pay, then exits to Roth Savings.
        const netPayFlow = grossPayNodeValue + totalEmployerMatchForTrad - totalTradSavings - totalInsurance - totalTaxes;

        // --- DEFINE NODES ---
        nodes.push({ id: 'Gross Pay', color: '#3b82f6', label: 'Gross Pay' });
        
        if (totalEmployerMatch > 0) {
            nodes.push({ id: 'Employer Contributions', color: '#10b981', label: 'Employer Contrib.' });
        }

        if (totalTradSavings > 0) nodes.push({ id: '401k Savings', color: '#10b981', label: '401k Savings' });
        if (totalInsurance > 0) nodes.push({ id: 'Benefits', color: '#6366f1', label: 'Benefits' });
        
        nodes.push({ id: 'Federal Tax', color: '#f59e0b', label: 'Federal Tax' });
        nodes.push({ id: 'State Tax', color: '#fbbf24', label: 'State Tax' });
        nodes.push({ id: 'FICA Tax', color: '#d97706', label: 'FICA Tax' });

        nodes.push({ id: 'Net Pay', color: '#3b82f6', label: 'Net Pay' });

        if (totalRothSavings > 0) nodes.push({ id: 'Roth Savings', color: '#10b981', label: 'Roth Savings' });
        if (totalPrincipal > 0) nodes.push({ id: 'Principal Payments', color: '#10b981', label: 'Principal Payments' });
        if (totalMortgage > 0) nodes.push({ id: 'Mortgage Payments', color: '#ef4444', label: 'Mortgage Payments' });

        // --- LINKS: LEVEL 0 (Inputs -> Gross) ---
        
        if (totalEmployerMatch > 0) {
            links.push({ source: 'Employer Contributions', target: 'Gross Pay', value: totalEmployerMatch });
        }
        incomes.forEach(inc => {
             const amount = getYearlyAmount(inc);
             if (amount > 0) {
                 nodes.push({ id: inc.name, color: '#10b981', label: inc.name });
                 links.push({ source: inc.name, target: 'Gross Pay', value: amount });
             }
        });

        // --- LINKS: LEVEL 1 (Gross -> PreTax/Taxes/Net) ---
        
        // 1. Traditional Savings (Leaves here)
        if (totalTradSavings > 0) links.push({ source: 'Gross Pay', target: '401k Savings', value: totalTradSavings });
        
        // 2. Expenses/Taxes (Leaves here)
        if (totalInsurance > 0) links.push({ source: 'Gross Pay', target: 'Benefits', value: totalInsurance });
        if (annualFedTax > 0) links.push({ source: 'Gross Pay', target: 'Federal Tax', value: annualFedTax });
        if (annualStateTax > 0) links.push({ source: 'Gross Pay', target: 'State Tax', value: annualStateTax });
        if (annualFicaTax > 0) links.push({ source: 'Gross Pay', target: 'FICA Tax', value: annualFicaTax });
        
        // 3. Flow to Net Pay (Includes Cash Salary + Roth Match)
        if (netPayFlow > 0) links.push({ source: 'Gross Pay', target: 'Net Pay', value: netPayFlow });

        // --- LINKS: LEVEL 2 (Net -> Roth/Living/Remaining) ---
        if (netPayFlow > 0) {
            
            // 1. Roth Savings (Employee + Employer Roth Match)
            if (totalRothSavings > 0) {
                links.push({ source: 'Net Pay', target: 'Roth Savings', value: totalRothSavings });
            }
            
            // 2. Living Expenses
            if (totalPrincipal > 0) links.push({ source: 'Net Pay', target: 'Principal Payments', value: totalPrincipal });
            if (totalMortgage > 0) links.push({ source: 'Net Pay', target: 'Mortgage Payments', value: totalMortgage });

            let totalYearlyExpenses = 0;
            const expenseCatTotals = new Map<string, number>();

            expenses.forEach(exp => {
                const amount = getYearlyAmount(exp);
                if (amount <= 0 || exp instanceof MortgageExpense) return;
                const category = EXPENSE_CLASS_TO_CAT[exp.constructor.name] || 'Other';
                expenseCatTotals.set(category, (expenseCatTotals.get(category) || 0) + amount);
                totalYearlyExpenses += amount;
            });

            expenseCatTotals.forEach((total, cat) => {
                nodes.push({ id: cat, color: '#ef4444', label: cat });
                links.push({ source: 'Net Pay', target: cat, value: total });
            });

            const remaining = netPayFlow - totalRothSavings - totalYearlyExpenses - totalMortgage - totalPrincipal;
            
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
                         <div className="text-green-400 font-mono mt-1">
                            ${link.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                    </div>
                )}
                theme={{
                    labels: { text: { fill: '#e5e7eb', fontSize: 11, fontWeight: 600 } }
                }}
            />
        </div>
    );
};