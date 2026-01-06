import { useMemo } from 'react';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { getAccountTotals, formatCurrency } from './FutureUtils';

export const DataTab = ({ simulationData, startAge }: { simulationData: SimulationYear[], startAge: number }) => {
    const tableData = useMemo(() => {
        return simulationData.map((year, index) => {
            const totalTaxes = year.taxDetails.fed + year.taxDetails.state + year.taxDetails.fica;
            const livingExpenses = year.expenses.reduce((sum, exp) => sum + exp.getAnnualAmount(), 0);
            const totalSaved = year.cashflow.investedUser + year.cashflow.discretionary;
            const netWorth = getAccountTotals(year.accounts).netWorth;

            return {
                year: year.year,
                age: startAge + index,
                grossIncome: year.cashflow.totalIncome,
                totalTaxes,
                livingExpenses,
                totalSaved,
                netWorth,
            };
        });
    }, [simulationData, startAge]);

    const handleExportCSV = () => {
        const headers = ["Year", "Age", "Gross Income", "Total Taxes", "Living Expenses", "Total Saved", "Net Worth"];
        const keys: (keyof typeof tableData[0])[] = ["year", "age", "grossIncome", "totalTaxes", "livingExpenses", "totalSaved", "netWorth"];
        const csvRows = [headers.join(',')];

        tableData.forEach(row => {
            const values = keys.map(key => row[key]);
            csvRows.push(values.join(','));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'simulation_data.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-4 text-white">
            <div className="flex justify-end mb-4">
                <button
                    onClick={handleExportCSV}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors"
                >
                    Export to CSV
                </button>
            </div>
            <div className="overflow-y-auto h-[350px]">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-gray-900">
                        <tr>
                            <th className="p-2 border-b border-gray-700">Year</th>
                            <th className="p-2 border-b border-gray-700">Age</th>
                            <th className="p-2 border-b border-gray-700">Gross Income</th>
                            <th className="p-2 border-b border-gray-700">Total Taxes</th>
                            <th className="p-2 border-b border-gray-700">Living Expenses</th>
                            <th className="p-2 border-b border-gray-700">Total Saved</th>
                            <th className="p-2 border-b border-gray-700">Net Worth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((row) => (
                            <tr key={row.year} className="hover:bg-gray-800">
                                <td className="p-2 border-b border-gray-800">{row.year}</td>
                                <td className="p-2 border-b border-gray-800">{row.age}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.grossIncome)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.totalTaxes)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.livingExpenses)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.totalSaved)}</td>
                                <td className="p-2 border-b border-gray-800">{formatCurrency(row.netWorth)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};