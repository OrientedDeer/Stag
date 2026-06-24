export type FilingStatus = 'Single' | 'Married Filing Jointly' | 'Married Filing Separately';

export interface TaxBracket {
  threshold: number; // The income level where this rate begins
  rate: number;      // Decimal (0.10 for 10%)
}

// State-specific Social Security treatment
export type SocialSecurityTreatment = 'exempt' | 'taxable' | 'income-based';

// State-specific long-term capital gains treatment
export type LTCGTreatment = 'ordinary' | 'preferential' | 'exempt';

// Retirement income exemption configuration
export interface RetirementIncomeExemption {
  amount: number;
  appliesTo: ('pension' | '401k' | 'ira' | 'all')[];
  ageRequirement?: number;
  perPerson: boolean;
}

// Social Security exemption phaseout thresholds
export interface SSExemptionPhaseout {
  start: number;
  end: number;
}

export interface TaxParameters {
  standardDeduction: number;
  brackets: TaxBracket[];
  socialSecurityTaxRate: number; // FICA
  socialSecurityWageBase: number;
  medicareTaxRate: number;
  // Long-term capital gains brackets (based on taxable income thresholds)
  capitalGainsBrackets?: TaxBracket[];
  // Net Investment Income Tax rate (3.8%). Optional override; when unset,
  // bracketTax.ts falls back to its NIIT_RATE constant. The future-year
  // calibration injects a scaled value here so the NIIT portion of the bill
  // scales with the carried-forward override % (federal only).
  niitRate?: number;

  // State-specific fields (all optional, for state use):
  socialSecurityTreatment?: SocialSecurityTreatment;
  ssExemptionThreshold?: number;
  ssExemptionPhaseout?: SSExemptionPhaseout;
  ltcgTreatment?: LTCGTreatment;
  retirementIncomeExemption?: RetirementIncomeExemption;
  seniorDeduction?: number;
  seniorAge?: number;
  seniorDeductionPerPerson?: boolean;  // If true, MFJ gets double the deduction (assumes both spouses same age)

  // OBBBA "senior bonus" additional deduction (federal only), tax years 2025–2028
  // (sunset after 2028 — gated by SENIOR_BONUS_*_YEAR in federalTax.ts). Per-person
  // base amount (MFJ doubles when seniorDeductionPerPerson is true). Phases out at
  // `seniorBonusPhaseoutRate` of (MAGI − seniorBonusPhaseoutThreshold), floored at $0.
  // Consumed ONLY by federalTax.ts (mirrors how the state senior fields are consumed
  // only by stateTax.ts).
  seniorBonusDeduction?: number;
  seniorBonusPhaseoutThreshold?: number;
  seniorBonusPhaseoutRate?: number;
}

export const max_year = 2026;


/** * Hierarchical Lookups:
 * AuthorityData: Year -> FilingStatus -> Parameters
 */
export type YearConfig = Record<FilingStatus, TaxParameters>;
export type AuthorityData = Record<number, YearConfig>;

export interface GlobalTaxDatabase {
  federal: AuthorityData;
  states: Record<string, AuthorityData>;
}


