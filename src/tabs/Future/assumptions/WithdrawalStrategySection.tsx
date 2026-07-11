import { type ReactElement, useContext, useMemo } from "react";
import {
    AssumptionsContext,
    ACA_SUBSIDY_LOSS_DEFAULT,
    WITHDRAWAL_STRATEGY_OPTIONS,
    type WithdrawalStrategy,
} from "../../../components/Objects/Assumptions/AssumptionsContext";
import { SimulationContext } from "../../../components/Objects/Assumptions/SimulationContext";
import { PercentageInput } from "../../../components/Layout/InputFields/PercentageInput";
import { DropdownInput } from "../../../components/Layout/InputFields/DropdownInput";
import { ToggleInput } from "../../../components/Layout/InputFields/ToggleInput";
import { CurrencyInput } from "../../../components/Layout/InputFields/CurrencyInput";
import { SegmentedInput } from "../../../components/Layout/InputFields/SegmentedInput";
import { AlertBanner } from "../../../components/Layout/AlertBanner";
import { computeGKRateSuggestion, getAutoRate } from "../../../services/gkRateSuggestion";

const STRATEGY_DESCRIPTIONS: Record<WithdrawalStrategy, { label: string; body: string }> = {
    "None": {
        label: "None",
        body: "Withdraw exactly what your listed expenses require. No target rate — accounts are drawn down as needed to cover your planned spending.",
    },
    "Needs Based": {
        label: "Needs Based",
        body: "Withdraw exactly what your expenses require — no more, no less. Surplus income is invested; deficits are covered by withdrawals. Discretionary spending is never adjusted.",
    },
    "Fixed Real": {
        label: "Fixed Real",
        body: "Withdraw a fixed percentage of your initial portfolio, adjusted for inflation each year. Discretionary expenses are adjusted (up or down) to match this budget.",
    },
    "Percentage": {
        label: "Percentage",
        body: "Withdraw a fixed percentage of your current portfolio each year. Discretionary expenses are adjusted (up or down) to fit the budget, which naturally varies with market performance.",
    },
    "Guyton Klinger": {
        label: "Guyton-Klinger",
        body: "Dynamic strategy that adjusts spending based on portfolio performance. Cuts discretionary expenses in bad markets, increases them in good markets.",
    },
};

// Guardrails are stored as multipliers on the target rate (upper 1.2 = cut when
// the rate exceeds target by 20%; lower 0.8 = boost when it's 20% below), but
// edited as the percent offset. Rounded to 2 decimals for display.
const upperGuardrailToPercent = (multiplier: number): number => Math.round((multiplier - 1) * 10000) / 100;
const percentToUpperGuardrail = (percent: number): number => 1 + percent / 100;
const lowerGuardrailToPercent = (multiplier: number): number => Math.round((1 - multiplier) * 10000) / 100;
const percentToLowerGuardrail = (percent: number): number => 1 - percent / 100;

/**
 * Retirement Withdrawals panel: strategy picker, the strategy's rate control
 * (auto/manual for Guyton-Klinger), guardrail settings, and the Roth
 * conversion (ACA) settings.
 */
