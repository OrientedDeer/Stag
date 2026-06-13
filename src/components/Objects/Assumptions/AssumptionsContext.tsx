// @refresh reset - This file exports both components and hooks, so full remount is needed for HMR
import { createContext, useReducer, useContext, ReactNode, useMemo } from 'react';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';
import { EarningsRecord } from '../../../services/SocialSecurityCalculator';
import { CustomMilestone } from '../../../services/simulation/types';

// Built-in milestone IDs that cannot be removed
export const BUILTIN_MILESTONE_IDS = {
    BIRTH: 'BUILTIN_BIRTH',
    RETIRE: 'BUILTIN_RETIRE',
    END_OF_PLAN: 'BUILTIN_END_OF_PLAN',
} as const;

// Check if a milestone is a built-in milestone
export const isBuiltinMilestone = (id: string): boolean =>
    Object.values(BUILTIN_MILESTONE_IDS).includes(id as typeof BUILTIN_MILESTONE_IDS[keyof typeof BUILTIN_MILESTONE_IDS]);

// Default values for built-in milestones
const DEFAULT_BIRTH_YEAR = 1990;
const DEFAULT_RETIREMENT_AGE = 65;
const DEFAULT_LIFE_EXPECTANCY = 90;

// Create default built-in milestones
export const createBuiltinMilestones = (
    birthYear: number = DEFAULT_BIRTH_YEAR,
    retirementAge: number = DEFAULT_RETIREMENT_AGE,
    lifeExpectancy: number = DEFAULT_LIFE_EXPECTANCY
): CustomMilestone[] => [
    {
        id: BUILTIN_MILESTONE_IDS.BIRTH,
        name: 'Birth',
        conditions: [{ type: 'YEAR', operator: '=', value: birthYear }],
        color: 'var(--c-accent-soft)', // blue-500
    },
    {
        id: BUILTIN_MILESTONE_IDS.RETIRE,
        name: 'Retire',
        conditions: [{ type: 'AGE', operator: '>=', value: retirementAge }],
        color: 'var(--c-positive-soft)', // green-500
    },
    {
        id: BUILTIN_MILESTONE_IDS.END_OF_PLAN,
        name: 'End of Plan',
        // Trigger AFTER life expectancy year so expenses continue through it
        conditions: [{ type: 'AGE', operator: '>=', value: lifeExpectancy}],
        color: 'var(--c-content-subtle)', // gray-500
    },
];

// Helper: Get the AGE value from a milestone's first AGE condition
export const getAgeFromMilestone = (milestone: CustomMilestone | undefined, defaultValue: number): number => {
    if (!milestone) return defaultValue;
    const ageCondition = milestone.conditions.find(c => c.type === 'AGE');
    return ageCondition?.value ?? defaultValue;
};

// Get birth year from the Birth milestone
export const getBirthYear = (milestones: CustomMilestone[]): number => {
    const birthMilestone = milestones.find(m => m.id === BUILTIN_MILESTONE_IDS.BIRTH);
    if (!birthMilestone) return DEFAULT_BIRTH_YEAR;
    const yearCondition = birthMilestone.conditions.find(c => c.type === 'YEAR');
    return yearCondition?.value ?? DEFAULT_BIRTH_YEAR;
};

// Get retirement age from the Retire milestone
export const getRetirementAge = (milestones: CustomMilestone[]): number => {
    const retireMilestone = milestones.find(m => m.id === BUILTIN_MILESTONE_IDS.RETIRE);
    return getAgeFromMilestone(retireMilestone, DEFAULT_RETIREMENT_AGE);
};

// Get life expectancy from the End of Plan milestone
export const getLifeExpectancy = (milestones: CustomMilestone[]): number => {
    const endOfPlanMilestone = milestones.find(m => m.id === BUILTIN_MILESTONE_IDS.END_OF_PLAN);
    const rawValue = getAgeFromMilestone(endOfPlanMilestone, DEFAULT_LIFE_EXPECTANCY);
    return rawValue;
};

export type CapType = 'MAX' | 'FIXED' | 'REMAINDER' | 'MULTIPLE_OF_EXPENSES';