export const TAX_DATABASE: GlobalTaxDatabase = {
    federal: {
        2024: {
            Single: {
                standardDeduction: 14600,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 11600, rate: 0.12 },
                    { threshold: 47150, rate: 0.22 },
                    { threshold: 100525, rate: 0.24 },
                    { threshold: 191950, rate: 0.32 },
                    { threshold: 243725, rate: 0.35 },
                    { threshold: 609350, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 47025, rate: 0.15 },
                    { threshold: 518900, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 168600,
                medicareTaxRate: 0.0145
            },
            'Married Filing Jointly': {
                standardDeduction: 29200,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 23200, rate: 0.12 },
                    { threshold: 94300, rate: 0.22 },
                    { threshold: 201050, rate: 0.24 },
                    { threshold: 383900, rate: 0.32 },
                    { threshold: 487450, rate: 0.35 },
                    { threshold: 731200, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 94050, rate: 0.15 },
                    { threshold: 583750, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 168600,
                medicareTaxRate: 0.0145
            },
            'Married Filing Separately': {
                standardDeduction: 14600,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 11600, rate: 0.12 },
                    { threshold: 47150, rate: 0.22 },
                    { threshold: 100525, rate: 0.24 },
                    { threshold: 191950, rate: 0.32 },
                    { threshold: 243725, rate: 0.35 },
                    { threshold: 365600, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 47025, rate: 0.15 },
                    { threshold: 291850, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 168600,
                medicareTaxRate: 0.0145
            }
        },
        2025: {
            Single: {
                standardDeduction: 15750,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 11925, rate: 0.12 },
                    { threshold: 48475, rate: 0.22 },
                    { threshold: 103350, rate: 0.24 },
                    { threshold: 197300, rate: 0.32 },
                    { threshold: 250525, rate: 0.35 },
                    { threshold: 626350, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 48350, rate: 0.15 },
                    { threshold: 533400, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145,
                // 2025 regular 65+ additional standard deduction: $2,000 (single/HoH).
                seniorDeduction: 2000,
                seniorAge: 65,
                // OBBBA senior bonus: $6,000/person, phases out at 6% over $75k MAGI (single).
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 75000,
                seniorBonusPhaseoutRate: 0.06
            },
            'Married Filing Jointly': {
                standardDeduction: 31500,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 23850, rate: 0.12 },
                    { threshold: 96950, rate: 0.22 },
                    { threshold: 206700, rate: 0.24 },
                    { threshold: 394600, rate: 0.32 },
                    { threshold: 501050, rate: 0.35 },
                    { threshold: 751600, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 96700, rate: 0.15 },
                    { threshold: 600050, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145,
                // 2025 regular 65+ additional standard deduction: $1,600 PER SPOUSE 65+
                // (doubled for MFJ via seniorDeductionPerPerson → $3,200 if both 65+).
                seniorDeduction: 1600,
                seniorAge: 65,
                seniorDeductionPerPerson: true,
                // OBBBA senior bonus: $6,000/person ($12,000 MFJ if both 65+), phases out
                // at 6% over $150k MAGI (MFJ). Per-person → doubled for MFJ.
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 150000,
                seniorBonusPhaseoutRate: 0.06
            },
            'Married Filing Separately': {
                standardDeduction: 15750,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 11925, rate: 0.12 },
                    { threshold: 48475, rate: 0.22 },
                    { threshold: 103350, rate: 0.24 },
                    { threshold: 197300, rate: 0.32 },
                    { threshold: 250525, rate: 0.35 },
                    { threshold: 375800, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 48350, rate: 0.15 },
                    { threshold: 300000, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145,
                // 2025 regular 65+ additional standard deduction: $1,600 (MFS, per spouse).
                // Single filer (one person) — not doubled.
                seniorDeduction: 1600,
                seniorAge: 65,
                // OBBBA senior bonus: $6,000/person; MFS phaseout threshold is $75k MAGI.
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 75000,
                seniorBonusPhaseoutRate: 0.06
            }
        },
        2026: {
            Single: {
                standardDeduction: 16100,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 12400, rate: 0.12 },
                    { threshold: 50400, rate: 0.22 },
                    { threshold: 105700, rate: 0.24 },
                    { threshold: 201775, rate: 0.32 },
                    { threshold: 256225, rate: 0.35 },
                    { threshold: 640600, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 49450, rate: 0.15 },
                    { threshold: 545500, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 184500,
                medicareTaxRate: 0.0145,
                // 2026 regular 65+ additional standard deduction: $2,050 (single/HoH).
                seniorDeduction: 2050,
                seniorAge: 65,
                // OBBBA senior bonus: $6,000/person, phases out at 6% over $75k MAGI (single).
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 75000,
                seniorBonusPhaseoutRate: 0.06
            },
            'Married Filing Jointly': {
                standardDeduction: 32200,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 24800, rate: 0.12 },
                    { threshold: 100800, rate: 0.22 },
                    { threshold: 211400, rate: 0.24 },
                    { threshold: 403550, rate: 0.32 },
                    { threshold: 512450, rate: 0.35 },
                    { threshold: 768700, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 98900, rate: 0.15 },
                    { threshold: 613700, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 184500,
                medicareTaxRate: 0.0145,
                // 2026 regular 65+ additional standard deduction: $1,650 PER SPOUSE 65+
                // (doubled for MFJ via seniorDeductionPerPerson → $3,300 if both 65+).
                seniorDeduction: 1650,
                seniorAge: 65,
                seniorDeductionPerPerson: true,
                // OBBBA senior bonus: $6,000/person ($12,000 MFJ if both 65+), phases out
                // at 6% over $150k MAGI (MFJ). Per-person → doubled for MFJ.
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 150000,
                seniorBonusPhaseoutRate: 0.06
            },
            'Married Filing Separately': {
                standardDeduction: 16100,
                brackets: [
                    { threshold: 0, rate: 0.10 },
                    { threshold: 12400, rate: 0.12 },
                    { threshold: 50400, rate: 0.22 },
                    { threshold: 105700, rate: 0.24 },
                    { threshold: 201775, rate: 0.32 },
                    { threshold: 256225, rate: 0.35 },
                    { threshold: 384350, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 49450, rate: 0.15 },
                    { threshold: 306850, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 184500,
                medicareTaxRate: 0.0145,
                // 2026 regular 65+ additional standard deduction: $1,650 (MFS, per spouse).
                // Single filer (one person) — not doubled.
                seniorDeduction: 1650,
                seniorAge: 65,
                // OBBBA senior bonus: $6,000/person; MFS phaseout threshold is $75k MAGI.
                seniorBonusDeduction: 6000,
                seniorBonusPhaseoutThreshold: 75000,
                seniorBonusPhaseoutRate: 0.06
            }
        }
    },
    states: {
        "California": {
            2025: {
                Single: {
                    standardDeduction: 5540,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 10_757, rate: 0.02 },
                        { threshold: 25_500, rate: 0.04 },
                        { threshold: 40_246, rate: 0.06 },
                        { threshold: 55_867, rate: 0.08 },
                        { threshold: 70_607, rate: 0.093 },
                        { threshold: 360_660, rate: 0.103 },
                        { threshold: 432_788, rate: 0.113 },
                        { threshold: 721_315, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 11080,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 21_513, rate: 0.02 },
                        { threshold: 50_999, rate: 0.04 },
                        { threshold: 80_491, rate: 0.06 },
                        { threshold: 111_733, rate: 0.08 },
                        { threshold: 141_213, rate: 0.093 },
                        { threshold: 721_319, rate: 0.103 },
                        { threshold: 865_575, rate: 0.113 },
                        { threshold: 1_442_629, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 5540,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 10_757, rate: 0.02 },
                        { threshold: 25_500, rate: 0.04 },
                        { threshold: 40_246, rate: 0.06 },
                        { threshold: 55_867, rate: 0.08 },
                        { threshold: 70_607, rate: 0.093 },
                        { threshold: 360_660, rate: 0.103 },
                        { threshold: 432_788, rate: 0.113 },
                        { threshold: 721_315, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                }
            },
            2026: {
                Single: {
                    standardDeduction: 5669,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 11_015, rate: 0.02 },
                        { threshold: 26_111, rate: 0.04 },
                        { threshold: 41_212, rate: 0.06 },
                        { threshold: 57_208, rate: 0.08 },
                        { threshold: 72_272, rate: 0.093 },
                        { threshold: 369_156, rate: 0.103 },
                        { threshold: 443_175, rate: 0.113 },
                        { threshold: 738_628, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 11_338,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 22_030, rate: 0.02 },
                        { threshold: 52_223, rate: 0.04 },
                        { threshold: 82_423, rate: 0.06 },
                        { threshold: 114_414, rate: 0.08 },
                        { threshold: 144_542, rate: 0.093 },
                        { threshold: 738_310, rate: 0.103 },
                        { threshold: 885_974, rate: 0.113 },
                        { threshold: 1_477_252, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 5669,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 11_015, rate: 0.02 },
                        { threshold: 26_111, rate: 0.04 },
                        { threshold: 41_212, rate: 0.06 },
                        { threshold: 57_208, rate: 0.08 },
                        { threshold: 72_272, rate: 0.093 },
                        { threshold: 369_156, rate: 0.103 },
                        { threshold: 443_175, rate: 0.113 },
                        { threshold: 738_628, rate: 0.123 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                }
            }
        },
        "DC": {
            2024: {
                Single: {
                    standardDeduction: 14600,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 29200,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 14600,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            },
            2025: {
                Single: {
                    standardDeduction: 15000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 30000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 15000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            },
            2026: {
                Single: {
                    standardDeduction: 15000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 30000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 15000,
                    brackets: [
                        { threshold: 0, rate: 0.04 },
                        { threshold: 10_000, rate: 0.06 },
                        { threshold: 40_000, rate: 0.065 },
                        { threshold: 60_000, rate: 0.085 },
                        { threshold: 250_000, rate: 0.0925 },
                        { threshold: 500_000, rate: 0.0975 },
                        { threshold: 1_000_000, rate: 0.1075 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            }
        },
        "Texas": {
            2024: {
                Single: {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
            },
            2025: {
                Single: {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
            },
            2026: {
                Single: {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 0,
                    brackets: [
                        { threshold: 0, rate: 0.0 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
            }
        },
        "North Carolina": {
            // NC has a flat tax rate - 4.5% in 2024, 4.25% in 2025, 3.99% in 2026+
            2024: {
                Single: {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.045 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.045 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.045 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            },
            2025: {
                Single: {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0425 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.0425 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0425 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            },
            2026: {
                Single: {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0399 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.0399 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0399 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt'
                },
            }
        },
        "Virginia": {
            // VA has 4 brackets: 2%, 3%, 5%, 5.75%
            // VA also has a $12k senior deduction at age 65+
            2024: {
                Single: {
                    standardDeduction: 8500,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
                'Married Filing Jointly': {
                    standardDeduction: 17000,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true  // $24k total for MFJ (both spouses 65+)
                },
                'Married Filing Separately': {
                    standardDeduction: 8500,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
            },
            2025: {
                Single: {
                    standardDeduction: 8750,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
                'Married Filing Jointly': {
                    standardDeduction: 17500,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true  // $24k total for MFJ (both spouses 65+)
                },
                'Married Filing Separately': {
                    standardDeduction: 8750,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
            },
            2026: {
                Single: {
                    standardDeduction: 8750,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
                'Married Filing Jointly': {
                    standardDeduction: 17500,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true  // $24k total for MFJ (both spouses 65+)
                },
                'Married Filing Separately': {
                    standardDeduction: 8750,
                    brackets: [
                        { threshold: 0, rate: 0.02 },
                        { threshold: 3000, rate: 0.03 },
                        { threshold: 5000, rate: 0.05 },
                        { threshold: 17000, rate: 0.0575 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0,
                    socialSecurityTreatment: 'exempt',
                    seniorDeduction: 12000,
                    seniorAge: 65,
                    seniorDeductionPerPerson: true
                },
            }
        }
    }
};

export const getClosestTaxYear = (year: number): number => {
    const availableYears = Object.keys(TAX_DATABASE.federal).map(Number);
    if (availableYears.length === 0) {
        throw new Error("No tax data available.");
    }

    return availableYears.reduce((prev, curr) => {
        return (Math.abs(curr - year) < Math.abs(prev - year) ? curr : prev);
    });
 };