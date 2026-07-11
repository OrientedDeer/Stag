import { type ReactElement } from "react";

/**
 * "How this works" expandable help block for the Assumptions tab. Purely
 * presentational; visibility is controlled by the tab.
 */
export function AssumptionsHelp(): ReactElement {
    return (
        <div className="mb-6 bg-info-tint/20 border border-info-strong/50 rounded-xl p-4 text-sm">
            <h3 className="font-semibold text-info-bright mb-2">Understanding Assumptions</h3>
            <p className="text-content-default mb-3">
                These settings control how your financial future is projected. Small changes here can have large impacts over decades, so choose values that reflect your expectations.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                    <h4 className="font-semibold text-content-emphasis">Key Settings:</h4>
                    <ul className="text-content-muted space-y-1">
                        <li><span className="text-white">Plan Basics</span> — Birth year, retirement age, life expectancy</li>
                        <li><span className="text-white">Investment Return</span> — Expected annual growth (7% is historical avg)</li>
                        <li><span className="text-white">Inflation</span> — How fast prices rise (3% is typical)</li>
                        <li><span className="text-white">Withdrawal Rate</span> — % of portfolio taken yearly in retirement</li>
                    </ul>
                </div>
                <div className="space-y-2">
                    <h4 className="font-semibold text-content-emphasis">Inflation Adjusted Mode:</h4>
                    <ul className="text-content-muted space-y-1">
                        <li><span className="text-positive">Enabled</span> — Projects in future dollars; growth rates are real (above inflation)</li>
                        <li><span className="text-warning">Disabled</span> — Everything shown in today's dollars</li>
                    </ul>
                    <p className="text-content-subtle mt-2">Same plan either way — only the dollars the numbers are shown in differ.</p>
                </div>
            </div>
            <p className="text-content-muted mt-3 text-xs">
                <span className="text-content-default">Tip:</span> The 4% withdrawal rule suggests you can safely withdraw 4% of your portfolio annually. More conservative planners use 3-3.5%.
            </p>
        </div>
    );
}
