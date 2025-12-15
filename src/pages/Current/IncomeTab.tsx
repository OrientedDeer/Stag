import React, { useState, useContext } from 'react';
import { IncomeContext } from '../../components/Income/IncomeContext';
import { 
  WorkIncome, 
  SocialSecurityIncome, 
  PassiveIncome, 
  WindfallIncome,
  RSUIncome,
  INCOME_CATEGORIES 
} from '../../components/Income/models';
import IncomeCard from '../../components/Income/IncomeCard';
import IncomeHorizontalBarChart from '../../components/Income/IncomeHorizontalBarChart';
import AddIncomeControl from '../../components/Income/AddIncomeUI';

const IncomeList = ({ type }: { type: any }) => {
  const { incomes } = useContext(IncomeContext);
  const filteredIncomes = incomes.filter((inc) =>inc instanceof type);

  if (filteredIncomes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {filteredIncomes.map((income) => (
        <IncomeCard key={`${income.id}-${income.constructor.name}`} income={income} />
      ))}
    </div>
  );
};

const TabsContent = () => {
    const { incomes } = useContext(IncomeContext);
    const [activeTab, setActiveTab] = useState<string>('Work');

    const allIncomes = incomes; 
    const workIncomes = incomes.filter(inc => inc instanceof WorkIncome);
    const ssIncomes = incomes.filter(inc => inc instanceof SocialSecurityIncome);
    const passiveIncomes = incomes.filter(inc => inc instanceof PassiveIncome);
    const windfallIncomes = incomes.filter(inc => inc instanceof WindfallIncome);
    const rsuIncomes = incomes.filter(inc => inc instanceof RSUIncome);

    const tabs = INCOME_CATEGORIES;

    const tabContent: Record<string, React.ReactNode> = {
        Work: (
            <div className="p-4">
                <IncomeList type={WorkIncome} />
                <AddIncomeControl 
                    IncomeClass={WorkIncome} 
                    title="Work" 
                    defaultArgs={['']}
                />
            </div>
        ),
        SocialSecurity: (
            <div className="p-4">
                <IncomeList type={SocialSecurityIncome} />
                 <AddIncomeControl 
                    IncomeClass={SocialSecurityIncome} 
                    title="Social Security" 
                    defaultArgs={[62]} // claimingAge
                />
            </div>
        ),
        Passive: (
            <div className="p-4">
                <IncomeList type={PassiveIncome} />
                <AddIncomeControl 
                    IncomeClass={PassiveIncome} 
                    title="Passive" 
                    defaultArgs={['Dividend']} // sourceType
                />
            </div>
        ),
        Windfall: (
            <div className="p-4">
                <IncomeList type={WindfallIncome} />
                <AddIncomeControl 
                    IncomeClass={WindfallIncome} 
                    title="Windfall" 
                    defaultArgs={[new Date()]} // receiptDate
                />
            </div>
        ),
        RSU: (
            <div className="p-4">
                <IncomeList type={RSUIncome} />
                <AddIncomeControl 
                    IncomeClass={RSUIncome} 
                    title="RSU" 
                    defaultArgs={[new Date()]} // vestingDate
                />
            </div>
        ),
    };

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-15/16 max-w-5xl">
                <div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">Income Breakdown (Monthly Normalized)</h2>
                    <IncomeHorizontalBarChart 
                        type="Total Monthly Income" 
                        incomeList={allIncomes}
                    />
                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <IncomeHorizontalBarChart 
                            type="Work" 
                            incomeList={workIncomes}
                        />
                        <IncomeHorizontalBarChart 
                            type="Social Security" 
                            incomeList={ssIncomes}
                        />
                        <IncomeHorizontalBarChart 
                            type="Passive" 
                            incomeList={passiveIncomes}
                        />
                         <IncomeHorizontalBarChart 
                            type="Windfall" 
                            incomeList={windfallIncomes}
                        />
                        <IncomeHorizontalBarChart 
                            type="RSU" 
                            incomeList={rsuIncomes}
                        />
                    </div>
                </div>
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-1 flex border border-gray-800 flex-wrap">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 min-w-[100px] font-semibold p-3 transition-colors duration-200 ${
                                activeTab === tab
                                    ? 'text-green-300 bg-gray-900 border-b-2 border-green-300'
                                    : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab === 'SocialSecurity' ? 'Soc. Sec.' : tab}
                        </button>
                    ))}
                </div>
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-[400px] mb-4">
                    {tabContent[activeTab]}
                </div>

            </div>
        </div>
    );
}

export default function IncomeTab() {
  return (
    <TabsContent />
  );
}