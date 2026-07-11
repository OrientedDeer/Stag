import { createContext } from 'react';
import { FilingStatus, max_year } from '../../../data/TaxData';
import { activeSurvivorScenario, type SurvivorScenario } from '../../../services/simulation/SurvivorScenario';

export type DeductionMethod = 'Standard' | 'Itemized' | 'Auto';

/**
 * A scheduled tax change in the projection — "moving to TX in 2034", "filing
 * status → Single when I retire". `filingStatus` and `stateResidency` on
 * TaxState are the CURRENT (year-0) values; events override them from their
 * trigger year onward. The trigger is a calendar `year` OR a `milestoneId`
 * (resolved to the year that milestone is reached). Year-based is exact;
 * milestone-based takes effect the year after the milestone is reached.
 * Stored with primitive triggers (no Date) so it round-trips through
 * persistence cleanly.
 */
export interface TaxLifeEvent {
  id: string;
  kind: 'stateResidency' | 'filingStatus';
  value: string; // a state name, or a FilingStatus
  year?: number;
  milestoneId?: string;
}

// Survivor ("first death at year N") scenario composer — fp-review F3b, the
// widow's penalty. The config lives on TaxState (persisted with the rest of
// the tax settings); the composer logic — the interface, the MFJ gate, and
// the death-year income/expense transition — lives in
// services/simulation/SurvivorScenario.ts. Re-exported here (type-only, so
// react-refresh stays happy) since TaxState is where consumers meet it.
export type { SurvivorScenario } from '../../../services/simulation/SurvivorScenario';

export interface TaxState {
  filingStatus: FilingStatus;
  stateResidency: string;
  deductionMethod: DeductionMethod;
  /**
   * Dollar tax overrides. These apply to the CURRENT year only (the snapshot
   * and the projection's year 0) — the engine clears them for every future
   * year, so a current-year correction no longer pins a flat amount across the
   * projection. (Carrying a correction forward as a % — calibration — is a
   * planned follow-up.)
   */
  fedOverride: number | null;
  ficaOverride: number | null;
  stateOverride: number | null;
  /**
   * When true, the % by which an override differs from the engine's computed
   * tax for the current year is carried into every future projected year (fed
   * and state; FICA excluded). Implemented as a multiplicative scale on the
   * marginal rates — federal/state tax is linear in the rates, so scaling them
   * scales the bill exactly, and because it's a parameter change it flows
   * through the simulation's gross-up sizing with no cash-balance risk.
   */
  calibrateFutureYears?: boolean;
  /** Scheduled state-residency / filing-status changes over the projection. */
  taxEvents?: TaxLifeEvent[];
  /** "First death at year N" composer (fp-review F3b). See SurvivorScenario. */
  survivorScenario?: SurvivorScenario;
  year: number;
}

type Action =
  | { type: 'SET_STATUS'; payload: FilingStatus }
  | { type: 'SET_STATE'; payload: string }
  | { type: 'SET_DEDUCTION_METHOD'; payload: DeductionMethod }
  | { type: 'SET_FED_OVERRIDE'; payload: number | null }
  | { type: 'SET_FICA_OVERRIDE'; payload: number | null }
  | { type: 'SET_STATE_OVERRIDE'; payload: number | null }
  | { type: 'SET_CALIBRATE_FUTURE'; payload: boolean }
  | { type: 'SET_TAX_EVENTS'; payload: TaxLifeEvent[] }
  | { type: 'SET_SURVIVOR_SCENARIO'; payload: SurvivorScenario }
  | { type: 'SET_YEAR'; payload: number }
  | { type: 'SET_BULK_DATA'; payload: TaxState };

export const defaultTaxState: TaxState = {
  filingStatus: 'Single',
  stateResidency: 'DC',
  deductionMethod: 'Auto',
  fedOverride: null,
  ficaOverride: null,
  stateOverride: null,
  year: max_year,
};

export function taxReducer(state: TaxState, action: Action): TaxState {
  switch (action.type) {
    case 'SET_STATUS': return { ...state, filingStatus: action.payload };
    case 'SET_STATE': return { ...state, stateResidency: action.payload };
    case 'SET_DEDUCTION_METHOD': return { ...state, deductionMethod: action.payload };
    case 'SET_FED_OVERRIDE': return { ...state, fedOverride: action.payload };
    case 'SET_FICA_OVERRIDE': return { ...state, ficaOverride: action.payload };
    case 'SET_STATE_OVERRIDE': return { ...state, stateOverride: action.payload };
    case 'SET_CALIBRATE_FUTURE': return { ...state, calibrateFutureYears: action.payload };
    case 'SET_TAX_EVENTS': return { ...state, taxEvents: action.payload };
    case 'SET_SURVIVOR_SCENARIO': return { ...state, survivorScenario: action.payload };
    case 'SET_YEAR': return { ...state, year: action.payload };
    case 'SET_BULK_DATA': return { ...action.payload };
    default: return state;
  }
}

/**
 * Resolve a year's effective TaxState by applying scheduled tax events
 * (state-residency / filing-status changes) that have fired by `year`. For
 * each kind the latest-firing event wins. Year-triggered events fire in their
 * year; milestone-triggered events fire in the year the milestone was reached
 * (per `milestoneReachYears`). Returns the base unchanged when nothing applies.
 */
export function resolveTaxEventsForYear(
  base: TaxState,
  year: number,
  milestoneReachYears: Map<string, number>,
): TaxState {
  const events = base.taxEvents ?? [];
  // Survivor scenario (fp-review F3b): the filing-status half of the composer.
  // Behaves exactly like a scheduled `filingStatus → Single` event at
  // `deathYear`, participating in the same latest-fires-wins resolution below —
  // so every existing consumer of this function prices it for free.
  const survivor = activeSurvivorScenario(base);
  const survivorFired = survivor !== null && year >= survivor.deathYear;
  if (events.length === 0 && !survivorFired) return base;

  let stateResidency = base.stateResidency;
  let filingStatus = base.filingStatus;
  let bestStateYear = -Infinity;
  let bestFilingYear = -Infinity;

  for (const ev of events) {
    const firedYear = ev.year !== undefined
      ? ev.year
      : ev.milestoneId !== undefined
        ? milestoneReachYears.get(ev.milestoneId)
        : undefined;
    if (firedYear === undefined || firedYear > year) continue;
    if (ev.kind === 'stateResidency' && firedYear >= bestStateYear) {
      stateResidency = ev.value;
      bestStateYear = firedYear;
    } else if (ev.kind === 'filingStatus' && firedYear >= bestFilingYear) {
      filingStatus = ev.value as FilingStatus;
      bestFilingYear = firedYear;
    }
  }

  if (survivorFired && survivor.deathYear >= bestFilingYear) {
    filingStatus = 'Single';
  }

  if (stateResidency === base.stateResidency && filingStatus === base.filingStatus) return base;
  return { ...base, stateResidency, filingStatus };
}

interface TaxContextProps {
  state: TaxState;
  dispatch: React.Dispatch<Action>;
}

export const TaxContext = createContext<TaxContextProps>({
  state: defaultTaxState,
  dispatch: () => null,
});