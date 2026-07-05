import React, { useContext } from "react";
import {
    AssumptionsContext,
    BUILTIN_MILESTONE_IDS,
    isBuiltinMilestone,
    getBirthYear,
    getRetirementAge,
    getLifeExpectancy,
} from "./AssumptionsContext";
import { NumberInput } from "../../Layout/InputFields/NumberInput";

interface PlanBasicsSectionProps {
    className?: string;
    /** Opens the custom-milestone manager (MilestoneModal); wired by the tab. */
    onOpenMilestones?: () => void;
}

const MIN_BIRTH_YEAR = 1900;

/**
 * Inline editors for the three built-in milestones (Birth / Retire / End of
 * Plan). These used to hide behind the milestone modal's locked editor; now
 * they're plain inputs on the Assumptions tab, and the modal manages only
 * custom milestones.
 */
export const PlanBasicsSection: React.FC<PlanBasicsSectionProps> = ({ className = "", onOpenMilestones }) => {
    const { state, dispatch } = useContext(AssumptionsContext);
    const milestones = state.milestones || [];

    const currentYear = new Date().getFullYear();
    const birthYear = getBirthYear(milestones);
    const retirementAge = getRetirementAge(milestones);
    const lifeExpectancy = getLifeExpectancy(milestones);
    const customCount = milestones.filter(m => !isBuiltinMilestone(m.id)).length;

    // Rewrite the value on the built-in milestone's defining condition
    // (YEAR for Birth, AGE for Retire / End of Plan), preserving everything
    // else on the milestone (name, color, operator).
    const updateBuiltinValue = (id: string, conditionType: "YEAR" | "AGE", value: number) => {
        const milestone = milestones.find(m => m.id === id);
        if (!milestone) return;
        dispatch({
            type: "UPDATE_MILESTONE",
            payload: {
                ...milestone,
                conditions: milestone.conditions.map(c =>
                    c.type === conditionType ? { ...c, value } : c
                ),
            },
        });
    };

    // Loud validation, no silent coercion: the raw value is always dispatched;
    // an out-of-range value just renders the input's error affordance.
    const birthYearError =
        birthYear < MIN_BIRTH_YEAR || birthYear > currentYear
            ? `Enter a year between ${MIN_BIRTH_YEAR} and ${currentYear}`
            : undefined;
    const retirementAgeError = retirementAge <= 0 ? "Must be greater than 0" : undefined;
    const lifeExpectancyError =
        lifeExpectancy <= retirementAge
            ? `Must exceed retirement age (${retirementAge})`
            : undefined;

    return (
        <div className={className}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <NumberInput
                        label="Birth Year"
                        value={birthYear}
                        min={MIN_BIRTH_YEAR}
                        max={currentYear}
                        error={birthYearError}
                        onChange={(val) => updateBuiltinValue(BUILTIN_MILESTONE_IDS.BIRTH, "YEAR", val)}
                    />
                    {!birthYearError && (
                        <p className="text-xs text-content-muted mt-1">
                            Age {currentYear - birthYear} in {currentYear}
                        </p>
                    )}
                </div>
                <div>
                    <NumberInput
                        label="Retirement Age"
                        value={retirementAge}
                        min={1}
                        error={retirementAgeError}
                        onChange={(val) => updateBuiltinValue(BUILTIN_MILESTONE_IDS.RETIRE, "AGE", val)}
                    />
                    {!retirementAgeError && (
                        <p className="text-xs text-content-muted mt-1">
                            Retires in {birthYear + retirementAge}
                        </p>
                    )}
                </div>
                <div>
                    <NumberInput
                        label="Life Expectancy"
                        value={lifeExpectancy}
                        min={retirementAge + 1}
                        error={lifeExpectancyError}
                        onChange={(val) => updateBuiltinValue(BUILTIN_MILESTONE_IDS.END_OF_PLAN, "AGE", val)}
                    />
                    {!lifeExpectancyError && (
                        <p className="text-xs text-content-muted mt-1">
                            Plan ends {birthYear + lifeExpectancy}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
                <span className="text-xs text-content-muted">
                    {customCount} custom milestone{customCount === 1 ? "" : "s"}
                </span>
                <button
                    type="button"
                    onClick={onOpenMilestones}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-surface-input border border-border-default rounded-lg text-xs font-medium text-content-emphasis transition-colors"
                >
                    Manage custom milestones
                    <svg className="w-3.5 h-3.5 text-content-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default PlanBasicsSection;
