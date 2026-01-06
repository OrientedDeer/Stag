import { useMemo } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { SimulationYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { SavedAccount, InvestedAccount, PropertyAccount } from '../../../components/Objects/Accounts/models';

export const AssetsTab = ({ simulationData }: { simulationData: SimulationYear[] }) => {
    const keys = ['Property', 'Invested', 'Saved'];
    const chartData = useMemo(() => {
        return simulationData.map(year => {
            const saved = year.accounts.filter(acc => acc instanceof SavedAccount).reduce((sum, acc) => sum + acc.amount, 0);
            const invested = year.accounts.filter(acc => acc instanceof InvestedAccount).reduce((sum, acc) => sum + acc.amount, 0);
            const property = year.accounts.filter(acc => acc instanceof PropertyAccount).reduce((sum, acc) => sum + acc.amount, 0);
            return {
                year: year.year,
                Saved: saved,
                Invested: invested,
                Property: property,
            };
        });
    }, [simulationData]);

    return (
        <div className="p-4 text-white h-[400px]">
            <ResponsiveBar
                data={chartData}
                keys={keys}
                indexBy="year"
                margin={{ top: 50, right: 60, bottom: 60, left: 80 }}
                padding={0.3}
                groupMode="stacked"
                valueScale={{ type: 'linear' }}
                indexScale={{ type: 'band', round: true }}
                colors={{ scheme: 'set2' }}
                valueFormat=" >-$,.0f"
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Year',
                    legendPosition: 'middle',
                    legendOffset: 32
                }}
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Asset Value',
                    legendPosition: 'middle',
                    legendOffset: -70,
                    format: " >-$,.0f"
                }}
                labelSkipWidth={12}
                labelSkipHeight={12}
                legends={[
                    {
                        dataFrom: 'keys',
                        anchor: 'bottom',
                        direction: 'row',
                        justify: false,
                        translateX: 20,
                        translateY: 50,
                        itemsSpacing: 2,
                        itemWidth: 100,
                        itemHeight: 20,
                        itemDirection: 'left-to-right',
                        itemOpacity: 0.85,
                        symbolSize: 20,
                    }
                ]}
                theme={{
                    "background": "#09090b",
                    "text": { "fontSize": 12, "fill": "#ffffff" },
                    "axis": { "legend": { "text": { "fill": "#ffffff" } }, "ticks": { "text": { "fill": "#dddddd" } } },
                    "grid": { "line": { "stroke": "#444444", "strokeWidth": 1 } },
                    "tooltip": { "container": { "background": "#222222", "color": "#ffffff", "fontSize": 12 } }
                }}
            />
        </div>
    );
};