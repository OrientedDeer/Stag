import { useContext, useState, useMemo } from "react";
import { AssumptionsContext, getBirthYear } from "../../components/Objects/Assumptions/AssumptionsContext";
import { SimulationContext } from "../../components/Objects/Assumptions/SimulationContext";
import MilestoneModal from "../../components/Objects/Assumptions/MilestoneModal";
import PlanBasicsSection from "../../components/Objects/Assumptions/PlanBasicsSection";
import { Panel } from "../../components/Layout/Primitives";
import { buildMilestoneReachYears } from "../../services/simulation/MilestoneEvaluator";
import { AssumptionsHelp } from "./assumptions/AssumptionsHelp";
import { GrowthRatesSection } from "./assumptions/GrowthRatesSection";
import { WithdrawalStrategySection } from "./assumptions/WithdrawalStrategySection";
import { AdvancedSettingsSection } from "./assumptions/AdvancedSettingsSection";

export default function AssumptionTab() {
  const { state, dispatch } = useContext(AssumptionsContext);
  const { simulation } = useContext(SimulationContext);
  const [showHelp, setShowHelp] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);

  const birthYear = useMemo(() => getBirthYear(state.milestones), [state.milestones]);

  // Derive milestoneId → year-reached from the cached simulation (shared extractor
  // so it can't drift from the other reach-year scans).
  const milestoneReachYears = useMemo(() => buildMilestoneReachYears(simulation), [simulation]);

  return (
    <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
        <div className="w-full px-4 sm:px-8 max-w-7xl">
            <div className="flex items-center justify-between mb-6 border-b border-border-subtle pb-2">
                <h2 className="text-2xl font-bold text-white">Assumptions</h2>
                <button
                    onClick={() => setShowHelp(!showHelp)}
                    className="text-xs text-content-muted hover:text-white flex items-center gap-1 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {showHelp ? 'Hide help' : 'How this works'}
                </button>
            </div>

            {showHelp && <AssumptionsHelp />}

            {/* Essential Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Left Column - Plan Basics & Growth Rates */}
                <Panel padding="none" className="p-5 shadow-lg space-y-5">
                    <div>
                        <h3 className="text-sm font-semibold text-white border-b border-border-default pb-2 mb-3">Plan Basics</h3>
                        <PlanBasicsSection onOpenMilestones={() => setShowMilestoneModal(true)} />
                    </div>
                    <GrowthRatesSection />
                </Panel>

                {/* Right Column - Withdrawal Strategy & Roth Conversions */}
                <Panel padding="none" className="p-5 shadow-lg space-y-5">
                    <WithdrawalStrategySection />
                </Panel>
            </div>

            <AdvancedSettingsSection />

            {/* Footer Actions */}
            <div className="flex items-center justify-end pt-4 border-t border-border-subtle">
                <button
                    onClick={() => dispatch({ type: 'RESET_DEFAULTS' })}
                    className="text-xs font-medium text-negative-soft hover:text-negative transition-colors px-3 py-1.5 border border-negative-tint/50 rounded hover:bg-negative-tint/10"
                >
                    Reset to Defaults
                </button>
            </div>
        </div>

        <MilestoneModal
            isOpen={showMilestoneModal}
            onClose={() => setShowMilestoneModal(false)}
            milestoneReachYears={milestoneReachYears}
            birthYear={birthYear}
        />
    </div>
  );
}
