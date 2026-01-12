import React, { useState, useContext } from 'react';
import { AssumptionsContext } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { DebtAccount, PropertyAccount, AnyAccount } from '../../../components/Objects/Accounts/models';
import { RangeSlider } from '../../../components/Layout/InputFields/RangeSlider'; // Import RangeSlider
import { CashflowSankey } from '../../../components/Charts/CashflowSankey';

const formatCurrency = (value: number) => {
    if (value === undefined || value === null) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

const calculateNetWorth = (accounts: AnyAccount[]) => {
    let assets = 0;
    let liabilities = 0;
    accounts.forEach(acc => {
        const val = acc.amount || 0;
        if (acc instanceof DebtAccount) {
            liabilities += val;
        } else {
            assets += val;
            // PropertyAccount has a loan that counts as liability
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                liabilities += acc.loanAmount;
            }
        }
    });
    return assets - liabilities;
};

export const CashflowTab = React.memo(({ simulationData }: { simulationData: any[] }) => {
    const { state: assumptions } = useContext(AssumptionsContext);
    const startYear = simulationData.length > 0 ? simulationData[0].year : new Date().getFullYear();
    const endYear = simulationData.length > 0 ? simulationData[simulationData.length - 1].year : startYear;
    const [selectedYear, setSelectedYear] = useState(startYear);
	
    const selectedYearIndex = simulationData.findIndex(s => s.year === selectedYear);
    const yearData = simulationData[selectedYearIndex];
	
    const age = assumptions.demographics.startAge + selectedYearIndex;
    const netWorth = yearData ? calculateNetWorth(yearData.accounts) : 0;

    if (!yearData) return <div>No data</div>;

    return (
         <div className="flex flex-col gap-4">
            {/* 1. SANKEY CHART */}
            <div className="overflow-hidden">
                <CashflowSankey
                    incomes={yearData.incomes}
                    expenses={yearData.expenses}
                    year={yearData.year}
                    taxes={yearData.taxDetails}
                    bucketAllocations={yearData.cashflow.bucketDetail || {}}
                    accounts={yearData.accounts}
                    withdrawals={yearData.cashflow.withdrawalDetail || {}}
                    height={400}
                />
            </div>


            {/* 2. SLIDER CONTROL (Updated to use RangeSlider) */}
            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800 shadow-lg">
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
});