export interface PriorityBucket {
  id: string;
  name: string; // e.g., "Max out 401k"
  type: 'DEBT' | 'INVESTMENT' | 'SAVINGS';
  accountId?: string; // Link to your actual Account IDs
  capType: CapType;
  capValue?: number; // e.g., 23000 for 401k, or 500 for monthly savings
}

export interface WithdrawalBucket {
  id: string;
  name: string;      // e.g. "Emergency Fund", "Brokerage"
  accountId: string; // The account to drain
  maxAmount?: number; // Optional cap on annual withdrawal from this bucket (e.g., to stay in a tax bracket)
}

export interface AssumptionsState {
  macro: {
    inflationRate: number;       // e.g., 3.0
    healthcareInflation: number; // e.g., 5.0
    inflationAdjusted: boolean;   // usually true (pegged to inflation)
  };
  income: {
    salaryGrowth: number;        // e.g., 3.0
    qualifiesForSocialSecurity: boolean; // Whether user expects to receive SS benefits
    socialSecurityFundingPercent: number; // Expected % of SS benefits (e.g., 75 if pessimistic about solvency)
  };
  expenses: {
    lifestyleCreep: number;      // e.g., 50.0 (% of raise spent)
    housingAppreciation: number; // e.g., 3.5
    rentInflation: number;       // e.g., 4.0
  };
  investments: {
    returnRates: {
      ror: number;   // e.g., 10.0
    };
    withdrawalStrategy: 'None' | 'Needs Based' | 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
    withdrawalRate: number; // e.g., 4.0
    // Guyton-Klinger guardrail settings
    gkUpperGuardrail: number;     // Default 1.2 (20% above target triggers cut)
    gkLowerGuardrail: number;     // Default 0.8 (20% below target triggers boost)
    gkAdjustmentPercent: number;  // Default 10 (10% cut/increase per GK rules)
    // Auto Roth conversions during retirement
    autoRothConversions: boolean; // Automatically convert Traditional to Roth in low-tax years
    // Which algorithm decides the per-year conversion amount when auto-conversions are on.
    // 'rate-match' = bracket-walk that compares this year's marginal to projected RMD-age marginal.
    // 'dp-precomputed' = experimental backward-induction DP solved once over the full horizon.
    rothConversionStrategy?: 'rate-match' | 'dp-precomputed';
    // Rate-match conversion: minimum percentage-point gap between current marginal
    // rate and projected RMD-age marginal rate to justify converting that bracket.
    // Higher = more conservative (skip conversions with smaller savings).
    // 0.05 = "convert at 12% to dodge 22% only if savings ≥ 5pp."
    rothConversionMinRateGap?: number;
    // DP-precomputed conversion: per-year back-load preference (δ).
    // V(t, b) = min over c of [tax(c) + (1 / (1 + δ)) × V(t+1, b')].
    // δ > 0 makes future tax look slightly cheaper than present tax, biasing
    // the optimal plan toward later conversions (SORR-friendly) at the cost of
    // some lifetime-tax efficiency. 0 = lifetime-optimal (mildly front-loaded).
    // 0.015 = 1.5%/yr (default). See RothConversionDP.ts for derivation.
    rothConversionDPBackloadDelta?: number;
    // Tax Optimization Mode
    taxOptimizationEnabled: boolean; // When enabled, uses smart withdrawal order and auto-calculated Roth conversions
    acaAware: boolean; // When true, limit Roth conversions to stay under ACA subsidy cliff (pre-65)
    };
  demographics: {
    priorEarnings?: EarningsRecord[];  // SSA earnings history imported from XML
    priorYearMode?: boolean;  // If true, simulation starts from last year using verified data
    // NOTE: birthYear, retirementAge, and lifeExpectancy are derived from milestones
    // Use getBirthYear(), getRetirementAge(), getLifeExpectancy() helpers
  };
  display: {
    useCompactCurrency: boolean; // Show $1.2M instead of $1,200,000
    showExperimentalFeatures: boolean; // Show Tax, Scenarios, Ratios tabs
    // Show the Testing tab and chart self-check diagnostics. Optional so saved
    // data (and existing display literals) predating the flag stay valid;
    // migrateAssumptions fills in the default (false) on load.
    showDevTools?: boolean;
    hsaEligible: boolean; // Whether user has HDHP and is eligible for HSA
  };
  priorities: PriorityBucket[];
  withdrawalStrategy: WithdrawalBucket[]; // The "Burn Order"
  milestones: CustomMilestone[]; // User-defined milestone triggers
}

