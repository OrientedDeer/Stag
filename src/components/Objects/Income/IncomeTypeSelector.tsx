import React from "react";
import {
    WorkIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    WindfallIncome
} from './models';

interface IncomeTypeSelectorProps {
    onSelect: (typeClass: any) => void;
}

const INCOME_CATEGORIES = [
    { label: 'Work', class: WorkIncome },
    { label: 'Current Social Security', class: CurrentSocialSecurityIncome },
    { label: 'Future Social Security', class: FutureSocialSecurityIncome },
    { label: 'FERS Pension', class: FERSPensionIncome },
    { label: 'CSRS Pension', class: CSRSPensionIncome },
    { label: 'Passive Income', class: PassiveIncome },
    { label: 'Windfall', class: WindfallIncome }
];

export const IncomeTypeSelector: React.FC<IncomeTypeSelectorProps> = ({ onSelect }) => (
    <div className="grid grid-cols-2 gap-4">
        {INCOME_CATEGORIES.map((cat) => (
            <button
                key={cat.label}
                type="button"
                onClick={() => onSelect(cat.class)}
                className="flex items-center justify-center p-2 h-12 bg-surface-overlay hover:bg-surface-input text-content-emphasis rounded-xl border border-border-default transition-all font-medium text-sm text-center"
            >
                {cat.label}
            </button>
        ))}
    </div>
);
