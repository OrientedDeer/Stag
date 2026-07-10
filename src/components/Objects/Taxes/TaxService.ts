/**
 * Barrel re-exporting the focused tax service modules.
 *
 * The implementation lives in ./taxService/ — each domain has its own file:
 *   - parameters.ts       getTaxParameters, getSALTCap
 *   - incomeAggregation   gross / pre-tax / post-tax / FICA / SS income getters
 *   - socialSecurity      getTaxableSocialSecurityBenefits
 *   - deductions          getItemizedDeductions, getYesDeductions
 *   - bracketTax          calculateTax + calculateTotalFederalTax (core engine)
 *   - federalTax          calculateFederalTaxFromIncomes (orchestrator)
 *   - stateTax            calculateStateTax, calculateUnifiedStateTax
 *   - ficaTax             calculateFicaTax
 *   - capitalGainsTax     getLTCGRate (consumed directly by the solvers)
 *   - marginalRates       getMarginalTaxRate, getCombinedMarginalRate
 *   - esppTax             calculateESPPDispositionTax
 *
 * Many consumers use `import * as TaxService from '.../TaxService'` (namespace
 * import), so this barrel must preserve every name that used to live in the
 * monolithic file. Don't drop re-exports without checking the consumer set.
 */

export { getSALTCap, getTaxParameters } from "./taxService/parameters";
export {
    getGrossIncome,
    getPreTaxExemptions,
    getPostTaxEmployerMatch,
    getPostTaxExemptions,
    getFicaExemptions,
    getEarnedIncome,
    getSocialSecurityBenefits,
} from "./taxService/incomeAggregation";
export { getTaxableSocialSecurityBenefits, getTaxableSocialSecurityFromComponents } from "./taxService/socialSecurity";
export { getItemizedDeductions, getYesDeductions } from "./taxService/deductions";
export {
    calculateTotalFederalTax,
    calculateTax,
    type TotalFederalTaxResult,
} from "./taxService/bracketTax";
export { calculateFederalTaxFromIncomes, getEffectiveStandardDeduction, getEffectiveDeduction } from "./taxService/federalTax";
export { calculateStateTax, calculateUnifiedStateTax } from "./taxService/stateTax";
export { calculateFicaTax } from "./taxService/ficaTax";
export {
    getMarginalTaxRate,
    getCombinedMarginalRate,
    type MarginalRateResult,
} from "./taxService/marginalRates";
export { calculateESPPDispositionTax } from "./taxService/esppTax";