export const defaultAssumptions: AssumptionsState = {
  macro: {
    inflationRate: 2.6,
    healthcareInflation: 3.9,
    inflationAdjusted: true,
  },
  income: {
    salaryGrowth: 1.0,
    qualifiesForSocialSecurity: true,
    socialSecurityFundingPercent: 100, // 100% = full benefits, reduce if pessimistic about SS solvency
  },
  expenses: {
    lifestyleCreep: 75.0,
    housingAppreciation: 1.4,
    rentInflation: 1.2,
  },
  investments: {
    returnRates: { ror: 5.9 },
    withdrawalStrategy: 'Fixed Real',
    withdrawalRate: 4.0,
    gkUpperGuardrail: 1.2,      // Cut when rate > target * 1.2
    gkLowerGuardrail: 0.8,      // Boost when rate < target * 0.8
    gkAdjustmentPercent: 10,    // 10% adjustment (per actual GK rules)
    autoRothConversions: false, // Auto-convert Traditional to Roth in retirement
    rothConversionStrategy: 'rate-match', // 'rate-match' (default) | 'dp-precomputed' (experimental)
    rothConversionMinRateGap: 0.05, // 5pp minimum savings to justify a non-free conversion (rate-match algorithm)
    rothConversionDPBackloadDelta: 0.015, // 1.5%/yr default — DP-precomputed back-load preference
    taxOptimizationEnabled: false, // Disabled by default - use manual withdrawal order
    acaAware: true, // Limit Roth conversions to stay under ACA subsidy cliff (pre-65)
  },
  demographics: {
    priorYearMode: false, // Default to current year mode
    // birthYear, retirementAge, lifeExpectancy are now in milestones
  },
  display: {
    useCompactCurrency: true,
    showExperimentalFeatures: false,
    showDevTools: false,
    hsaEligible: true,
  },
  priorities: [],
  withdrawalStrategy: [],
  milestones: createBuiltinMilestones(), // Built-in milestones with default values (birth 1990, retire 65, life 90)
};

/**
 * Deep merge saved data with defaults, ensuring all fields exist.
 * This handles cases where old localStorage data is missing newer fields.
 */
