// @refresh reset - This file exports both components and hooks, so full remount is needed for HMR
import { createContext, useReducer, useContext, ReactNode, useMemo } from 'react';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';
import { EarningsRecord } from '../../../services/SocialSecurityCalculator';

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
  // No "Cap" needed usually - we just drain until empty, then move to next.
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
    withdrawalStrategy: 'Fixed Real' | 'Percentage' | 'Guyton Klinger';
    withdrawalRate: number; // e.g., 4.0
    // Guyton-Klinger guardrail settings
    gkUpperGuardrail: number;     // Default 1.2 (20% above target triggers cut)
    gkLowerGuardrail: number;     // Default 0.8 (20% below target triggers boost)
    gkAdjustmentPercent: number;  // Default 10 (10% cut/increase per GK rules)
    // Auto Roth conversions during retirement
    autoRothConversions: boolean; // Automatically convert Traditional to Roth in low-tax years
    };
  demographics: {
    birthYear: number;
    retirementAge: number;
    lifeExpectancy: number;
    priorEarnings?: EarningsRecord[];  // SSA earnings history imported from XML
    priorYearMode?: boolean;  // If true, simulation starts from last year using verified data
  };
  display: {
    useCompactCurrency: boolean; // Show $1.2M instead of $1,200,000
    showExperimentalFeatures: boolean; // Show Tax, Scenarios, Ratios tabs
    hsaEligible: boolean; // Whether user has HDHP and is eligible for HSA
  };
  priorities: PriorityBucket[];
  withdrawalStrategy: WithdrawalBucket[]; // The "Burn Order"
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
  },
  demographics: {
    retirementAge: 65,
    lifeExpectancy: 90,
    birthYear: new Date().getFullYear() - 24, // Default to 24 years old
    priorYearMode: false, // Default to current year mode
  },
  display: {
    useCompactCurrency: true,
    showExperimentalFeatures: false,
    hsaEligible: true,
  },
  priorities: [],
  withdrawalStrategy: [],
};

/**
 * Deep merge saved data with defaults, ensuring all fields exist.
 * This handles cases where old localStorage data is missing newer fields.
 */
function migrateAssumptions(saved: unknown, defaults: AssumptionsState): AssumptionsState {
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
  };

  // Migration: Convert old startAge/startYear to birthYear
  const savedDemographics = data.demographics as Record<string, unknown> | undefined;
  if (savedDemographics && !savedDemographics.birthYear) {
    // Old format had startAge and startYear
    const startAge = savedDemographics.startAge as number | undefined;
    const startYear = savedDemographics.startYear as number | undefined;
    if (startAge !== undefined && startYear !== undefined) {
      // Calculate birth year from the old format
      migrated.demographics.birthYear = startYear - startAge;
    } else if (startAge !== undefined) {
      // If only startAge exists, use current year
      migrated.demographics.birthYear = new Date().getFullYear() - startAge;
    }
  }

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
  | { type: 'CLEAR_PRIOR_EARNINGS' };

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
      // Preserve user's allocations and withdrawal order
      return {
        ...defaultAssumptions,
        priorities: state.priorities,
        withdrawalStrategy: state.withdrawalStrategy,
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
      } catch (e) {
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
