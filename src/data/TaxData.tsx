export type FilingStatus = 'Single' | 'Married Filing Jointly' | 'Married Filing Separately';

export interface TaxBracket {
  threshold: number; // The income level where this rate begins
  rate: number;      // Decimal (0.10 for 10%)
}

export interface TaxParameters {
  standardDeduction: number;
  brackets: TaxBracket[];
  socialSecurityTaxRate: number; // FICA
  socialSecurityWageBase: number;
  medicareTaxRate: number;
  // Long-term capital gains brackets (based on taxable income thresholds)
  capitalGainsBrackets?: TaxBracket[];
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
                    { threshold: 47151, rate: 0.22 },
                    { threshold: 100526, rate: 0.24 },
                    { threshold: 191951, rate: 0.32 },
                    { threshold: 243726, rate: 0.35 },
                    { threshold: 609350, rate: 0.37 }
                ],
                capitalGainsBrackets: [
                    { threshold: 0, rate: 0.00 },
                    { threshold: 47025, rate: 0.15 },
                    { threshold: 518900, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
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
                socialSecurityWageBase: 176100,
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
                socialSecurityWageBase: 176100,
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
                medicareTaxRate: 0.0145
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
                medicareTaxRate: 0.0145
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
                medicareTaxRate: 0.0145
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
                    { threshold: 49700, rate: 0.15 },
                    { threshold: 548200, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145
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
                    { threshold: 99400, rate: 0.15 },
                    { threshold: 616400, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145
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
                    { threshold: 49700, rate: 0.15 },
                    { threshold: 308200, rate: 0.20 }
                ],
                socialSecurityTaxRate: 0.062,
                socialSecurityWageBase: 176100,
                medicareTaxRate: 0.0145
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
                }
            },
            2026: {
                Single: {
                    standardDeduction: 5363,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                        { threshold: 10412, rate: 0.02 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 10726,
                    brackets: [
                        { threshold: 0, rate: 0.01 },
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 5363,
                    brackets: [
                        { threshold: 0, rate: 0.01 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.045 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.045 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.0425 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0425 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
                },
                'Married Filing Jointly': {
                    standardDeduction: 25500,
                    brackets: [
                        { threshold: 0, rate: 0.0399 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
                'Married Filing Separately': {
                    standardDeduction: 12750,
                    brackets: [
                        { threshold: 0, rate: 0.0399 }
                    ],
                    socialSecurityTaxRate: 0.0,
                    socialSecurityWageBase: 0,
                    medicareTaxRate: 0.0
                },
            }
        },
        "Virginia": {
            // VA has 4 brackets: 2%, 3%, 5%, 5.75%
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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
                    medicareTaxRate: 0.0
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