export function migrateAssumptions(saved: unknown, defaults: AssumptionsState): AssumptionsState {
  // If saved is not an object, return defaults
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return defaults;
  }

  const data = saved as Record<string, unknown>;

  // Helper to safely merge nested objects
  const mergeSection = <T extends Record<string, unknown>>(
    savedSection: unknown,
    defaultSection: T
  ): T => {
    if (!savedSection || typeof savedSection !== 'object' || Array.isArray(savedSection)) {
      return defaultSection;
    }
    const section = savedSection as Record<string, unknown>;
    const result = { ...defaultSection };

    for (const key of Object.keys(defaultSection)) {
      const defaultValue = defaultSection[key];
      const savedValue = section[key];

      // If savedValue exists and is the right type, use it
      if (savedValue !== undefined && savedValue !== null) {
        // Type check: ensure saved value matches expected type
        if (typeof savedValue === typeof defaultValue) {
          (result as Record<string, unknown>)[key] = savedValue;
        } else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
          // Recursively merge nested objects
          (result as Record<string, unknown>)[key] = mergeSection(
            savedValue,
            defaultValue as Record<string, unknown>
          );
        }
        // If types don't match, keep the default
      }
      // If savedValue is undefined/null, keep the default
    }
    return result;
  };

  // Build migrated state by merging each section
  const migrated: AssumptionsState = {
    macro: mergeSection(data.macro, defaults.macro),
    income: mergeSection(data.income, defaults.income),
    expenses: mergeSection(data.expenses, defaults.expenses),
    investments: {
      ...mergeSection(data.investments, defaults.investments),
      // Ensure nested returnRates is also merged
      returnRates: mergeSection(
        (data.investments as Record<string, unknown>)?.returnRates,
        defaults.investments.returnRates
      ),
    },
    demographics: mergeSection(data.demographics, defaults.demographics),
    display: mergeSection(data.display, defaults.display),
    // Arrays: use saved if it's a valid array, otherwise use default
    priorities: Array.isArray(data.priorities) ? data.priorities as PriorityBucket[] : defaults.priorities,
    withdrawalStrategy: Array.isArray(data.withdrawalStrategy) ? data.withdrawalStrategy as WithdrawalBucket[] : defaults.withdrawalStrategy,
    // When saved data has no milestones array, start EMPTY (not defaults.milestones)
    // so the built-in-milestone synthesis below actually fires and can seed Birth/
    // Retire/End-of-Plan from any legacy demographics.{birthYear,retirementAge,
    // lifeExpectancy}. If we copied defaults.milestones here, those built-ins would
    // already exist at default values (1990/65/90) and the legacy values would be
    // silently dropped (Findings #8/#12).
    milestones: Array.isArray(data.milestones) ? data.milestones as CustomMilestone[] : [],
  };

  // Migration: Get legacy values from old demographics if present
  const savedDemographics = data.demographics as Record<string, unknown> | undefined;

  // priorEarnings is a saved-only demographics field (absent from the defaults
  // object), so the mergeSection above silently drops it on every reload.
  // Preserve the imported SSA earnings history explicitly — the SS benefit
  // projection (IncomeProjection) depends on it.
  if (savedDemographics?.priorEarnings !== undefined && savedDemographics?.priorEarnings !== null) {
    migrated.demographics.priorEarnings = savedDemographics.priorEarnings as EarningsRecord[];
  }

  // Handle very old format with startAge/startYear
  let legacyBirthYear = savedDemographics?.birthYear as number | undefined;
  if (!legacyBirthYear && savedDemographics) {
    const startAge = savedDemographics.startAge as number | undefined;
    const startYear = savedDemographics.startYear as number | undefined;
    if (startAge !== undefined && startYear !== undefined) {
      legacyBirthYear = startYear - startAge;
    } else if (startAge !== undefined) {
      legacyBirthYear = new Date().getFullYear() - startAge;
    }
  }

  const legacyRetirementAge = savedDemographics?.retirementAge as number | undefined;
  const legacyLifeExpectancy = savedDemographics?.lifeExpectancy as number | undefined;

  // Use legacy values or defaults for creating built-in milestones
  const birthYearForMilestones = legacyBirthYear ?? DEFAULT_BIRTH_YEAR;
  const retirementAgeForMilestones = legacyRetirementAge ?? DEFAULT_RETIREMENT_AGE;
  const lifeExpectancyForMilestones = legacyLifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY;

  // Migration: Ensure built-in milestones always exist
  const existingIds = new Set(migrated.milestones.map(m => m.id));

  // If Birth milestone doesn't exist, create it with legacy or default value
  if (!existingIds.has(BUILTIN_MILESTONE_IDS.BIRTH)) {
    migrated.milestones.unshift({
      id: BUILTIN_MILESTONE_IDS.BIRTH,
      name: 'Birth',
      conditions: [{ type: 'YEAR', operator: '=', value: birthYearForMilestones }],
      color: 'var(--c-accent-soft)',
    });
  }

  // If Retire milestone doesn't exist, create it with legacy or default value
  if (!existingIds.has(BUILTIN_MILESTONE_IDS.RETIRE)) {
    const birthIndex = migrated.milestones.findIndex(m => m.id === BUILTIN_MILESTONE_IDS.BIRTH);
    const insertIndex = birthIndex >= 0 ? birthIndex + 1 : 0;
    migrated.milestones.splice(insertIndex, 0, {
      id: BUILTIN_MILESTONE_IDS.RETIRE,
      name: 'Retire',
      conditions: [{ type: 'AGE', operator: '>=', value: retirementAgeForMilestones }],
      color: 'var(--c-positive-soft)',
    });
  }

  // If End of Plan milestone doesn't exist, create it with legacy or default value
  if (!existingIds.has(BUILTIN_MILESTONE_IDS.END_OF_PLAN)) {
    const retireIndex = migrated.milestones.findIndex(m => m.id === BUILTIN_MILESTONE_IDS.RETIRE);
    const insertIndex = retireIndex >= 0 ? retireIndex + 1 : 0;
    migrated.milestones.splice(insertIndex, 0, {
      id: BUILTIN_MILESTONE_IDS.END_OF_PLAN,
      name: 'End of Plan',
      // Trigger AFTER life expectancy year so expenses continue through it
      conditions: [{ type: 'AGE', operator: '>=', value: lifeExpectancyForMilestones }],
      color: 'var(--c-content-subtle)',
    });
  }

  // Ensure built-in milestones have correct names and formats
  migrated.milestones = migrated.milestones.map(m => {
    if (m.id === BUILTIN_MILESTONE_IDS.BIRTH) {
      return { ...m, name: 'Birth' };
    }
    if (m.id === BUILTIN_MILESTONE_IDS.RETIRE) {
      return { ...m, name: 'Retire' };
    }
    if (m.id === BUILTIN_MILESTONE_IDS.END_OF_PLAN) {
      // Migrate old format (operator '>') to new format (operator '>=') preserving
      // the age value: getLifeExpectancy returns this value verbatim, so it must equal
      // the intended life expectancy for both fresh and migrated users (no +1).
      const ageCondition = m.conditions.find(c => c.type === 'AGE');
      if (ageCondition && ageCondition.operator === '>') {
        return {
          ...m,
          name: 'End of Plan',
          conditions: [{ type: 'AGE' as const, operator: '>=' as const, value: ageCondition.value }],
        };
      }
      return { ...m, name: 'End of Plan' };
    }
    return m;
  });

  // Clear deprecated fields (they're now derived from milestones)
  delete (migrated.demographics as Record<string, unknown>).birthYear;
  delete (migrated.demographics as Record<string, unknown>).retirementAge;
  delete (migrated.demographics as Record<string, unknown>).lifeExpectancy;

  return migrated;
}

