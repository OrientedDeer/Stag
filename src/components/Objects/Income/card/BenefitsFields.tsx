import { ReactElement } from 'react';
import { CurrencyInput } from '../../../Layout/InputFields/CurrencyInput';

/**
 * Value-based Benefits field cluster (insurance + HSA) shared by BOTH the income
 * card and the Add-Income modal, the body of their "Benefits" CardSection. Same
 * value/onUpdate shape as the other shared clusters so the two editors can't drift
 * (#151).
 */
export interface BenefitsFieldValues {
    insurance: number;
    hsaContribution: number;
}

interface BenefitsFieldsProps {
    values: BenefitsFieldValues;
    onUpdate: (field: keyof BenefitsFieldValues, value: unknown) => void;
    idPrefix: string;
}

export function BenefitsFields({ values, onUpdate, idPrefix }: BenefitsFieldsProps): ReactElement {
    return (
        <>
            <CurrencyInput
                id={`${idPrefix}-insurance`}
                label="Insurance"
                value={values.insurance}
                onChange={(val) => onUpdate('insurance', val)}
                tooltip="Monthly pre-tax deduction for health, dental, vision insurance."
            />
            <CurrencyInput
                id={`${idPrefix}-hsa-contribution`}
                label="HSA Contribution"
                value={values.hsaContribution}
                onChange={(val) => onUpdate('hsaContribution', val)}
                tooltip="Monthly HSA contribution. Triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical expenses."
            />
        </>
    );
}