export function WithdrawalStrategySection(): ReactElement {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);

    const strategy = state.investments.withdrawalStrategy;
    const isGuytonKlinger = strategy === "Guyton Klinger";
    const rateMode = state.investments.withdrawalRateMode ?? "auto";
    const showManualRateInput =
        strategy === "Fixed Real" || strategy === "Percentage" || (isGuytonKlinger && rateMode === "manual");

    // Under Guyton-Klinger with a MANUAL rate, surface a tip when the user's
    // planned year-1 retirement spending implies an initial withdrawal rate that
    // differs meaningfully from the configured one, in EITHER direction. Too low
    // ('raise'): GK caps spending and produces amber budget-cap markers. Too high
    // ('lower'): the prosperity guardrail keeps boosting spending above plan.
    // `null` when there's nothing worth flagging (including auto mode, where the
    // engine derives the rate itself so it can never drift).
    const gkRateSuggestion = useMemo(
        () => computeGKRateSuggestion(simulation, state),
        // computeGKRateSuggestion only reads `investments` and `milestones` off
        // the assumptions state, so don't recompute on unrelated changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [simulation, state.investments, state.milestones],
    );

    // Engine-derived initial rate for the auto-mode readout.
    const autoRate = useMemo(
        () => (isGuytonKlinger && rateMode === "auto" ? getAutoRate(simulation, state) : null),
        // getAutoRate also only reads `investments` and `milestones` off the state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isGuytonKlinger, rateMode, simulation, state.investments, state.milestones],
    );

    const description = STRATEGY_DESCRIPTIONS[strategy];

    return (
        <>
            <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2">Retirement Withdrawals</h3>

            <div className="grid grid-cols-2 gap-3">
                <DropdownInput
                    label="Strategy"
                    value={strategy}
                    options={[...WITHDRAWAL_STRATEGY_OPTIONS]}
                    onChange={(val) =>
                        dispatch({ type: "UPDATE_INVESTMENTS", payload: { withdrawalStrategy: val as WithdrawalStrategy } })
                    }
                />
                {showManualRateInput && (
                    <PercentageInput
                        label="Withdrawal Rate"
                        value={state.investments.withdrawalRate}
                        onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { withdrawalRate: val } })}
                    />
                )}
            </div>

            {/* Guyton-Klinger rate mode: in Auto the engine derives the initial rate
                from planned spending ÷ portfolio at retirement; Manual exposes the
                rate input (plus the drift tip below). */}
            {isGuytonKlinger && (
                <SegmentedInput<"auto" | "manual">
                    label="Rate mode"
                    value={rateMode}
                    options={[
                        {
                            value: "auto",
                            label: "Auto",
                            caption:
                                autoRate !== null
                                    ? `Auto — currently ${autoRate.toFixed(1)}%`
                                    : "Auto — computed on next run",
                        },
                        {
                            value: "manual",
                            label: "Manual",
                            caption: "Set the initial withdrawal rate yourself",
                        },
                    ]}
                    onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { withdrawalRateMode: val } })}
                />
            )}

            {/* GK manual-rate suggestion: planned spending implies a different rate
                than the one set. computeGKRateSuggestion already returns null for any
                non-GK strategy and for auto mode, so a non-null suggestion implies
                Guyton-Klinger + manual. `direction` distinguishes too-low ('raise')
                from too-high ('lower'). */}
            {gkRateSuggestion && (
                <AlertBanner
                    severity="warning"
                    size="sm"
                    title={
                        gkRateSuggestion.direction === "raise"
                            ? "Your spending implies a higher initial rate"
                            : "Your spending implies a lower initial rate"
                    }
                >
                    {gkRateSuggestion.direction === "raise" ? (
                        <p>
                            Your year-1 retirement spending needs an initial rate of about{" "}
                            <span className="font-semibold">{gkRateSuggestion.suggestedRate.toFixed(1)}%</span> of your
                            portfolio at retirement — above your set rate of{" "}
                            <span className="font-semibold">{gkRateSuggestion.configuredRate.toFixed(1)}%</span>.
                            Guyton-Klinger will cap spending to the lower rate, which shows up as amber budget-cap
                            markers throughout retirement. Consider raising your initial rate.
                        </p>
                    ) : (
                        <p>
                            Your year-1 retirement spending only needs an initial rate of about{" "}
                            <span className="font-semibold">{gkRateSuggestion.suggestedRate.toFixed(1)}%</span> of your
                            portfolio at retirement — below your set rate of{" "}
                            <span className="font-semibold">{gkRateSuggestion.configuredRate.toFixed(1)}%</span>.
                            Guyton-Klinger's prosperity guardrail will keep boosting spending above your planned
                            budget to hit the higher rate. Consider lowering your initial rate.
                        </p>
                    )}
                    <button
                        onClick={() =>
                            dispatch({
                                type: "UPDATE_INVESTMENTS",
                                payload: { withdrawalRate: gkRateSuggestion.suggestedRate },
                            })
                        }
                        className="mt-2 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-warning-solid/80 hover:bg-warning-solid text-white transition-colors"
                    >
                        Set rate to {gkRateSuggestion.suggestedRate.toFixed(1)}%
                    </button>
                </AlertBanner>
            )}

            {/* Strategy Description */}
            <div className="text-xs text-content-muted bg-surface-overlay/50 rounded-lg p-3">
                <p>
                    <span className="text-content-default font-medium">{description.label}:</span> {description.body}
                </p>
            </div>

            {/* Guyton-Klinger Info */}
            {isGuytonKlinger && (
                <div className="p-3 bg-info-tint/20 rounded-lg border border-info-strong/50 text-xs text-info-bright">
                    <p className="font-medium text-info-bright mb-1">Note: Large Spending Swings Possible</p>
                    <p>The Guyton-Klinger strategy adjusts spending by {state.investments.gkAdjustmentPercent}% of your withdrawal amount when guardrails trigger. This can result in significant year-over-year changes in discretionary expenses, especially when your portfolio performs very well (prosperity) or poorly (capital preservation).</p>
                </div>
            )}

            {/* Guyton-Klinger Settings */}
            {isGuytonKlinger && (
                <div className="p-3 bg-positive-tint/20 rounded-lg border border-positive-strong/50 space-y-3">
                    <h4 className="text-xs uppercase text-positive font-semibold">Guardrail Settings</h4>
                    <div className="grid grid-cols-3 gap-2">
                        <PercentageInput
                            label="Upper"
                            value={upperGuardrailToPercent(state.investments.gkUpperGuardrail)}
                            onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { gkUpperGuardrail: percentToUpperGuardrail(val) } })}
                            tooltip="Cut spending when withdrawal rate exceeds target by this %"
                        />
                        <PercentageInput
                            label="Lower"
                            value={lowerGuardrailToPercent(state.investments.gkLowerGuardrail)}
                            onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { gkLowerGuardrail: percentToLowerGuardrail(val) } })}
                            tooltip="Increase spending when withdrawal rate is below target by this %"
                        />
                        <PercentageInput
                            label="Adjustment"
                            value={state.investments.gkAdjustmentPercent}
                            onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { gkAdjustmentPercent: val } })}
                            tooltip="How much to cut/increase discretionary expenses"
                        />
                    </div>
                </div>
            )}

            {/* Roth Conversions */}
            <div className="pt-4 border-t border-border-subtle space-y-3">
                <h4 className="text-xs uppercase text-content-muted font-semibold">Roth Conversions</h4>
                <ToggleInput
                    label="ACA-Aware Conversions"
                    enabled={state.investments.acaAware ?? true}
                    setEnabled={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { acaAware: val } })}
                    tooltip="Limit Roth conversions before age 65 to stay under the ACA subsidy cliff. Turn off to allow larger conversions if you have non-ACA health coverage."
                />
                {(state.investments.acaAware ?? true) && (
                    <div>
                        <CurrencyInput
                            label="Est. Annual ACA Subsidy"
                            value={state.investments.acaAnnualSubsidyLoss ?? ACA_SUBSIDY_LOSS_DEFAULT}
                            onChange={(val) => dispatch({ type: "UPDATE_INVESTMENTS", payload: { acaAnnualSubsidyLoss: val } })}
                            tooltip="Your estimated annual marketplace premium subsidy. Check your ACA exchange for your actual premium tax credit."
                        />
                        <p className="text-xs text-content-muted mt-1">
                            Charged as a real cost in any pre-65 retirement year whose income crosses
                            the 400% FPL cliff, so the plan weighs conversions against losing it.
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}