type Action =
  | { type: 'UPDATE_MACRO'; payload: Partial<AssumptionsState['macro']> }
  | { type: 'UPDATE_INCOME'; payload: Partial<AssumptionsState['income']> }
  | { type: 'UPDATE_EXPENSES'; payload: Partial<AssumptionsState['expenses']> }
  | { type: 'UPDATE_INVESTMENTS'; payload: Partial<AssumptionsState['investments']> }
  | { type: 'UPDATE_INVESTMENT_RATES'; payload: Partial<AssumptionsState['investments']['returnRates']> }
  | { type: 'UPDATE_DEMOGRAPHICS'; payload: Partial<AssumptionsState['demographics']> }
  | { type: 'UPDATE_DISPLAY'; payload: Partial<AssumptionsState['display']> }
  | { type: 'RESET_DEFAULTS' }
  | { type: 'SET_BULK_DATA'; payload: AssumptionsState }
  | { type: 'SET_PRIORITIES'; payload: PriorityBucket[] }
  | { type: 'ADD_PRIORITY'; payload: PriorityBucket }
  | { type: 'REMOVE_PRIORITY'; payload: string }
  | { type: 'UPDATE_PRIORITY'; payload: PriorityBucket }
  | { type: 'SET_WITHDRAWAL_STRATEGY'; payload: WithdrawalBucket[] }
  | { type: 'ADD_WITHDRAWAL_STRATEGY'; payload: WithdrawalBucket }
  | { type: 'REMOVE_WITHDRAWAL_STRATEGY'; payload: string }
  | { type: 'UPDATE_WITHDRAWAL_STRATEGY'; payload: WithdrawalBucket }
  | { type: 'SET_PRIOR_EARNINGS'; payload: EarningsRecord[] }
  | { type: 'CLEAR_PRIOR_EARNINGS' }
  | { type: 'SET_MILESTONES'; payload: CustomMilestone[] }
  | { type: 'ADD_MILESTONE'; payload: CustomMilestone }
  | { type: 'REMOVE_MILESTONE'; payload: string }
  | { type: 'UPDATE_MILESTONE'; payload: CustomMilestone };

