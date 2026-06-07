import { memo } from 'react';

interface HelpSectionProps {
    taxOptimizationEnabled: boolean;
}

function HelpSectionInner({ taxOptimizationEnabled }: HelpSectionProps) {
    return (
        <div className="mb-6 mt-4 bg-info-tint/20 border border-info-strong/50 rounded-xl p-4 text-sm">
            <h3 className="font-semibold text-info-bright mb-2">Understanding Withdrawal Order</h3>
            <p className="text-content-default mb-3">
                In retirement, when your expenses exceed your income, money is withdrawn from your accounts to cover the gap.
                {taxOptimizationEnabled
                    ? ' With Tax Optimization enabled, the system automatically determines the best order each year.'
                    : ' The order you set here determines which accounts get drained first.'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-2">
                    <h4 className="font-semibold text-content-emphasis">Tax Treatment:</h4>
                    <ul className="text-content-muted space-y-1">
                        <li><span className="text-positive">Tax-Free</span> — Roth, HSA, Cash: No tax on withdrawals</li>
                        <li><span className="text-warning">Taxable</span> — Traditional 401k/IRA: Adds to taxable income</li>
                        <li><span className="text-info">Cap Gains</span> — Brokerage: Only gains are taxed</li>
                    </ul>
                </div>
                <div className="space-y-2">
                    <h4 className="font-semibold text-content-emphasis">{taxOptimizationEnabled ? 'Tax Optimization Strategy:' : 'Common Strategies:'}</h4>
                    <ul className="text-content-muted space-y-1">
                        {taxOptimizationEnabled ? (
                            <>
                                <li><span className="text-white">Bracket filling:</span> Fill lower brackets with Traditional first</li>
                                <li><span className="text-white">Smart ordering:</span> Use Roth for excess, preserve tax-free growth</li>
                                <li><span className="text-white">CG optimization:</span> Prefer long-term gains when rates are lower</li>
                            </>
                        ) : (
                            <>
                                <li><span className="text-white">Tax-efficient:</span> Taxable → Tax-deferred → Tax-free</li>
                                <li><span className="text-white">Roth ladder:</span> Convert Traditional to Roth over time</li>
                                <li><span className="text-white">Bracket filling:</span> Withdraw Traditional up to tax bracket</li>
                            </>
                        )}
                    </ul>
                </div>
            </div>
            <p className="text-content-muted mt-3 text-xs">
                {taxOptimizationEnabled ? (
                    <><span className="text-content-default">Note:</span> Tax Optimization automatically manages Roth conversions and withdrawal ordering. Manual ordering below is disabled.</>
                ) : (
                    <><span className="text-content-default">Tip:</span> Consider withdrawing from taxable accounts first to let tax-advantaged accounts grow longer. Early withdrawal from Traditional accounts before 59½ incurs a 10% penalty.</>
                )}
            </p>
        </div>
    );
}

export const HelpSection = memo(HelpSectionInner);
