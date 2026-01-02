import { useState, useMemo, useContext } from 'react';
import { MortgageExpense } from '../../components/Expense/models';
import { CurrencyInput } from '../../components/Layout/CurrencyInput';
import { PercentageInput } from '../../components/Layout/PercentageInput';
import { NumberInput } from '../../components/Layout/NumberInput';
import { AssumptionsContext } from '../../components/Assumptions/AssumptionsContext';

// Helper to format currency
const toCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);

export default function Testing() {
    // --- Inputs State ---
    const [valuation, setValuation] = useState(500000);
    const [startingLoan, setStartingLoan] = useState(400000); // Also used as current balance for start
    const [apr, setApr] = useState(6.5);
    const [propertyTaxRate, setPropertyTaxRate] = useState(0.85);
    const [propertyDeduction, setPropertyDeduction] = useState(89850);
    const [insuranceRate, setInsuranceRate] = useState(0.56);
    const [repairsRate, setRepairsRate] = useState(0.75);
    const [term, setTerm] = useState(30);
    const [extraPayment, setExtraPayment] = useState(0);
    const [pmi, setPmi] = useState(0);
    const [hoa, setHoa] = useState(0);
    const [utilities, setUtilities] = useState(0);

    const { state: assumptions } = useContext(AssumptionsContext);

    // --- Simulation ---
    const simulationData = useMemo(() => {
        const rows = [];

        // 1. Create Initial Mortgage Object
        // We use today as start date
        const startDate = new Date();

        let currentMortgage = new MortgageExpense(
            'debug-mortgage',
            'Debug Mortgage',
            'Monthly',
            valuation,
            startingLoan, // Current Balance (starts full)
            startingLoan, // Starting Balance
            apr,
            term,
            propertyTaxRate,
            propertyDeduction,
            repairsRate,
            utilities,
            insuranceRate,
            pmi,
            hoa,
            'No', // Tax Deductible (not used for this sim display)
            0,
            'none',
            startDate,
            0,
            extraPayment
        );

        // 2. Loop for 30 years (or Term)
        for (let year = 1; year <= term; year++) {
            // Capture Start-of-Year State
            const startValuation = currentMortgage.valuation;
            const startBalance = currentMortgage.loan_balance;

            // Calculate 'Escrow' and other non-P&I expenses for the year
            // These are based on the valuation/rates of the CURRENT year object
            const annualPropTax = Math.max(0, startValuation - currentMortgage.valuation_deduction) * (currentMortgage.property_taxes / 100);
            const annualInsurance = startValuation * (currentMortgage.home_owners_insurance / 100);
            const annualRepairs = startValuation * (currentMortgage.maintenance / 100);
            const annualPMI = startValuation * (currentMortgage.pmi / 100);
            const annualHOA = currentMortgage.hoa_fee * 12;
            const annualUtilities = currentMortgage.utilities * 12;

            // Advance Time
            const nextMortgage = currentMortgage.increment(assumptions);

            // Calculate Deltas from Increment
            // MortgageExpense.increment() stores the total interest paid in 'tax_deductible' of the NEW object
            const interestPaid = nextMortgage.tax_deductible;
            const principalPaid = startBalance - nextMortgage.loan_balance;

            // Total P&I actually paid (approximate via sum, accurate to what happened in simulation)
            const totalPIPaid = interestPaid + principalPaid;

            const totalAnnualCost = totalPIPaid + annualPropTax + annualInsurance + annualRepairs + annualPMI + annualHOA + annualUtilities;

            rows.push({
                year,
                valuation: startValuation,
                startBalance,
                interestPaid,
                principalPaid,
                propertyTax: annualPropTax,
                insurance: annualInsurance,
                repairs: annualRepairs,
                pmi: annualPMI,
                hoa: annualHOA,
                totalCost: totalAnnualCost,
                endBalance: nextMortgage.loan_balance
            });

            // Update for next iteration
            currentMortgage = nextMortgage;

            // Optional: optimization to stop if paid off early
            if (currentMortgage.loan_balance <= 0 && principalPaid <= 0) break;
        }

        return rows;
    }, [valuation, startingLoan, apr, propertyTaxRate, propertyDeduction, insuranceRate, repairsRate, pmi, hoa, utilities, term, extraPayment, assumptions]);

    return (
        <div className="w-full min-h-screen bg-gray-950 text-gray-100 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-3xl font-bold mb-8 border-b border-gray-800 pb-4 text-fuchsia-500">
                    Mortgage Full Simulation
                </h2>

                {/* --- Inputs Grid --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                    <CurrencyInput label="Home Valuation" value={valuation} onChange={setValuation} />
                    <CurrencyInput label="Starting Loan" value={startingLoan} onChange={setStartingLoan} />
                    <PercentageInput label="Interest Rate" value={apr} onChange={setApr} />
                    <NumberInput label="Term (Years)" value={term} onChange={setTerm} />

                    <PercentageInput label="Property Tax Rate" value={propertyTaxRate} onChange={setPropertyTaxRate} />
                    <CurrencyInput label="Prop. Tax Deduction" value={propertyDeduction} onChange={setPropertyDeduction} />
                    <PercentageInput label="Insurance Rate" value={insuranceRate} onChange={setInsuranceRate} />
                    <PercentageInput label="Repairs/Maint. Rate" value={repairsRate} onChange={setRepairsRate} />

                    <PercentageInput label="PMI Rate" value={pmi} onChange={setPmi} />
                    <CurrencyInput label="Monthly HOA" value={hoa} onChange={setHoa} />
                    <CurrencyInput label="Monthly Utilities" value={utilities} onChange={setUtilities} />
                    <CurrencyInput label="Extra Payment / Mo" value={extraPayment} onChange={setExtraPayment} />
                </div>

                {/* --- Results Table --- */}
                <div className="rounded-xl border border-gray-800 overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 border-b border-gray-800">Year</th>
                                <th className="p-4 border-b border-gray-800 text-right">Valuation</th>
                                <th className="p-4 border-b border-gray-800 text-right text-red-400">Interest</th>
                                <th className="p-4 border-b border-gray-800 text-right text-emerald-400">Principal</th>
                                <th className="p-4 border-b border-gray-800 text-right text-orange-400">Taxes</th>
                                <th className="p-4 border-b border-gray-800 text-right text-yellow-400">Ins/Maint</th>
                                <th className="p-4 border-b border-gray-800 text-right">PMI/HOA</th>
                                <th className="p-4 border-b border-gray-800 text-right font-bold text-white">Total Outflow</th>
                                <th className="p-4 border-b border-gray-800 text-right text-blue-400">Remaining Bal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 bg-gray-950">
                            {simulationData.map((row) => (
                                <tr key={row.year} className="hover:bg-gray-900/40 transition-colors">
                                    <td className="p-4 font-mono text-gray-500">{row.year}</td>
                                    <td className="p-4 text-right font-mono text-gray-300">{toCurrency(row.valuation)}</td>
                                    <td className="p-4 text-right font-mono text-red-500/80">{toCurrency(row.interestPaid)}</td>
                                    <td className="p-4 text-right font-mono text-emerald-500/80">{toCurrency(row.principalPaid)}</td>
                                    <td className="p-4 text-right font-mono text-orange-500/80">{toCurrency(row.propertyTax)}</td>
                                    <td className="p-4 text-right font-mono text-yellow-500/80">{toCurrency(row.insurance + row.repairs)}</td>
                                    <td className="p-4 text-right font-mono text-gray-400">{toCurrency(row.pmi + row.hoa)}</td>
                                    <td className="p-4 text-right font-mono font-bold text-gray-200 bg-gray-900/20">{toCurrency(row.totalCost)}</td>
                                    <td className="p-4 text-right font-mono text-blue-400 font-semibold">{toCurrency(row.endBalance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}