const assumptionsReducer = (state: AssumptionsState, action: Action): AssumptionsState => {
  switch (action.type) {
    case 'UPDATE_MACRO':
      return { ...state, macro: { ...state.macro, ...action.payload } };
    case 'UPDATE_INCOME':
      return { ...state, income: { ...state.income, ...action.payload } };
    case 'UPDATE_EXPENSES':
      return { ...state, expenses: { ...state.expenses, ...action.payload } };
    case 'UPDATE_INVESTMENTS':
      return { ...state, investments: { ...state.investments, ...action.payload } };
    case 'UPDATE_INVESTMENT_RATES':
      return {
        ...state,
        investments: {
          ...state.investments,
          returnRates: { ...state.investments.returnRates, ...action.payload },
        },
      };
    case 'UPDATE_DEMOGRAPHICS':
      return { ...state, demographics: { ...state.demographics, ...action.payload } };
    case 'UPDATE_DISPLAY':
      return { ...state, display: { ...state.display, ...action.payload } };
    case 'RESET_DEFAULTS':
      // Preserve user's allocations, withdrawal order, and milestones
      return {
        ...defaultAssumptions,
        priorities: state.priorities,
        withdrawalStrategy: state.withdrawalStrategy,
        milestones: state.milestones,
      };
    case 'SET_BULK_DATA':
      return action.payload;
    case 'SET_PRIORITIES':
        return { ...state, priorities: action.payload };
    case 'ADD_PRIORITY':
        return { ...state, priorities: [...state.priorities, action.payload] };
    case 'REMOVE_PRIORITY':
        return { ...state, priorities: state.priorities.filter(p => p.id !== action.payload) };
    case 'UPDATE_PRIORITY':
        return { 
            ...state, 
            priorities: state.priorities.map(p => p.id === action.payload.id ? action.payload : p) 
        };
    case 'SET_WITHDRAWAL_STRATEGY':
        return { ...state, withdrawalStrategy: action.payload };
    case 'ADD_WITHDRAWAL_STRATEGY':
        return { ...state, withdrawalStrategy: [...state.withdrawalStrategy, action.payload] };
    case 'REMOVE_WITHDRAWAL_STRATEGY':
        return { ...state, withdrawalStrategy: state.withdrawalStrategy.filter(p => p.id !== action.payload) };
    case 'UPDATE_WITHDRAWAL_STRATEGY':
        return {
            ...state,
            withdrawalStrategy: state.withdrawalStrategy.map(p => p.id === action.payload.id ? action.payload : p)
        };
    case 'SET_PRIOR_EARNINGS':
        return {
            ...state,
            demographics: { ...state.demographics, priorEarnings: action.payload }
        };
    case 'CLEAR_PRIOR_EARNINGS':
        return {
            ...state,
            demographics: { ...state.demographics, priorEarnings: undefined }
        };
    case 'SET_MILESTONES':
        return { ...state, milestones: action.payload };
    case 'ADD_MILESTONE':
        return { ...state, milestones: [...state.milestones, action.payload] };
    case 'REMOVE_MILESTONE':
        // Prevent removing built-in milestones
        if (isBuiltinMilestone(action.payload)) {
            return state;
        }
        return { ...state, milestones: state.milestones.filter(m => m.id !== action.payload) };
    case 'UPDATE_MILESTONE': {
        // For built-in milestones, preserve the name
        const updatedMilestone = isBuiltinMilestone(action.payload.id)
            ? { ...action.payload, name: state.milestones.find(m => m.id === action.payload.id)?.name || action.payload.name }
            : action.payload;
        return {
            ...state,
            milestones: state.milestones.map(m => m.id === updatedMilestone.id ? updatedMilestone : m)
        };
    }
    default:
      return state;
  }
};

interface AssumptionsContextProps {
    state: AssumptionsState;
    dispatch: React.Dispatch<Action>;
}

export const AssumptionsContext = createContext<AssumptionsContextProps>({
  state: defaultAssumptions,
  dispatch: () => null,
})

export const AssumptionsProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(assumptionsReducer, defaultAssumptions, (initial) => {
    const saved = localStorage.getItem('assumptions_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Deep merge with defaults to handle missing fields from older versions
        return migrateAssumptions(parsed, initial);
      } catch {
        // JSON parse failed - return defaults
        return initial;
      }
    }
    return initial;
  });

  // Debounced localStorage persistence (500ms delay to prevent main thread blocking)
  useDebouncedLocalStorage('assumptions_settings', state);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    state,
    dispatch
  }), [state, dispatch]);

  return <AssumptionsContext.Provider value={contextValue}>{children}</AssumptionsContext.Provider>;
};

/**
 * Custom hook to access assumptions state
 * @returns Object containing assumptions state and dispatch function
 */
export const useAssumptions = () => {
  const { state, dispatch } = useContext(AssumptionsContext);
  return { assumptions: state, dispatch };
};
