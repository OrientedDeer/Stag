import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
import jsQR from 'jsqr';
import { useSubTabKeyboardNav } from '../../hooks/useKeyboardShortcuts';
import { MortgageExpense, HealthcareExpense, CLASS_TO_CATEGORY } from '../../components/Objects/Expense/models';
import { decompressData, isCompactFormat, expandCompactBackup, validatePayload } from '../../components/Objects/Accounts/QRTransfer/qrUtils';
import { useFileManager } from '../../components/Objects/Accounts/useFileManager';
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { PercentageInput } from '../../components/Layout/InputFields/PercentageInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { ToggleInput } from '../../components/Layout/InputFields/ToggleInput';
import { AssumptionsContext, getRetirementAge, getLifeExpectancy, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { SimulationContext } from '../../components/Objects/Assumptions/SimulationContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { computeEOYBudgetContributions } from '../../services/eoyContributionProjection';
import { toLocalDateString } from '../Budget/transactions/utils';
import { WorkIncome, PassiveIncome, FERSPensionIncome, CSRSPensionIncome, getIncomeActiveMultiplier, isSocialSecurity } from '../../components/Objects/Income/models';
import { buildProjectionAsync } from '../Future/buildProjection';
import { JointSearchSupersededError } from '../../services/jointSearchRunner';
import { getSimulationInputHash } from '../../services/simulationHash';
import {
    getTaxParameters,
    getMarginalTaxRate,
    getCombinedMarginalRate,
    getGrossIncome,
    getPreTaxExemptions,
    getEarnedIncome,
    getSocialSecurityBenefits,
    getTaxableSocialSecurityBenefits,
    getItemizedDeductions,
    getYesDeductions,
    getSALTCap,
} from '../../components/Objects/Taxes/TaxService';
import {
    extractEarningsFromSimulation,
    calculateAIME
} from '../../services/SocialSecurityCalculator';
import {
    getMedianRetirementTaxRate,
    findRothConversionWindows,
    analyzeRothPreTaxAllocation
} from '../../services/TaxOptimizationService';
import type { RothPreTaxAllocation, AllocationVerdict } from '../../services/TaxOptimizationService';
import { get401kLimit, getHSALimit, getIRALimit } from '../../data/ContributionLimits';
import { calculateEffectiveConversionTax } from '../../components/Objects/Assumptions/SimulationEngine';
import {
    getFRA,
    getClaimingAdjustment,
    getBendPoints,
    getWageBase
} from '../../data/SocialSecurityData';
import {
    getRMDStartAge,
    getDistributionPeriod,
    calculateRMD,
    isAccountSubjectToRMD,
    isRMDRequired,
    RMDCalculation
} from '../../data/RMDData';
import {
    getFERSMRA,
    checkFERSEligibility,
    calculateFERSBasicBenefit,
    getDisplayedFERSBenefit,
    getFERSCOLA,
    checkCSRSEligibility,
    calculateCSRSBasicBenefit,
    getDisplayedCSRSBenefit,
    getCSRSCOLA,
    PENSION_SYSTEM_COMPARISON
} from '../../data/PensionData';
import { getFicaTaxableBase } from '../../components/Objects/Taxes/taxService/ficaTax';
import { isSSCoveredForFica } from '../../components/Objects/Taxes/taxService/incomeAggregation';
import { SavedAccount, InvestedAccount, DebtAccount, DeficitDebtAccount, PropertyAccount, ESPPAccount, RSUAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { formatCompactCurrency } from '../Future/tabs/FutureUtils';
import { SimulationYear } from '../../services/simulation/types';
import RothConversionDebugTab from './RothConversionDebug';
import { Panel, Button } from "../../components/Layout/Primitives";

// Helper to format currency
const toCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

const toCurrencyShort = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

// ============================================================================
// COPY-FRIENDLY TEXT SUMMARY
// ============================================================================
// Exported for unit testing (dev-tool summary logic). Not a component, so the
// fast-refresh "only export components" rule doesn't meaningfully apply here.
// eslint-disable-next-line react-refresh/only-export-components
export function generateYearSummaryText(simYear: SimulationYear, age: number, accountsContext: AnyAccount[]): string {
    const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
    const lines: string[] = [];

    lines.push(`Year ${simYear.year} (Age ${age})`);
    lines.push('');

    // ACCOUNTS
    lines.push('ACCOUNTS');
    let totalBalance = 0;
    for (const acc of simYear.accounts) {
        const isInvested = acc instanceof InvestedAccount;
        const isESPP = acc instanceof ESPPAccount;
        const isRSU = acc instanceof RSUAccount;
        const isSaved = acc instanceof SavedAccount;
        const isDebt = acc instanceof DebtAccount || acc instanceof DeficitDebtAccount;
        const isProperty = acc instanceof PropertyAccount;
        const type = isInvested ? (acc as InvestedAccount).taxType :
            isESPP ? 'ESPP' : isRSU ? 'RSU' : isSaved ? 'Savings' : isDebt ? 'Debt' : isProperty ? 'Property' : 'Unknown';
        lines.push(`  ${acc.name} (${type}): ${fmt(acc.amount)}`);
        // Debt is a liability — subtract it so "Total" reads as net worth, not a
        // sum that inflates by every loan balance.
        totalBalance += isDebt ? -acc.amount : acc.amount;
    }
    lines.push(`  Total: ${fmt(totalBalance)}`);
    lines.push('');

    // INCOME
    lines.push('INCOME');
    for (const inc of simYear.incomes) {
        const className = (inc as { className?: string }).className || inc.constructor.name;
        const amount = inc.getProratedAnnual(inc.amount, simYear.year);
        if (inc instanceof WorkIncome) {
            // preTax401k/roth401k/match/insurance/hsa are PER-PERIOD fields; annualize
            // them (like the salary line above) so they aren't shown as if annual next
            // to the annual Work total.
            const annual = (v: number) => inc.getProratedAnnual(v, simYear.year);
            const parts: string[] = [];
            if (inc.preTax401k > 0) parts.push(`preTax401k: ${fmt(annual(inc.preTax401k))}`);
            if (inc.roth401k > 0) parts.push(`roth401k: ${fmt(annual(inc.roth401k))}`);
            if (inc.employerMatch > 0) parts.push(`match: ${fmt(annual(inc.employerMatch))}`);
            if (inc.insurance > 0) parts.push(`insurance: ${fmt(annual(inc.insurance))}`);
            if (inc.hsaContribution > 0) parts.push(`hsa: ${fmt(annual(inc.hsaContribution))}`);
            const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
            lines.push(`  Work: ${inc.name} — ${fmt(amount)}${detail}`);
        } else if (isSocialSecurity(inc)) {
            lines.push(`  Social Security: ${inc.name} — ${fmt(amount)}`);
        } else if (className === 'FERSPensionIncome' || className === 'CSRSPensionIncome') {
            lines.push(`  Pension: ${inc.name} — ${fmt(amount)}`);
        } else if (inc instanceof PassiveIncome) {
            const reinvested = inc.isReinvested ? ' (reinvested)' : '';
            lines.push(`  Passive: ${inc.name} — ${fmt(amount)}${reinvested}`);
        } else {
            lines.push(`  ${inc.name} — ${fmt(amount)}`);
        }
    }
    lines.push(`  Total: ${fmt(simYear.cashflow.totalIncome)}`);
    lines.push('');

    // WITHDRAWALS
    const withdrawalEntries = Object.entries(simYear.cashflow.withdrawalDetail);
    if (withdrawalEntries.length > 0) {
        lines.push('WITHDRAWALS');
        // withdrawalDetail is keyed by account id (#142); resolve id -> account.
        for (const [id, amount] of withdrawalEntries) {
            const account = simYear.accounts.find(a => a.id === id);
            const isTraditional = account instanceof InvestedAccount &&
                ((account as InvestedAccount).taxType === 'Traditional 401k' || (account as InvestedAccount).taxType === 'Traditional IRA');
            const isBrokerage = account instanceof InvestedAccount && (account as InvestedAccount).taxType === 'Brokerage';
            const taxable = isTraditional || isBrokerage || account instanceof ESPPAccount || account instanceof RSUAccount;
            lines.push(`  ${account?.name ?? id}: ${fmt(amount)}${taxable ? ' (taxable)' : ''}`);
        }
        lines.push(`  Total: ${fmt(simYear.cashflow.withdrawals)}`);
        lines.push('');
    }

    // CONTRIBUTIONS
    lines.push('CONTRIBUTIONS');
    const contribParts: string[] = [];
    if (simYear.cashflow.investedUser > 0) contribParts.push(`User: ${fmt(simYear.cashflow.investedUser)}`);
    if (simYear.cashflow.investedMatch > 0) contribParts.push(`Employer: ${fmt(simYear.cashflow.investedMatch)}`);
    if (simYear.cashflow.bucketAllocations > 0) contribParts.push(`Buckets: ${fmt(simYear.cashflow.bucketAllocations)}`);
    if (contribParts.length > 0) lines.push(`  ${contribParts.join(' | ')}`);
    const bucketEntries = Object.entries(simYear.cashflow.bucketDetail);
    if (bucketEntries.length > 0) {
        for (const [id, amount] of bucketEntries) {
            const acc = accountsContext.find(a => a.id === id);
            lines.push(`  Bucket: ${acc?.name || id} — ${fmt(amount)}`);
        }
    }
    lines.push(`  Total Invested: ${fmt(simYear.cashflow.totalInvested)}`);
    lines.push('');

    // TAXES
    lines.push('TAXES');
    const penalty = simYear.taxDetails.earlyWithdrawalPenalty ?? 0;
    const fedIncomeTax = Math.max(0, simYear.taxDetails.fed - penalty);
    lines.push(`  Federal Income: ${fmt(fedIncomeTax)} | State: ${fmt(simYear.taxDetails.state)} | FICA: ${fmt(simYear.taxDetails.fica)}`);
    const irmaa = simYear.taxDetails.irmaa ?? 0;
    const aca = simYear.taxDetails.aca ?? 0;
    lines.push(`  Cap Gains Tax: ${fmt(simYear.taxDetails.capitalGains)} | Withdrawal Tax: ${fmt(simYear.taxDetails.withdrawalOrdinaryTax)} | NIIT: ${fmt(simYear.taxDetails.niit)} | IRMAA: ${fmt(irmaa)} | ACA Subsidy Loss: ${fmt(aca)} | Early-Withdraw Penalty: ${fmt(penalty)}`);
    const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica +
        simYear.taxDetails.capitalGains + simYear.taxDetails.withdrawalOrdinaryTax + simYear.taxDetails.niit + irmaa + aca;
    lines.push(`  Total: ${fmt(totalTax)}`);
    lines.push('');

    // CASHFLOW
    lines.push('CASHFLOW');
    lines.push(`  Living Expenses: ${fmt(simYear.cashflow.livingExpenses)} | Total Expense: ${fmt(simYear.cashflow.totalExpense)}`);
    lines.push(`  Discretionary: ${fmt(simYear.cashflow.discretionary)}`);
    lines.push('');

    // ROTH CONVERSION
    if (simYear.rothConversion && simYear.rothConversion.amount > 0) {
        lines.push('ROTH CONVERSION');
        const effRate = ((simYear.rothConversion.taxCost / simYear.rothConversion.amount) * 100).toFixed(1);
        lines.push(`  Amount: ${fmt(simYear.rothConversion.amount)} | Tax Cost: ${fmt(simYear.rothConversion.taxCost)} | Effective Rate: ${effRate}%`);
        for (const [name, amt] of Object.entries(simYear.rothConversion.fromAccounts)) {
            lines.push(`  From: ${name} — ${fmt(amt)}`);
        }
        for (const [name, amt] of Object.entries(simYear.rothConversion.toAccounts)) {
            lines.push(`  To: ${name} — ${fmt(amt)}`);
        }
        lines.push('');
    }

    // RMD
    if (simYear.rmdDetails && simYear.rmdDetails.totalRMD > 0) {
        lines.push('RMD');
        lines.push(`  Required: ${fmt(simYear.rmdDetails.totalRMD)} | Withdrawn: ${fmt(simYear.rmdDetails.totalWithdrawn)}`);
        if (simYear.rmdDetails.shortfall > 0) {
            lines.push(`  Shortfall: ${fmt(simYear.rmdDetails.shortfall)} | Penalty: ${fmt(simYear.rmdDetails.penalty)}`);
        }
        for (const rmd of simYear.rmdDetails.accountBreakdown) {
            lines.push(`  ${rmd.accountName}: ${fmt(rmd.rmdAmount)}`);
        }
        lines.push('');
    }

    // STRATEGY ADJUSTMENT
    if (simYear.strategyAdjustment) {
        lines.push('STRATEGY ADJUSTMENT');
        lines.push(`  Guardrail: ${simYear.strategyAdjustment.guardrailTriggered} | Required: ${fmt(simYear.strategyAdjustment.requiredAdjustment)} | Actual: ${fmt(simYear.strategyAdjustment.actualAdjustment)}`);
        if (simYear.strategyAdjustment.warning) lines.push(`  Warning: ${simYear.strategyAdjustment.warning}`);
        lines.push('');
    }

    // LOGS
    if (simYear.logs.length > 0) {
        lines.push('LOGS');
        for (const log of simYear.logs) {
            lines.push(`  ${log}`);
        }
    }

    return lines.join('\n');
}

// ============================================================================
// DETAILED YEAR PANEL COMPONENT
// ============================================================================
interface DetailedYearPanelProps {
    simYear: SimulationYear;
    age: number;
    accountsContext: AnyAccount[];
}

function DetailedYearPanel({ simYear, age: _age, accountsContext }: DetailedYearPanelProps) {
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        accounts: true,
        income: true,
        withdrawals: true,
        inflows: true,
        taxes: true,
        rothConversion: true
    });

    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const SectionHeader = ({ title, section, count }: { title: string; section: string; count?: number }) => (
        <button
            onClick={() => toggleSection(section)}
            className="w-full flex items-center justify-between p-3 bg-surface-overlay hover:bg-surface-input rounded-lg transition-colors"
        >
            <span className="font-semibold text-white flex items-center gap-2">
                {title}
                {count !== undefined && <span className="text-xs bg-surface-hover px-2 py-0.5 rounded">{count}</span>}
            </span>
            <span className="text-content-muted">{expandedSections[section] ? '▼' : '▶'}</span>
        </button>
    );

    // Extract detailed account info
    const accountDetails = simYear.accounts.map(acc => {
        const isInvested = acc instanceof InvestedAccount;
        const isESPP = acc instanceof ESPPAccount;
        const isRSU = acc instanceof RSUAccount;
        const isSaved = acc instanceof SavedAccount;
        const isDebt = acc instanceof DebtAccount || acc instanceof DeficitDebtAccount;
        const isProperty = acc instanceof PropertyAccount;

        return {
            id: acc.id,
            name: acc.name,
            amount: acc.amount,
            type: isInvested ? (acc as InvestedAccount).taxType :
                  isESPP ? 'ESPP' :
                  isRSU ? 'RSU' :
                  isSaved ? 'Savings' :
                  isDebt ? 'Debt' :
                  isProperty ? 'Property' : 'Unknown',
            costBasis: isInvested ? (acc as InvestedAccount).costBasis : undefined,
            unrealizedGains: isInvested ? (acc as InvestedAccount).unrealizedGains : undefined,
            apr: isSaved ? (acc as SavedAccount).apr : isDebt ? (acc as DebtAccount).apr : undefined,
            lotCount: isInvested && (acc as InvestedAccount).lots ? (acc as InvestedAccount).lots!.length : undefined
        };
    });

    // Extract all income sources
    const incomeDetails = simYear.incomes.map(inc => {
        const className = (inc as { className?: string }).className || inc.constructor.name;
        let category = 'Other';
        let additionalInfo: Record<string, number | string> = {};

        if (inc instanceof WorkIncome) {
            category = 'Work';
            additionalInfo = {
                salary: inc.getProratedAnnual(inc.amount, simYear.year),
                preTax401k: inc.preTax401k,
                roth401k: inc.roth401k,
                employerMatch: inc.employerMatch,
                insurance: inc.insurance,
                hsa: inc.hsaContribution
            };
        } else if (isSocialSecurity(inc)) {
            category = 'Social Security';
        } else if (className === 'FERSPensionIncome' || className === 'CSRSPensionIncome') {
            category = 'Pension';
            if (inc instanceof FERSPensionIncome) {
                additionalInfo = {
                    yearsOfService: inc.yearsOfService,
                    high3: inc.high3Salary,
                    supplement: inc.fersSupplement
                };
            }
        } else if (inc instanceof PassiveIncome) {
            category = inc.sourceType || 'Passive';
            additionalInfo = { reinvested: inc.isReinvested ? 'Yes' : 'No' };
        }

        return {
            name: inc.name,
            className,
            category,
            amount: inc.getProratedAnnual(inc.amount, simYear.year),
            frequency: inc.frequency,
            additionalInfo
        };
    });

    // Group income by category
    const incomeByCategory = incomeDetails.reduce((acc, inc) => {
        if (!acc[inc.category]) acc[inc.category] = [];
        acc[inc.category].push(inc);
        return acc;
    }, {} as Record<string, typeof incomeDetails>);

    // Calculate withdrawal breakdown with capital gains info.
    // withdrawalDetail is keyed by account id (#142); resolve id -> account.
    const withdrawalBreakdown = Object.entries(simYear.cashflow.withdrawalDetail).map(([id, amount]) => {
        // Find the account to get its type
        const account = simYear.accounts.find(a => a.id === id);
        const isBrokerage = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Brokerage');
        const isESPP = account instanceof ESPPAccount;
        const isRSU = account instanceof RSUAccount;
        const isTraditional = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Traditional 401k' || (account as InvestedAccount).taxType === 'Traditional IRA');
        const isRoth = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Roth 401k' || (account as InvestedAccount).taxType === 'Roth IRA');

        return {
            name: account?.name ?? id,
            amount,
            type: isBrokerage ? 'Brokerage' : isESPP ? 'ESPP' : isRSU ? 'RSU' : isTraditional ? 'Traditional' : isRoth ? 'Roth' : 'Other',
            isTaxable: isTraditional || isBrokerage || isESPP || isRSU
        };
    });

    // Calculate inflows
    const _totalBucketAllocations = simYear.cashflow.bucketAllocations;
    void _totalBucketAllocations; // Reserved for future use
    const bucketDetails = Object.entries(simYear.cashflow.bucketDetail).map(([id, amount]) => {
        const acc = accountsContext.find(a => a.id === id);
        return { name: acc?.name || id, amount };
    });

    // Calculate tax breakdown
    const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica;

    return (
        <div className="space-y-3 mt-4">
            {/* 1. Account Balances */}
            <div>
                <SectionHeader title="Account Balances (End of Year)" section="accounts" count={accountDetails.length} />
                {expandedSections.accounts && (
                    <div className="mt-2 bg-surface-raised rounded-lg p-3 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Account</th>
                                    <th className="text-left p-2">Type</th>
                                    <th className="text-right p-2">Balance</th>
                                    <th className="text-right p-2">Cost Basis</th>
                                    <th className="text-right p-2">Unrealized Gains</th>
                                    <th className="text-right p-2">APR/Lots</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accountDetails.map(acc => (
                                    <tr key={acc.id} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-white">{acc.name}</td>
                                        <td className="p-2 text-content-muted text-xs">{acc.type}</td>
                                        <td className={`p-2 text-right font-mono ${acc.amount < 0 ? 'text-negative' : 'text-positive'}`}>
                                            {toCurrencyShort(acc.amount)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-content-muted">
                                            {acc.costBasis !== undefined ? toCurrencyShort(acc.costBasis) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-mono ${(acc.unrealizedGains || 0) > 0 ? 'text-cat-lime' : 'text-content-subtle'}`}>
                                            {acc.unrealizedGains !== undefined ? toCurrencyShort(acc.unrealizedGains) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-content-subtle text-xs">
                                            {acc.apr !== undefined ? `${acc.apr}%` : acc.lotCount !== undefined ? `${acc.lotCount} lots` : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-border-strong">
                                <tr className="font-semibold">
                                    <td className="p-2 text-white" colSpan={2}>Total</td>
                                    <td className="p-2 text-right font-mono text-info">
                                        {toCurrencyShort(accountDetails.reduce((s, a) => s + a.amount, 0))}
                                    </td>
                                    <td colSpan={3}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* 2. Income */}
            <div>
                <SectionHeader title="Income Sources" section="income" count={incomeDetails.length} />
                {expandedSections.income && (
                    <div className="mt-2 bg-surface-raised rounded-lg p-3 space-y-3">
                        {Object.entries(incomeByCategory).map(([category, items]) => (
                            <div key={category}>
                                <div className="text-xs text-content-muted uppercase tracking-wider mb-1">{category}</div>
                                <div className="space-y-1">
                                    {items.map((inc, idx) => (
                                        <div key={idx} className="flex justify-between items-start bg-surface-overlay/50 rounded p-2">
                                            <div>
                                                <span className="text-white">{inc.name}</span>
                                                <span className="text-content-subtle text-xs ml-2">({inc.frequency})</span>
                                                {Object.keys(inc.additionalInfo).length > 0 && (
                                                    <div className="text-xs text-content-subtle mt-1">
                                                        {Object.entries(inc.additionalInfo).map(([k, v]) => (
                                                            <span key={k} className="mr-3">
                                                                {k}: {typeof v === 'number' ? toCurrencyShort(v) : v}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="font-mono text-positive">{toCurrencyShort(inc.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="flex justify-between border-t border-border-default pt-2 font-semibold">
                            <span className="text-white">Total Income</span>
                            <span className="font-mono text-positive">{toCurrencyShort(simYear.cashflow.totalIncome)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* 3. Withdrawals */}
            <div>
                <SectionHeader title="Withdrawals" section="withdrawals" count={withdrawalBreakdown.length} />
                {expandedSections.withdrawals && (
                    <div className="mt-2 bg-surface-raised rounded-lg p-3">
                        {withdrawalBreakdown.length === 0 ? (
                            <div className="text-content-subtle text-sm">No withdrawals this year</div>
                        ) : (
                            <>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-content-muted border-b border-border-default">
                                            <th className="text-left p-2">Account</th>
                                            <th className="text-left p-2">Type</th>
                                            <th className="text-right p-2">Amount</th>
                                            <th className="text-center p-2">Taxable</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {withdrawalBreakdown.map((w, idx) => (
                                            <tr key={idx} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                                <td className="p-2 text-white">{w.name}</td>
                                                <td className="p-2 text-content-muted text-xs">{w.type}</td>
                                                <td className="p-2 text-right font-mono text-cat-purple">{toCurrencyShort(w.amount)}</td>
                                                <td className="p-2 text-center">
                                                    {w.isTaxable ? <span className="text-warning">●</span> : <span className="text-content-faint">○</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="border-t border-border-strong">
                                        <tr className="font-semibold">
                                            <td className="p-2 text-white" colSpan={2}>Total Withdrawals</td>
                                            <td className="p-2 text-right font-mono text-cat-purple">
                                                {toCurrencyShort(simYear.cashflow.withdrawals)}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                                {simYear.taxDetails.capitalGains > 0 && (
                                    <div className="mt-2 p-2 bg-surface-overlay rounded text-sm">
                                        <div className="text-content-muted text-xs uppercase mb-1">Capital Gains from Brokerage/ESPP</div>
                                        <div className="flex justify-between">
                                            <span className="text-content-default">Capital Gains Tax Paid</span>
                                            <span className="font-mono text-warning">{toCurrencyShort(simYear.taxDetails.capitalGains)}</span>
                                        </div>
                                    </div>
                                )}
                                {simYear.taxDetails.withdrawalOrdinaryTax > 0 && (
                                    <div className="mt-2 p-2 bg-surface-overlay rounded text-sm">
                                        <div className="text-content-muted text-xs uppercase mb-1">Withdrawal Ordinary Tax</div>
                                        <div className="flex justify-between">
                                            <span className="text-content-default">Tax on Roth Earnings / Traditional / HSA</span>
                                            <span className="font-mono text-cat-purple">{toCurrencyShort(simYear.taxDetails.withdrawalOrdinaryTax)}</span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* 4. Contributions/Inflows */}
            <div>
                <SectionHeader title="Contributions & Inflows" section="inflows" />
                {expandedSections.inflows && (
                    <div className="mt-2 bg-surface-raised rounded-lg p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">User Contributions</div>
                                <div className="font-mono text-info">{toCurrencyShort(simYear.cashflow.investedUser)}</div>
                            </div>
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">Employer Match</div>
                                <div className="font-mono text-cat-cyan">{toCurrencyShort(simYear.cashflow.investedMatch)}</div>
                            </div>
                        </div>
                        {bucketDetails.length > 0 && (
                            <div>
                                <div className="text-xs text-content-muted uppercase tracking-wider mb-1">Priority Bucket Allocations</div>
                                <div className="space-y-1">
                                    {bucketDetails.map((b, idx) => (
                                        <div key={idx} className="flex justify-between bg-surface-overlay/50 rounded p-2">
                                            <span className="text-content-default">{b.name}</span>
                                            <span className="font-mono text-positive">{toCurrencyShort(b.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-between border-t border-border-default pt-2 font-semibold">
                            <span className="text-white">Total Invested</span>
                            <span className="font-mono text-info">{toCurrencyShort(simYear.cashflow.totalInvested)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* 5. Taxes */}
            <div>
                <SectionHeader title="Tax Breakdown" section="taxes" />
                {expandedSections.taxes && (
                    <div className="mt-2 bg-surface-raised rounded-lg p-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">Federal Tax</div>
                                <div className="font-mono text-warning">{toCurrencyShort(simYear.taxDetails.fed)}</div>
                            </div>
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">State Tax</div>
                                <div className="font-mono text-warning">{toCurrencyShort(simYear.taxDetails.state)}</div>
                            </div>
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">FICA</div>
                                <div className="font-mono text-warning">{toCurrencyShort(simYear.taxDetails.fica)}</div>
                            </div>
                            <div className="bg-surface-overlay/50 rounded p-2">
                                <div className="text-xs text-content-muted">Total Tax</div>
                                <div className="font-mono text-negative font-bold">{toCurrencyShort(totalTax)}</div>
                            </div>
                        </div>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-content-muted">Pre-Tax Deductions (401k, HSA)</span>
                                <span className="font-mono text-content-default">{toCurrencyShort(simYear.taxDetails.preTax)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-content-muted">Insurance Costs</span>
                                <span className="font-mono text-content-default">{toCurrencyShort(simYear.taxDetails.insurance)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-content-muted">Post-Tax Deductions</span>
                                <span className="font-mono text-content-default">{toCurrencyShort(simYear.taxDetails.postTax)}</span>
                            </div>
                            {simYear.taxDetails.capitalGains > 0 && (
                                <div className="flex justify-between text-cat-lime">
                                    <span>Capital Gains Tax (Brokerage/ESPP)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.capitalGains)}</span>
                                </div>
                            )}
                            {simYear.taxDetails.withdrawalOrdinaryTax > 0 && (
                                <div className="flex justify-between text-cat-purple">
                                    <span>Withdrawal Tax (Roth Earnings/Traditional)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.withdrawalOrdinaryTax)}</span>
                                </div>
                            )}
                            {simYear.taxDetails.niit > 0 && (
                                <div className="flex justify-between text-cat-orange">
                                    <span>NIIT (3.8% Net Investment Income Tax)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.niit)}</span>
                                </div>
                            )}
                            {(simYear.taxDetails.irmaa ?? 0) > 0 && (
                                <div className="flex justify-between text-cat-orange">
                                    <span>Medicare IRMAA (Part B/D surcharge)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.irmaa ?? 0)}</span>
                                </div>
                            )}
                            {(simYear.taxDetails.aca ?? 0) > 0 && (
                                <div className="flex justify-between text-cat-orange">
                                    <span>ACA Subsidy Loss (400% FPL cliff)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.aca ?? 0)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 6. Roth Conversions */}
            {simYear.rothConversion && simYear.rothConversion.amount > 0 && (
                <div>
                    <SectionHeader title="Roth Conversion" section="rothConversion" />
                    {expandedSections.rothConversion && (
                        <div className="mt-2 bg-surface-raised rounded-lg p-3">
                            <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="bg-cat-purple-tint/30 border border-cat-purple-strong/50 rounded p-2">
                                    <div className="text-xs text-cat-purple-bright">Amount Converted</div>
                                    <div className="font-mono text-cat-purple font-bold">
                                        {toCurrencyShort(simYear.rothConversion.amount)}
                                    </div>
                                </div>
                                <div className="bg-negative-tint/30 border border-negative-strong/50 rounded p-2">
                                    <div className="text-xs text-negative-bright">Tax Cost</div>
                                    <div className="font-mono text-negative">
                                        {toCurrencyShort(simYear.rothConversion.taxCost)}
                                    </div>
                                </div>
                                <div className="bg-surface-overlay/50 rounded p-2">
                                    <div className="text-xs text-content-muted">Effective Rate</div>
                                    <div className="font-mono text-white">
                                        {((simYear.rothConversion.taxCost / simYear.rothConversion.amount) * 100).toFixed(1)}%
                                    </div>
                                </div>
                            </div>
                            {Object.keys(simYear.rothConversion.fromAccounts).length > 0 && (
                                <div className="space-y-2 text-sm">
                                    <div className="text-xs text-content-muted uppercase">Transfer Details</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <div className="text-content-subtle text-xs mb-1">From (Traditional)</div>
                                            {Object.entries(simYear.rothConversion.fromAccounts).map(([name, amt]) => (
                                                <div key={name} className="flex justify-between bg-surface-overlay/50 rounded p-1 px-2">
                                                    <span className="text-content-default truncate">{name}</span>
                                                    <span className="font-mono text-negative">-{toCurrencyShort(amt)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div>
                                            <div className="text-content-subtle text-xs mb-1">To (Roth)</div>
                                            {Object.entries(simYear.rothConversion.toAccounts).map(([name, amt]) => (
                                                <div key={name} className="flex justify-between bg-surface-overlay/50 rounded p-1 px-2">
                                                    <span className="text-content-default truncate">{name}</span>
                                                    <span className="font-mono text-positive">+{toCurrencyShort(amt)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 7. RMD Details */}
            {simYear.rmdDetails && simYear.rmdDetails.totalRMD > 0 && (
                <div>
                    <button
                        onClick={() => toggleSection('rmd')}
                        className="w-full flex items-center justify-between p-3 bg-cat-orange-tint/30 hover:bg-cat-orange-tint/40 border border-cat-orange-strong/50 rounded-lg transition-colors"
                    >
                        <span className="font-semibold text-cat-orange-bright">Required Minimum Distributions</span>
                        <span className="text-cat-orange">{expandedSections['rmd'] ? '▼' : '▶'}</span>
                    </button>
                    {expandedSections['rmd'] && (
                        <div className="mt-2 bg-surface-raised rounded-lg p-3">
                            <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="bg-surface-overlay/50 rounded p-2">
                                    <div className="text-xs text-content-muted">Required RMD</div>
                                    <div className="font-mono text-cat-orange">{toCurrencyShort(simYear.rmdDetails.totalRMD)}</div>
                                </div>
                                <div className="bg-surface-overlay/50 rounded p-2">
                                    <div className="text-xs text-content-muted">Actually Withdrawn</div>
                                    <div className="font-mono text-white">{toCurrencyShort(simYear.rmdDetails.totalWithdrawn)}</div>
                                </div>
                                {simYear.rmdDetails.shortfall > 0 && (
                                    <div className="bg-negative-tint/30 border border-negative-strong/50 rounded p-2">
                                        <div className="text-xs text-negative-bright">Shortfall (25% penalty)</div>
                                        <div className="font-mono text-negative">{toCurrencyShort(simYear.rmdDetails.penalty)}</div>
                                    </div>
                                )}
                            </div>
                            {simYear.rmdDetails.accountBreakdown.length > 0 && (
                                <div className="text-sm">
                                    <div className="text-xs text-content-muted uppercase mb-1">Per-Account Breakdown</div>
                                    {simYear.rmdDetails.accountBreakdown.map((rmd, idx) => (
                                        <div key={idx} className="flex justify-between bg-surface-overlay/50 rounded p-2 mb-1">
                                            <span className="text-content-default">{rmd.accountName}</span>
                                            <span className="font-mono text-cat-orange">{toCurrencyShort(rmd.rmdAmount)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// SIMULATION DEBUG TAB
// ============================================================================
function SimulationDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation, inputHash: storedInputHash, dispatch: dispatchSimulation } = useContext(SimulationContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { months: budgetMonths } = useContext(BudgetContext);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showDetailedView, setShowDetailedView] = useState(false);
    const [copyButtonText, setCopyButtonText] = useState('Copy as Text');
    const [multiAgesInput, setMultiAgesInput] = useState('35, 45, 55, 67, 75');
    const [multiCopyText, setMultiCopyText] = useState('Copy ages');

    const retirementAge = getRetirementAge(assumptions.milestones);
    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);

    // Auto-recalculation logic (same as FutureTab)
    const currentInputHash = useMemo(() =>
        getSimulationInputHash(accounts, incomes, expenses, assumptions, taxState),
        [accounts, incomes, expenses, assumptions, taxState]
    );

    const isSimulationStale = useMemo(() => {
        if (simulation.length === 0) return false;
        if (!storedInputHash) return true;
        return storedInputHash !== currentInputHash;
    }, [storedInputHash, currentInputHash, simulation.length]);

    // #158: async — with Tax Optimization ON the projection is the multi-second
    // joint conversion/order search; buildProjectionAsync routes it through the
    // jointSearch Web Worker (sync fallback when unavailable) so this debug tab
    // never freezes the whole UI on mount/staleness.
    const executeSimulation = useCallback(
        () => buildProjectionAsync(assumptions, accounts, incomes, expenses, taxState, budgetMonths, simulation),
        [assumptions, accounts, incomes, expenses, taxState, budgetMonths, simulation],
    );

    const handleRecalculate = useCallback(() => {
        setIsLoading(true);
        executeSimulation().then(newSimulation => {
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash: currentInputHash }
            });
            setIsLoading(false);
        }).catch(err => {
            // Superseded → a newer request owns the loading state; anything else —
            // release it so the tab can't hang on a failed run.
            if (err instanceof JointSearchSupersededError) return;
            setIsLoading(false);
        });
    }, [executeSimulation, dispatchSimulation, currentInputHash]);

    // Auto-recalculate on mount if data exists but no simulation
    useEffect(() => {
        const hasData = accounts.length > 0 || incomes.length > 0 || expenses.length > 0;
        const hasNoSimulation = simulation.length === 0;

        if (hasData && hasNoSimulation) {
            handleRecalculate();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-run simulation after 500ms of being stale
    useEffect(() => {
        if (!isSimulationStale || isLoading) return;

        const timer = setTimeout(() => {
            handleRecalculate();
        }, 500);

        return () => clearTimeout(timer);
    }, [isSimulationStale, currentInputHash, isLoading, handleRecalculate]);

    // Analyze simulation for issues
    const analysis = useMemo(() => {
        if (simulation.length === 0) return null;

        const issues: Array<{ year: number; age: number; type: string; message: string; severity: 'error' | 'warning' | 'info' }> = [];
        const birthYear = currentYear - startAge;

        const yearData: Array<{
            year: number;
            age: number;
            isEndOfYearProjection: boolean;
            isRetired: boolean;
            netWorth: number;
            totalIncome: number;
            totalExpenses: number;
            totalWithdrawals: number;
            discretionary: number;
            accountBalances: Record<string, number>;
            workIncomes: Array<{ name: string; amount: number; contrib401k: number; employerMatch: number }>;
            socialSecurityIncome: number;
            interestIncome: Array<{ name: string; amount: number }>;
            withdrawalDetail: Record<string, number>;
            bucketDetail: Record<string, number>;
            taxDetails: { fed: number; state: number; fica: number; capitalGains: number; withdrawalOrdinaryTax: number; irmaa?: number; aca?: number; earlyWithdrawalPenalty?: number };
            logs: string[];
        }> = [];

        simulation.forEach((simYear, idx) => {
            const age = simYear.year - birthYear;
            const isRetired = age >= retirementAge;

            // Extract data
            const totalWithdrawals = simYear.cashflow.withdrawals || 0;
            const withdrawalDetail = simYear.cashflow.withdrawalDetail || {};
            const bucketDetail = simYear.cashflow.bucketDetail || {};

            // Account balances
            const accountBalances: Record<string, number> = {};
            simYear.accounts.forEach(acc => {
                accountBalances[acc.name] = acc.amount;
            });

            // Work income details
            const workIncomes: Array<{ name: string; amount: number; contrib401k: number; employerMatch: number }> = [];
            let socialSecurityIncome = 0;
            const interestIncome: Array<{ name: string; amount: number }> = [];

            simYear.incomes.forEach(inc => {
                if (inc instanceof WorkIncome) {
                    workIncomes.push({
                        name: inc.name,
                        amount: inc.getProratedAnnual(inc.amount, simYear.year),
                        contrib401k: inc.getProratedAnnual(inc.preTax401k + inc.roth401k, simYear.year),
                        employerMatch: inc.getEffectiveAnnualEmployerMatch(simYear.year),
                    });
                } else if (isSocialSecurity(inc)) {
                    socialSecurityIncome += inc.getProratedAnnual(inc.amount, simYear.year);
                } else if (inc instanceof PassiveIncome && inc.sourceType === 'Interest') {
                    interestIncome.push({
                        name: inc.name,
                        amount: inc.getProratedAnnual(inc.amount, simYear.year),
                    });
                }
            });

            // Check for issues
            // 1. Deficit when there's money in accounts
            if (simYear.cashflow.discretionary < -1) {
                const totalAvailable = simYear.accounts.reduce((sum, acc) =>
                    acc instanceof DebtAccount ? sum : sum + acc.amount, 0);
                if (totalAvailable > Math.abs(simYear.cashflow.discretionary)) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'DEFICIT_WITH_FUNDS',
                        message: `Deficit of ${toCurrencyShort(simYear.cashflow.discretionary)} but accounts have ${toCurrencyShort(totalAvailable)} available`,
                        severity: 'error'
                    });
                }
            }

            // 2. 401k contributions after retirement
            if (isRetired) {
                workIncomes.forEach(wi => {
                    if (wi.contrib401k > 0 || wi.employerMatch > 0) {
                        issues.push({
                            year: simYear.year,
                            age,
                            type: '401K_AFTER_RETIREMENT',
                            message: `${wi.name}: 401k contrib ${toCurrencyShort(wi.contrib401k)}, employer match ${toCurrencyShort(wi.employerMatch)} after retirement`,
                            severity: 'error'
                        });
                    }
                });

            }

            // 3. No withdrawals when in deficit and retired
            if (isRetired && simYear.cashflow.discretionary < -1 && totalWithdrawals === 0) {
                issues.push({
                    year: simYear.year,
                    age,
                    type: 'NO_WITHDRAWAL_IN_DEFICIT',
                    message: `Deficit of ${toCurrencyShort(simYear.cashflow.discretionary)} but no withdrawals made`,
                    severity: 'error'
                });
            }

            // 4. Alternating expense patterns (check against previous year)
            if (idx > 0) {
                const prevYear = simulation[idx - 1];
                const prevExpenseCount = prevYear.expenses.length;
                const currExpenseCount = simYear.expenses.length;
                const prevExpenseTotal = prevYear.cashflow.totalExpense;
                const currExpenseTotal = simYear.cashflow.totalExpense;

                // Check if this is the first year of retirement (transition year)
                const prevAge = prevYear.year - birthYear;
                const wasRetiredLastYear = prevAge >= retirementAge;
                const isFirstRetirementYear = isRetired && !wasRetiredLastYear;

                // Big swing in expense count or amount
                if (Math.abs(prevExpenseCount - currExpenseCount) > 2) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'EXPENSE_COUNT_CHANGE',
                        message: `Expense count changed from ${prevExpenseCount} to ${currExpenseCount}`,
                        severity: 'info'
                    });
                }
                // Skip expense swing warning for:
                // - First year of retirement (expected drop in 401k, FICA, etc.)
                // - Guyton-Klinger guardrail triggers (prosperity/austerity adjustments)
                // - Transitions from/to EOY projection (prorated amounts cause false positives)
                const hasGKTrigger = (simYear.logs || []).some(log =>
                    log.includes('GK Prosperity') || log.includes('GK Austerity')
                );
                const prevIsEOY = prevYear.isEndOfYearProjection;
                if (!isFirstRetirementYear && !hasGKTrigger && !prevIsEOY && !simYear.isEndOfYearProjection && prevExpenseTotal > 0 && Math.abs(currExpenseTotal - prevExpenseTotal) / prevExpenseTotal > 0.5) {
                    issues.push({
                        year: simYear.year,
                        age,
                        type: 'EXPENSE_AMOUNT_SWING',
                        message: `Expenses swung from ${toCurrencyShort(prevExpenseTotal)} to ${toCurrencyShort(currExpenseTotal)}`,
                        severity: 'warning'
                    });
                }
            }

            const netWorth = simYear.accounts.reduce((sum, acc) => {
                if (acc instanceof DebtAccount) return sum - acc.amount;
                if (acc instanceof PropertyAccount) return sum + acc.amount - (acc.loanAmount || 0);
                return sum + acc.amount;
            }, 0);

            yearData.push({
                year: simYear.year,
                age,
                isEndOfYearProjection: !!simYear.isEndOfYearProjection,
                isRetired,
                totalIncome: simYear.cashflow.totalIncome,
                totalExpenses: simYear.cashflow.totalExpense,
                totalWithdrawals,
                discretionary: simYear.cashflow.discretionary,
                netWorth,
                accountBalances,
                workIncomes,
                socialSecurityIncome,
                interestIncome,
                withdrawalDetail,
                bucketDetail,
                taxDetails: {
                    fed: simYear.taxDetails.fed,
                    state: simYear.taxDetails.state,
                    fica: simYear.taxDetails.fica,
                    capitalGains: simYear.taxDetails.capitalGains,
                    withdrawalOrdinaryTax: simYear.taxDetails.withdrawalOrdinaryTax || 0,
                    irmaa: simYear.taxDetails.irmaa ?? 0,
                    aca: simYear.taxDetails.aca ?? 0,
                    earlyWithdrawalPenalty: simYear.taxDetails.earlyWithdrawalPenalty,
                },
                logs: simYear.logs || [],
            });
        });

        return { issues, yearData };
    }, [simulation, startAge, retirementAge]);

    if (simulation.length === 0 || isLoading) {
        return (
            <div className="text-center py-8 text-content-muted">
                {isLoading ? 'Running simulation...' : 'No simulation data. Waiting for data...'}
            </div>
        );
    }

    const selectedYearData = selectedYear !== null
        ? analysis?.yearData.find(y => y.year === selectedYear)
        : null;

    return (
        <div className="space-y-6">
            {/* Current Configuration */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Current Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-content-muted">Start Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Retirement Age:</span>
                        <span className="ml-2 text-white">{retirementAge}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Accounts:</span>
                        <span className="ml-2 text-white">{accounts.length}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Withdrawal Strategy:</span>
                        <span className="ml-2 text-white">{assumptions.withdrawalStrategy?.length || 0} buckets</span>
                    </div>
                </div>
                {assumptions.withdrawalStrategy && assumptions.withdrawalStrategy.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle">
                        <span className="text-content-muted text-sm">Withdrawal Order: </span>
                        {assumptions.withdrawalStrategy.map((bucket, idx) => {
                            const acc = accounts.find(a => a.id === bucket.accountId);
                            return (
                                <span key={bucket.accountId} className="text-xs bg-surface-overlay px-2 py-1 rounded mr-2">
                                    {idx + 1}. {acc?.name || 'Unknown'}
                                </span>
                            );
                        })}
                    </div>
                )}
            </Panel>

            {/* Issues Summary */}
            {analysis && analysis.issues.length > 0 && (
                <div className="bg-negative-tint/20 p-4 rounded-xl border border-negative-strong">
                    <h3 className="text-lg font-bold text-negative mb-3">
                        Issues Found ({analysis.issues.length})
                    </h3>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {analysis.issues.map((issue, idx) => (
                            <div
                                key={idx}
                                className={`text-sm p-2 rounded cursor-pointer hover:bg-surface-overlay ${
                                    issue.severity === 'error' ? 'bg-negative-tint/30 text-negative-bright' :
                                    issue.severity === 'warning' ? 'bg-warning-tint/30 text-warning-bright' :
                                    'bg-info-tint/30 text-info-bright'
                                }`}
                                onClick={() => setSelectedYear(issue.year)}
                            >
                                <span className="font-mono">{issue.year} (Age {issue.age})</span>
                                <span className="mx-2 text-content-subtle">|</span>
                                <span className="font-semibold">{issue.type}</span>
                                <span className="mx-2 text-content-subtle">|</span>
                                <span>{issue.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Year-by-Year Data Table */}
            <Panel padding="none" className="overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border-subtle gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-white">
                        Simulation Data (Click row for details)
                    </h3>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={multiAgesInput}
                            onChange={(e) => setMultiAgesInput(e.target.value)}
                            placeholder="ages e.g. 35, 45, 55"
                            className="px-2 py-1 rounded bg-surface-overlay border border-border-default text-sm text-white font-mono w-48 focus:outline-none focus:border-accent-soft"
                        />
                        <button
                            onClick={() => {
                                const ages = multiAgesInput
                                    .split(/[,\s]+/)
                                    .map(s => parseInt(s.trim(), 10))
                                    .filter(n => Number.isFinite(n));
                                if (ages.length === 0) {
                                    setMultiCopyText('No ages');
                                    setTimeout(() => setMultiCopyText('Copy ages'), 1500);
                                    return;
                                }
                                const chunks: string[] = [];
                                const missing: number[] = [];
                                for (const age of ages) {
                                    const row = analysis?.yearData.find(
                                        y => y.age === age && !y.isEndOfYearProjection
                                    );
                                    const fullSimYear = row && simulation.find(s => s.year === row.year);
                                    if (!row || !fullSimYear) {
                                        missing.push(age);
                                        continue;
                                    }
                                    chunks.push(generateYearSummaryText(fullSimYear, row.age, accounts));
                                }
                                if (chunks.length === 0) {
                                    setMultiCopyText('No matches');
                                    setTimeout(() => setMultiCopyText('Copy ages'), 1500);
                                    return;
                                }
                                const header = missing.length > 0
                                    ? `(missing ages: ${missing.join(', ')})\n\n`
                                    : '';
                                const text = header + chunks.join('\n\n========================================\n\n');
                                navigator.clipboard.writeText(text).then(() => {
                                    setMultiCopyText(`Copied ${chunks.length}!`);
                                    setTimeout(() => setMultiCopyText('Copy ages'), 1500);
                                });
                            }}
                            className="px-3 py-1 rounded-lg text-sm font-medium bg-surface-input text-content-default hover:bg-surface-hover transition-colors whitespace-nowrap"
                        >
                            {multiCopyText}
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-overlay sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-content-muted">Year</th>
                                <th className="p-2 text-left text-content-muted">Age</th>
                                <th className="p-2 text-left text-content-muted">Phase</th>
                                <th className="p-2 text-right text-content-muted">Income</th>
                                <th className="p-2 text-right text-content-muted">Expenses</th>
                                <th className="p-2 text-right text-content-muted">Withdrawals</th>
                                <th className="p-2 text-right text-content-muted">Discretionary</th>
                                <th className="p-2 text-right text-content-muted">Net Worth</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analysis?.yearData.map(row => {
                                const hasIssue = analysis.issues.some(i => i.year === row.year);
                                return (
                                    <tr
                                        key={`${row.year}-${row.isEndOfYearProjection ? 'eoy' : 'main'}`}
                                        className={`border-t border-border-subtle cursor-pointer hover:bg-surface-overlay ${
                                            selectedYear === row.year ? 'bg-info-tint/30' : ''
                                        } ${hasIssue ? 'bg-negative-tint/10' : ''} ${row.isEndOfYearProjection ? 'opacity-60 italic' : ''}`}
                                        onClick={() => setSelectedYear(row.year)}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.isEndOfYearProjection ? `Rest of ${row.year}` : row.year}
                                        </td>
                                        <td className="p-2">{row.age}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                                row.isRetired ? 'bg-warning-tint/50 text-warning-bright' : 'bg-positive-tint/50 text-positive-bright'
                                            }`}>
                                                {row.isRetired ? 'Retired' : 'Working'}
                                            </span>
                                        </td>
                                        <td className="p-2 text-right font-mono text-positive">{toCurrencyShort(row.totalIncome)}</td>
                                        <td className="p-2 text-right font-mono text-negative">{toCurrencyShort(row.totalExpenses)}</td>
                                        <td className="p-2 text-right font-mono text-cat-purple">
                                            {row.totalWithdrawals > 0 ? toCurrencyShort(row.totalWithdrawals) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-mono ${row.discretionary < 0 ? 'text-negative-soft font-bold' : 'text-content-muted'}`}>
                                            {toCurrencyShort(row.discretionary)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-info">{toCurrencyShort(row.netWorth)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Selected Year Details */}
            {selectedYearData && (
                <Panel>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-white">
                            Year {selectedYearData.year} Details (Age {selectedYearData.age})
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    const fullSimYear = simulation.find(s => s.year === selectedYearData.year);
                                    if (!fullSimYear) return;
                                    const text = generateYearSummaryText(fullSimYear, selectedYearData.age, accounts);
                                    navigator.clipboard.writeText(text).then(() => {
                                        setCopyButtonText('Copied!');
                                        setTimeout(() => setCopyButtonText('Copy as Text'), 1500);
                                    });
                                }}
                                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-surface-input text-content-default hover:bg-surface-hover"
                            >
                                {copyButtonText}
                            </button>
                            <button
                                onClick={() => setShowDetailedView(!showDetailedView)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    showDetailedView
                                        ? 'bg-accent text-white'
                                        : 'bg-surface-input text-content-default hover:bg-surface-hover'
                                }`}
                            >
                                {showDetailedView ? '◉ Detailed View' : '○ Basic View'}
                            </button>
                        </div>
                    </div>

                    {/* Detailed View Panel */}
                    {showDetailedView && (() => {
                        const fullSimYear = simulation.find(s => s.year === selectedYearData.year);
                        if (!fullSimYear) return null;
                        return (
                            <DetailedYearPanel
                                simYear={fullSimYear}
                                age={selectedYearData.age}
                                accountsContext={accounts}
                            />
                        );
                    })()}

                    {/* Basic View (original content) */}
                    {!showDetailedView && (
                    <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Account Balances */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Account Balances</h4>
                            <div className="space-y-1 text-sm">
                                {Object.entries(selectedYearData.accountBalances).map(([name, bal]) => (
                                    <div key={name} className="flex justify-between">
                                        <span className="text-content-muted">{name}</span>
                                        <span className="font-mono text-white">{toCurrencyShort(bal)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Work Income Details */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Work Income</h4>
                            {selectedYearData.workIncomes.length === 0 ? (
                                <span className="text-content-subtle text-sm">No work income</span>
                            ) : (
                                <div className="space-y-2 text-sm">
                                    {selectedYearData.workIncomes.map(wi => (
                                        <div key={wi.name} className="border-b border-border-default pb-2">
                                            <div className="font-semibold text-white">{wi.name}</div>
                                            <div className="flex justify-between text-content-muted">
                                                <span>Salary:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.amount)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.contrib401k > 0 && selectedYearData.isRetired ? 'text-negative' : 'text-content-muted'}`}>
                                                <span>401k Contrib:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.contrib401k)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.employerMatch > 0 && selectedYearData.isRetired ? 'text-negative' : 'text-content-muted'}`}>
                                                <span>Employer Match:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.employerMatch)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Other Income (Social Security + Interest) */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Other Income</h4>
                            <div className="space-y-2 text-sm">
                                {/* Social Security */}
                                <div className="flex justify-between text-content-muted">
                                    <span>Social Security:</span>
                                    <span className={`font-mono ${selectedYearData.socialSecurityIncome > 0 ? 'text-cat-cyan' : 'text-content-subtle'}`}>
                                        {selectedYearData.socialSecurityIncome > 0 ? toCurrencyShort(selectedYearData.socialSecurityIncome) : '-'}
                                    </span>
                                </div>
                                {/* Interest Income */}
                                {selectedYearData.interestIncome.length === 0 ? (
                                    <div className="flex justify-between text-content-muted">
                                        <span>Interest Income:</span>
                                        <span className="font-mono text-content-subtle">-</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-content-muted mt-2">Interest Income:</div>
                                        {selectedYearData.interestIncome.map(ii => (
                                            <div key={ii.name} className="flex justify-between pl-2">
                                                <span className="text-content-subtle">{ii.name}</span>
                                                <span className="font-mono text-warning">{toCurrencyShort(ii.amount)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between border-t border-border-default pt-1 mt-1">
                                            <span className="text-content-muted">Total Interest:</span>
                                            <span className="font-mono text-warning">
                                                {toCurrencyShort(selectedYearData.interestIncome.reduce((sum, ii) => sum + ii.amount, 0))}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Withdrawals */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Withdrawals</h4>
                            {Object.keys(selectedYearData.withdrawalDetail).length === 0 ? (
                                <span className="text-content-subtle text-sm">No withdrawals</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {/* withdrawalDetail is keyed by account id (#142); resolve id -> name. */}
                                    {Object.entries(selectedYearData.withdrawalDetail).map(([id, amt]) => {
                                        const acc = accounts.find(a => a.id === id);
                                        return (
                                            <div key={id} className="flex justify-between">
                                                <span className="text-content-muted">{acc?.name || id}</span>
                                                <span className="font-mono text-cat-purple">{toCurrencyShort(amt)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Bucket Allocations */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Priority Buckets</h4>
                            {Object.keys(selectedYearData.bucketDetail).length === 0 ? (
                                <span className="text-content-subtle text-sm">No allocations</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {Object.entries(selectedYearData.bucketDetail).map(([id, amt]) => {
                                        const acc = accounts.find(a => a.id === id);
                                        return (
                                            <div key={id} className="flex justify-between">
                                                <span className="text-content-muted">{acc?.name || id}</span>
                                                <span className="font-mono text-positive">{toCurrencyShort(amt)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tax Breakdown */}
                    <div className="mt-4 bg-surface-overlay p-3 rounded-lg">
                        <h4 className="font-semibold text-content-default mb-2">Tax Breakdown</h4>
                        {(() => {
                            const fedRaw = selectedYearData.taxDetails.fed;
                            const penalty = selectedYearData.taxDetails.earlyWithdrawalPenalty ?? 0;
                            const fedIncomeTax = Math.max(0, fedRaw - penalty);
                            return (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <span className="text-content-muted">Federal Income Tax:</span>
                                <span className={`ml-2 font-mono ${fedIncomeTax > 0 ? 'text-warning' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(fedIncomeTax)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">Early-Withdraw Penalty:</span>
                                <span className={`ml-2 font-mono ${penalty > 0 ? 'text-warning' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(penalty)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">State Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.state > 0 ? 'text-warning' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.state)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">FICA:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.fica > 0 ? 'text-warning' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.fica)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">Cap Gains Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.capitalGains > 0 ? 'text-cat-lime' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.capitalGains)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">Withdrawal Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.withdrawalOrdinaryTax > 0 ? 'text-cat-purple' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.withdrawalOrdinaryTax)}
                                </span>
                            </div>
                            <div>
                                <span className="text-content-muted">Medicare IRMAA:</span>
                                <span className={`ml-2 font-mono ${(selectedYearData.taxDetails.irmaa ?? 0) > 0 ? 'text-cat-orange' : 'text-content-subtle'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.irmaa ?? 0)}
                                </span>
                            </div>
                        </div>
                            );
                        })()}
                        <div className="mt-2 pt-2 border-t border-border-default text-xs text-content-subtle">
                            Cap Gains Tax is from brokerage/ESPP withdrawals.
                            Withdrawal Tax is from Roth earnings (5-year rule), Traditional, or HSA non-medical.
                            Early-Withdraw Penalty is the 10% penalty on Traditional pre-59½ and Roth conversion 5-year-rule withdrawals (also bundled into the engine's `taxDetails.fed`).
                            {selectedYearData.isRetired && (selectedYearData.taxDetails.fed - (selectedYearData.taxDetails.earlyWithdrawalPenalty ?? 0)) > 0 && selectedYearData.taxDetails.capitalGains === 0 && selectedYearData.taxDetails.withdrawalOrdinaryTax === 0 && (
                                <span className="text-warning block mt-1">
                                    Federal income tax in retirement with $0 withdrawal taxes may indicate ordinary income (Roth conversion, etc.) above the standard deduction.
                                </span>
                            )}
                        </div>
                    </div>
                    </>
                    )}

                    {/* Logs (shown in both views) */}
                    {selectedYearData.logs.length > 0 && (
                        <div className="mt-4 bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Simulation Logs</h4>
                            <div className="text-xs font-mono space-y-1 max-h-96 overflow-y-auto">
                                {selectedYearData.logs.map((log, idx) => (
                                    <div key={idx} className="text-content-muted">{log}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </Panel>
            )}
        </div>
    );
}

// ============================================================================
// MORTGAGE TESTING TAB (Original)
// ============================================================================
function MortgageTestingTab() {
    const { state: assumptions } = useContext(AssumptionsContext);

    // --- Inputs State ---
    const [valuation, setValuation] = useState(500000);
    const [startingLoan, setStartingLoan] = useState(400000);
    const [apr, setApr] = useState(6.5);
    const [propertyTaxRate, setPropertyTaxRate] = useState(0.85);
    const [propertyDeduction, setPropertyDeduction] = useState(89850);
    const [insuranceRate, setInsuranceRate] = useState(0.56);
    const [repairsRate, setRepairsRate] = useState(0.75);
    const [term, setTerm] = useState(30);
    const [extraPayment, setExtraPayment] = useState(0);
    const [pmi, setPmi] = useState(0);
    const [hoa, setHoa] = useState(0);
    const [utilities, setUtilities] = useState(0);

    // --- Simulation ---
    const simulationData = useMemo(() => {
        const rows = [];

        // 1. Create Initial Mortgage Object
        // We use today as start date
        const startDate = new Date();

        let currentMortgage = new MortgageExpense(
            'debug-mortgage',
            'Debug Mortgage',
            'Monthly',
            valuation,
            startingLoan, // Current Balance (starts full)
            startingLoan, // Starting Balance
            apr,
            term,
            propertyTaxRate,
            propertyDeduction,
            repairsRate,
            utilities,
            insuranceRate,
            pmi,
            hoa,
            'No', // Tax Deductible (not used for this sim display)
            0,
            'none',
            startDate,
            0,
            extraPayment
        );

        // 2. Loop for 30 years (or Term)
        for (let year = 1; year <= (term+5); year++) {
            // Capture Start-of-Year State
            const startValuation = currentMortgage.valuation;
            const startBalance = currentMortgage.loan_balance;

            // Calculate 'Escrow' and other non-P&I expenses for the year
            // These are based on the valuation/rates of the CURRENT year object
            const annualPropTax = Math.max(0, startValuation - currentMortgage.valuation_deduction) * (currentMortgage.property_taxes / 100);
            const annualInsurance = startValuation * (currentMortgage.home_owners_insurance / 100);
            const annualRepairs = startValuation * (currentMortgage.maintenance / 100);
            const annualPMI = startValuation * (currentMortgage.pmi / 100);
            const annualHOA = currentMortgage.hoa_fee * 12;
            const annualUtilities = currentMortgage.utilities * 12;

            // Advance Time
            const nextMortgage = currentMortgage.increment(assumptions, year);

            // Calculate Deltas from Increment
            // MortgageExpense.increment() stores the total interest paid in 'tax_deductible' of the NEW object
            const interestPaid = nextMortgage.tax_deductible;
            const principalPaid = startBalance - nextMortgage.loan_balance;

            // Total P&I actually paid (approximate via sum, accurate to what happened in simulation)
            const totalPIPaid = interestPaid + principalPaid;

            const totalAnnualCost = totalPIPaid + annualPropTax + annualInsurance + annualRepairs + annualPMI + annualHOA + annualUtilities;

            rows.push({
                year,
                valuation: startValuation,
                startBalance,
                interestPaid,
                principalPaid,
                propertyTax: annualPropTax,
                insurance: annualInsurance,
                repairs: annualRepairs,
                pmi: annualPMI,
                hoa: annualHOA,
                totalCost: totalAnnualCost,
                endBalance: nextMortgage.loan_balance
            });

            // Update for next iteration
            currentMortgage = nextMortgage;

            // Optional: optimization to stop if paid off early
            //if (currentMortgage.loan_balance <= 0 && principalPaid <= 0) break;
        }

        return rows;
    }, [valuation, startingLoan, apr, propertyTaxRate, propertyDeduction, insuranceRate, repairsRate, pmi, hoa, utilities, term, extraPayment, assumptions]);

    return (
        <>
            <h3 className="text-xl font-bold mb-4 text-white">
                Mortgage Full Simulation
            </h3>

            {/* --- Inputs Grid --- */}
                <Panel padding="lg" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 shadow-lg">
                    <CurrencyInput label="Home Valuation" value={valuation} onChange={setValuation} />
                    <CurrencyInput label="Starting Loan" value={startingLoan} onChange={setStartingLoan} />
                    <PercentageInput label="Interest Rate" value={apr} onChange={setApr} />
                    <NumberInput label="Term (Years)" value={term} onChange={setTerm} />

                    <PercentageInput label="Property Tax Rate" value={propertyTaxRate} onChange={setPropertyTaxRate} />
                    <CurrencyInput label="Prop. Tax Deduction" value={propertyDeduction} onChange={setPropertyDeduction} />
                    <PercentageInput label="Insurance Rate" value={insuranceRate} onChange={setInsuranceRate} />
                    <PercentageInput label="Repairs/Maint. Rate" value={repairsRate} onChange={setRepairsRate} />

                    <PercentageInput label="PMI Rate" value={pmi} onChange={setPmi} />
                    <CurrencyInput label="Monthly HOA" value={hoa} onChange={setHoa} />
                    <CurrencyInput label="Monthly Utilities" value={utilities} onChange={setUtilities} />
                    <CurrencyInput label="Extra Payment / Mo" value={extraPayment} onChange={setExtraPayment} />
                </Panel>

                {/* --- Results Table --- */}
                <div className="rounded-xl border border-border-subtle overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-surface-raised text-content-muted text-xs uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 border-b border-border-subtle">Year</th>
                                <th className="p-4 border-b border-border-subtle text-right">Valuation</th>
                                <th className="p-4 border-b border-border-subtle text-right text-negative">Interest</th>
                                <th className="p-4 border-b border-border-subtle text-right text-positive">Principal</th>
                                <th className="p-4 border-b border-border-subtle text-right text-cat-orange">Taxes</th>
                                <th className="p-4 border-b border-border-subtle text-right text-warning">Ins/Maint</th>
                                <th className="p-4 border-b border-border-subtle text-right">PMI/HOA</th>
                                <th className="p-4 border-b border-border-subtle text-right font-bold text-white">Total Outflow</th>
                                <th className="p-4 border-b border-border-subtle text-right text-info">Remaining Bal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle bg-surface-base">
                            {simulationData.map((row) => (
                                <tr key={row.year} className="hover:bg-surface-raised/40 transition-colors">
                                    <td className="p-4 font-mono text-content-subtle">{row.year}</td>
                                    <td className="p-4 text-right font-mono text-content-default">{toCurrency(row.valuation)}</td>
                                    <td className="p-4 text-right font-mono text-negative-soft/80">{toCurrency(row.interestPaid)}</td>
                                    <td className="p-4 text-right font-mono text-positive-soft/80">{toCurrency(row.principalPaid)}</td>
                                    <td className="p-4 text-right font-mono text-cat-orange-soft/80">{toCurrency(row.propertyTax)}</td>
                                    <td className="p-4 text-right font-mono text-warning-soft/80">{toCurrency(row.insurance + row.repairs)}</td>
                                    <td className="p-4 text-right font-mono text-content-muted">{toCurrency(row.pmi + row.hoa)}</td>
                                    <td className="p-4 text-right font-mono font-bold text-content-emphasis bg-surface-raised/20">{toCurrency(row.totalCost)}</td>
                                    <td className="p-4 text-right font-mono text-info font-semibold">{toCurrency(row.endBalance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
        </>
    );
}

// ============================================================================
// TAX DEBUG TAB
// ============================================================================
function TaxDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { state: taxState } = useContext(TaxContext);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [filingStatus, setFilingStatus] = useState(taxState.filingStatus);

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);

    // Calculate detailed tax info for each simulation year.
    // Uses sim engine output for gross income and final tax totals (since the engine
    // tracks RMDs, Traditional withdrawals, and capital gains that aren't in simYear.incomes).
    // Intermediate values (brackets, AGI, etc.) are derived from the corrected gross income.
    const taxData = useMemo(() => {
        if (simulation.length === 0) return [];

        const birthYear = currentYear - startAge;
        return simulation.filter(y => !y.isEndOfYearProjection).map((simYear) => {
            const age = simYear.year - birthYear;
            const year = simYear.year;
            const incomes = simYear.incomes;
            const expenses = simYear.expenses;

            // Get tax parameters using the selected filing status
            const fedParams = getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
            const stateParams = getTaxParameters(year, filingStatus, 'state', taxState.stateResidency, assumptions);

            if (!fedParams) return null;

            // Use sim engine's gross income (includes RMDs, Traditional withdrawals, cap gains, etc.)
            const grossIncome = simYear.cashflow.totalIncome;

            // Earned income and SS can still be derived from income objects (they are complete)
            const earnedIncome = getEarnedIncome(incomes, year);
            const preTaxDeductions = getPreTaxExemptions(incomes, year);
            const aboveLineDeductions = getYesDeductions(expenses, year);
            const totalPreTax = preTaxDeductions + aboveLineDeductions;

            // Social Security
            const ssBenefits = getSocialSecurityBenefits(incomes, year);
            const agiExcludingSS = grossIncome - ssBenefits - totalPreTax;
            const taxableSS = getTaxableSocialSecurityBenefits(ssBenefits, agiExcludingSS, 0, taxState.filingStatus);

            // AGI and deductions
            const agi = grossIncome - ssBenefits + taxableSS - totalPreTax;
            const itemizedDeductions = getItemizedDeductions(expenses, year);
            const saltCap = getSALTCap(year, taxState.filingStatus);
            const standardDeduction = fedParams.standardDeduction;
            const stateStandardDeduction = stateParams?.standardDeduction || 0;

            // Determine which deduction is better
            const usingItemized = itemizedDeductions > standardDeduction;
            const appliedDeduction = Math.max(itemizedDeductions, standardDeduction);

            // Taxable income
            const taxableIncome = Math.max(0, agi - appliedDeduction);

            // Calculate federal tax bracket by bracket (for the bracket breakdown display)
            const bracketBreakdown: Array<{ rate: number; amount: number; tax: number }> = [];
            let remainingIncome = taxableIncome;
            for (let i = 0; i < fedParams.brackets.length && remainingIncome > 0; i++) {
                const bracket = fedParams.brackets[i];
                const nextBracket = fedParams.brackets[i + 1];
                const upperLimit = nextBracket ? nextBracket.threshold : Infinity;
                const bracketSize = upperLimit - bracket.threshold;
                const amountInBracket = Math.min(remainingIncome, bracketSize);

                if (amountInBracket > 0) {
                    bracketBreakdown.push({
                        rate: bracket.rate,
                        amount: amountInBracket,
                        tax: amountInBracket * bracket.rate
                    });
                }
                remainingIncome -= amountInBracket;
            }

            const effectiveRate = taxableIncome > 0
                ? bracketBreakdown.reduce((sum, b) => sum + b.tax, 0) / taxableIncome
                : 0;
            const marginalInfo = getMarginalTaxRate(taxableIncome, fedParams);

            // State tax — derive intermediate values for display
            let stateAdjustedGross = grossIncome - totalPreTax;
            if (ssBenefits > 0) {
                const ssTreatment = stateParams?.socialSecurityTreatment ?? 'exempt';
                if (ssTreatment === 'taxable') {
                    stateAdjustedGross = agi;
                } else {
                    stateAdjustedGross = grossIncome - ssBenefits - totalPreTax;
                }
            }
            const stateTaxableIncome = stateParams ? Math.max(0, stateAdjustedGross - (stateParams.standardDeduction || 0)) : 0;

            // FICA — derive SS vs Medicare split for display. Use the shared
            // getFicaTaxableBase so this readout cannot drift from the FICA the
            // engine actually charges.
            const ficaTaxableBase = getFicaTaxableBase(incomes, year);
            // SS is charged only on the SS-covered base — CSRS wages are outside
            // Social Security (#139); Medicare stays on the full base. Mirrors
            // calculateFicaTax so this readout cannot drift from the engine.
            const ssCoveredBase = getFicaTaxableBase(incomes.filter(isSSCoveredForFica), year);
            const ssWageBase = fedParams.socialSecurityWageBase;
            const ssTax = Math.min(ssCoveredBase, ssWageBase) * fedParams.socialSecurityTaxRate;
            const medicareTax = ficaTaxableBase * fedParams.medicareTaxRate;

            // Use sim engine values for final tax totals (includes withdrawal taxes, NIIT, etc.)
            const federalTax = simYear.taxDetails.fed;
            const stateTax = simYear.taxDetails.state;
            const totalFica = simYear.taxDetails.fica;
            const capitalGainsTax = simYear.taxDetails.capitalGains || 0;

            return {
                year,
                age,
                grossIncome,
                earnedIncome,
                ssBenefits,
                taxableSS,
                preTaxDeductions,
                aboveLineDeductions,
                agi,
                standardDeduction,
                itemizedDeductions,
                usingItemized,
                appliedDeduction,
                saltCap,
                taxableIncome,
                bracketBreakdown,
                federalTax,
                effectiveRate,
                marginalInfo,
                stateTaxableIncome,
                stateTax,
                stateStandardDeduction,
                ficaTaxableBase,
                ssWageBase,
                ssTax,
                medicareTax,
                totalFica,
                capitalGainsTax,
                totalTax: federalTax + stateTax + totalFica + capitalGainsTax,
                fedParams,
                stateParams
            };
        }).filter(Boolean);
    }, [simulation, startAge, taxState, assumptions, filingStatus]);

    // Lifetime tax totals across the whole simulation. Follows the YearSolver
    // convention: fed already includes ordinary federal income tax + the
    // early-withdrawal penalty; capitalGains, niit, and withdrawalOrdinaryTax are
    // separate line items that all add into total.
    const lifetimeTaxes = useMemo(() => {
        const empty = { total: 0, federal: 0, state: 0, fica: 0, capitalGains: 0, withdrawalOrdinary: 0, niit: 0, irmaa: 0, aca: 0, penalty: 0 };
        const years = simulation.filter(y => !y.isEndOfYearProjection);
        if (years.length === 0) return empty;
        return years.reduce((acc, s) => {
            const fed = s.taxDetails.fed;
            const state = s.taxDetails.state;
            const fica = s.taxDetails.fica;
            const cg = s.taxDetails.capitalGains;
            const wot = s.taxDetails.withdrawalOrdinaryTax ?? 0;
            const niit = s.taxDetails.niit ?? 0;
            const irmaa = s.taxDetails.irmaa ?? 0;
            const aca = s.taxDetails.aca ?? 0;
            const penalty = s.taxDetails.earlyWithdrawalPenalty ?? 0;
            return {
                total: acc.total + fed + state + fica + cg + wot + niit + irmaa + aca,
                federal: acc.federal + fed,
                state: acc.state + state,
                fica: acc.fica + fica,
                capitalGains: acc.capitalGains + cg,
                withdrawalOrdinary: acc.withdrawalOrdinary + wot,
                niit: acc.niit + niit,
                irmaa: acc.irmaa + irmaa,
                aca: acc.aca + aca,
                penalty: acc.penalty + penalty,
            };
        }, empty);
    }, [simulation]);

    if (simulation.length === 0) {
        return (
            <div className="text-center py-8 text-content-muted">
                No simulation data. Run a simulation first.
            </div>
        );
    }

    const selectedData = selectedYear !== null
        ? taxData.find(d => d?.year === selectedYear)
        : null;

    return (
        <div className="space-y-6">
            {/* Filing Status Override */}
            <Panel padding="lg">
                <DropdownInput
                    label="Filing Status"
                    value={filingStatus}
                    onChange={(val) => setFilingStatus(val as typeof filingStatus)}
                    options={[
                        { value: 'Single', label: 'Single' },
                        { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
                        { value: 'Married Filing Separately', label: 'Married Filing Separately' },
                        { value: 'Head of Household', label: 'Head of Household' }
                    ]}
                />
            </Panel>

            {/* Summary Header */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Tax Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-content-muted">Filing Status:</span>
                        <span className="ml-2 text-white">{filingStatus}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">State:</span>
                        <span className="ml-2 text-white">{taxState.stateResidency}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Deduction Method:</span>
                        <span className="ml-2 text-white">{taxState.deductionMethod}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Current Year:</span>
                        <span className="ml-2 text-white">{currentYear}</span>
                    </div>
                </div>
            </Panel>

            {/* Year-by-Year Tax Table */}
            <Panel padding="none" className="overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-border-subtle">
                    Tax Breakdown by Year (Click for details)
                </h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-overlay sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-content-muted">Year</th>
                                <th className="p-2 text-left text-content-muted">Age</th>
                                <th className="p-2 text-right text-content-muted">Gross Income</th>
                                <th className="p-2 text-right text-content-muted">Taxable</th>
                                <th className="p-2 text-right text-content-muted">Federal</th>
                                <th className="p-2 text-right text-content-muted">State</th>
                                <th className="p-2 text-right text-content-muted">FICA</th>
                                <th className="p-2 text-right text-content-muted">Cap Gains</th>
                                <th className="p-2 text-right text-content-muted">Total</th>
                                <th className="p-2 text-right text-content-muted">Eff. Rate</th>
                                <th className="p-2 text-right text-content-muted">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {taxData.map(row => row && (
                                <tr
                                    key={row.year}
                                    className={`border-t border-border-subtle cursor-pointer hover:bg-surface-overlay ${
                                        selectedYear === row.year ? 'bg-info-tint/30' : ''
                                    }`}
                                    onClick={() => setSelectedYear(row.year)}
                                >
                                    <td className="p-2 font-mono">{row.year}</td>
                                    <td className="p-2">{row.age}</td>
                                    <td className="p-2 text-right font-mono text-positive">{toCurrencyShort(row.grossIncome)}</td>
                                    <td className="p-2 text-right font-mono text-content-default">{toCurrencyShort(row.taxableIncome)}</td>
                                    <td className="p-2 text-right font-mono text-warning">{toCurrencyShort(row.federalTax)}</td>
                                    <td className="p-2 text-right font-mono text-warning">{toCurrencyShort(row.stateTax)}</td>
                                    <td className="p-2 text-right font-mono text-cat-orange">{toCurrencyShort(row.totalFica)}</td>
                                    <td className="p-2 text-right font-mono text-cat-lime">{toCurrencyShort(row.capitalGainsTax)}</td>
                                    <td className="p-2 text-right font-mono text-negative font-semibold">{toCurrencyShort(row.totalTax)}</td>
                                    <td className="p-2 text-right font-mono text-content-muted">{(row.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right font-mono text-content-muted">{(row.marginalInfo.rate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Lifetime Tax Summary */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Lifetime Tax Summary</h3>
                <p className="text-sm text-content-muted mb-4">
                    Total taxes paid across the entire simulation (ages {startAge} to {getLifeExpectancy(assumptions.milestones)}).
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Total Taxes</div>
                        <div className="text-lg font-bold text-negative">{toCurrencyShort(lifetimeTaxes.total)}</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Federal</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.federal)}</div>
                        <div className="text-xs text-content-subtle">incl. penalty</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">State</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.state)}</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">FICA</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.fica)}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Capital Gains</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.capitalGains)}</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Withdrawal Ordinary</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.withdrawalOrdinary)}</div>
                        <div className="text-xs text-content-subtle">Roth earnings, Trad, HSA</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">NIIT</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.niit)}</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Medicare IRMAA</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.irmaa)}</div>
                        <div className="text-xs text-content-subtle">Part B/D surcharge, age 65+</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">ACA Subsidy Loss</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.aca)}</div>
                        <div className="text-xs text-content-subtle">400% FPL cliff, pre-65</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3">
                        <div className="text-xs text-content-muted">Early-Withdraw Penalty</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.penalty)}</div>
                        <div className="text-xs text-content-subtle">already in Federal</div>
                    </div>
                </div>
            </Panel>

            {/* Selected Year Details */}
            {selectedData && (
                <Panel>
                    <h3 className="text-lg font-bold text-white mb-4">
                        Year {selectedData.year} Details (Age {selectedData.age})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Income Breakdown */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Income</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Gross Income:</span>
                                    <span className="font-mono text-positive">{toCurrencyShort(selectedData.grossIncome)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Earned Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.earnedIncome)}</span>
                                </div>
                                {selectedData.ssBenefits > 0 && (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-content-muted">SS Benefits:</span>
                                            <span className="font-mono text-cat-cyan">{toCurrencyShort(selectedData.ssBenefits)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-content-muted">Taxable SS ({((selectedData.taxableSS / selectedData.ssBenefits) * 100).toFixed(0)}%):</span>
                                            <span className="font-mono text-cat-cyan-bright">{toCurrencyShort(selectedData.taxableSS)}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Deductions */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Deductions</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Pre-Tax (401k, etc):</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.preTaxDeductions)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Above-Line:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.aboveLineDeductions)}</span>
                                </div>
                                <div className="flex justify-between border-t border-border-default pt-1">
                                    <span className="text-content-muted">AGI:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.agi)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Standard Ded:</span>
                                    <span className={`font-mono ${!selectedData.usingItemized ? 'text-positive' : 'text-content-subtle'}`}>
                                        {toCurrencyShort(selectedData.standardDeduction)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Itemized Ded:</span>
                                    <span className={`font-mono ${selectedData.usingItemized ? 'text-positive' : 'text-content-subtle'}`}>
                                        {toCurrencyShort(selectedData.itemizedDeductions)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">SALT Cap:</span>
                                    <span className="font-mono text-content-muted">{toCurrencyShort(selectedData.saltCap)}</span>
                                </div>
                                <div className="flex justify-between border-t border-border-default pt-1">
                                    <span className="text-content-default font-medium">Taxable Income:</span>
                                    <span className="font-mono text-white font-semibold">{toCurrencyShort(selectedData.taxableIncome)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Federal Tax Brackets */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Federal Brackets</h4>
                            <div className="space-y-1 text-sm">
                                {selectedData.bracketBreakdown.map((bracket, i) => (
                                    <div key={i} className="flex justify-between">
                                        <span className="text-content-muted">{(bracket.rate * 100).toFixed(0)}% on {toCurrencyShort(bracket.amount)}:</span>
                                        <span className="font-mono text-warning">{toCurrencyShort(bracket.tax)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between border-t border-border-default pt-1">
                                    <span className="text-content-default font-medium">Total Federal:</span>
                                    <span className="font-mono text-warning font-semibold">{toCurrencyShort(selectedData.federalTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Effective Rate:</span>
                                    <span className="font-mono text-content-default">{(selectedData.effectiveRate * 100).toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Marginal Rate:</span>
                                    <span className="font-mono text-content-default">{(selectedData.marginalInfo.rate * 100).toFixed(0)}%</span>
                                </div>
                                {selectedData.marginalInfo.headroom < Infinity && (
                                    <div className="flex justify-between">
                                        <span className="text-content-muted">Headroom:</span>
                                        <span className="font-mono text-content-default">{toCurrencyShort(selectedData.marginalInfo.headroom)}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* State Tax */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">State Tax ({taxState.stateResidency})</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Standard Ded:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateStandardDeduction)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Taxable Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateTaxableIncome)}</span>
                                </div>
                                <div className="flex justify-between border-t border-border-default pt-1">
                                    <span className="text-content-default font-medium">State Tax:</span>
                                    <span className="font-mono text-warning font-semibold">{toCurrencyShort(selectedData.stateTax)}</span>
                                </div>
                            </div>
                        </div>

                        {/* FICA */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">FICA / Payroll</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">FICA Taxable:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.ficaTaxableBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">SS Wage Base:</span>
                                    <span className="font-mono text-content-muted">{toCurrencyShort(selectedData.ssWageBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Social Security (6.2%):</span>
                                    <span className="font-mono text-cat-orange">{toCurrencyShort(selectedData.ssTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Medicare (1.45%):</span>
                                    <span className="font-mono text-cat-orange">{toCurrencyShort(selectedData.medicareTax)}</span>
                                </div>
                                <div className="flex justify-between border-t border-border-default pt-1">
                                    <span className="text-content-default font-medium">Total FICA:</span>
                                    <span className="font-mono text-cat-orange font-semibold">{toCurrencyShort(selectedData.totalFica)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Capital Gains */}
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">Capital Gains</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Cap Gains Tax:</span>
                                    <span className="font-mono text-cat-lime">{toCurrencyShort(selectedData.capitalGainsTax)}</span>
                                </div>
                                <div className="text-xs text-content-subtle mt-2">
                                    From brokerage account withdrawals. Taxed at preferential long-term rates (0/15/20%).
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total Summary */}
                    <div className="mt-4 p-3 bg-surface-overlay rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold text-white">Total Tax Burden</span>
                            <span className="text-xl font-mono text-negative font-bold">{toCurrencyShort(selectedData.totalTax)}</span>
                        </div>
                        <div className="text-sm text-content-muted mt-1">
                            {((selectedData.totalTax / selectedData.grossIncome) * 100).toFixed(1)}% of gross income
                        </div>
                    </div>
                </Panel>
            )}
        </div>
    );
}

// ============================================================================
// SOCIAL SECURITY DEBUG TAB
// ============================================================================
function SocialSecurityDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { incomes } = useContext(IncomeContext);

    const defaultBirthYear = getBirthYear(assumptions.milestones);

    // Inputs for what-if scenarios
    const [birthYearOverride, setBirthYearOverride] = useState(defaultBirthYear);
    const [priorYearsWorked, setPriorYearsWorked] = useState(0);
    const [priorAvgSalary, setPriorAvgSalary] = useState(0);
    const [wageGrowthRate, setWageGrowthRate] = useState(2.5);
    const [highlightClaimingAge, setHighlightClaimingAge] = useState(67);

    const birthYear = birthYearOverride;
    const currentYear = new Date().getFullYear();

    // Find Social Security income objects
    const ssIncomes = useMemo(() => {
        return incomes.filter(inc => isSocialSecurity(inc));
    }, [incomes]);

    // Build prior earnings from inputs
    const priorEarnings = useMemo(() => {
        if (priorYearsWorked <= 0 || priorAvgSalary <= 0) return [];
        const earnings = [];
        const startYear = currentYear - priorYearsWorked;
        for (let i = 0; i < priorYearsWorked; i++) {
            const year = startYear + i;
            const wageBase = getWageBase(year, wageGrowthRate / 100, assumptions.macro.inflationAdjusted);
            earnings.push({
                year,
                amount: Math.min(priorAvgSalary, wageBase)
            });
        }
        return earnings;
    }, [priorYearsWorked, priorAvgSalary, currentYear, wageGrowthRate, assumptions.macro.inflationAdjusted]);

    // Extract earnings from simulation + prior earnings
    const earningsHistory = useMemo(() => {
        const simEarnings = simulation.length > 0
            ? extractEarningsFromSimulation(simulation, undefined, true)
            : [];

        // Merge prior earnings with simulation earnings (prior takes precedence for overlapping years)
        const mergedMap = new Map<number, number>();
        priorEarnings.forEach(e => mergedMap.set(e.year, e.amount));
        simEarnings.forEach(e => {
            if (!mergedMap.has(e.year)) {
                mergedMap.set(e.year, e.amount);
            }
        });

        return Array.from(mergedMap.entries())
            .map(([year, amount]) => ({ year, amount }))
            .sort((a, b) => a.year - b.year);
    }, [simulation, priorEarnings]);

    // Calculate AIME for different claiming ages
    const claimingAnalysis = useMemo(() => {
        if (earningsHistory.length === 0) return null;

        const ages = [62, 63, 64, 65, 66, 67, 68, 69, 70];
        const fra = getFRA(birthYear);
        const calculationYear = birthYear + 62;

        return ages.map(age => {
            const result = calculateAIME(earningsHistory, calculationYear, age, birthYear, wageGrowthRate / 100, true);
            const adjustmentFactor = getClaimingAdjustment(age, fra);
            return {
                age,
                aime: result.aime,
                pia: result.pia,
                adjustedBenefit: result.adjustedBenefit,
                adjustmentFactor,
                annualBenefit: result.adjustedBenefit * 12,
                bendPoints: result.bendPoints,
                indexYear: result.indexYear
            };
        });
    }, [earningsHistory, birthYear, wageGrowthRate]);

    // Get detailed breakdown for the highlighted claiming age
    const detailedBreakdown = useMemo(() => {
        if (earningsHistory.length === 0) return null;
        const calculationYear = birthYear + 62;
        return calculateAIME(earningsHistory, calculationYear, highlightClaimingAge, birthYear, wageGrowthRate / 100, true);
    }, [earningsHistory, birthYear, highlightClaimingAge, wageGrowthRate]);

    const fra = getFRA(birthYear);
    const bendPoints = getBendPoints(birthYear + 62, wageGrowthRate / 100, true);

    return (
        <div className="space-y-6">
            {/* Inputs Grid */}
            <Panel padding="lg" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <NumberInput
                    label="Birth Year"
                    value={birthYearOverride}
                    onChange={setBirthYearOverride}
                    tooltip="Override birth year for what-if analysis"
                />
                <NumberInput
                    label="Prior Years Worked"
                    value={priorYearsWorked}
                    onChange={setPriorYearsWorked}
                    tooltip="Years worked before simulation starts"
                />
                <CurrencyInput
                    label="Prior Avg Salary"
                    value={priorAvgSalary}
                    onChange={setPriorAvgSalary}
                    tooltip="Average salary during prior years"
                />
                <PercentageInput
                    label="Wage Growth Rate"
                    value={wageGrowthRate}
                    onChange={setWageGrowthRate}
                    tooltip="Assumed wage growth for projections"
                />
                <DropdownInput
                    label="Highlight Age"
                    value={highlightClaimingAge.toString()}
                    onChange={(v) => setHighlightClaimingAge(parseInt(v))}
                    options={[62, 63, 64, 65, 66, 67, 68, 69, 70].map(a => ({
                        value: a.toString(),
                        label: a === fra ? `${a} (FRA)` : a.toString()
                    }))}
                />
            </Panel>

            {/* Configuration */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Social Security Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-content-muted">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Full Retirement Age:</span>
                        <span className="ml-2 text-white">{fra}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Years of Earnings:</span>
                        <span className="ml-2 text-white">{earningsHistory.length}</span>
                        {priorYearsWorked > 0 && (
                            <span className="ml-1 text-xs text-cat-cyan">({priorYearsWorked} prior)</span>
                        )}
                    </div>
                    <div>
                        <span className="text-content-muted">SS Income Objects:</span>
                        <span className="ml-2 text-white">{ssIncomes.length}</span>
                    </div>
                </div>
                {ssIncomes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle">
                        <span className="text-content-muted text-sm">Current SS Incomes: </span>
                        {ssIncomes.map((inc, idx) => (
                            <span key={idx} className="text-xs bg-cat-cyan-tint/50 px-2 py-1 rounded mr-2">
                                {inc.name}: {toCurrencyShort(inc.amount)}/mo
                            </span>
                        ))}
                    </div>
                )}
            </Panel>

            {/* Bend Points Info */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">PIA Bend Points (Year {birthYear + 62})</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-surface-overlay p-3 rounded-lg">
                        <div className="text-cat-cyan font-semibold">First Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.first)}</div>
                        <div className="text-xs text-content-muted">90% of AIME up to this amount</div>
                    </div>
                    <div className="bg-surface-overlay p-3 rounded-lg">
                        <div className="text-cat-cyan font-semibold">Second Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.second)}</div>
                        <div className="text-xs text-content-muted">32% of AIME between bend points</div>
                    </div>
                    <div className="bg-surface-overlay p-3 rounded-lg">
                        <div className="text-cat-cyan font-semibold">Above Second</div>
                        <div className="text-2xl font-mono text-white">15%</div>
                        <div className="text-xs text-content-muted">of AIME above second bend point</div>
                    </div>
                </div>
            </Panel>

            {/* Claiming Age Comparison */}
            {claimingAnalysis && (
                <Panel padding="none" className="overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-border-subtle">
                        Benefit by Claiming Age
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-overlay">
                                <tr>
                                    <th className="p-2 text-left text-content-muted">Claiming Age</th>
                                    <th className="p-2 text-right text-content-muted">AIME</th>
                                    <th className="p-2 text-right text-content-muted">PIA (at FRA)</th>
                                    <th className="p-2 text-right text-content-muted">Adjustment</th>
                                    <th className="p-2 text-right text-content-muted">Monthly Benefit</th>
                                    <th className="p-2 text-right text-content-muted">Annual Benefit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claimingAnalysis.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-border-subtle cursor-pointer hover:bg-surface-overlay ${
                                            row.age === highlightClaimingAge ? 'bg-cat-purple-tint/30 ring-1 ring-cat-purple-soft' :
                                            row.age === fra ? 'bg-cat-cyan-tint/20' : ''
                                        }`}
                                        onClick={() => setHighlightClaimingAge(row.age)}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-cat-purple-tint/50 px-1 rounded text-cat-purple">Selected</span>
                                            )}
                                            {row.age === fra && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-cat-cyan-tint/50 px-1 rounded text-cat-cyan">FRA</span>
                                            )}
                                            {row.age === 70 && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-positive-tint/50 px-1 rounded text-positive">MAX</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.aime)}</td>
                                        <td className="p-2 text-right font-mono text-content-muted">{toCurrencyShort(row.pia)}</td>
                                        <td className={`p-2 text-right font-mono ${
                                            row.adjustmentFactor < 1 ? 'text-negative' :
                                            row.adjustmentFactor > 1 ? 'text-positive' : 'text-white'
                                        }`}>
                                            {(row.adjustmentFactor * 100).toFixed(1)}%
                                        </td>
                                        <td className="p-2 text-right font-mono text-cat-cyan font-semibold">
                                            {toCurrencyShort(row.adjustedBenefit)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-cat-cyan-bright">
                                            {toCurrencyShort(row.annualBenefit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}

            {/* Earnings History */}
            {earningsHistory.length > 0 && (
                <Panel padding="none" className="overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-border-subtle">
                        Earnings History (from Simulation)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-overlay sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-content-muted">Year</th>
                                    <th className="p-2 text-right text-content-muted">Earnings</th>
                                    <th className="p-2 text-right text-content-muted">SS Wage Base</th>
                                    <th className="p-2 text-right text-content-muted">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {earningsHistory.map(record => {
                                    const wageBase = getWageBase(record.year, 0.025, assumptions.macro.inflationAdjusted);
                                    const atMax = record.amount >= wageBase * 0.99;
                                    return (
                                        <tr key={record.year} className="border-t border-border-subtle">
                                            <td className="p-2 font-mono">{record.year}</td>
                                            <td className="p-2 text-right font-mono text-positive">
                                                {toCurrencyShort(record.amount)}
                                            </td>
                                            <td className="p-2 text-right font-mono text-content-muted">
                                                {toCurrencyShort(wageBase)}
                                            </td>
                                            <td className="p-2 text-right">
                                                {atMax ? (
                                                    <span className="text-xs bg-positive-tint/50 px-2 py-0.5 rounded text-positive">At Max</span>
                                                ) : (
                                                    <span className="text-xs text-content-subtle">
                                                        {((record.amount / wageBase) * 100).toFixed(0)}% of max
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-3 border-t border-border-subtle text-xs text-content-subtle">
                        Top 35 years of indexed earnings are used to calculate AIME. Earnings after age 60 are not indexed.
                    </div>
                </Panel>
            )}

            {/* Detailed PIA Breakdown */}
            {detailedBreakdown && (
                <Panel>
                    <h3 className="text-lg font-bold text-white mb-3">PIA Calculation Breakdown</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">AIME Calculation</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Index Year (Age 60):</span>
                                    <span className="font-mono text-white">{detailedBreakdown.indexYear}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Top 35 Earnings Sum:</span>
                                    <span className="font-mono text-white">
                                        {toCurrencyShort(detailedBreakdown.indexedEarnings.reduce((a, b) => a + b, 0))}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">÷ 420 months:</span>
                                    <span className="font-mono text-cat-cyan font-semibold">
                                        {toCurrencyShort(detailedBreakdown.aime)}/mo
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded-lg">
                            <h4 className="font-semibold text-content-default mb-2">PIA Formula</h4>
                            <div className="space-y-1 text-sm font-mono">
                                <div className="text-content-muted">
                                    90% × min({toCurrencyShort(detailedBreakdown.aime)}, {toCurrencyShort(detailedBreakdown.bendPoints.first)})
                                </div>
                                <div className="text-content-muted">
                                    + 32% × amount between ${detailedBreakdown.bendPoints.first} and ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="text-content-muted">
                                    + 15% × amount above ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="flex justify-between border-t border-border-default pt-1 mt-2">
                                    <span className="text-content-default">= PIA:</span>
                                    <span className="text-cat-cyan font-semibold">{toCurrencyShort(detailedBreakdown.pia)}/mo</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </Panel>
            )}

            {simulation.length === 0 && (
                <div className="text-center py-8 text-content-muted">
                    No simulation data. Run a simulation to calculate Social Security benefits.
                </div>
            )}
        </div>
    );
}

// ============================================================================
// RMD DEBUG TAB
// ============================================================================
function RMDDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation: rawSimulation } = useContext(SimulationContext);
    const simulation = useMemo(() => rawSimulation.filter(y => !y.isEndOfYearProjection), [rawSimulation]);
    const { accounts } = useContext(AccountContext);

    const defaultBirthYear = getBirthYear(assumptions.milestones);

    // Inputs for what-if scenarios
    const [birthYearOverride, setBirthYearOverride] = useState(defaultBirthYear);
    const [additionalBalance, setAdditionalBalance] = useState(0);
    const [growthRate, setGrowthRate] = useState(6);
    const [focusAge, setFocusAge] = useState(75);

    const birthYear = birthYearOverride;
    const currentYear = new Date().getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const startAge = startYear - birthYear;

    // Get RMD-eligible accounts
    const rmdAccounts = useMemo(() => {
        return accounts.filter(acc => 'taxType' in acc && isAccountSubjectToRMD(acc.taxType));
    }, [accounts]);

    // Calculate standalone what-if RMD projection
    const whatIfProjection = useMemo(() => {
        if (additionalBalance <= 0) return null;

        const rmdStartAge = getRMDStartAge(birthYear);
        const projections = [];
        let balance = additionalBalance;

        for (let age = rmdStartAge; age <= 95; age++) {
            const distributionPeriod = getDistributionPeriod(age);
            const rmdAmount = calculateRMD(balance, age);
            const percentOfBalance = balance > 0 ? (rmdAmount / balance) * 100 : 0;

            projections.push({
                age,
                balance,
                distributionPeriod,
                rmdAmount,
                percentOfBalance
            });

            // Grow balance after RMD withdrawal
            balance = (balance - rmdAmount) * (1 + growthRate / 100);
            if (balance < 100) break;
        }

        return projections;
    }, [additionalBalance, birthYear, growthRate]);

    // Calculate RMD data for each year
    const rmdData = useMemo(() => {
        if (simulation.length === 0) return [];

        const rmdStartAge = getRMDStartAge(birthYear);

        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const required = isRMDRequired(age, birthYear);
            const distributionPeriod = getDistributionPeriod(age);

            // Get account balances from simulation
            const accountBreakdown: RMDCalculation[] = [];
            let totalRMD = 0;
            let totalTraditionalBalance = 0;

            // Find RMD-eligible accounts in simulation
            simYear.accounts.forEach(simAcc => {
                const originalAccount = accounts.find(a => a.id === simAcc.id);
                if (originalAccount && 'taxType' in originalAccount && isAccountSubjectToRMD(originalAccount.taxType)) {
                    // RMD is based on prior year-end balance
                    // For first year, we use current balance; otherwise use prior year
                    const priorYearBalance = idx > 0
                        ? simulation[idx - 1].accounts.find(a => a.id === simAcc.id)?.amount || 0
                        : simAcc.amount;

                    const rmdAmount = required ? calculateRMD(priorYearBalance, age) : 0;
                    totalRMD += rmdAmount;
                    totalTraditionalBalance += simAcc.amount;

                    accountBreakdown.push({
                        accountName: simAcc.name,
                        accountId: simAcc.id,
                        priorYearBalance,
                        distributionPeriod,
                        rmdAmount
                    });
                }
            });

            return {
                year: simYear.year,
                age,
                required,
                distributionPeriod,
                totalRMD,
                totalTraditionalBalance,
                accountBreakdown,
                rmdStartAge
            };
        });
    }, [simulation, accounts, startAge, birthYear]);

    const rmdStartAge = getRMDStartAge(birthYear);

    return (
        <div className="space-y-6">
            {/* Inputs Grid */}
            <Panel padding="lg" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <NumberInput
                    label="Birth Year"
                    value={birthYearOverride}
                    onChange={setBirthYearOverride}
                    tooltip="Override birth year to test different RMD start ages"
                />
                <CurrencyInput
                    label="Test Balance"
                    value={additionalBalance}
                    onChange={setAdditionalBalance}
                    tooltip="Enter a balance to see projected RMDs"
                />
                <PercentageInput
                    label="Growth Rate"
                    value={growthRate}
                    onChange={setGrowthRate}
                    tooltip="Assumed annual growth rate for projections"
                />
                <NumberInput
                    label="Focus Age"
                    value={focusAge}
                    onChange={setFocusAge}
                    tooltip="Age to highlight in the table"
                />
            </Panel>

            {/* What-If RMD Projection */}
            {whatIfProjection && whatIfProjection.length > 0 && (
                <div className="bg-linear-to-r from-warning-tint/30 to-cat-orange-tint/30 p-4 rounded-xl border border-warning-strong/50">
                    <h3 className="text-lg font-bold text-warning-bright mb-3">
                        What-If RMD Projection ({toCurrencyShort(additionalBalance)} starting balance, {growthRate}% growth)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-warning-tint/30 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-warning-bright">Age</th>
                                    <th className="p-2 text-right text-warning-bright">Balance (BOY)</th>
                                    <th className="p-2 text-right text-warning-bright">Dist. Period</th>
                                    <th className="p-2 text-right text-warning-bright">RMD Amount</th>
                                    <th className="p-2 text-right text-warning-bright">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {whatIfProjection.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-warning-strong/30 ${
                                            row.age === focusAge ? 'bg-warning-tint/40 ring-1 ring-warning-soft' : ''
                                        }`}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === rmdStartAge && (
                                                <span className="ml-2 text-xs bg-warning-tint/50 px-1 rounded text-warning">Start</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.balance)}</td>
                                        <td className="p-2 text-right font-mono text-content-muted">{row.distributionPeriod.toFixed(1)}</td>
                                        <td className="p-2 text-right font-mono text-warning font-semibold">{toCurrencyShort(row.rmdAmount)}</td>
                                        <td className="p-2 text-right font-mono text-content-muted">{row.percentOfBalance.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Configuration */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">RMD Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-content-muted">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">RMD Start Age:</span>
                        <span className="ml-2 text-white">{rmdStartAge}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">RMD-Eligible Accounts:</span>
                        <span className="ml-2 text-white">{rmdAccounts.length}</span>
                    </div>
                    <div>
                        <span className="text-content-muted">Current Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                </div>
                {rmdAccounts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle">
                        <span className="text-content-muted text-sm">Traditional Accounts: </span>
                        {rmdAccounts.map((acc, idx) => (
                            <span key={idx} className="text-xs bg-warning-tint/50 px-2 py-1 rounded mr-2">
                                {acc.name}: {toCurrencyShort(acc.amount)}
                            </span>
                        ))}
                    </div>
                )}
            </Panel>

            {/* RMD Start Age Rules */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">SECURE Act 2.0 RMD Rules</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className={`bg-surface-overlay p-3 rounded-lg ${birthYear <= 1950 ? 'ring-2 ring-warning-soft' : ''}`}>
                        <div className="text-warning font-semibold">Born 1950 or earlier</div>
                        <div className="text-2xl font-mono text-white">Age 72</div>
                    </div>
                    <div className={`bg-surface-overlay p-3 rounded-lg ${birthYear > 1950 && birthYear <= 1959 ? 'ring-2 ring-warning-soft' : ''}`}>
                        <div className="text-warning font-semibold">Born 1951-1959</div>
                        <div className="text-2xl font-mono text-white">Age 73</div>
                    </div>
                    <div className={`bg-surface-overlay p-3 rounded-lg ${birthYear >= 1960 ? 'ring-2 ring-warning-soft' : ''}`}>
                        <div className="text-warning font-semibold">Born 1960 or later</div>
                        <div className="text-2xl font-mono text-white">Age 75</div>
                    </div>
                </div>
            </Panel>

            {/* RMD Table by Year - from Simulation */}
            <Panel padding="none" className="overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-border-subtle">
                    RMD by Year (From Your Simulation)
                    <span className="ml-2 text-xs font-normal text-content-subtle">
                        Based on your Traditional 401k/IRA accounts
                    </span>
                </h3>
                {rmdData.length === 0 || rmdAccounts.length === 0 ? (
                    <div className="p-6 text-center text-content-subtle">
                        {simulation.length === 0 ? (
                            <p>No simulation data. Run a simulation first to see RMD projections for your accounts.</p>
                        ) : rmdAccounts.length === 0 ? (
                            <p>No Traditional 401k or Traditional IRA accounts found. RMDs only apply to pre-tax retirement accounts.</p>
                        ) : (
                            <p>No RMD data available.</p>
                        )}
                        <p className="mt-2 text-sm">Use the "Test Balance" input above to see a standalone RMD projection.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-overlay sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-content-muted">Year</th>
                                    <th className="p-2 text-left text-content-muted">Age</th>
                                    <th className="p-2 text-right text-content-muted">Distribution Period</th>
                                    <th className="p-2 text-right text-content-muted">Traditional Balance</th>
                                    <th className="p-2 text-right text-content-muted">Required RMD</th>
                                    <th className="p-2 text-right text-content-muted">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rmdData.map(row => (
                                    <tr
                                        key={row.year}
                                        className={`border-t border-border-subtle ${
                                            row.age === row.rmdStartAge ? 'bg-warning-tint/20' : ''
                                        } ${!row.required ? 'opacity-50' : ''}`}
                                    >
                                        <td className="p-2 font-mono">{row.year}</td>
                                        <td className="p-2">
                                            {row.age}
                                            {row.age === row.rmdStartAge && (
                                                <span className="ml-2 text-xs bg-warning-tint/50 px-1 rounded text-warning">RMD Starts</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-content-muted">
                                            {row.required ? row.distributionPeriod.toFixed(1) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">
                                            {toCurrencyShort(row.totalTraditionalBalance)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-warning font-semibold">
                                            {row.required ? toCurrencyShort(row.totalRMD) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-content-muted">
                                            {row.required && row.totalTraditionalBalance > 0
                                                ? `${((row.totalRMD / row.totalTraditionalBalance) * 100).toFixed(1)}%`
                                                : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            {/* Distribution Period Table */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">IRS Uniform Lifetime Table (Excerpt)</h3>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2 text-sm">
                    {[73, 75, 80, 85, 90, 95].map(age => (
                        <div key={age} className={`bg-surface-overlay p-2 rounded text-center ${
                            startAge === age ? 'ring-2 ring-warning-soft' : ''
                        }`}>
                            <div className="text-content-muted text-xs">Age {age}</div>
                            <div className="font-mono text-white">{getDistributionPeriod(age).toFixed(1)}</div>
                            <div className="text-xs text-warning">
                                {(100 / getDistributionPeriod(age)).toFixed(1)}%
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 text-xs text-content-subtle">
                    Distribution Period = Life expectancy factor. RMD = Prior Year Balance ÷ Distribution Period.
                    The percentage shown is the effective withdrawal rate for that age.
                </div>
            </Panel>
        </div>
    );
}

// ============================================================================
// TAX BRACKET VISUALIZATION TAB
// ============================================================================
function TaxBracketVisualizationTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation: rawSimulation } = useContext(SimulationContext);
    const simulation = useMemo(() => rawSimulation.filter(y => !y.isEndOfYearProjection), [rawSimulation]);
    const { state: taxState } = useContext(TaxContext);

    const birthYear = getBirthYear(assumptions.milestones);

    const filingStatus = taxState.filingStatus;

    // Build bracket data for each simulation year
    const bracketData = useMemo(() => {
        if (simulation.length === 0) return [];

        return simulation.map((simYear) => {
            const year = simYear.year;
            const age = year - birthYear;
            const fedParams = getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
            if (!fedParams) return null;

            // Get taxable income from simulation.
            // Use sim engine's spendable income (includes RMDs, which are filtered out of
            // simYear.incomes). Add Roth conversions on top — they're taxable but not spendable.
            const rothConversionAmount = simYear.rothConversion?.amount || 0;
            const grossIncome = simYear.cashflow.totalIncome + rothConversionAmount;
            const preTaxDeductions = getPreTaxExemptions(simYear.incomes, year, age);
            const aboveLineDeductions = getYesDeductions(simYear.expenses, year);
            const totalPreTax = preTaxDeductions + aboveLineDeductions;

            // Social Security adjustments
            const ssBenefits = getSocialSecurityBenefits(simYear.incomes, year);
            const agiExcludingSS = grossIncome - ssBenefits - totalPreTax;
            const taxableSS = getTaxableSocialSecurityBenefits(ssBenefits, agiExcludingSS, 0, filingStatus);
            const agi = grossIncome - ssBenefits + taxableSS - totalPreTax;

            const taxableIncome = Math.max(0, agi - fedParams.standardDeduction);

            // Walk federal brackets to find marginal rate at this taxable income
            let remainingIncome = taxableIncome;
            let marginalRate = 0;
            for (let i = 0; i < fedParams.brackets.length; i++) {
                const bracket = fedParams.brackets[i];
                const nextBracket = fedParams.brackets[i + 1];
                const nextThreshold = nextBracket ? nextBracket.threshold : Infinity;
                const bracketSize = nextThreshold - bracket.threshold;
                const amountInBracket = Math.min(Math.max(0, remainingIncome), bracketSize);
                if (amountInBracket > 0) marginalRate = bracket.rate;
                remainingIncome -= amountInBracket;
                if (remainingIncome <= 0) break;
            }

            // Pull all tax components from the sim's taxDetails.
            // Note: `fed` includes the 10% early-withdrawal penalty. Split it out for clarity.
            const fedRaw = simYear.taxDetails?.fed ?? 0;
            const penalty = simYear.taxDetails?.earlyWithdrawalPenalty ?? 0;
            const fedIncomeTax = Math.max(0, fedRaw - penalty);
            const stateTax = simYear.taxDetails?.state ?? 0;
            const ficaTax = simYear.taxDetails?.fica ?? 0;
            const ltcgTax = simYear.taxDetails?.capitalGains ?? 0;
            const niitTax = simYear.taxDetails?.niit ?? 0;
            const totalTax = fedRaw + stateTax + ficaTax + ltcgTax + niitTax;

            // Effective-rate denominator: AGI-equivalent (matches what the IRS would
            // call "total income"). AGI already absorbs Trad/RMD withdrawals via
            // ordinary-income flow, taxable SS, Roth conversions; LTCG must be added
            // since it sits below the AGI line in `agi` here.
            const ltcgAmount = simYear.taxDetails?.longTermCapitalGains ?? 0;
            const effectiveDenominator = Math.max(0, agi) + ltcgAmount;

            return {
                year,
                age,
                grossIncome: effectiveDenominator,
                taxableIncome,
                fedIncomeTax,
                penalty,
                stateTax,
                ficaTax,
                ltcgTax,
                niitTax,
                totalTax,
                effectiveRate: effectiveDenominator > 0 ? totalTax / effectiveDenominator : 0,
                marginalRate,
                standardDeduction: fedParams.standardDeduction,
            };
        }).filter(Boolean);
    }, [simulation, birthYear, filingStatus, assumptions]);

    // Bracket colors
    const bracketColors: Record<number, string> = {
        0.10: 'bg-positive-solid',
        0.12: 'bg-positive-soft',
        0.22: 'bg-warning-soft',
        0.24: 'bg-cat-orange-soft',
        0.32: 'bg-negative-soft',
        0.35: 'bg-negative-solid',
        0.37: 'bg-negative-strong'
    };

    if (simulation.length === 0) {
        return <div className="text-content-muted text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Detailed breakdown by year */}
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">Bracket Details by Year</h3>
                <p className="text-content-muted text-sm mb-4">
                    Per-year tax breakdown from the simulation. Effective rate is total tax / gross income; marginal rate is the federal bracket the last dollar of taxable income lands in. Penalty is the 10% early-withdrawal penalty (split out from federal income tax for clarity).
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default">
                                <th className="text-left p-2 text-content-muted">Year</th>
                                <th className="text-left p-2 text-content-muted">Age</th>
                                <th className="text-right p-2 text-content-muted">AGI+LTCG</th>
                                <th className="text-right p-2 text-content-muted">Std Ded</th>
                                <th className="text-right p-2 text-content-muted">Taxable</th>
                                <th className="text-right p-2 text-content-muted">Fed</th>
                                <th className="text-right p-2 text-content-muted">Penalty</th>
                                <th className="text-right p-2 text-content-muted">State</th>
                                <th className="text-right p-2 text-content-muted">FICA</th>
                                <th className="text-right p-2 text-content-muted">LTCG</th>
                                <th className="text-right p-2 text-content-muted">NIIT</th>
                                <th className="text-right p-2 text-content-muted">Total</th>
                                <th className="text-right p-2 text-content-muted">Effective</th>
                                <th className="text-right p-2 text-content-muted">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bracketData.map((data: any) => (
                                <tr key={data.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                    <td className="p-2 text-white">{data.year}</td>
                                    <td className="p-2 text-content-default">{data.age}</td>
                                    <td className="p-2 text-right text-content-default">{toCurrencyShort(data.grossIncome)}</td>
                                    <td className="p-2 text-right text-content-muted">{toCurrencyShort(data.standardDeduction)}</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(data.taxableIncome)}</td>
                                    <td className="p-2 text-right text-negative">{toCurrencyShort(data.fedIncomeTax)}</td>
                                    <td className={`p-2 text-right ${data.penalty > 0 ? 'text-warning' : 'text-content-faint'}`}>{data.penalty > 0 ? toCurrencyShort(data.penalty) : '—'}</td>
                                    <td className="p-2 text-right text-negative-bright">{toCurrencyShort(data.stateTax)}</td>
                                    <td className="p-2 text-right text-negative-bright">{toCurrencyShort(data.ficaTax)}</td>
                                    <td className="p-2 text-right text-negative-bright">{toCurrencyShort(data.ltcgTax)}</td>
                                    <td className="p-2 text-right text-negative-bright">{toCurrencyShort(data.niitTax)}</td>
                                    <td className="p-2 text-right text-negative-soft font-medium">{toCurrencyShort(data.totalTax)}</td>
                                    <td className="p-2 text-right text-warning">{(data.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right text-cat-orange">{(data.marginalRate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Bracket thresholds over time */}
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-2">
                    Federal Bracket Thresholds Over Time ({filingStatus})
                </h3>
                <p className="text-content-muted text-sm mb-4">
                    {assumptions.macro.inflationAdjusted
                        ? `Shows how tax bracket thresholds inflate based on ${assumptions.macro.inflationRate}% assumed inflation rate.`
                        : 'Inflation adjustment is disabled. Bracket thresholds remain at current year values.'}
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default">
                                <th className="text-left p-2 text-content-muted">Year</th>
                                <th className="text-right p-2 text-content-muted">Std Ded</th>
                                {[10, 12, 22, 24, 32, 35, 37].map(rate => (
                                    <th key={rate} className="text-right p-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${bracketColors[rate / 100] || 'bg-surface-hover'} text-white`}>
                                            {rate}%
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {bracketData.map((data: any) => {
                                const params = getTaxParameters(data.year, filingStatus, 'federal', undefined, assumptions);
                                if (!params) return null;
                                return (
                                    <tr key={data.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-white font-medium">{data.year}</td>
                                        <td className="p-2 text-right text-positive">{toCurrencyShort(params.standardDeduction)}</td>
                                        {params.brackets.map((bracket, i) => {
                                            const nextBracket = params.brackets[i + 1];
                                            return (
                                                <td key={i} className="p-2 text-right text-content-default">
                                                    {toCurrencyShort(bracket.threshold)}
                                                    {nextBracket && (
                                                        <span className="text-content-subtle text-xs ml-1">
                                                            → {toCurrencyShort(nextBracket.threshold - 1)}
                                                        </span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

        </div>
    );
}

// ============================================================================
// PENSION DEBUG TAB
// ============================================================================
function PensionDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { incomes } = useContext(IncomeContext);

    const birthYear = getBirthYear(assumptions.milestones);
    const currentYear = new Date().getFullYear();
    const currentAge = currentYear - birthYear;

    // Find pension incomes
    const fersPensions = incomes.filter(inc => inc instanceof FERSPensionIncome) as FERSPensionIncome[];
    const csrsPensions = incomes.filter(inc => inc instanceof CSRSPensionIncome) as CSRSPensionIncome[];
    const hasPensions = fersPensions.length > 0 || csrsPensions.length > 0;

    // Get work incomes for potential High-3 calculation
    const workIncomes = incomes.filter(inc => inc instanceof WorkIncome) as WorkIncome[];

    // Get pension-eligible work incomes for the explorer
    const pensionEligibleWorkIncomes = workIncomes.filter(inc => inc.pensionSystem !== 'NONE');

    // State for retirement age explorer
    const [explorerRetirementAge, setExplorerRetirementAge] = useState<number>(() => {
        // Default to first pension's retirement age, or 62 if no pensions
        if (fersPensions.length > 0) return fersPensions[0].retirementAge;
        if (csrsPensions.length > 0) return csrsPensions[0].retirementAge;
        return 62;
    });
    const [explorerYearsOfService, setExplorerYearsOfService] = useState<number>(() => {
        if (fersPensions.length > 0) return fersPensions[0].yearsOfService;
        if (csrsPensions.length > 0) return csrsPensions[0].yearsOfService;
        return 0;
    });
    const [explorerPensionType, setExplorerPensionType] = useState<'FERS' | 'CSRS'>('FERS');

    // FERS calculations
    const fersDetails = useMemo(() => {
        const inflationAdjusted = assumptions.macro.inflationAdjusted;
        return fersPensions.map(pension => {
            const mra = getFERSMRA(birthYear);
            const eligibility = checkFERSEligibility(pension.retirementAge, pension.yearsOfService, birthYear);
            const baseBenefit = calculateFERSBasicBenefit(pension.yearsOfService, pension.high3Salary, pension.retirementAge);
            // Use the shared helper for the displayed (MRA+10-reduced) benefit so this
            // chart stays in lockstep with the sim's FERS benefit; eligibility/baseBenefit
            // are still surfaced for the eligibility readout below.
            const reducedBenefit = getDisplayedFERSBenefit(pension.yearsOfService, pension.high3Salary, pension.retirementAge, birthYear);

            // Simulate COLA growth (only if showing nominal dollars)
            const colaProjection: Array<{ age: number; year: number; cola: number; benefit: number }> = [];
            let projectedBenefit = reducedBenefit;
            const inflationRate = assumptions.macro.inflationRate / 100;

            for (let age = pension.retirementAge; age <= getLifeExpectancy(assumptions.milestones); age++) {
                const cola = getFERSCOLA(inflationRate, age);
                // Only apply COLA growth if showing nominal (future) dollars
                if (!inflationAdjusted && age > pension.retirementAge) {
                    projectedBenefit *= (1 + cola);
                }
                colaProjection.push({
                    age,
                    year: birthYear + age,
                    cola: inflationAdjusted ? 0 : cola * 100, // Show 0 COLA in real dollars mode
                    benefit: projectedBenefit
                });
            }

            return {
                pension,
                mra,
                eligibility,
                baseBenefit,
                reducedBenefit,
                colaProjection
            };
        });
    }, [fersPensions, birthYear, assumptions]);

    // CSRS calculations
    const csrsDetails = useMemo(() => {
        const inflationAdjusted = assumptions.macro.inflationAdjusted;
        return csrsPensions.map(pension => {
            const eligibility = checkCSRSEligibility(pension.retirementAge, pension.yearsOfService);
            const baseBenefit = calculateCSRSBasicBenefit(pension.yearsOfService, pension.high3Salary);
            // Use the shared helper for the displayed (early-retirement-reduced) benefit
            // so this chart stays in lockstep with the sim's CSRS benefit;
            // eligibility/baseBenefit are still surfaced for the eligibility readout below.
            const reducedBenefit = getDisplayedCSRSBenefit(pension.yearsOfService, pension.high3Salary, pension.retirementAge);

            // Simulate COLA growth (only if showing nominal dollars)
            const colaProjection: Array<{ age: number; year: number; cola: number; benefit: number }> = [];
            let projectedBenefit = reducedBenefit;
            const inflationRate = assumptions.macro.inflationRate / 100;

            for (let age = pension.retirementAge; age <= getLifeExpectancy(assumptions.milestones); age++) {
                const cola = getCSRSCOLA(inflationRate);
                // Only apply COLA growth if showing nominal (future) dollars
                if (!inflationAdjusted && age > pension.retirementAge) {
                    projectedBenefit *= (1 + cola);
                }
                colaProjection.push({
                    age,
                    year: birthYear + age,
                    cola: inflationAdjusted ? 0 : cola * 100, // Show 0 COLA in real dollars mode
                    benefit: projectedBenefit
                });
            }

            return {
                pension,
                eligibility,
                baseBenefit,
                reducedBenefit,
                colaProjection
            };
        });
    }, [csrsPensions, birthYear, assumptions]);

    // High-3 tracking from simulation (only pension-eligible work incomes)
    const high3Tracking = useMemo(() => {
        if (simulation.length === 0 || workIncomes.length === 0) return null;

        const salaryHistory: Array<{ year: number; age: number; salary: number }> = [];

        simulation.forEach((simYear) => {
            const year = simYear.year;
            const age = year - birthYear;

            // Sum only work incomes that are pension-eligible (FERS or CSRS)
            const totalSalary = simYear.incomes
                .filter(inc => inc instanceof WorkIncome && inc.pensionSystem !== 'NONE')
                .reduce((sum, inc) => sum + inc.amount, 0);

            if (totalSalary > 0) {
                salaryHistory.push({
                    year,
                    age,
                    salary: totalSalary
                });
            }
        });

        // Calculate running High-3 (average of highest 3 consecutive years)
        const high3History: Array<{ year: number; age: number; high3: number; salaries: number[] }> = [];
        for (let i = 2; i < salaryHistory.length; i++) {
            const lastThree = [salaryHistory[i - 2].salary, salaryHistory[i - 1].salary, salaryHistory[i].salary];
            const high3 = lastThree.reduce((a, b) => a + b, 0) / 3;
            high3History.push({
                year: salaryHistory[i].year,
                age: salaryHistory[i].age,
                high3,
                salaries: lastThree
            });
        }

        return { salaryHistory, high3History };
    }, [simulation, workIncomes, birthYear]);

    // Get High-3 estimate from simulation at a given retirement age
    const getHigh3AtAge = useCallback((retireAge: number): number => {
        if (!high3Tracking || high3Tracking.high3History.length === 0) {
            // Fall back to first pension's High-3 or a default
            if (fersPensions.length > 0) return fersPensions[0].high3Salary;
            if (csrsPensions.length > 0) return csrsPensions[0].high3Salary;
            // Estimate from current pension-eligible work income
            const totalPensionSalary = pensionEligibleWorkIncomes.reduce((sum, inc) => sum + inc.getAnnualAmount(), 0);
            return totalPensionSalary || 100000;
        }
        // Find the High-3 at retirement age (or closest before it)
        const high3AtAge = high3Tracking.high3History.filter(h => h.age <= retireAge);
        if (high3AtAge.length === 0) return high3Tracking.high3History[0]?.high3 || 100000;
        return high3AtAge[high3AtAge.length - 1].high3;
    }, [high3Tracking, fersPensions, csrsPensions, pensionEligibleWorkIncomes]);

    // Explorer: Calculate benefits at different retirement ages
    const explorerData = useMemo(() => {
        const mra = getFERSMRA(birthYear);
        const inflationRate = assumptions.macro.inflationRate / 100;
        const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
        const inflationAdjusted = assumptions.macro.inflationAdjusted;

        // Generate data for ages from MRA (or 50) to 70
        const minAge = Math.max(50, Math.min(mra, currentAge));
        const maxAge = 70;
        const ages: number[] = [];
        for (let age = minAge; age <= maxAge; age++) {
            ages.push(age);
        }

        return ages.map(retireAge => {
            // Calculate years of service at this retirement age
            // Assume they started service at (currentAge - explorerYearsOfService) years ago
            const serviceStartAge = currentAge - explorerYearsOfService;
            const yearsAtRetirement = Math.max(0, retireAge - serviceStartAge);

            // Get projected High-3 at this retirement age
            const high3 = getHigh3AtAge(retireAge);

            if (explorerPensionType === 'FERS') {
                const eligibility = checkFERSEligibility(retireAge, yearsAtRetirement, birthYear);
                const baseBenefit = calculateFERSBasicBenefit(yearsAtRetirement, high3, retireAge);
                const reductionFactor = (1 - eligibility.reductionPercent / 100);
                // Route the headline benefit through the shared helper so the explorer
                // can't drift from the sim's FERS number; baseBenefit/reductionPercent
                // are still surfaced below for the per-component breakdown.
                const annualBenefit = getDisplayedFERSBenefit(yearsAtRetirement, high3, retireAge, birthYear);

                // Calculate lifetime benefit
                // If inflationAdjusted (real dollars): don't apply COLA growth (COLA ~ inflation, so real value stays flat)
                // If not inflationAdjusted (nominal): apply COLA to show future nominal values
                const yearsReceiving = lifeExpectancy - retireAge;
                let lifetimeBenefit = 0;
                let projectedBenefit = annualBenefit;
                for (let y = 0; y < yearsReceiving; y++) {
                    if (!inflationAdjusted && y > 0) {
                        const age = retireAge + y;
                        const cola = age >= 62 ? getFERSCOLA(inflationRate, age) : 0;
                        projectedBenefit *= (1 + cola);
                    }
                    lifetimeBenefit += projectedBenefit;
                }

                return {
                    age: retireAge,
                    yearsOfService: yearsAtRetirement,
                    high3,
                    baseBenefit,
                    reductionPercent: (1 - reductionFactor) * 100,
                    annualBenefit,
                    monthlyBenefit: annualBenefit / 12,
                    lifetimeBenefit,
                    eligible: eligibility.eligible,
                    message: eligibility.message,
                    isSelected: retireAge === explorerRetirementAge
                };
            } else {
                // CSRS
                const eligibility = checkCSRSEligibility(retireAge, yearsAtRetirement);
                const baseBenefit = calculateCSRSBasicBenefit(yearsAtRetirement, high3);
                // Route the headline benefit through the shared helper so the explorer
                // can't drift from the sim's CSRS number; baseBenefit/reductionPercent
                // are still surfaced below for the per-component breakdown.
                const annualBenefit = getDisplayedCSRSBenefit(yearsAtRetirement, high3, retireAge);

                // Calculate lifetime benefit
                const yearsReceiving = lifeExpectancy - retireAge;
                let lifetimeBenefit = 0;
                let projectedBenefit = annualBenefit;
                const cola = getCSRSCOLA(inflationRate);
                for (let y = 0; y < yearsReceiving; y++) {
                    if (!inflationAdjusted && y > 0) {
                        projectedBenefit *= (1 + cola);
                    }
                    lifetimeBenefit += projectedBenefit;
                }

                return {
                    age: retireAge,
                    yearsOfService: yearsAtRetirement,
                    high3,
                    baseBenefit,
                    reductionPercent: eligibility.reductionPercent,
                    annualBenefit,
                    monthlyBenefit: annualBenefit / 12,
                    lifetimeBenefit,
                    eligible: eligibility.eligible,
                    message: eligibility.message,
                    isSelected: retireAge === explorerRetirementAge
                };
            }
        });
    }, [explorerRetirementAge, explorerYearsOfService, explorerPensionType, birthYear, currentAge, assumptions, getHigh3AtAge]);

    // Find the selected age data
    const selectedAgeData = explorerData.find(d => d.age === explorerRetirementAge);
    const mra = getFERSMRA(birthYear);

    if (!hasPensions && workIncomes.length === 0) {
        return (
            <div className="text-content-muted text-center py-8">
                <p>No pension or work income data to analyze.</p>
                <p className="text-sm mt-2">Add a FERS or CSRS pension to see detailed calculations.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* FERS vs CSRS Comparison */}
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Pension System Comparison</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-surface-overlay p-4 rounded-lg">
                        <h4 className="font-semibold text-cat-cyan mb-2">FERS</h4>
                        <ul className="text-sm text-content-default space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.FERS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.FERS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.FERS.socialSecurity}</li>
                            <li>• Supplement: {PENSION_SYSTEM_COMPARISON.FERS.supplement}</li>
                        </ul>
                    </div>
                    <div className="bg-surface-overlay p-4 rounded-lg">
                        <h4 className="font-semibold text-warning mb-2">CSRS</h4>
                        <ul className="text-sm text-content-default space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.CSRS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.CSRS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.CSRS.socialSecurity}</li>
                            <li>• Max Benefit: {PENSION_SYSTEM_COMPARISON.CSRS.maxBenefit}</li>
                        </ul>
                    </div>
                </div>
            </Panel>

            {/* Retirement Age Explorer */}
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Retirement Age Explorer</h3>
                <p className="text-sm text-content-muted mb-4">
                    Explore how different retirement ages affect your pension benefit. Adjust the sliders to see the impact.
                </p>

                {/* Controls */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <DropdownInput
                        label="Pension System"
                        value={explorerPensionType}
                        onChange={(val) => setExplorerPensionType(val as 'FERS' | 'CSRS')}
                        options={[
                            { value: 'FERS', label: 'FERS' },
                            { value: 'CSRS', label: 'CSRS' }
                        ]}
                    />
                    <NumberInput
                        label="Retirement Age"
                        value={explorerRetirementAge}
                        onChange={(val) => setExplorerRetirementAge(val)}
                        min={50}
                        max={70}
                        tooltip="Age at which you plan to retire"
                    />
                    <NumberInput
                        label="Current Years of Service"
                        value={explorerYearsOfService}
                        onChange={(val) => setExplorerYearsOfService(val)}
                        min={0}
                        max={50}
                        tooltip="Your current years of creditable federal service"
                    />
                </div>

                {/* Selected Age Summary */}
                {selectedAgeData && (
                    <div className={`p-4 rounded-lg mb-6 ${selectedAgeData.eligible ? 'bg-positive-tint/20 border border-positive-strong/50' : 'bg-warning-tint/20 border border-warning-strong/50'}`}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <div className="text-content-muted text-xs">Retire at Age</div>
                                <div className="text-2xl font-bold text-white">{selectedAgeData.age}</div>
                                <div className="text-xs text-content-subtle">Year {birthYear + selectedAgeData.age}</div>
                            </div>
                            <div>
                                <div className="text-content-muted text-xs">Years of Service</div>
                                <div className="text-2xl font-bold text-white">{selectedAgeData.yearsOfService}</div>
                            </div>
                            <div>
                                <div className="text-content-muted text-xs">Annual Benefit</div>
                                <div className="text-2xl font-bold text-positive">{toCurrencyShort(selectedAgeData.annualBenefit)}</div>
                                <div className="text-xs text-content-muted">{toCurrencyShort(selectedAgeData.monthlyBenefit)}/mo</div>
                            </div>
                            <div>
                                <div className="text-content-muted text-xs">Reduction</div>
                                <div className={`text-2xl font-bold ${selectedAgeData.reductionPercent > 0 ? 'text-negative' : 'text-positive'}`}>
                                    {selectedAgeData.reductionPercent > 0 ? `-${selectedAgeData.reductionPercent.toFixed(1)}%` : 'None'}
                                </div>
                            </div>
                        </div>
                        <div className={`mt-3 text-sm ${selectedAgeData.eligible ? 'text-positive' : 'text-warning'}`}>
                            {selectedAgeData.message}
                        </div>
                    </div>
                )}

                {/* Comparison Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border-default">
                                <th className="text-left p-2 text-content-muted">Age</th>
                                <th className="text-center p-2 text-content-muted">YOS</th>
                                <th className="text-right p-2 text-content-muted">High-3</th>
                                <th className="text-right p-2 text-content-muted">Reduction</th>
                                <th className="text-right p-2 text-content-muted">Annual</th>
                                <th className="text-right p-2 text-content-muted">Monthly</th>
                                <th className="text-right p-2 text-content-muted">Lifetime*</th>
                                <th className="text-left p-2 text-content-muted">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {explorerData.map((row) => (
                                <tr
                                    key={row.age}
                                    className={`border-b border-border-subtle cursor-pointer transition-colors ${
                                        row.isSelected
                                            ? 'bg-info-tint/30 border-info-strong'
                                            : row.age === mra
                                            ? 'bg-cat-cyan-tint/10'
                                            : 'hover:bg-surface-overlay/50'
                                    }`}
                                    onClick={() => setExplorerRetirementAge(row.age)}
                                >
                                    <td className="p-2 text-white font-medium">
                                        {row.age}
                                        {row.age === mra && <span className="ml-1 text-xs text-cat-cyan">(MRA)</span>}
                                        {row.age === 62 && <span className="ml-1 text-xs text-positive">(62)</span>}
                                    </td>
                                    <td className="p-2 text-center text-content-default">{row.yearsOfService}</td>
                                    <td className="p-2 text-right text-content-default">{toCurrencyShort(row.high3)}</td>
                                    <td className={`p-2 text-right ${row.reductionPercent > 0 ? 'text-negative' : 'text-positive'}`}>
                                        {row.reductionPercent > 0 ? `-${row.reductionPercent.toFixed(1)}%` : '0%'}
                                    </td>
                                    <td className="p-2 text-right text-white font-semibold">{toCurrencyShort(row.annualBenefit)}</td>
                                    <td className="p-2 text-right text-content-default">{toCurrencyShort(row.monthlyBenefit)}</td>
                                    <td className="p-2 text-right text-content-muted">{toCurrencyShort(row.lifetimeBenefit)}</td>
                                    <td className="p-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            row.eligible ? 'bg-positive-tint/50 text-positive' : 'bg-warning-tint/50 text-warning'
                                        }`}>
                                            {row.eligible ? 'Eligible' : 'Reduced'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-content-subtle mt-2">
                    * Lifetime benefit assumes life expectancy of {getLifeExpectancy(assumptions.milestones)}.
                    {assumptions.macro.inflationAdjusted
                        ? ' Values shown in today\'s dollars (real). COLA growth excluded as it roughly offsets inflation.'
                        : ` Values shown in future dollars (nominal) with ${assumptions.macro.inflationRate}% annual COLA applied.`
                    }
                    {' '}Click a row to select that retirement age.
                </p>
            </Panel>

            {/* FERS Pensions */}
            {fersDetails.map((detail, idx) => (
                <div key={idx} className="bg-surface-raised p-4 rounded-lg border border-border-subtle">
                    <h3 className="text-lg font-semibold text-cat-cyan mb-4">
                        FERS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">MRA (Birth {birthYear})</div>
                            <div className="text-xl font-bold text-white">{detail.mra}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-surface-overlay p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-content-muted">Multiplier ({detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'})</span>
                                <span className="text-content-default">{detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'} per year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-content-muted">Base Benefit ({detail.pension.yearsOfService} years × High-3)</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-negative">
                                    <span>MRA+10 Early Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-border-default pt-2">
                                <span className="text-positive font-semibold">Final Annual Benefit</span>
                                <span className="text-positive font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-content-muted">Monthly</span>
                                <span className="text-content-default">{toCurrency(detail.reducedBenefit / 12)}/month</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-positive-tint/30 border border-positive-strong' : 'bg-negative-tint/30 border border-negative-strong'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-positive' : 'text-negative'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-surface-overlay p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">
                            Benefit Projection {assumptions.macro.inflationAdjusted ? '(Today\'s Dollars)' : `(Nominal with ${assumptions.macro.inflationRate}% COLA)`}
                        </h4>
                        <div className="text-xs text-content-muted mb-2">
                            {assumptions.macro.inflationAdjusted
                                ? "Values shown in today's dollars. COLA growth excluded as it roughly offsets inflation."
                                : "FERS COLA: None before age 62. After 62: Full if CPI ≤ 2%, 2% if 2-3%, CPI-1% if > 3%"
                            }
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border-default">
                                        <th className="text-left p-2 text-content-muted">Age</th>
                                        <th className="text-left p-2 text-content-muted">Year</th>
                                        <th className="text-right p-2 text-content-muted">COLA</th>
                                        <th className="text-right p-2 text-content-muted">Annual Benefit</th>
                                        <th className="text-right p-2 text-content-muted">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className={`border-b border-border-subtle ${row.age === 62 ? 'bg-cat-cyan-tint/20' : ''}`}>
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-content-default">{row.year}</td>
                                            <td className="p-2 text-right text-cat-cyan">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-content-default">{toCurrencyShort(row.benefit / 12)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ))}

            {/* CSRS Pensions */}
            {csrsDetails.map((detail, idx) => (
                <div key={idx} className="bg-surface-raised p-4 rounded-lg border border-border-subtle">
                    <h3 className="text-lg font-semibold text-warning mb-4">
                        CSRS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-surface-overlay p-3 rounded">
                            <div className="text-content-muted text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-surface-overlay p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">CSRS Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-content-muted">First 5 years @ 1.5%</span>
                                <span className="text-content-default">{toCurrency(Math.min(detail.pension.yearsOfService, 5) * detail.pension.high3Salary * 0.015)}</span>
                            </div>
                            {detail.pension.yearsOfService > 5 && (
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Years 6-10 @ 1.75%</span>
                                    <span className="text-content-default">{toCurrency(Math.min(detail.pension.yearsOfService - 5, 5) * detail.pension.high3Salary * 0.0175)}</span>
                                </div>
                            )}
                            {detail.pension.yearsOfService > 10 && (
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Years 11+ @ 2.0%</span>
                                    <span className="text-content-default">{toCurrency((detail.pension.yearsOfService - 10) * detail.pension.high3Salary * 0.02)}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-content-muted">Base Benefit</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between text-xs text-content-subtle">
                                <span>Max (80% of High-3)</span>
                                <span>{toCurrency(detail.pension.high3Salary * 0.8)}</span>
                            </div>
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-negative">
                                    <span>Early Retirement Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-border-default pt-2">
                                <span className="text-positive font-semibold">Final Annual Benefit</span>
                                <span className="text-positive font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-positive-tint/30 border border-positive-strong' : 'bg-negative-tint/30 border border-negative-strong'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-positive' : 'text-negative'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-surface-overlay p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">
                            Benefit Projection {assumptions.macro.inflationAdjusted ? '(Today\'s Dollars)' : `(Nominal with ${assumptions.macro.inflationRate}% COLA)`}
                        </h4>
                        <div className="text-xs text-content-muted mb-2">
                            {assumptions.macro.inflationAdjusted
                                ? "Values shown in today's dollars. COLA growth excluded as it roughly offsets inflation."
                                : "CSRS receives full CPI COLA regardless of age."
                            }
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border-default">
                                        <th className="text-left p-2 text-content-muted">Age</th>
                                        <th className="text-left p-2 text-content-muted">Year</th>
                                        <th className="text-right p-2 text-content-muted">COLA</th>
                                        <th className="text-right p-2 text-content-muted">Annual Benefit</th>
                                        <th className="text-right p-2 text-content-muted">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className="border-b border-border-subtle">
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-content-default">{row.year}</td>
                                            <td className="p-2 text-right text-warning">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-content-default">{toCurrencyShort(row.benefit / 12)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            ))}

            {/* High-3 Tracking from Work Income */}
            {high3Tracking && high3Tracking.high3History.length > 0 && (
                <Panel className="rounded-lg">
                    <h3 className="text-lg font-semibold text-white mb-4">High-3 Salary Tracking (From Simulation)</h3>
                    <p className="text-sm text-content-muted mb-4">
                        Your High-3 is the average of your highest 3 consecutive years of salary.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border-default">
                                    <th className="text-left p-2 text-content-muted">Year</th>
                                    <th className="text-left p-2 text-content-muted">Age</th>
                                    <th className="text-right p-2 text-content-muted">Year -2</th>
                                    <th className="text-right p-2 text-content-muted">Year -1</th>
                                    <th className="text-right p-2 text-content-muted">Current</th>
                                    <th className="text-right p-2 text-content-muted">High-3 Avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {high3Tracking.high3History.map((row: any) => (
                                    <tr key={row.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-white">{row.year}</td>
                                        <td className="p-2 text-content-default">{row.age}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(row.salaries[0])}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(row.salaries[1])}</td>
                                        <td className="p-2 text-right text-content-default">{toCurrencyShort(row.salaries[2])}</td>
                                        <td className="p-2 text-right text-positive font-semibold">{toCurrencyShort(row.high3)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}
        </div>
    );
}

// ============================================================================
// ROTH ANALYSIS DEBUG TAB
// ============================================================================

// --- Section 1: Recommendation Summary ---
const VERDICT_LABEL: Record<AllocationVerdict, { text: string; cls: string }> = {
    'optimal': { text: 'Optimal', cls: 'text-positive-bright' },
    'should-be-roth': { text: 'Should be Roth', cls: 'text-positive-bright' },
    'should-be-pretax': { text: 'Should be Pre-Tax', cls: 'text-info-bright' },
    'lean-roth': { text: 'Lean Roth', cls: 'text-positive' },
    'lean-pretax': { text: 'Lean Pre-Tax', cls: 'text-info' },
    'either-fine': { text: 'Either is fine', cls: 'text-warning-bright' },
};

function RothPreTaxAllocationDebug({ allocation }: { allocation: RothPreTaxAllocation }) {
    const v = VERDICT_LABEL[allocation.verdict];
    const rothPct = Math.round(allocation.rothFraction * 100);
    const basisLabel = allocation.futureRateBasis === 'rmd-year'
        ? 'first RMD year (marginal)'
        : 'median retirement (fallback — no RMD years)';
    const gapCls = allocation.rateGap > 0 ? 'text-positive' : allocation.rateGap < 0 ? 'text-info' : 'text-warning';

    return (
        <div className="space-y-4">
            <div className="p-3 rounded-lg border bg-surface-overlay border-border-default flex items-center justify-between">
                <span className="text-content-muted text-sm">Verdict</span>
                <span className={`text-xl font-bold ${v.cls}`}>{v.text}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface-overlay p-3 rounded-lg text-center">
                    <span className="text-content-muted text-xs">Current Marginal</span>
                    <p className="text-white text-lg font-bold">{(allocation.currentRate * 100).toFixed(1)}%</p>
                </div>
                <div className="bg-surface-overlay p-3 rounded-lg text-center">
                    <span className="text-content-muted text-xs">Future Marginal</span>
                    <p className="text-white text-lg font-bold">{(allocation.futureRate * 100).toFixed(1)}%</p>
                    <p className="text-content-subtle text-xs">{basisLabel}</p>
                </div>
                <div className="bg-surface-overlay p-3 rounded-lg text-center">
                    <span className="text-content-muted text-xs">Rate Gap</span>
                    <p className={`text-lg font-bold ${gapCls}`}>{allocation.rateGap >= 0 ? '+' : ''}{(allocation.rateGap * 100).toFixed(1)}%</p>
                    <p className="text-content-subtle text-xs">future − current</p>
                </div>
                <div className="bg-surface-overlay p-3 rounded-lg text-center">
                    <span className="text-content-muted text-xs">Current Split</span>
                    <p className="text-white text-lg font-bold">{rothPct}% Roth</p>
                    <p className="text-content-subtle text-xs">{toCurrencyShort(allocation.current401kSplit.preTax)} PT / {toCurrencyShort(allocation.current401kSplit.roth)} Roth</p>
                </div>
            </div>
            <p className="text-content-subtle text-xs">
                Positive gap → future rate higher → Roth wins. Negative → Pre-Tax wins. Within ±2% reads as "either fine."
            </p>
        </div>
    );
}

// --- Section 2: Tax Rate Timeline ---
type PhaseType = 'Working' | 'Gap' | 'SS/Pension' | 'RMD';
interface TimelineRow {
    year: number;
    age: number;
    phase: PhaseType;
    grossIncome: number;
    federalMarginalRate: number;
    effectiveRate: number;
    taxableIncome: number;
}

function TaxRateTimeline({ timelineData }: { timelineData: TimelineRow[] }) {
    const phaseColors: Record<PhaseType, string> = {
        'Working': 'text-info',
        'Gap': 'text-positive',
        'SS/Pension': 'text-warning',
        'RMD': 'text-cat-purple'
    };

    return (
        <Panel className="rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Tax Rate Timeline</h3>
            <p className="text-content-muted text-sm mb-4">Year-by-year marginal and effective rates. Green "Gap" years are prime conversion windows.</p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-raised">
                        <tr className="border-b border-border-default">
                            <th className="text-left p-2 text-content-muted">Year</th>
                            <th className="text-left p-2 text-content-muted">Age</th>
                            <th className="text-left p-2 text-content-muted">Phase</th>
                            <th className="text-right p-2 text-content-muted">Gross Income</th>
                            <th className="text-right p-2 text-content-muted">Taxable Income</th>
                            <th className="text-right p-2 text-content-muted">Fed Marginal</th>
                            <th className="text-right p-2 text-content-muted">Effective Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {timelineData.map(row => (
                            <tr key={row.year} className={`border-b border-border-subtle hover:bg-surface-overlay/50 ${row.phase === 'Gap' ? 'bg-positive-tint/10' : ''}`}>
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-content-default">{row.age}</td>
                                <td className={`p-2 font-semibold ${phaseColors[row.phase]}`}>{row.phase}</td>
                                <td className="p-2 text-right text-content-default">{toCurrencyShort(row.grossIncome)}</td>
                                <td className="p-2 text-right text-content-default">{toCurrencyShort(row.taxableIncome)}</td>
                                <td className="p-2 text-right text-white font-semibold">{(row.federalMarginalRate * 100).toFixed(0)}%</td>
                                <td className={`p-2 text-right font-semibold ${
                                    row.effectiveRate > 0.3 ? 'text-negative' :
                                    row.effectiveRate > 0.15 ? 'text-warning' : 'text-positive'
                                }`}>
                                    {(row.effectiveRate * 100).toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Panel>
    );
}

// --- Section 3: Bracket Headroom Analysis ---
interface HeadroomRow {
    year: number;
    age: number;
    taxableIncome: number;
    bracketHeadrooms: { rate: number; headroom: number }[];
    totalHeadroom: number;
    traditionalBalance: number;
}

function BracketHeadroomAnalysis({ headroomData, targetRate, setTargetRate }: {
    headroomData: HeadroomRow[];
    targetRate: number;
    setTargetRate: (rate: number) => void;
}) {
    const rateOptions = [
        { value: '0.10', label: '10%' },
        { value: '0.12', label: '12%' },
        { value: '0.22', label: '22%' },
        { value: '0.24', label: '24%' },
        { value: '0.32', label: '32%' }
    ];

    if (headroomData.length === 0) {
        return (
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Bracket Headroom Analysis</h3>
                <p className="text-content-muted text-center py-4">No retirement years in simulation or no Traditional account balances.</p>
            </Panel>
        );
    }

    // Collect unique bracket rates from the data
    const bracketRates = headroomData[0]?.bracketHeadrooms.map(b => b.rate) || [];

    return (
        <Panel className="rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Bracket Headroom Analysis</h3>
            <p className="text-content-muted text-sm mb-4">Room available in each federal bracket during retirement. Shows how much you can convert and stay within the target bracket.</p>
            <div className="mb-4 max-w-xs">
                <DropdownInput
                    label="Target Bracket"
                    value={String(targetRate)}
                    onChange={(v: string) => setTargetRate(Number(v))}
                    options={rateOptions}
                    tooltip="Show headroom for brackets up to this rate"
                />
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-raised">
                        <tr className="border-b border-border-default">
                            <th className="text-left p-2 text-content-muted">Year</th>
                            <th className="text-left p-2 text-content-muted">Age</th>
                            <th className="text-right p-2 text-content-muted">Taxable Inc</th>
                            {bracketRates.map(rate => (
                                <th key={rate} className="text-right p-2 text-content-muted">{(rate * 100).toFixed(0)}% Room</th>
                            ))}
                            <th className="text-right p-2 text-content-muted">Total Room</th>
                            <th className="text-right p-2 text-content-muted">Trad. Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {headroomData.map(row => (
                            <tr key={row.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-content-default">{row.age}</td>
                                <td className="p-2 text-right text-content-default">{toCurrencyShort(row.taxableIncome)}</td>
                                {row.bracketHeadrooms.map(bh => (
                                    <td key={bh.rate} className={`p-2 text-right ${bh.headroom > 0 ? 'text-positive' : 'text-content-faint'}`}>
                                        {bh.headroom > 0 ? toCurrencyShort(bh.headroom) : '-'}
                                    </td>
                                ))}
                                <td className="p-2 text-right text-positive font-semibold">{toCurrencyShort(row.totalHeadroom)}</td>
                                <td className="p-2 text-right text-info">{toCurrencyShort(row.traditionalBalance)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Panel>
    );
}

// --- Section 4: Conversion Windows Analysis ---
interface ConversionWindowRow {
    year: number;
    age: number;
    bracketHeadroom: number;
    traditionalAvailable: number;
    optimalConversion: number;
    taxCost: number;
    effectiveRate: number;
    hasTorpedo: boolean;
}

function ConversionWindowsAnalysis({ windows, windowSummary }: {
    windows: ConversionWindowRow[];
    windowSummary: { totalYears: number; totalHeadroom: number; totalTaxCost: number; avgRate: number; firstAge: number; lastAge: number } | null;
}) {
    if (windows.length === 0) {
        return (
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Conversion Windows</h3>
                <p className="text-content-muted text-center py-4">No low-tax conversion windows found. This may mean your retirement income already fills higher brackets, or you have no Traditional account balance.</p>
            </Panel>
        );
    }

    return (
        <Panel className="rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Conversion Windows</h3>
            <p className="text-content-muted text-sm mb-1">Years where Roth conversions can be done at rates below your retirement rate. Effective rate includes the SS "tax torpedo" effect.</p>
            <p className="text-warning/70 text-xs mb-4">
                Hypothetical opportunity heuristic ("convert up to the income where your marginal rate reaches the retirement rate") — <em>not</em> what the simulation actually converted. For realized conversions (rate-match or DP) see the Roth Debug tab.
            </p>

            {windowSummary && (
                <div className="bg-surface-overlay p-3 rounded-lg mb-4 flex flex-wrap gap-4 text-sm">
                    <span className="text-white">Window: Ages <span className="text-positive font-semibold">{windowSummary.firstAge}-{windowSummary.lastAge}</span> ({windowSummary.totalYears} years)</span>
                    <span className="text-white">Total Headroom: <span className="text-positive font-semibold">{toCurrencyShort(windowSummary.totalHeadroom)}</span></span>
                    <span className="text-white">Total Tax Cost: <span className="text-negative font-semibold">{toCurrencyShort(windowSummary.totalTaxCost)}</span></span>
                    <span className="text-white">Avg Rate: <span className="text-warning font-semibold">{(windowSummary.avgRate * 100).toFixed(1)}%</span></span>
                </div>
            )}

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-raised">
                        <tr className="border-b border-border-default">
                            <th className="text-left p-2 text-content-muted">Year</th>
                            <th className="text-left p-2 text-content-muted">Age</th>
                            <th className="text-right p-2 text-content-muted">Bracket Room</th>
                            <th className="text-right p-2 text-content-muted">Trad. Available</th>
                            <th className="text-right p-2 text-content-muted">Optimal Conv</th>
                            <th className="text-right p-2 text-content-muted">Tax Cost</th>
                            <th className="text-right p-2 text-content-muted">Effective Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {windows.map(row => (
                            <tr key={row.year} className={`border-b border-border-subtle hover:bg-surface-overlay/50 ${row.hasTorpedo ? 'bg-warning-tint/10' : ''}`}>
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-content-default">{row.age}</td>
                                <td className="p-2 text-right text-positive">{toCurrencyShort(row.bracketHeadroom)}</td>
                                <td className="p-2 text-right text-info">{toCurrencyShort(row.traditionalAvailable)}</td>
                                <td className="p-2 text-right text-white font-semibold">{toCurrencyShort(row.optimalConversion)}</td>
                                <td className="p-2 text-right text-negative">{toCurrencyShort(row.taxCost)}</td>
                                <td className={`p-2 text-right font-semibold ${row.hasTorpedo ? 'text-warning' : 'text-positive'}`}>
                                    {(row.effectiveRate * 100).toFixed(1)}%{row.hasTorpedo ? '*' : ''}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {windows.some(w => w.hasTorpedo) && (
                <p className="text-warning/80 text-xs mt-2">
                    * Effective rate exceeds bracket rate due to SS "tax torpedo" — conversions push Social Security benefits into taxable territory, increasing total tax beyond the marginal bracket rate.
                </p>
            )}
        </Panel>
    );
}

// --- Section 5: Roth vs Pre-Tax Contribution Comparison ---
interface ContributionComparison {
    jobName: string;
    currentPreTax: number;
    currentRoth: number;
    limit: number;
    currentMarginalRate: number;
    retirementRate: number;
    yearsToRetirement: number;
    ror: number;
    preTaxPath: { futureValue: number; taxAtWithdrawal: number; afterTaxValue: number; reinvestedSavings: number; total: number };
    rothPath: { futureValue: number; total: number };
    winner: 'pretax' | 'roth';
    advantage: number;
    breakEvenRate: number;
    optimalSplit: { preTax: number; roth: number; explanation: string } | null;
}

function RothVsPreTaxComparison({ comparisons }: { comparisons: ContributionComparison[] }) {
    if (comparisons.length === 0) {
        return (
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-4">Roth vs Pre-Tax Contribution Comparison</h3>
                <p className="text-content-muted text-center py-4">No active work income with 401k contributions found.</p>
            </Panel>
        );
    }

    return (
        <Panel className="rounded-lg">
            <h3 className="text-lg font-semibold text-white mb-4">Roth vs Pre-Tax Contribution Comparison</h3>
            <p className="text-content-muted text-sm mb-1">Compares the after-tax terminal wealth of contributing the full 401k limit as all pre-tax vs all Roth.</p>
            <p className="text-warning/70 text-xs mb-4">
                Illustrative projection only — simplified assumptions (flat growth, an approximate 15% long-term-capital-gains drag on reinvested pre-tax savings, and today's marginal rate vs the median <em>effective</em> retirement rate). The authoritative Roth-vs-Pre-Tax call is the marginal-to-marginal verdict in "Contribution Recommendation" above.
            </p>

            {comparisons.map((comp, idx) => (
                <div key={idx} className="mb-6 last:mb-0">
                    <div className="bg-surface-overlay p-3 rounded-lg mb-3">
                        <div className="flex flex-wrap gap-4 text-sm">
                            <span className="text-white font-semibold">{comp.jobName}</span>
                            <span className="text-content-muted">Current: {toCurrencyShort(comp.currentPreTax)} pre-tax / {toCurrencyShort(comp.currentRoth)} Roth</span>
                            <span className="text-content-muted">Limit: {toCurrencyShort(comp.limit)}</span>
                            <span className="text-content-muted">{comp.yearsToRetirement} yrs to retirement</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-3">
                        <div className={`p-4 rounded-lg border ${comp.winner === 'pretax' ? 'border-info-strong/50 bg-info-tint/20' : 'border-border-default bg-surface-overlay'}`}>
                            <h4 className="text-info font-semibold mb-2">All Pre-Tax</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-content-muted">Contribution</span><span className="text-white">{toCurrencyShort(comp.limit)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Tax saved today</span><span className="text-positive">{toCurrencyShort(comp.limit * comp.currentMarginalRate)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Future value</span><span className="text-white">{toCurrencyShort(comp.preTaxPath.futureValue)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Tax at withdrawal</span><span className="text-negative">-{toCurrencyShort(comp.preTaxPath.taxAtWithdrawal)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Reinvested savings</span><span className="text-positive">+{toCurrencyShort(comp.preTaxPath.reinvestedSavings)}</span></div>
                                <div className="flex justify-between border-t border-border-strong pt-1 mt-1"><span className="text-white font-semibold">After-tax total</span><span className="text-white font-semibold">{toCurrencyShort(comp.preTaxPath.total)}</span></div>
                            </div>
                        </div>
                        <div className={`p-4 rounded-lg border ${comp.winner === 'roth' ? 'border-positive-strong/50 bg-positive-tint/20' : 'border-border-default bg-surface-overlay'}`}>
                            <h4 className="text-positive font-semibold mb-2">All Roth</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-content-muted">Contribution</span><span className="text-white">{toCurrencyShort(comp.limit)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Tax paid today</span><span className="text-negative">-{toCurrencyShort(comp.limit * comp.currentMarginalRate)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Future value</span><span className="text-white">{toCurrencyShort(comp.rothPath.futureValue)}</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">Tax at withdrawal</span><span className="text-positive">$0</span></div>
                                <div className="flex justify-between"><span className="text-content-muted">&nbsp;</span><span>&nbsp;</span></div>
                                <div className="flex justify-between border-t border-border-strong pt-1 mt-1"><span className="text-white font-semibold">After-tax total</span><span className="text-white font-semibold">{toCurrencyShort(comp.rothPath.total)}</span></div>
                            </div>
                        </div>
                    </div>

                    <div className={`p-3 rounded-lg border ${comp.winner === 'pretax' ? 'bg-info-tint/20 border-info-strong/50' : 'bg-positive-tint/20 border-positive-strong/50'}`}>
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <span className={`font-semibold ${comp.winner === 'pretax' ? 'text-info-bright' : 'text-positive-bright'}`}>
                                {comp.winner === 'pretax' ? 'Pre-Tax' : 'Roth'} wins by {toCurrencyShort(comp.advantage)} ({((comp.advantage / Math.min(comp.preTaxPath.total, comp.rothPath.total)) * 100).toFixed(1)}% better)
                            </span>
                            <span className="text-content-muted text-sm">Breakeven retirement rate: {(comp.breakEvenRate * 100).toFixed(1)}%</span>
                        </div>
                    </div>

                    {comp.optimalSplit && (
                        <div className="mt-3 bg-surface-overlay p-3 rounded-lg border border-border-default">
                            <h4 className="text-warning font-semibold text-sm mb-1">Optimal Split</h4>
                            <p className="text-content-default text-sm">
                                Pre-tax: {toCurrencyShort(comp.optimalSplit.preTax)} | Roth: {toCurrencyShort(comp.optimalSplit.roth)}
                            </p>
                            <p className="text-content-muted text-xs mt-1">{comp.optimalSplit.explanation}</p>
                        </div>
                    )}
                </div>
            ))}
        </Panel>
    );
}

// --- Main Container ---
function RothAnalysisDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { simulation } = useContext(SimulationContext);
    const { incomes } = useContext(IncomeContext);
    const { state: taxState } = useContext(TaxContext);

    const [targetRate, setTargetRate] = useState(0.22);

    const birthYear = getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const currentYear = new Date().getFullYear();
    const currentAge = currentYear - birthYear;
    const retirementYear = birthYear + retirementAge;
    const ror = (assumptions.investments?.returnRates?.ror / 100) || 0.07;

    // --- Section 1: production Roth-vs-Pre-Tax verdict (same fn the Tax Optimization tab uses) ---
    const allocation = useMemo(
        () => analyzeRothPreTaxAllocation(simulation, assumptions, taxState),
        [simulation, assumptions, taxState]
    );

    // --- Section 5 input: median effective retirement rate (drives the illustrative projection) ---
    const retirementEffectiveRate = useMemo(() => {
        if (simulation.length === 0) return null;
        return getMedianRetirementTaxRate(simulation, retirementYear);
    }, [simulation, retirementYear]);

    // --- Section 2 Data: Tax Rate Timeline ---
    const timelineData = useMemo((): TimelineRow[] => {
        if (simulation.length === 0) return [];

        return simulation.map(simYear => {
            const age = simYear.year - birthYear;
            const grossIncome = simYear.cashflow.totalIncome;
            const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica;
            const effectiveRate = grossIncome > 0 ? totalTax / grossIncome : 0;

            // Get federal marginal rate
            const fedParams = getTaxParameters(simYear.year, taxState.filingStatus, 'federal', undefined, assumptions);
            const preTaxDed = getPreTaxExemptions(simYear.incomes, simYear.year, age);
            // Use cashflow.totalIncome (includes RMDs which are filtered from simYear.incomes)
            // plus Roth conversion (taxable but not spendable).
            const conversionAmt = simYear.rothConversion?.amount || 0;
            const adjustedGross = Math.max(0, simYear.cashflow.totalIncome + conversionAmt - preTaxDed);
            const fedStdDed = fedParams?.standardDeduction || 14600;
            const taxableIncome = Math.max(0, adjustedGross - fedStdDed);
            const fedMarginal = fedParams ? getMarginalTaxRate(taxableIncome, fedParams) : { rate: 0 };

            // Phase detection
            const hasRMD = simYear.rmdDetails && simYear.rmdDetails.totalRMD > 0;
            const hasSS = simYear.incomes.some(inc => isSocialSecurity(inc));
            const hasPension = simYear.incomes.some(inc => inc instanceof FERSPensionIncome || inc instanceof CSRSPensionIncome);

            let phase: PhaseType = 'Working';
            if (age < retirementAge) {
                phase = 'Working';
            } else if (hasRMD) {
                phase = 'RMD';
            } else if (hasSS || hasPension) {
                phase = 'SS/Pension';
            } else {
                phase = 'Gap';
            }

            return {
                year: simYear.year,
                age,
                phase,
                grossIncome,
                federalMarginalRate: fedMarginal.rate,
                effectiveRate,
                taxableIncome
            };
        });
    }, [simulation, birthYear, retirementAge, taxState, assumptions]);

    // --- Section 3 Data: Bracket Headroom ---
    const headroomData = useMemo((): HeadroomRow[] => {
        if (simulation.length === 0) return [];

        const retirementYears = simulation.filter(s => (s.year - birthYear) >= retirementAge);
        if (retirementYears.length === 0) return [];

        return retirementYears.map(simYear => {
            const age = simYear.year - birthYear;
            const fedParams = getTaxParameters(simYear.year, taxState.filingStatus, 'federal', undefined, assumptions);
            if (!fedParams) return null;

            const preTaxDed = getPreTaxExemptions(simYear.incomes, simYear.year, age);
            // Use cashflow.totalIncome so RMDs (filtered from simYear.incomes) are included.
            const conversionAmt = simYear.rothConversion?.amount || 0;
            const adjustedGross = Math.max(0, simYear.cashflow.totalIncome + conversionAmt - preTaxDed);
            const taxableIncome = Math.max(0, adjustedGross - fedParams.standardDeduction);

            // Calculate headroom for each bracket up to target rate
            const bracketHeadrooms: { rate: number; headroom: number }[] = [];
            for (const bracket of fedParams.brackets) {
                if (bracket.rate > targetRate) break;
                const nextBracketIdx = fedParams.brackets.indexOf(bracket) + 1;
                const nextThreshold = nextBracketIdx < fedParams.brackets.length
                    ? fedParams.brackets[nextBracketIdx].threshold
                    : Infinity;
                const headroom = Math.max(0, nextThreshold - Math.max(taxableIncome, bracket.threshold));
                if (headroom < Infinity) {
                    bracketHeadrooms.push({ rate: bracket.rate, headroom });
                }
            }

            const totalHeadroom = bracketHeadrooms.reduce((sum, bh) => sum + bh.headroom, 0);

            // Get Traditional balance for this year
            const traditionalBalance = simYear.accounts
                .filter(acc => acc instanceof InvestedAccount &&
                    (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0);

            return {
                year: simYear.year,
                age,
                taxableIncome,
                bracketHeadrooms,
                totalHeadroom,
                traditionalBalance
            };
        }).filter((row): row is HeadroomRow => row !== null);
    }, [simulation, birthYear, retirementAge, taxState, assumptions, targetRate]);

    // --- Section 4 Data: Conversion Windows ---
    const conversionWindowData = useMemo(() => {
        if (simulation.length === 0) return { windows: [] as ConversionWindowRow[], summary: null };

        const opportunities = findRothConversionWindows(simulation, assumptions, taxState);
        if (opportunities.length === 0) return { windows: [] as ConversionWindowRow[], summary: null };

        const windows: ConversionWindowRow[] = opportunities.map(opp => {
            const simYear = simulation.find(s => s.year === opp.year);
            if (!simYear) return null;

            const age = opp.age;
            const traditionalAvailable = simYear.accounts
                .filter(acc => acc instanceof InvestedAccount &&
                    (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0);

            const optimalConversion = Math.min(opp.optimalConversionAmount, traditionalAvailable);

            // Calculate effective rate including SS torpedo
            const fedParams = getTaxParameters(simYear.year, taxState.filingStatus, 'federal', undefined, assumptions);
            let effectiveRate = opp.taxCost > 0 && opp.optimalConversionAmount > 0
                ? opp.taxCost / opp.optimalConversionAmount
                : opp.marginalRate;

            // Check SS torpedo effect
            if (fedParams && optimalConversion > 0) {
                const ssBenefits = getSocialSecurityBenefits(simYear.incomes, simYear.year);
                if (ssBenefits > 0) {
                    const preTaxDed = getPreTaxExemptions(simYear.incomes, simYear.year, age);
                    // Use cashflow.totalIncome so RMDs (filtered from simYear.incomes) are included.
                    const nonSSIncome = Math.max(0, simYear.cashflow.totalIncome - ssBenefits - preTaxDed);
                    const torpedoResult = calculateEffectiveConversionTax(
                        nonSSIncome, ssBenefits, 0, optimalConversion, taxState.filingStatus, fedParams, null
                    );
                    effectiveRate = torpedoResult.effectiveRate;
                }
            }

            const hasTorpedo = effectiveRate > opp.marginalRate + 0.02;

            return {
                year: opp.year,
                age,
                bracketHeadroom: opp.optimalConversionAmount,
                traditionalAvailable,
                optimalConversion,
                taxCost: opp.taxCost,
                effectiveRate,
                hasTorpedo
            };
        }).filter((row): row is ConversionWindowRow => row !== null);

        const totalHeadroom = windows.reduce((sum, w) => sum + w.bracketHeadroom, 0);
        const totalTaxCost = windows.reduce((sum, w) => sum + w.taxCost, 0);
        const totalConvertible = windows.reduce((sum, w) => sum + w.optimalConversion, 0);
        const avgRate = totalConvertible > 0 ? totalTaxCost / totalConvertible : 0;

        const summary = windows.length > 0 ? {
            totalYears: windows.length,
            totalHeadroom,
            totalTaxCost,
            avgRate,
            firstAge: windows[0].age,
            lastAge: windows[windows.length - 1].age
        } : null;

        return { windows, summary };
    }, [simulation, assumptions, taxState, birthYear]);

    // --- Section 5 Data: Roth vs Pre-Tax Comparison ---
    const contributionComparisons = useMemo((): ContributionComparison[] => {
        if (simulation.length === 0) return [];

        const workIncomes = incomes.filter((inc): inc is WorkIncome =>
            inc instanceof WorkIncome &&
            (!inc.end_date || inc.end_date.getFullYear() >= currentYear)
        );

        if (workIncomes.length === 0) return [];

        const retirementRate = retirementEffectiveRate || 0.15;
        const yearsToRetirement = Math.max(1, retirementAge - currentAge);
        const capGainsRate = 0.15; // Approximate long-term capital gains rate

        return workIncomes.map(income => {
            const age = currentAge;
            const effective = income.getEffective401k(currentYear, age);
            const limit = get401kLimit(currentYear, age);

            // Current marginal rate (fed + state, no FICA)
            const firstYear = simulation[0];
            const grossIncome = getGrossIncome(firstYear.incomes, firstYear.year);
            const preTaxDed = getPreTaxExemptions(firstYear.incomes, firstYear.year, age);
            const marginal = getCombinedMarginalRate(grossIncome, preTaxDed, taxState, firstYear.year, assumptions, false);
            const currentMarginalRate = marginal.federal + marginal.state;

            // All Pre-Tax path
            const preTaxFutureValue = limit * Math.pow(1 + ror, yearsToRetirement);
            const preTaxTaxAtWithdrawal = preTaxFutureValue * retirementRate;
            const preTaxAfterTax = preTaxFutureValue - preTaxTaxAtWithdrawal;
            const taxSavedToday = limit * currentMarginalRate;
            const reinvestedSavings = taxSavedToday * Math.pow(1 + ror, yearsToRetirement) * (1 - capGainsRate * 0.5);
            const preTaxTotal = preTaxAfterTax + reinvestedSavings;

            // All Roth path
            const rothFutureValue = limit * Math.pow(1 + ror, yearsToRetirement);
            const rothTotal = rothFutureValue; // Tax-free

            const winner = preTaxTotal >= rothTotal ? 'pretax' as const : 'roth' as const;
            const advantage = Math.abs(preTaxTotal - rothTotal);

            // Breakeven: solve for rate where preTax = roth
            // FV*(1-r) + taxSaved*(1+ror)^n*(1-cg*0.5) = FV
            // FV - FV*r + reinvested = FV
            // -FV*r + reinvested = 0
            // r = reinvested / FV
            const breakEvenRate = reinvestedSavings > 0
                ? 1 - (rothTotal - reinvestedSavings) / preTaxFutureValue
                : currentMarginalRate;

            // Optimal split: fill current bracket with pre-tax, rest Roth
            let optimalSplit: ContributionComparison['optimalSplit'] = null;
            const fedParams = getTaxParameters(currentYear, taxState.filingStatus, 'federal', undefined, assumptions);
            if (fedParams) {
                const adjustedGross = Math.max(0, grossIncome - preTaxDed);
                const taxableIncome = Math.max(0, adjustedGross - fedParams.standardDeduction);
                const bracketInfo = getMarginalTaxRate(taxableIncome, fedParams);

                if (bracketInfo.rate > retirementRate && bracketInfo.headroom < limit && bracketInfo.headroom > 0) {
                    // Pre-tax to fill current bracket (income above retirement rate), Roth for rest
                    const preTaxAmount = Math.min(bracketInfo.headroom, limit);
                    const rothAmount = limit - preTaxAmount;
                    const currentBracketPct = (bracketInfo.rate * 100).toFixed(0);
                    const nextBracketRate = fedParams.brackets.find(b => b.rate > bracketInfo.rate);
                    const nextPct = nextBracketRate ? (nextBracketRate.rate * 100).toFixed(0) : '?';
                    optimalSplit = {
                        preTax: preTaxAmount,
                        roth: rothAmount,
                        explanation: `Pre-tax fills the ${currentBracketPct}% bracket (saving at ${currentBracketPct}% now, paying ~${(retirementRate * 100).toFixed(0)}% later). Roth avoids the ${nextPct}% bracket savings since you'd pay similar rates in retirement.`
                    };
                } else if (bracketInfo.rate <= retirementRate) {
                    optimalSplit = {
                        preTax: 0,
                        roth: limit,
                        explanation: `Your current bracket (${(bracketInfo.rate * 100).toFixed(0)}%) is at or below your retirement rate (${(retirementRate * 100).toFixed(0)}%). All Roth is optimal — you'd pay the same or more tax later on pre-tax dollars.`
                    };
                }
            }

            return {
                jobName: income.name,
                currentPreTax: effective.preTax,
                currentRoth: effective.roth,
                limit,
                currentMarginalRate,
                retirementRate,
                yearsToRetirement,
                ror,
                preTaxPath: {
                    futureValue: preTaxFutureValue,
                    taxAtWithdrawal: preTaxTaxAtWithdrawal,
                    afterTaxValue: preTaxAfterTax,
                    reinvestedSavings,
                    total: preTaxTotal
                },
                rothPath: {
                    futureValue: rothFutureValue,
                    total: rothTotal
                },
                winner,
                advantage,
                breakEvenRate: Math.max(0, Math.min(1, breakEvenRate)),
                optimalSplit
            };
        });
    }, [simulation, incomes, taxState, assumptions, currentYear, currentAge, retirementAge, ror, retirementEffectiveRate]);

    if (simulation.length === 0) {
        return <div className="text-content-muted text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Section 1: Production Roth-vs-Pre-Tax verdict */}
            <Panel className="rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-1">Contribution Recommendation</h3>
                <p className="text-content-muted text-sm mb-4">
                    Live output of <code className="text-content-default">analyzeRothPreTaxAllocation</code> — the same diagnostic the Tax Optimization tab renders. Compares today's marginal rate to the marginal rate when Traditional dollars come back out (first RMD year; median retirement if there are no RMD years). Fed + state, FICA excluded.
                </p>
                {allocation ? (
                    <RothPreTaxAllocationDebug allocation={allocation} />
                ) : (
                    <p className="text-content-muted">No current 401(k) employee contributions — this diagnostic doesn't apply.</p>
                )}
            </Panel>

            {/* Section 2: Tax Rate Timeline */}
            <TaxRateTimeline timelineData={timelineData} />

            {/* Section 3: Bracket Headroom */}
            <BracketHeadroomAnalysis
                headroomData={headroomData}
                targetRate={targetRate}
                setTargetRate={setTargetRate}
            />

            {/* Section 4: Conversion Windows */}
            <ConversionWindowsAnalysis
                windows={conversionWindowData.windows}
                windowSummary={conversionWindowData.summary}
            />

            {/* Section 5: Roth vs Pre-Tax Comparison */}
            <RothVsPreTaxComparison comparisons={contributionComparisons} />
        </div>
    );
}

// ============================================================================
// QR CODE DEBUG TAB
// ============================================================================
function QRCodeDebugTab() {
    const { handleGlobalImport } = useFileManager();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [decodedData, setDecodedData] = useState<{
        accounts: number;
        incomes: number;
        expenses: number;
        rawSize: number;
        compressedSize: number;
    } | null>(null);
    const [rawJson, setRawJson] = useState('');

    const [debugInfo, setDebugInfo] = useState<string>('');
    const [previewUrl, setPreviewUrl] = useState<string>('');

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus('loading');
        setErrorMessage('');
        setDecodedData(null);
        setRawJson('');
        setDebugInfo('');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl('');

        try {
            // Load the image
            const img = new Image();
            const imageUrl = URL.createObjectURL(file);
            setPreviewUrl(imageUrl);

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = imageUrl;
            });

            // Draw to canvas to get image data
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get canvas context');

            // Fill with white background first (in case of transparency)
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            setDebugInfo(`Image: ${img.width}x${img.height}, File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

            // Try decoding at original size first
            let qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'attemptBoth',
            });

            // If that fails and image is large, try downscaling for better detection
            if (!qrCode && img.width > 500) {
                const scaledCanvas = document.createElement('canvas');
                const scale = 500 / img.width;
                scaledCanvas.width = Math.floor(img.width * scale);
                scaledCanvas.height = Math.floor(img.height * scale);
                const scaledCtx = scaledCanvas.getContext('2d');
                if (scaledCtx) {
                    scaledCtx.fillStyle = 'white';
                    scaledCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
                    scaledCtx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
                    const scaledImageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
                    qrCode = jsQR(scaledImageData.data, scaledImageData.width, scaledImageData.height, {
                        inversionAttempts: 'attemptBoth',
                    });
                    if (qrCode) {
                        setDebugInfo(prev => prev + ' (decoded at scaled size)');
                    }
                }
            }

            if (!qrCode) {
                throw new Error(`No QR code found in image (${img.width}x${img.height})`);
            }

            const compressedData = qrCode.data;
            const compressedSize = compressedData.length;

            // Decompress
            let data = decompressData(compressedData);

            // Expand compact format if needed
            if (isCompactFormat(data)) {
                data = expandCompactBackup(data);
            }

            // Validate
            if (!validatePayload(data)) {
                throw new Error('Invalid backup format');
            }

            const json = JSON.stringify(data);
            setRawJson(json);
            setDecodedData({
                accounts: (data as { accounts: unknown[] }).accounts.length,
                incomes: (data as { incomes: unknown[] }).incomes.length,
                expenses: (data as { expenses: unknown[] }).expenses.length,
                rawSize: json.length,
                compressedSize,
            });
            setStatus('success');
        } catch (err) {
            setStatus('error');
            setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
        }

        // Reset input
        e.target.value = '';
    };

    const handleImport = () => {
        if (rawJson) {
            // Just call import - same as regular JSON file import
            // Let the app handle simulation refresh automatically
            handleGlobalImport(rawJson);

            setStatus('idle');
            setDecodedData(null);
            setRawJson('');
        }
    };

    const handleReset = () => {
        setStatus('idle');
        setErrorMessage('');
        setDecodedData(null);
        setRawJson('');
    };

    return (
        <div className="space-y-6">
            <Panel padding="lg" className="rounded-lg">
                <h3 className="text-xl font-bold text-white mb-4">QR Code Image Decoder</h3>
                <p className="text-content-muted mb-4">
                    Upload a QR code image exported from the app to decode and import the data.
                </p>

                {/* File Input */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                {status === 'idle' && (
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-6 py-3 bg-cat-fuchsia-solid hover:bg-cat-fuchsia-soft text-white rounded-lg font-medium transition-colors"
                    >
                        Select QR Code Image
                    </button>
                )}

                {status === 'loading' && (
                    <div className="flex items-center gap-3 text-content-muted">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Decoding QR code...
                    </div>
                )}

                {status === 'error' && (
                    <div className="space-y-4">
                        <div className="bg-negative-tint/20 border border-negative-strong rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-negative shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h4 className="text-negative font-semibold">Decode Failed</h4>
                                    <p className="text-negative/80 text-sm mt-1">{errorMessage}</p>
                                    {debugInfo && <p className="text-content-subtle text-xs mt-2">{debugInfo}</p>}
                                </div>
                            </div>
                            <Button
                                onClick={handleReset}
                                variant="secondary" className="mt-4"
                            >
                                Try Again
                            </Button>
                        </div>
                        {previewUrl && (
                            <div className="bg-surface-overlay rounded-lg p-4">
                                <p className="text-content-muted text-sm mb-2">Uploaded image:</p>
                                <img src={previewUrl} alt="Uploaded QR" className="max-w-75 mx-auto border border-border-default rounded" />
                            </div>
                        )}
                    </div>
                )}

                {status === 'success' && decodedData && (
                    <div className="space-y-4">
                        <div className="bg-positive-tint/20 border border-positive-strong rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-positive shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <div>
                                    <h4 className="text-positive font-semibold">QR Code Decoded!</h4>
                                    <ul className="text-content-default text-sm mt-2 space-y-1">
                                        <li>• {decodedData.accounts} account{decodedData.accounts !== 1 ? 's' : ''}</li>
                                        <li>• {decodedData.incomes} income source{decodedData.incomes !== 1 ? 's' : ''}</li>
                                        <li>• {decodedData.expenses} expense{decodedData.expenses !== 1 ? 's' : ''}</li>
                                    </ul>
                                    <p className="text-content-subtle text-xs mt-2">
                                        Compressed: {(decodedData.compressedSize / 1024).toFixed(2)} KB →
                                        Raw: {(decodedData.rawSize / 1024).toFixed(2)} KB
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <Button
                                onClick={handleReset}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleImport}
                                variant="positive"
                            >
                                Import Data
                            </Button>
                        </div>
                    </div>
                )}
            </Panel>

            {/* Raw JSON Preview (collapsed by default) */}
            {rawJson && (
                <details className="bg-surface-raised rounded-lg border border-border-subtle">
                    <summary className="p-4 cursor-pointer text-content-muted hover:text-white">
                        View Raw JSON ({(rawJson.length / 1024).toFixed(2)} KB)
                    </summary>
                    <pre className="p-4 pt-0 text-xs text-content-subtle overflow-auto max-h-96">
                        {JSON.stringify(JSON.parse(rawJson), null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}

// ============================================================================
// RATIOS DEBUG TAB
// ============================================================================
function RatiosDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const [selectedYearIdx, setSelectedYearIdx] = useState(0);

    if (simulation.length === 0) return <div className="text-content-muted p-4">No simulation data available.</div>;

    const simYear = simulation[selectedYearIdx];
    const { accounts, cashflow } = simYear;

    const savedAccounts = accounts.filter((acc): acc is SavedAccount => acc instanceof SavedAccount);
    const investedAccounts = accounts.filter((acc): acc is InvestedAccount => acc instanceof InvestedAccount);
    const debtAccounts = accounts.filter((acc): acc is DebtAccount | DeficitDebtAccount =>
        acc instanceof DebtAccount || acc instanceof DeficitDebtAccount
    );
    const propertyAccounts = accounts.filter((acc): acc is PropertyAccount => acc instanceof PropertyAccount);

    const totalLiquid = savedAccounts.reduce((sum, acc) => sum + acc.amount, 0);
    const totalInvested = investedAccounts.reduce((sum, acc) => sum + acc.amount, 0);
    const totalDebt = debtAccounts.reduce((sum, acc) => sum + acc.amount, 0);
    const totalProperty = propertyAccounts.reduce((sum, acc) => sum + acc.amount, 0);
    const totalAssets = totalLiquid + totalInvested + totalProperty;
    const netWorth = totalAssets - totalDebt;

    const taxesAndDeductions = (simYear.taxDetails.fed || 0) +
        (simYear.taxDetails.state || 0) +
        (simYear.taxDetails.fica || 0) +
        (simYear.taxDetails.preTax || 0) +
        (simYear.taxDetails.insurance || 0) +
        (simYear.taxDetails.postTax || 0) +
        (simYear.taxDetails.capitalGains || 0);
    const livingExpenses = Math.max(0, cashflow.totalExpense - taxesAndDeductions);
    const monthlyLivingExpenses = livingExpenses / 12;
    const emergencyMonths = monthlyLivingExpenses > 0 ? totalLiquid / monthlyLivingExpenses : 0;

    return (
        <div className="space-y-6">
            {/* Year selector */}
            <Panel>
                <div className="flex items-center gap-4 mb-2">
                    <h3 className="text-lg font-bold text-white">Year: {simYear.year}</h3>
                    <span className="text-sm text-content-muted">({selectedYearIdx + 1} of {simulation.length})</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={simulation.length - 1}
                    value={selectedYearIdx}
                    onChange={(e) => setSelectedYearIdx(parseInt(e.target.value))}
                    className="w-full"
                />
            </Panel>

            {/* Accounts Breakdown */}
            <div className="space-y-2">
                <h4 className="text-content-muted font-medium">Accounts by Type</h4>
                <div className="bg-positive-tint/20 border border-positive-strong/30 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-positive font-medium">Savings (Liquid)</span>
                        <span className="text-positive font-bold">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
                    </div>
                    {savedAccounts.map((acc) => (
                        <div key={acc.id} className="flex justify-between text-xs text-content-default">
                            <span>• {acc.name}</span>
                            <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                        </div>
                    ))}
                </div>
                <div className="bg-surface-overlay/50 border border-border-default rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-content-muted font-medium">Invested (Not Liquid)</span>
                        <span className="text-content-muted">{formatCompactCurrency(totalInvested, { forceExact })}</span>
                    </div>
                    {investedAccounts.map((acc) => (
                        <div key={acc.id} className="flex justify-between text-xs text-content-muted">
                            <span>• {acc.name} ({acc.taxType})</span>
                            <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                        </div>
                    ))}
                </div>
                {propertyAccounts.length > 0 && (
                    <div className="bg-surface-overlay/50 border border-border-default rounded-lg p-3">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-content-muted font-medium">Property (Not Liquid)</span>
                            <span className="text-content-muted">{formatCompactCurrency(totalProperty, { forceExact })}</span>
                        </div>
                        {propertyAccounts.map((acc) => (
                            <div key={acc.id} className="flex justify-between text-xs text-content-muted">
                                <span>• {acc.name}</span>
                                <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                            </div>
                        ))}
                    </div>
                )}
                {debtAccounts.length > 0 && (
                    <div className="bg-negative-tint/20 border border-negative-strong/30 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-negative font-medium">Debt</span>
                            <span className="text-negative">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
                        </div>
                        {debtAccounts.map((acc) => (
                            <div key={acc.id} className="flex justify-between text-xs text-content-default">
                                <span>• {acc.name}</span>
                                <span>-{formatCompactCurrency(acc.amount, { forceExact })}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Emergency Fund Calculation */}
            <div className="bg-info-tint/20 border border-info-strong/30 rounded-lg p-3">
                <h4 className="text-info font-medium mb-2">Emergency Fund Calculation</h4>
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                        <span className="text-content-muted">Liquid Assets (Savings only):</span>
                        <span className="text-white">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
                    </div>
                    <div className="border-t border-info-strong/20 my-2"></div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Total Expenses:</span>
                        <span className="text-white">{formatCompactCurrency(cashflow.totalExpense, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                        <span className="pl-2">- Federal Tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.fed || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                        <span className="pl-2">- State Tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.state || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                        <span className="pl-2">- FICA:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.fica || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                        <span className="pl-2">- 401k/Pre-tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.preTax || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-content-muted">
                        <span className="pl-2">- Insurance:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.insurance || 0, { forceExact })}</span>
                    </div>
                    {(simYear.taxDetails.postTax || 0) > 0 && (
                        <div className="flex justify-between text-content-muted">
                            <span className="pl-2">- Post-tax:</span>
                            <span>-{formatCompactCurrency(simYear.taxDetails.postTax || 0, { forceExact })}</span>
                        </div>
                    )}
                    <div className="flex justify-between border-t border-info-strong/30 pt-1">
                        <span className="text-content-default">= Living Expenses:</span>
                        <span className="text-white font-medium">{formatCompactCurrency(livingExpenses, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Monthly Living Expenses:</span>
                        <span className="text-white">{formatCompactCurrency(monthlyLivingExpenses, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between border-t border-info-strong/30 pt-1 mt-1">
                        <span className="text-info font-medium">Emergency Fund Months:</span>
                        <span className="text-info font-bold">
                            {formatCompactCurrency(totalLiquid, { forceExact })} / {formatCompactCurrency(monthlyLivingExpenses, { forceExact })} = {emergencyMonths.toFixed(1)} mo
                        </span>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="bg-surface-overlay rounded-lg p-3">
                <h4 className="text-content-default font-medium mb-2">Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                        <span className="text-content-muted">Total Assets:</span>
                        <span className="text-white">{formatCompactCurrency(totalAssets, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Total Debt:</span>
                        <span className="text-negative">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Net Worth:</span>
                        <span className="text-positive">{formatCompactCurrency(netWorth, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-content-muted">Total Income:</span>
                        <span className="text-white">{formatCompactCurrency(cashflow.totalIncome, { forceExact })}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// WITHDRAWAL DEBUG TAB
// ============================================================================
function WithdrawalDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const [yearFilter, setYearFilter] = useState<string>('Retirement Only');

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const isGKStrategy = assumptions.investments.withdrawalStrategy === 'Guyton Klinger';

    const filteredSimulation = useMemo(() => {
        if (simulation.length === 0) return [];
        if (yearFilter === 'Retirement Only') {
            return simulation.filter((_, idx) => startAge + idx >= retirementAge);
        }
        return simulation;
    }, [simulation, yearFilter, startAge, retirementAge]);

    if (simulation.length === 0) return <div className="text-content-muted p-4">No simulation data available. Run the simulation first.</div>;

    // Compute lifetime withdrawal totals by account.
    // withdrawalDetail is keyed by account ID (#142), so the accumulator is keyed
    // by id too — two accounts that share a display name stay tracked separately.
    const lifetimeWithdrawals: Record<string, { name: string; total: number; drainedYear: number | null }> = {};
    simulation.forEach((simYear, idx) => {
        const age = startAge + idx;
        const detail = simYear.cashflow.withdrawalDetail || {};
        for (const [accId, amount] of Object.entries(detail)) {
            const acc = simYear.accounts.find(a => a.id === accId);
            if (!lifetimeWithdrawals[accId]) {
                lifetimeWithdrawals[accId] = { name: acc?.name ?? accId, total: 0, drainedYear: null };
            }
            lifetimeWithdrawals[accId].total += amount;
            // Check if account hit zero
            if (acc && acc.amount <= 0 && amount > 0 && lifetimeWithdrawals[accId].drainedYear === null) {
                lifetimeWithdrawals[accId].drainedYear = simYear.year;
            }
        }
        // Also detect zero balances even without withdrawal in that year
        if (age >= retirementAge) {
            simYear.accounts.forEach(acc => {
                if (lifetimeWithdrawals[acc.id] && acc.amount <= 0 && lifetimeWithdrawals[acc.id].drainedYear === null && lifetimeWithdrawals[acc.id].total > 0) {
                    lifetimeWithdrawals[acc.id].drainedYear = simYear.year;
                }
            });
        }
    });

    // Detect early withdrawal penalties (withdrawals from tax-advantaged before 59.5)
    // withdrawalDetail is keyed by account ID (#142); resolve id -> account.
    const penaltyYears: Array<{ year: number; age: number; accountName: string; amount: number; penalty: number }> = [];
    simulation.forEach((simYear, idx) => {
        const age = startAge + idx;
        if (age >= 60) return; // 59.5 check - use 60 as conservative boundary
        const detail = simYear.cashflow.withdrawalDetail || {};
        for (const [accId, amount] of Object.entries(detail)) {
            if (amount <= 0) continue;
            const acc = simYear.accounts.find(a => a.id === accId);
            if (acc && acc instanceof InvestedAccount) {
                const taxAdvantaged = ['Traditional 401k', 'Traditional IRA', 'Roth 401k', 'Roth IRA'];
                if (taxAdvantaged.includes(acc.taxType)) {
                    penaltyYears.push({ year: simYear.year, age, accountName: acc.name, amount, penalty: amount * 0.1 });
                }
            }
        }
    });

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Panel className="flex items-center gap-4">
                <DropdownInput label="Show Years" value={yearFilter} onChange={setYearFilter} options={['All Years', 'Retirement Only']} />
            </Panel>

            {/* Section 1: Withdrawal Order */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Withdrawal Order</h3>
                <p className="text-sm text-content-muted mb-3">
                    Strategy: <span className="text-positive">{assumptions.investments.withdrawalStrategy}</span> at {assumptions.investments.withdrawalRate}% |
                    Configured order: {assumptions.withdrawalStrategy.map(b => b.name).join(' → ') || 'None configured'}
                </p>

                {/* Lifetime summary */}
                {Object.keys(lifetimeWithdrawals).length > 0 && (
                    <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {Object.entries(lifetimeWithdrawals).map(([id, data]) => (
                            <div key={id} className={`rounded-lg p-2 border ${data.drainedYear ? 'border-negative-strong/50 bg-negative-tint/10' : 'border-border-default bg-surface-overlay/50'}`}>
                                <div className="text-xs text-content-muted">{data.name}</div>
                                <div className="text-sm font-bold text-white">{toCurrencyShort(data.total)}</div>
                                {data.drainedYear && <div className="text-xs text-negative">Drained in {data.drainedYear}</div>}
                            </div>
                        ))}
                    </div>
                )}

                {/* Year-by-year table */}
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">Total</th>
                                {assumptions.withdrawalStrategy.map(b => (
                                    <th key={b.id} className="text-right p-2">{b.name}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSimulation.map((simYear, idx) => {
                                const age = yearFilter === 'Retirement Only' ? retirementAge + idx : startAge + idx;
                                const detail = simYear.cashflow.withdrawalDetail || {};
                                const total = Object.values(detail).reduce((s, v) => s + v, 0);
                                if (total === 0) return null;
                                return (
                                    <tr key={simYear.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-content-default">{simYear.year}</td>
                                        <td className="p-2 text-content-muted">{age}</td>
                                        <td className="p-2 text-right text-white font-medium">{toCurrencyShort(total)}</td>
                                        {assumptions.withdrawalStrategy.map(b => {
                                            const acc = simYear.accounts.find(a => a.id === b.accountId);
                                            // withdrawalDetail is keyed by account id (#142).
                                            const amt = detail[b.accountId] || 0;
                                            const drained = acc && acc.amount <= 0;
                                            return (
                                                <td key={b.id} className={`p-2 text-right ${drained ? 'text-negative' : amt > 0 ? 'text-positive' : 'text-content-faint'}`}>
                                                    {amt > 0 ? toCurrencyShort(amt) : '—'}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 2: Early Withdrawal Penalties */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Early Withdrawal Penalties</h3>
                {penaltyYears.length === 0 ? (
                    <div className="bg-positive-tint/20 border border-positive-strong/50 rounded-lg p-3 text-positive">
                        No early withdrawal penalties detected. All tax-advantaged withdrawals occur after age 59.5.
                    </div>
                ) : (
                    <>
                        <div className="bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 mb-3 text-warning-bright">
                            {penaltyYears.length} early withdrawal(s) detected before age 59.5. Total penalties: {toCurrency(penaltyYears.reduce((s, p) => s + p.penalty, 0))}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-content-muted border-b border-border-default">
                                        <th className="text-left p-2">Year</th>
                                        <th className="text-left p-2">Age</th>
                                        <th className="text-left p-2">Account</th>
                                        <th className="text-right p-2">Withdrawal</th>
                                        <th className="text-right p-2">10% Penalty</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {penaltyYears.map((p, i) => (
                                        <tr key={i} className="border-b border-border-subtle">
                                            <td className="p-2 text-content-default">{p.year}</td>
                                            <td className="p-2 text-content-muted">{p.age}</td>
                                            <td className="p-2 text-white">{p.accountName}</td>
                                            <td className="p-2 text-right text-warning-bright">{toCurrency(p.amount)}</td>
                                            <td className="p-2 text-right text-negative">{toCurrency(p.penalty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </Panel>

            {/* Section 3: Guyton-Klinger Details */}
            {isGKStrategy && (
                <Panel>
                    <h3 className="text-lg font-bold text-white mb-3">Guyton-Klinger Guardrail Details</h3>
                    <p className="text-sm text-content-muted mb-3">
                        Target Rate: {assumptions.investments.withdrawalRate}% |
                        Upper Guardrail: {assumptions.investments.gkUpperGuardrail}x |
                        Lower Guardrail: {assumptions.investments.gkLowerGuardrail}x |
                        Adjustment: {assumptions.investments.gkAdjustmentPercent}%
                    </p>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-surface-raised">
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-right p-2">Withdrawal</th>
                                    <th className="text-right p-2">Target Rate</th>
                                    <th className="text-right p-2">Current Rate</th>
                                    <th className="text-center p-2">Trigger</th>
                                    <th className="text-right p-2">Adjustment</th>
                                    <th className="text-left p-2">Warning</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredSimulation.map((simYear) => {
                                    const sw = simYear.strategyWithdrawal;
                                    const sa = simYear.strategyAdjustment;
                                    if (!sw) return null;
                                    const triggerColor = sa?.guardrailTriggered === 'capital-preservation' ? 'text-negative'
                                        : sa?.guardrailTriggered === 'prosperity' ? 'text-info' : 'text-positive';
                                    return (
                                        <tr key={simYear.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                            <td className="p-2 text-content-default">{simYear.year}</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(sw.amount)}</td>
                                            <td className="p-2 text-right text-content-muted">{sw.targetWithdrawalRate.toFixed(2)}%</td>
                                            <td className="p-2 text-right text-content-default">{sw.currentWithdrawalRate.toFixed(2)}%</td>
                                            <td className={`p-2 text-center font-medium ${triggerColor}`}>
                                                {sa?.guardrailTriggered || 'none'}
                                            </td>
                                            <td className="p-2 text-right text-content-default">
                                                {sa?.actualAdjustment ? `${sa.actualAdjustment > 0 ? '+' : ''}${toCurrencyShort(sa.actualAdjustment)}` : '—'}
                                            </td>
                                            <td className="p-2 text-warning-bright text-xs">{sa?.warning || ''}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Panel>
            )}
        </div>
    );
}

// ============================================================================
// ACCOUNTS DEBUG TAB
// ============================================================================
function AccountsDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const [accountFilter, setAccountFilter] = useState<string>('All');

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const inflationRate = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0;

    if (simulation.length === 0) return <div className="text-content-muted p-4">No simulation data available. Run the simulation first.</div>;

    const investedAccounts = simulation[0].accounts.filter((a): a is InvestedAccount => a instanceof InvestedAccount);
    const accountOptions = ['All', ...investedAccounts.map(a => a.name)];

    // Section 1: Investment Returns
    const returnsData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const prevYear = idx > 0 ? simulation[idx - 1] : null;
            const age = startAge + idx;
            const year = simYear.year;
            const contributions = simYear.cashflow.bucketDetail || {};
            const withdrawals = simYear.cashflow.withdrawalDetail || {};

            const accountReturns: Record<string, { startBal: number; endBal: number; netContrib: number; growth: number; returnPct: number; realReturn: number }> = {};
            let totalStart = 0, totalEnd = 0, totalGrowth = 0;

            simYear.accounts.forEach(acc => {
                if (!(acc instanceof InvestedAccount)) return;
                if (accountFilter !== 'All' && acc.name !== accountFilter) return;
                const prevAcc = prevYear?.accounts.find(a => a.id === acc.id);
                const startBal = prevAcc?.amount || 0;
                const endBal = acc.amount;
                const contrib = contributions[acc.id] || 0;
                const withdrawal = withdrawals[acc.id] || 0; // withdrawalDetail keyed by id (#142)
                const netContrib = contrib - withdrawal;
                const growth = endBal - startBal - netContrib;
                const returnPct = startBal > 0 ? (growth / startBal) * 100 : 0;
                const realReturn = returnPct - (inflationRate * 100);
                accountReturns[acc.id] = { startBal, endBal, netContrib, growth, returnPct, realReturn };
                totalStart += startBal;
                totalEnd += endBal;
                totalGrowth += growth;
            });

            const portfolioReturn = totalStart > 0 ? (totalGrowth / totalStart) * 100 : 0;
            return { year, age, accountReturns, portfolioReturn, totalGrowth };
        });
    }, [simulation, startAge, accountFilter, inflationRate]);

    // Section 2: Contribution Limits
    const contributionData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const year = simYear.year;
            const isWorking = age < retirementAge;
            if (!isWorking) return null;

            const inflationAdjusted = assumptions.macro.inflationAdjusted;
            const limit401k = get401kLimit(year, age, inflationAdjusted);
            const limitHSA = getHSALimit(year, age, 'individual', inflationAdjusted);
            const limitIRA = getIRALimit(year, age, inflationAdjusted);

            // Sum 401k contributions from work incomes
            let actual401k = 0;
            let actualHSA = 0;
            simYear.incomes.forEach(inc => {
                if (inc instanceof WorkIncome) {
                    const effective = inc.getEffective401k(year, age);
                    actual401k += effective.preTax + effective.roth;
                    actualHSA += inc.hsaContribution || 0;
                }
            });

            return {
                year, age,
                limit401k, actual401k, util401k: limit401k > 0 ? (actual401k / limit401k) * 100 : 0,
                limitHSA, actualHSA, utilHSA: limitHSA > 0 ? (actualHSA / limitHSA) * 100 : 0,
                limitIRA,
                catchUp: age >= 50
            };
        }).filter(Boolean);
    }, [simulation, startAge, retirementAge, assumptions.macro.inflationAdjusted]);

    // Section 3: Employer Matching
    const matchingData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const prevYear = idx > 0 ? simulation[idx - 1] : null;
            const age = startAge + idx;
            const matchAccounts: Array<{ name: string; employerBal: number; vestedPct: number; unvested: number; matchContrib: number }> = [];

            simYear.accounts.forEach(acc => {
                if (!(acc instanceof InvestedAccount) || acc.employerBalance <= 0) return;
                const prevAcc = prevYear?.accounts.find(a => a.id === acc.id) as InvestedAccount | undefined;
                const tenure = acc.tenureYears || 0;
                const vestedPct = Math.min(1, tenure * acc.vestedPerYear);
                const unvested = acc.employerBalance * (1 - vestedPct);
                const prevEmployer = prevAcc?.employerBalance || 0;
                const ror = assumptions.investments.returnRates.ror / 100;
                const matchContrib = Math.max(0, acc.employerBalance - prevEmployer * (1 + ror));
                matchAccounts.push({ name: acc.name, employerBal: acc.employerBalance, vestedPct, unvested, matchContrib });
            });

            return { year: simYear.year, age, matchAccounts };
        }).filter(d => d.matchAccounts.length > 0);
    }, [simulation, startAge, assumptions.investments.returnRates.ror]);

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Panel className="flex items-center gap-4">
                <DropdownInput label="Account" value={accountFilter} onChange={setAccountFilter} options={accountOptions} />
            </Panel>

            {/* Section 1: Investment Returns */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Investment Returns</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">Growth</th>
                                <th className="text-right p-2">Nominal %</th>
                                <th className="text-right p-2">Real %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {returnsData.map(d => {
                                const realReturn = d.portfolioReturn - (inflationRate * 100);
                                const color = realReturn > 0 ? 'text-positive' : realReturn > -2 ? 'text-warning-bright' : 'text-negative';
                                return (
                                    <tr key={d.year} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-content-muted">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.totalGrowth)}</td>
                                        <td className="p-2 text-right text-content-default">{d.portfolioReturn.toFixed(1)}%</td>
                                        <td className={`p-2 text-right font-medium ${color}`}>{realReturn.toFixed(1)}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 2: Contribution Limits */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Contribution Limits</h3>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">401k Actual</th>
                                <th className="text-right p-2">401k Limit</th>
                                <th className="text-right p-2">401k %</th>
                                <th className="text-right p-2">HSA Actual</th>
                                <th className="text-right p-2">HSA Limit</th>
                                <th className="text-center p-2">Catch-up</th>
                            </tr>
                        </thead>
                        <tbody>
                            {contributionData.map(d => {
                                if (!d) return null;
                                const utilColor = d.util401k >= 95 ? 'text-positive' : d.util401k >= 50 ? 'text-warning-bright' : 'text-content-muted';
                                return (
                                    <tr key={d.year} className="border-b border-border-subtle">
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-content-muted">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.actual401k)}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(d.limit401k)}</td>
                                        <td className={`p-2 text-right font-medium ${utilColor}`}>{d.util401k.toFixed(0)}%</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.actualHSA)}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(d.limitHSA)}</td>
                                        <td className="p-2 text-center">{d.catchUp ? <span className="text-info text-xs">50+</span> : ''}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 3: Employer Matching */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Employer Matching & Vesting</h3>
                {matchingData.length === 0 ? (
                    <div className="text-content-muted">No employer match accounts found.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-surface-raised">
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-left p-2">Account</th>
                                    <th className="text-right p-2">Employer Bal</th>
                                    <th className="text-right p-2">Vested %</th>
                                    <th className="text-right p-2">Unvested</th>
                                    <th className="text-right p-2">Match Contrib</th>
                                </tr>
                            </thead>
                            <tbody>
                                {matchingData.map(d =>
                                    d.matchAccounts.map((ma, i) => (
                                        <tr key={`${d.year}-${i}`} className="border-b border-border-subtle">
                                            <td className="p-2 text-content-default">{d.year}</td>
                                            <td className="p-2 text-white">{ma.name}</td>
                                            <td className="p-2 text-right text-content-default">{toCurrencyShort(ma.employerBal)}</td>
                                            <td className={`p-2 text-right ${ma.vestedPct >= 1 ? 'text-positive' : 'text-warning-bright'}`}>
                                                {(ma.vestedPct * 100).toFixed(0)}%
                                            </td>
                                            <td className="p-2 text-right text-negative">{ma.unvested > 0 ? toCurrencyShort(ma.unvested) : '—'}</td>
                                            <td className="p-2 text-right text-positive">{ma.matchContrib > 0 ? toCurrencyShort(ma.matchContrib) : '—'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </div>
    );
}

// ============================================================================
// INCOME & EXPENSES DEBUG TAB
// ============================================================================
function IncomeExpensesDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const [showRealDollars, setShowRealDollars] = useState(false);

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);
    const inflationRate = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0;

    if (simulation.length === 0) return <div className="text-content-muted p-4">No simulation data available. Run the simulation first.</div>;

    // Section 1: Salary Projections
    const salaryData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const cumulativeInflation = Math.pow(1 + inflationRate, idx);
            const workIncomes = simYear.incomes.filter((inc): inc is WorkIncome => inc instanceof WorkIncome);
            return workIncomes.map(inc => {
                const nominalSalary = inc.amount;
                const realSalary = cumulativeInflation > 0 ? nominalSalary / cumulativeInflation : nominalSalary;
                const prevYear = idx > 0 ? simulation[idx - 1] : null;
                const prevInc = prevYear?.incomes.find(i => i.id === inc.id) as WorkIncome | undefined;
                const yoyGrowth = prevInc && prevInc.amount > 0 ? ((inc.amount - prevInc.amount) / prevInc.amount) * 100 : 0;
                const effective401k = inc.getEffective401k(simYear.year, age);
                const totalContrib = effective401k.preTax + effective401k.roth + (inc.hsaContribution || 0);
                const realContrib = cumulativeInflation > 0 ? totalContrib / cumulativeInflation : totalContrib;
                return {
                    year: simYear.year, age, name: inc.name,
                    nominalSalary, realSalary, yoyGrowth, totalContrib, realContrib,
                    totalComp: nominalSalary + totalContrib
                };
            });
        }).flat();
    }, [simulation, startAge, inflationRate]);

    // Section 2: Expense Breakdown
    const expenseData = useMemo(() => {
        const categoryTotals: Record<string, number[]> = {};
        let totalFixed = 0, totalDiscretionary = 0;

        simulation.forEach((simYear, idx) => {
            const cumulativeInflation = Math.pow(1 + inflationRate, idx);
            simYear.expenses.forEach(exp => {
                const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
                if (!categoryTotals[category]) categoryTotals[category] = new Array(simulation.length).fill(0);
                const annual = exp.getAnnualAmount(simYear.year);
                const value = showRealDollars && cumulativeInflation > 0 ? annual / cumulativeInflation : annual;
                categoryTotals[category][idx] += value;
                if (exp.isDiscretionary) totalDiscretionary += annual;
                else totalFixed += annual;
            });
        });

        const grandTotal = totalFixed + totalDiscretionary;
        return { categoryTotals, totalFixed, totalDiscretionary, fixedPct: grandTotal > 0 ? (totalFixed / grandTotal) * 100 : 0 };
    }, [simulation, inflationRate, showRealDollars]);

    // Find largest category
    const largestCategory = useMemo(() => {
        let max = 0, maxCat = '';
        for (const [cat, vals] of Object.entries(expenseData.categoryTotals)) {
            const total = vals.reduce((s, v) => s + v, 0);
            if (total > max) { max = total; maxCat = cat; }
        }
        return maxCat;
    }, [expenseData]);

    // Section 3: Healthcare Costs
    const healthcareData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const age = startAge + idx;
            const cumulativeInflation = Math.pow(1 + inflationRate, idx);
            const healthExpenses = simYear.expenses.filter((e): e is HealthcareExpense => e instanceof HealthcareExpense);
            const totalHealthcare = healthExpenses.reduce((s, e) => s + e.getAnnualAmount(simYear.year), 0);
            const realCost = cumulativeInflation > 0 ? totalHealthcare / cumulativeInflation : totalHealthcare;
            const totalIncome = simYear.cashflow.totalIncome;
            const pctOfIncome = totalIncome > 0 ? (totalHealthcare / totalIncome) * 100 : 0;
            return { year: simYear.year, age, totalHealthcare, realCost, pctOfIncome, isMedicare: age >= 65 };
        }).filter(d => d.totalHealthcare > 0);
    }, [simulation, startAge, inflationRate]);

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Panel className="flex items-center gap-4">
                <ToggleInput
                    label="Today's Dollars (inflation-adjusted)"
                    enabled={showRealDollars}
                    setEnabled={setShowRealDollars}
                />
            </Panel>

            {/* Section 1: Salary Projections */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Salary Projections</h3>
                {salaryData.length === 0 ? (
                    <div className="text-content-muted">No work income found.</div>
                ) : (
                    <>
                        <div className="mb-3 flex gap-4 text-sm">
                            <span className="text-content-muted">Total Lifetime Earnings: <span className="text-white font-bold">{toCurrencyShort(salaryData.reduce((s, d) => s + d.nominalSalary, 0))}</span></span>
                            <span className="text-content-muted">Avg Real Growth: <span className="text-positive">{salaryData.length > 1 ? (salaryData.reduce((s, d) => s + d.yoyGrowth, 0) / (salaryData.length - 1)).toFixed(1) : 0}%</span></span>
                        </div>
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-surface-raised">
                                    <tr className="text-content-muted border-b border-border-default">
                                        <th className="text-left p-2">Year</th>
                                        <th className="text-left p-2">Age</th>
                                        <th className="text-left p-2">Source</th>
                                        <th className="text-right p-2">Salary</th>
                                        <th className="text-right p-2">{showRealDollars ? 'Real' : 'Growth'}</th>
                                        <th className="text-right p-2">Contributions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {salaryData.map((d, i) => (
                                        <tr key={i} className="border-b border-border-subtle">
                                            <td className="p-2 text-content-default">{d.year}</td>
                                            <td className="p-2 text-content-muted">{d.age}</td>
                                            <td className="p-2 text-white">{d.name}</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(d.nominalSalary)}</td>
                                            <td className={`p-2 text-right ${d.yoyGrowth > 0 ? 'text-positive' : 'text-content-muted'}`}>
                                                {showRealDollars ? toCurrencyShort(d.realSalary) : `${d.yoyGrowth.toFixed(1)}%`}
                                            </td>
                                            <td className="p-2 text-right text-info">{toCurrencyShort(showRealDollars ? d.realContrib : d.totalContrib)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </Panel>

            {/* Section 2: Expense Breakdown */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Expense Breakdown</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-surface-overlay/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-content-muted">Fixed</div>
                        <div className="text-lg font-bold text-white">{expenseData.fixedPct.toFixed(0)}%</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-content-muted">Discretionary</div>
                        <div className="text-lg font-bold text-white">{(100 - expenseData.fixedPct).toFixed(0)}%</div>
                    </div>
                    <div className="bg-surface-overlay/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-content-muted">Largest Category</div>
                        <div className="text-lg font-bold text-positive">{largestCategory}</div>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Category</th>
                                {simulation.slice(0, Math.min(simulation.length, 10)).map((sy) => (
                                    <th key={sy.year} className="text-right p-2">{sy.year}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(expenseData.categoryTotals).map(([cat, vals]) => (
                                <tr key={cat} className="border-b border-border-subtle">
                                    <td className="p-2 text-white">{cat}</td>
                                    {vals.slice(0, 10).map((v, i) => (
                                        <td key={i} className="p-2 text-right text-content-default">{v > 0 ? toCurrencyShort(v) : '—'}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 3: Healthcare Costs */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Healthcare Costs</h3>
                {healthcareData.length === 0 ? (
                    <div className="text-content-muted">No healthcare expenses found.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-surface-raised">
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-left p-2">Age</th>
                                    <th className="text-right p-2">Annual Cost</th>
                                    <th className="text-right p-2">{showRealDollars ? 'Real Cost' : '% of Income'}</th>
                                    <th className="text-center p-2">Medicare</th>
                                </tr>
                            </thead>
                            <tbody>
                                {healthcareData.map(d => (
                                    <tr key={d.year} className={`border-b border-border-subtle ${d.isMedicare ? 'bg-info-tint/10' : ''}`}>
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-content-muted">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.totalHealthcare)}</td>
                                        <td className="p-2 text-right text-content-default">
                                            {showRealDollars ? toCurrencyShort(d.realCost) : `${d.pctOfIncome.toFixed(1)}%`}
                                        </td>
                                        <td className="p-2 text-center">{d.isMedicare ? <span className="text-info text-xs">65+</span> : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </div>
    );
}

// ============================================================================
// CASH FLOW DEBUG TAB
// ============================================================================
function CashFlowDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const [periodFilter, setPeriodFilter] = useState<string>('All Years');

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const inflationRate = assumptions.macro.inflationAdjusted ? assumptions.macro.inflationRate / 100 : 0;

    if (simulation.length === 0) return <div className="text-content-muted p-4">No simulation data available. Run the simulation first.</div>;

    const filteredSimulation = useMemo(() => {
        if (periodFilter === 'Accumulation') return simulation.filter((_, idx) => startAge + idx < retirementAge);
        if (periodFilter === 'Retirement') return simulation.filter((_, idx) => startAge + idx >= retirementAge);
        return simulation;
    }, [simulation, periodFilter, startAge, retirementAge]);

    // Section 1: Priority Waterfall
    const waterfallData = useMemo(() => {
        return filteredSimulation.map((simYear) => {
            const bucketDetail = simYear.cashflow.bucketDetail || {};
            const buckets = assumptions.priorities.map(bucket => {
                const allocated = bucketDetail[bucket.accountId || ''] || 0;
                return { name: bucket.name, capType: bucket.capType, capValue: bucket.capValue, allocated, hit: bucket.capType === 'MAX' && allocated > 0 };
            });
            const preBucketSurplus = simYear.cashflow.discretionary + simYear.cashflow.bucketAllocations;
            return { year: simYear.year, age: startAge + (simulation.indexOf(simYear)), buckets, preBucketSurplus };
        });
    }, [filteredSimulation, simulation, assumptions.priorities, startAge]);

    // Section 2: Net Worth Timeline
    const netWorthData = useMemo(() => {
        let peakNW = -Infinity, peakYear = 0;
        const data = simulation.map((simYear, idx) => {
            const age = startAge + idx;
            let assets = 0, liabilities = 0;
            simYear.accounts.forEach(acc => {
                if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount || acc instanceof RSUAccount || acc instanceof PropertyAccount) {
                    assets += acc.amount;
                } else if (acc instanceof DebtAccount) {
                    liabilities += acc.amount;
                }
            });
            const netWorth = assets - liabilities;
            if (netWorth > peakNW) { peakNW = netWorth; peakYear = simYear.year; }
            return { year: simYear.year, age, assets, liabilities, netWorth };
        });
        return { data, peakYear, peakNW };
    }, [simulation, startAge]);

    // Section 3: Cash Flow Summary
    const cashFlowSummary = useMemo(() => {
        return filteredSimulation.map((simYear) => {
            const totalIncome = simYear.cashflow.totalIncome;
            const totalExpense = simYear.cashflow.totalExpense;
            const taxes = (simYear.taxDetails.fed || 0) + (simYear.taxDetails.state || 0) +
                (simYear.taxDetails.fica || 0) + (simYear.taxDetails.capitalGains || 0);
            const livingExpenses = Math.max(0, totalExpense - taxes - (simYear.taxDetails.preTax || 0) - (simYear.taxDetails.insurance || 0) - (simYear.taxDetails.postTax || 0));
            const totalInvested = simYear.cashflow.totalInvested;
            const savingsRate = totalIncome > 0 ? (totalInvested / totalIncome) * 100 : 0;
            const age = startAge + simulation.indexOf(simYear);
            return { year: simYear.year, age, totalIncome, livingExpenses, taxes, totalInvested, savingsRate, isRetired: age >= retirementAge };
        });
    }, [filteredSimulation, simulation, startAge, retirementAge]);

    // Section 4: Inflation Impact
    const inflationData = useMemo(() => {
        return simulation.map((simYear, idx) => {
            const cumulativeInflation = Math.pow(1 + inflationRate, idx);
            const purchasingPower = cumulativeInflation > 0 ? 1 / cumulativeInflation : 1;
            const nominalIncome = simYear.cashflow.totalIncome;
            const realIncome = cumulativeInflation > 0 ? nominalIncome / cumulativeInflation : nominalIncome;
            return { year: simYear.year, age: startAge + idx, cumulativeInflation, purchasingPower, nominalIncome, realIncome };
        });
    }, [simulation, startAge, inflationRate]);

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Panel className="flex items-center gap-4">
                <DropdownInput label="Period" value={periodFilter} onChange={setPeriodFilter} options={['All Years', 'Accumulation', 'Retirement']} />
            </Panel>

            {/* Section 1: Priority Waterfall */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Priority Waterfall</h3>
                {assumptions.priorities.length === 0 ? (
                    <div className="text-content-muted">No priority buckets configured.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-surface-raised">
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-right p-2">Surplus</th>
                                    {assumptions.priorities.map(b => (
                                        <th key={b.id} className="text-right p-2">{b.name}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {waterfallData.map(d => (
                                    <tr key={d.year} className="border-b border-border-subtle">
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.preBucketSurplus)}</td>
                                        {d.buckets.map((b, i) => (
                                            <td key={i} className={`p-2 text-right ${b.allocated > 0 ? (b.hit ? 'text-warning-bright' : 'text-positive') : 'text-content-faint'}`}>
                                                {b.allocated > 0 ? toCurrencyShort(b.allocated) : '—'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            {/* Section 2: Net Worth Timeline */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Net Worth Timeline</h3>
                <div className="mb-3 text-sm text-content-muted">
                    Peak: <span className="text-positive font-bold">{toCurrencyShort(netWorthData.peakNW)}</span> in {netWorthData.peakYear}
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">Assets</th>
                                <th className="text-right p-2">Liabilities</th>
                                <th className="text-right p-2">Net Worth</th>
                                <th className="text-right p-2">YoY Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            {netWorthData.data.map((d, idx) => {
                                const prev = idx > 0 ? netWorthData.data[idx - 1] : null;
                                const change = prev ? d.netWorth - prev.netWorth : 0;
                                const changeColor = change > 0 ? 'text-positive' : change < 0 ? 'text-negative' : 'text-content-subtle';
                                return (
                                    <tr key={d.year} className={`border-b border-border-subtle ${d.age === retirementAge ? 'border-t-2 border-t-warning-solid' : ''}`}>
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-content-muted">{d.age}</td>
                                        <td className="p-2 text-right text-positive">{toCurrencyShort(d.assets)}</td>
                                        <td className="p-2 text-right text-negative">{d.liabilities > 0 ? toCurrencyShort(d.liabilities) : '—'}</td>
                                        <td className="p-2 text-right text-white font-medium">{toCurrencyShort(d.netWorth)}</td>
                                        <td className={`p-2 text-right ${changeColor}`}>
                                            {idx > 0 ? `${change >= 0 ? '+' : ''}${toCurrencyShort(change)}` : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 3: Cash Flow Summary */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Cash Flow Summary</h3>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">Income</th>
                                <th className="text-right p-2">Living Exp</th>
                                <th className="text-right p-2">Taxes</th>
                                <th className="text-right p-2">Invested</th>
                                <th className="text-right p-2">Savings Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cashFlowSummary.map(d => {
                                const srColor = d.savingsRate >= 20 ? 'text-positive' : d.savingsRate >= 10 ? 'text-warning-bright' : 'text-negative';
                                return (
                                    <tr key={d.year} className={`border-b border-border-subtle ${d.isRetired ? 'bg-info-tint/5' : ''}`}>
                                        <td className="p-2 text-content-default">{d.year}</td>
                                        <td className="p-2 text-content-muted">{d.age}</td>
                                        <td className="p-2 text-right text-positive">{toCurrencyShort(d.totalIncome)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.livingExpenses)}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(d.taxes)}</td>
                                        <td className="p-2 text-right text-info">{d.totalInvested > 0 ? toCurrencyShort(d.totalInvested) : '—'}</td>
                                        <td className={`p-2 text-right font-medium ${d.isRetired ? 'text-content-subtle' : srColor}`}>
                                            {d.isRetired ? 'N/A' : `${d.savingsRate.toFixed(0)}%`}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Section 4: Inflation Impact */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Inflation Impact</h3>
                <p className="text-sm text-content-muted mb-3">Rate: {(inflationRate * 100).toFixed(1)}% | Shows erosion of purchasing power over time.</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-raised">
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">$1 Today =</th>
                                <th className="text-right p-2">Nominal Income</th>
                                <th className="text-right p-2">Real Income</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inflationData.filter((_, i) => i % 5 === 0 || i === inflationData.length - 1).map(d => (
                                <tr key={d.year} className="border-b border-border-subtle">
                                    <td className="p-2 text-content-default">{d.year}</td>
                                    <td className="p-2 text-content-muted">{d.age}</td>
                                    <td className="p-2 text-right text-warning-bright">${(d.purchasingPower * 100).toFixed(0)}¢</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(d.nominalIncome)}</td>
                                    <td className="p-2 text-right text-positive">{toCurrencyShort(d.realIncome)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>
        </div>
    );
}

// ============================================================================
// VALIDATION DEBUG TAB
// ============================================================================
// ============================================================================
// EOY PROJECTION DEBUG TAB
// ============================================================================
// Explains how the "Projected Dec 20XX" point on the Overview chart is built.
// Mirrors the logic in useSimulation.tsx STEP 1.5 / 1.75: partial-year payroll
// contributions are added to investment accounts, and Year 0 cashflow/taxes
// are scaled by the remaining fraction of the calendar year.
// ============================================================================
function EOYProjectionDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { months: budgetMonths } = useContext(BudgetContext);

    const today = new Date();
    const currentMonth = today.getMonth();        // 0=Jan, 11=Dec
    const currentYear = today.getFullYear();
    const startYear = assumptions.demographics.priorYearMode ? currentYear - 1 : currentYear;
    const startAge = startYear - getBirthYear(assumptions.milestones);
    const remainingFraction = (11 - currentMonth) / 12;
    const priorYearMode = assumptions.demographics.priorYearMode;
    const eoySkipped = priorYearMode || remainingFraction <= 0;

    // Compute budget-driven EOY contribution additions (same call the live sim uses)
    const budgetProjection = useMemo(() => {
        const remainderGoals = (simulation.find(s => s.year === startYear + 1)?.cashflow.bucketDetail
            ?? simulation.find(s => s.year === startYear)?.cashflow.bucketDetail
            ?? {});
        return computeEOYBudgetContributions(
            assumptions.priorities, accounts, incomes, expenses, budgetMonths,
            assumptions, taxState, startYear, today, remainderGoals,
        );
    }, [assumptions, accounts, incomes, expenses, budgetMonths, taxState, startYear, today, simulation]);

    // Locate Year 0 and the synthetic EOY row in the live simulation
    const yearZero = simulation.find(y => !y.isEndOfYearProjection && y.year === startYear);
    const eoyYear = simulation.find(y => y.isEndOfYearProjection);

    // Per-WorkIncome partial-year payroll breakdown (mirrors useSimulation STEP 1.5)
    const payrollRows = useMemo(() => {
        if (eoySkipped) return [];
        const rows: Array<{
            id: string;
            name: string;
            matchAccountId: string;
            matchAccountName: string;
            preTax401k: number;
            roth401k: number;
            employerMatchAnnual: number;
            activeMultiplier: number;
            effectiveFraction: number;
            userContrib: number;
            employerContrib: number;
        }> = [];
        incomes.forEach(inc => {
            if (!(inc instanceof WorkIncome) || !inc.matchAccountId) return;
            const activeMultiplier = getIncomeActiveMultiplier(inc, startYear);
            const effectiveFraction = Math.min(remainingFraction, activeMultiplier);
            if (effectiveFraction <= 0) return;
            const effective = inc.autoMax401k !== 'custom'
                ? inc.getEffective401k(startYear, startAge)
                : { preTax: inc.preTax401k, roth: inc.roth401k };
            const employerMatchAnnual = inc.getEffectiveAnnualEmployerMatch();
            const userContrib = (effective.preTax + effective.roth) * effectiveFraction;
            const employerContrib = employerMatchAnnual * effectiveFraction;
            const matchAcc = accounts.find(a => a.id === inc.matchAccountId);
            rows.push({
                id: inc.id,
                name: inc.name,
                matchAccountId: inc.matchAccountId,
                matchAccountName: matchAcc?.name ?? '(unknown)',
                preTax401k: effective.preTax,
                roth401k: effective.roth,
                employerMatchAnnual,
                activeMultiplier,
                effectiveFraction,
                userContrib,
                employerContrib,
            });
        });
        return rows;
    }, [incomes, accounts, startYear, startAge, remainingFraction, eoySkipped]);

    // Sum partial contributions per InvestedAccount id
    const partialPerAccount = useMemo(() => {
        const out: Record<string, { user: number; employer: number }> = {};
        payrollRows.forEach(r => {
            const cur = out[r.matchAccountId] || { user: 0, employer: 0 };
            out[r.matchAccountId] = { user: cur.user + r.userContrib, employer: cur.employer + r.employerContrib };
        });
        return out;
    }, [payrollRows]);

    // Per-account: today's balance, partial contribution, budget contribution, debt reduction, projected EOY balance
    const accountRows = useMemo(() => {
        return accounts.map(acc => {
            const partial = (acc instanceof InvestedAccount) ? partialPerAccount[acc.id] : undefined;
            const userAdd = partial?.user ?? 0;
            const employerAdd = partial?.employer ?? 0;
            const budgetAdd = budgetProjection.additions[acc.id] || 0;
            const debtReduce = budgetProjection.debtReductions[acc.id] || 0;
            const projected = acc.amount + userAdd + employerAdd + budgetAdd - debtReduce;
            let category: string;
            if (acc instanceof InvestedAccount) category = 'Invested';
            else if (acc instanceof SavedAccount) category = 'Saved';
            else if (acc instanceof PropertyAccount) category = 'Property';
            else if (acc instanceof DebtAccount) category = 'Debt';
            else if (acc instanceof DeficitDebtAccount) category = 'Debt';
            else category = 'Other';
            return {
                id: acc.id,
                name: acc.name,
                category,
                today: acc.amount,
                userAdd,
                employerAdd,
                budgetAdd,
                debtReduce,
                projected,
            };
        });
    }, [accounts, partialPerAccount, budgetProjection]);

    // Category roll-up matching what Overview chart shows
    const categoryTotals = useMemo(() => {
        const cats = { Invested: { today: 0, eoy: 0 }, Saved: { today: 0, eoy: 0 }, Property: { today: 0, eoy: 0 }, Debt: { today: 0, eoy: 0 } };
        accountRows.forEach(r => {
            if (r.category === 'Invested') { cats.Invested.today += r.today; cats.Invested.eoy += r.projected; }
            else if (r.category === 'Saved') { cats.Saved.today += r.today; cats.Saved.eoy += r.projected; }
            else if (r.category === 'Property') { cats.Property.today += r.today; cats.Property.eoy += r.projected; }
            else if (r.category === 'Debt') { cats.Debt.today += r.today; cats.Debt.eoy += r.projected; }
        });
        return cats;
    }, [accountRows]);

    // Mortgage balances live on MortgageExpense, not DebtAccount. For EOY,
    // each mortgage's projected balance = current loan_balance − projected
    // principal pay-down for the rest of the year (from budgetProjection).
    const mortgageDebt = useMemo(() => {
        let today = 0;
        let eoy = 0;
        const items: Array<{ name: string; today: number; eoy: number }> = [];
        (yearZero?.expenses ?? []).forEach(exp => {
            if (exp instanceof MortgageExpense) {
                const reduction = budgetProjection.mortgageReductions[exp.id] || 0;
                const eoyBal = Math.max(0, exp.loan_balance - reduction);
                today += exp.loan_balance;
                eoy += eoyBal;
                items.push({ name: exp.name, today: exp.loan_balance, eoy: eoyBal });
            }
        });
        return { today, eoy, items };
    }, [yearZero, budgetProjection]);

    const todayNetWorth = categoryTotals.Invested.today + categoryTotals.Saved.today + categoryTotals.Property.today - categoryTotals.Debt.today - mortgageDebt.today;
    const eoyNetWorth = categoryTotals.Invested.eoy + categoryTotals.Saved.eoy + categoryTotals.Property.eoy - categoryTotals.Debt.eoy - mortgageDebt.eoy;

    // Cashflow / tax scaling for the synthetic EOY row
    const cashflowRows = yearZero && eoyYear ? [
        { label: 'Gross income', y0: yearZero.cashflow.totalIncome, eoy: eoyYear.cashflow.totalIncome },
        { label: 'Total expense (incl. taxes)', y0: yearZero.cashflow.totalExpense, eoy: eoyYear.cashflow.totalExpense },
        { label: 'Living expenses', y0: yearZero.cashflow.livingExpenses, eoy: eoyYear.cashflow.livingExpenses },
        { label: 'Discretionary', y0: yearZero.cashflow.discretionary, eoy: eoyYear.cashflow.discretionary },
        { label: 'Invested (user payroll)', y0: yearZero.cashflow.investedUser, eoy: eoyYear.cashflow.investedUser },
        { label: 'Invested (employer match)', y0: yearZero.cashflow.investedMatch, eoy: eoyYear.cashflow.investedMatch },
    ] : [];
    const taxRows = yearZero && eoyYear ? [
        { label: 'Federal tax', y0: yearZero.taxDetails.fed, eoy: eoyYear.taxDetails.fed },
        { label: 'State tax', y0: yearZero.taxDetails.state, eoy: eoyYear.taxDetails.state },
        { label: 'FICA', y0: yearZero.taxDetails.fica, eoy: eoyYear.taxDetails.fica },
    ] : [];

    return (
        <div className="space-y-6">
            {/* Overview / explainer */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">What is "Projected Dec {startYear}"?</h3>
                <div className="text-sm text-content-default space-y-2 leading-relaxed">
                    <p>
                        The Overview chart shows two points for the current calendar year:
                        <span className="text-info"> "Today"</span> (your actual balances right now)
                        and <span className="text-positive">"Projected Dec {startYear}"</span> (a synthetic
                        end-of-year snapshot). This avoids the visual "big jump" between today's balances
                        and the first full future year.
                    </p>
                    <p>The synthetic EOY row is built in <code className="bg-surface-overlay px-1 rounded text-xs">useSimulation.tsx</code> STEP&nbsp;1.5 / 1.75:</p>
                    <ol className="list-decimal list-inside pl-2 space-y-1 text-content-muted">
                        <li>Compute <code className="bg-surface-overlay px-1 rounded text-xs">remainingFraction = (11 − currentMonth) / 12</code> — the share of the calendar year still ahead.</li>
                        <li>For each <code className="bg-surface-overlay px-1 rounded text-xs">WorkIncome</code> with a linked match account, add <code className="bg-surface-overlay px-1 rounded text-xs">(preTax401k + roth401k + employerMatch) × min(remainingFraction, activeMultiplier)</code> to that account's balance.</li>
                        <li>For each non-payroll <code className="bg-surface-overlay px-1 rounded text-xs">priority</code> with an annual goal (Brokerage / IRA / HSA / Savings), add <code className="bg-surface-overlay px-1 rounded text-xs">max(0, annualGoal − ytdActual)</code> using YTD from the budget. Balance targets (TARGET / MULTIPLE_OF_EXPENSES) instead use <code className="bg-surface-overlay px-1 rounded text-xs">max(0, target − currentBalance)</code>.</li>
                        <li>For each debt liability (DebtAccount + LoanExpense, or MortgageExpense), subtract <code className="bg-surface-overlay px-1 rounded text-xs">annualPrincipal × remainingFraction</code> from the balance so loan / mortgage payoff through year-end shows up on the synthetic point.</li>
                        <li>Scale Year-0 cashflow and tax line items by <code className="bg-surface-overlay px-1 rounded text-xs">remainingFraction</code>.</li>
                        <li>Investment growth between today and Dec 31 is <span className="text-warning-bright">not</span> applied — Property / Debt balances are carried forward unchanged.</li>
                    </ol>
                    {priorYearMode && (
                        <p className="bg-warning-tint/30 border border-warning-strong/50 rounded p-2 text-warning-bright text-xs">
                            Prior-Year Mode is on, so the EOY row is skipped entirely. The chart only shows the
                            normal year-by-year sim points.
                        </p>
                    )}
                    {!priorYearMode && remainingFraction <= 0 && (
                        <p className="bg-warning-tint/30 border border-warning-strong/50 rounded p-2 text-warning-bright text-xs">
                            It's December — <code className="bg-surface-overlay px-1 rounded text-xs">remainingFraction</code> is 0, so no EOY row is inserted.
                        </p>
                    )}
                </div>
            </Panel>

            {/* Date inputs */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-3">Date Inputs</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                        <div className="text-content-subtle text-xs">Today</div>
                        <div className="text-white font-mono">{toLocalDateString(today)}</div>
                    </div>
                    <div>
                        <div className="text-content-subtle text-xs">Current month (0–11)</div>
                        <div className="text-white font-mono">{currentMonth}</div>
                    </div>
                    <div>
                        <div className="text-content-subtle text-xs">remainingFraction</div>
                        <div className="text-positive font-mono">{remainingFraction.toFixed(4)} ({((11 - currentMonth))}/12)</div>
                    </div>
                    <div>
                        <div className="text-content-subtle text-xs">Simulation start year</div>
                        <div className="text-white font-mono">{startYear}</div>
                    </div>
                </div>
            </Panel>

            {/* Per-WorkIncome partial payroll */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Partial-Year Payroll Contributions</h3>
                <p className="text-xs text-content-subtle mb-3">Mirrors STEP&nbsp;1.5: only <code className="bg-surface-overlay px-1 rounded">WorkIncome</code>s with a linked <code className="bg-surface-overlay px-1 rounded">matchAccountId</code> appear here.</p>
                {eoySkipped ? (
                    <p className="text-sm text-content-subtle">EOY row is skipped — no partial contributions computed.</p>
                ) : payrollRows.length === 0 ? (
                    <p className="text-sm text-content-subtle">No active WorkIncome with a linked match account.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Income</th>
                                    <th className="text-left p-2">→ Account</th>
                                    <th className="text-right p-2">Annual pre-tax 401k</th>
                                    <th className="text-right p-2">Annual Roth 401k</th>
                                    <th className="text-right p-2">Annual match</th>
                                    <th className="text-right p-2">activeMult</th>
                                    <th className="text-right p-2">effective fraction</th>
                                    <th className="text-right p-2">User add</th>
                                    <th className="text-right p-2">Employer add</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrollRows.map(r => (
                                    <tr key={r.id} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-content-default">{r.name}</td>
                                        <td className="p-2 text-content-muted">{r.matchAccountName}</td>
                                        <td className="p-2 text-right text-content-default">{toCurrencyShort(r.preTax401k)}</td>
                                        <td className="p-2 text-right text-content-default">{toCurrencyShort(r.roth401k)}</td>
                                        <td className="p-2 text-right text-content-default">{toCurrencyShort(r.employerMatchAnnual)}</td>
                                        <td className="p-2 text-right text-content-muted font-mono">{r.activeMultiplier.toFixed(3)}</td>
                                        <td className="p-2 text-right text-positive font-mono">{r.effectiveFraction.toFixed(3)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(r.userContrib)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(r.employerContrib)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            {/* Budget-tracked priority contributions */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Budget-Tracked Priority Contributions</h3>
                <p className="text-xs text-content-subtle mb-3">
                    For each non-payroll priority with an annual goal: remaining = <span className="text-positive">max(0, annualGoal − ytdActual)</span>. YTD comes from budget transactions tagged with <code className="bg-surface-overlay px-1 rounded">targetAccountId</code> for the current year.
                    {' '}<span className="text-cat-sky-bright">TARGET / MULTIPLE_OF_EXPENSES</span> priorities are balance targets — the gap to the target is added, or skipped if already met.
                </p>
                {budgetProjection.rows.length === 0 ? (
                    <p className="text-sm text-content-subtle">No priorities configured.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Priority</th>
                                    <th className="text-left p-2">Account</th>
                                    <th className="text-left p-2">Cap</th>
                                    <th className="text-right p-2">Annual goal / target</th>
                                    <th className="text-right p-2">YTD / current bal</th>
                                    <th className="text-right p-2">Expected remaining</th>
                                    <th className="text-left p-2">Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {budgetProjection.rows.map((r, i) => {
                                    const skipColor = r.skipped ? 'text-content-faint italic' : 'text-content-default';
                                    const isBalanceTarget = r.source === 'balance-target';
                                    const midValue = isBalanceTarget ? r.currentBalance : r.ytdActual;
                                    const midColor = isBalanceTarget ? 'text-cat-sky-bright' : 'text-content-muted';
                                    return (
                                        <tr key={`${r.accountId}-${i}`} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                            <td className={`p-2 ${skipColor}`}>{r.priorityName}</td>
                                            <td className={`p-2 ${skipColor}`}>{r.accountName}</td>
                                            <td className="p-2 text-content-subtle font-mono text-xs">{r.capType}</td>
                                            <td className="p-2 text-right text-content-default">{r.annualGoal > 0 ? toCurrencyShort(r.annualGoal) : '—'}</td>
                                            <td className={`p-2 text-right ${midColor}`}>{midValue !== undefined && midValue > 0 ? toCurrencyShort(midValue) : '—'}</td>
                                            <td className={`p-2 text-right ${r.expectedRemaining > 0 ? 'text-positive' : 'text-content-faint'}`}>
                                                {r.expectedRemaining > 0 ? toCurrencyShort(r.expectedRemaining) : '—'}
                                            </td>
                                            <td className="p-2 text-xs">
                                                {r.skipped ? (
                                                    <span className="text-content-subtle">skipped: {r.skipped}</span>
                                                ) : r.source === 'budget-ytd' ? (
                                                    <span className="text-positive">budget YTD</span>
                                                ) : r.source === 'balance-target' ? (
                                                    <span className="text-cat-sky-bright">balance target</span>
                                                ) : (
                                                    <span className="text-warning-bright">fraction</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            {/* Per-account: Today → Projected EOY */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Per-Account: Today → Projected Dec {startYear}</h3>
                <p className="text-xs text-content-subtle mb-3">User / Employer = payroll partial-year contributions. Budget = projected non-payroll priority contributions. − Debt = projected principal pay-down on DebtAccount-style liabilities (car loans / credit cards). Property / unmatched accounts carry through unchanged.</p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-content-muted border-b border-border-default">
                                <th className="text-left p-2">Account</th>
                                <th className="text-left p-2">Category</th>
                                <th className="text-right p-2">Today</th>
                                <th className="text-right p-2">+ User</th>
                                <th className="text-right p-2">+ Employer</th>
                                <th className="text-right p-2">+ Budget</th>
                                <th className="text-right p-2">− Debt</th>
                                <th className="text-right p-2">Projected EOY</th>
                                <th className="text-right p-2">Δ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accountRows.map(r => {
                                const delta = r.projected - r.today;
                                return (
                                    <tr key={r.id} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                        <td className="p-2 text-content-default">{r.name}</td>
                                        <td className="p-2 text-content-subtle">{r.category}</td>
                                        <td className="p-2 text-right text-content-default">{toCurrencyShort(r.today)}</td>
                                        <td className="p-2 text-right text-content-muted">{r.userAdd > 0 ? toCurrencyShort(r.userAdd) : '—'}</td>
                                        <td className="p-2 text-right text-content-muted">{r.employerAdd > 0 ? toCurrencyShort(r.employerAdd) : '—'}</td>
                                        <td className="p-2 text-right text-content-muted">{r.budgetAdd > 0 ? toCurrencyShort(r.budgetAdd) : '—'}</td>
                                        <td className="p-2 text-right text-negative">{r.debtReduce > 0 ? toCurrencyShort(r.debtReduce) : '—'}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(r.projected)}</td>
                                        <td className={`p-2 text-right font-mono ${delta > 0 ? 'text-positive' : delta < 0 ? 'text-negative' : 'text-content-faint'}`}>
                                            {delta === 0 ? '—' : (delta > 0 ? '+' : '') + toCurrencyShort(delta)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Debt principal pay-down */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Debt Principal Pay-Down</h3>
                <p className="text-xs text-content-subtle mb-3">
                    For each liability (DebtAccount linked to a LoanExpense, or MortgageExpense), use the linked amortization's <code className="bg-surface-overlay px-1 rounded">totalPrincipal</code> for {startYear}, then scale by <code className="bg-surface-overlay px-1 rounded">remainingFraction</code> ({remainingFraction.toFixed(3)}). DeficitDebtAccounts are skipped.
                </p>
                {budgetProjection.debtRows.length === 0 ? (
                    <p className="text-sm text-content-subtle">No debt liabilities found.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Debt</th>
                                    <th className="text-left p-2">Type</th>
                                    <th className="text-left p-2">Linked expense</th>
                                    <th className="text-right p-2">Current balance</th>
                                    <th className="text-right p-2">Annual principal</th>
                                    <th className="text-right p-2">Expected reduction</th>
                                    <th className="text-right p-2">Projected EOY</th>
                                </tr>
                            </thead>
                            <tbody>
                                {budgetProjection.debtRows.map((r, i) => {
                                    const skipColor = r.skipped ? 'text-content-faint italic' : 'text-content-default';
                                    const eoyBal = Math.max(0, r.currentBalance - r.expectedReduction);
                                    return (
                                        <tr key={`${r.targetId}-${i}`} className="border-b border-border-subtle hover:bg-surface-overlay/50">
                                            <td className={`p-2 ${skipColor}`}>{r.name}</td>
                                            <td className="p-2 text-content-subtle font-mono text-xs">{r.targetType === 'mortgage-expense' ? 'mortgage' : 'account'}</td>
                                            <td className={`p-2 ${skipColor}`}>{r.linkedExpenseName || (r.skipped ? `(skipped: ${r.skipped})` : '—')}</td>
                                            <td className="p-2 text-right text-content-default">{r.currentBalance > 0 ? toCurrencyShort(r.currentBalance) : '—'}</td>
                                            <td className="p-2 text-right text-content-muted">{r.annualPrincipal > 0 ? toCurrencyShort(r.annualPrincipal) : '—'}</td>
                                            <td className={`p-2 text-right ${r.expectedReduction > 0 ? 'text-negative' : 'text-content-faint'}`}>
                                                {r.expectedReduction > 0 ? toCurrencyShort(r.expectedReduction) : '—'}
                                            </td>
                                            <td className="p-2 text-right text-white">{r.skipped ? '—' : toCurrencyShort(eoyBal)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            {/* Category roll-up (matches Overview chart series) */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Overview Chart Series — Today vs Projected Dec {startYear}</h3>
                <p className="text-xs text-content-subtle mb-3">These are the values plotted at the "Today" and "Dec {startYear}" x-positions on the Overview chart.</p>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-content-muted border-b border-border-default">
                            <th className="text-left p-2">Series</th>
                            <th className="text-right p-2">Today</th>
                            <th className="text-right p-2">Projected Dec {startYear}</th>
                            <th className="text-right p-2">Δ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(['Invested', 'Saved', 'Property'] as const).map(k => {
                            const t = categoryTotals[k].today;
                            const e = categoryTotals[k].eoy;
                            const d = e - t;
                            const color = k === 'Invested' ? 'text-positive' : k === 'Saved' ? 'text-info' : 'text-warning';
                            return (
                                <tr key={k} className="border-b border-border-subtle">
                                    <td className={`p-2 font-medium ${color}`}>{k}</td>
                                    <td className="p-2 text-right text-content-default">{toCurrencyShort(t)}</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(e)}</td>
                                    <td className={`p-2 text-right font-mono ${d > 0 ? 'text-positive' : d < 0 ? 'text-negative' : 'text-content-faint'}`}>
                                        {d === 0 ? '—' : (d > 0 ? '+' : '') + toCurrencyShort(d)}
                                    </td>
                                </tr>
                            );
                        })}
                        {/* Debt row: combines DebtAccount + MortgageExpense (chart plots this negative) */}
                        <tr className="border-b border-border-subtle">
                            <td className="p-2 font-medium text-negative">Debt</td>
                            <td className="p-2 text-right text-content-default">{toCurrencyShort(-(categoryTotals.Debt.today + mortgageDebt.today))}</td>
                            <td className="p-2 text-right text-white">{toCurrencyShort(-(categoryTotals.Debt.eoy + mortgageDebt.eoy))}</td>
                            <td className="p-2 text-right text-content-faint">—</td>
                        </tr>
                        <tr>
                            <td className="p-2 font-bold text-white">Net Worth</td>
                            <td className="p-2 text-right text-content-emphasis font-bold">{toCurrencyShort(todayNetWorth)}</td>
                            <td className="p-2 text-right text-white font-bold">{toCurrencyShort(eoyNetWorth)}</td>
                            <td className={`p-2 text-right font-mono font-bold ${eoyNetWorth - todayNetWorth > 0 ? 'text-positive' : 'text-negative'}`}>
                                {(eoyNetWorth - todayNetWorth) >= 0 ? '+' : ''}{toCurrencyShort(eoyNetWorth - todayNetWorth)}
                            </td>
                        </tr>
                    </tbody>
                </table>
                {mortgageDebt.items.length > 0 && (
                    <div className="mt-3 text-xs text-content-subtle">
                        Mortgage balances projected with amortization: {mortgageDebt.items.map(m => `${m.name} ${toCurrencyShort(m.today)} → ${toCurrencyShort(m.eoy)}`).join(', ')}.
                    </div>
                )}
            </Panel>

            {/* Cashflow / tax scaling */}
            <Panel>
                <h3 className="text-lg font-bold text-white mb-1">Cashflow &amp; Tax Scaling</h3>
                <p className="text-xs text-content-subtle mb-3">
                    The EOY row scales Year 0 cashflow/tax line items by <code className="bg-surface-overlay px-1 rounded">remainingFraction</code> ({remainingFraction.toFixed(3)}) so the Sankey / Cashflow views reflect only the rest of the year.
                </p>
                {!eoyYear ? (
                    <p className="text-sm text-content-subtle">No EOY row present in the current simulation.</p>
                ) : (
                    <>
                        <table className="w-full text-sm mb-4">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Cashflow</th>
                                    <th className="text-right p-2">Year 0 (annual)</th>
                                    <th className="text-right p-2">× fraction</th>
                                    <th className="text-right p-2">EOY value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cashflowRows.map(r => (
                                    <tr key={r.label} className="border-b border-border-subtle">
                                        <td className="p-2 text-content-default">{r.label}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(r.y0)}</td>
                                        <td className="p-2 text-right text-content-subtle font-mono">{toCurrencyShort(r.y0 * remainingFraction)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(r.eoy)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-content-muted border-b border-border-default">
                                    <th className="text-left p-2">Tax</th>
                                    <th className="text-right p-2">Year 0 (annual)</th>
                                    <th className="text-right p-2">× fraction</th>
                                    <th className="text-right p-2">EOY value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {taxRows.map(r => (
                                    <tr key={r.label} className="border-b border-border-subtle">
                                        <td className="p-2 text-content-default">{r.label}</td>
                                        <td className="p-2 text-right text-content-muted">{toCurrencyShort(r.y0)}</td>
                                        <td className="p-2 text-right text-content-subtle font-mono">{toCurrencyShort(r.y0 * remainingFraction)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(r.eoy)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}
            </Panel>
        </div>
    );
}

function ValidationDebugTab() {
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const [severityFilter, setSeverityFilter] = useState<string>('All');

    const currentYear = new Date().getFullYear();
    const startAge = currentYear - getBirthYear(assumptions.milestones);

    type Issue = { type: 'error' | 'warning' | 'info'; title: string; detail: string; section: string };

    // Section 2: Assumption Conflicts (context-based, works without simulation)
    const assumptionIssues = useMemo<Issue[]>(() => {
        const issues: Issue[] = [];

        if (getRetirementAge(assumptions.milestones) >= getLifeExpectancy(assumptions.milestones)) {
            issues.push({ type: 'error', title: 'Retirement age >= life expectancy', detail: `Retirement ${getRetirementAge(assumptions.milestones)} >= Life ${getLifeExpectancy(assumptions.milestones)}`, section: 'Assumptions' });
        }

        if (assumptions.investments.autoRothConversions) {
            const hasTraditional = accounts.some(a => a instanceof InvestedAccount && (a.taxType === 'Traditional 401k' || a.taxType === 'Traditional IRA'));
            if (!hasTraditional) {
                issues.push({ type: 'warning', title: 'Auto Roth conversions enabled but no Traditional accounts', detail: 'No Traditional 401k or IRA accounts configured.', section: 'Assumptions' });
            }
        }

        if (assumptions.withdrawalStrategy.length === 0) {
            issues.push({ type: 'warning', title: 'No withdrawal strategy configured', detail: 'No accounts in withdrawal order. Retirement withdrawals may not function.', section: 'Assumptions' });
        }

        const ror = assumptions.investments.returnRates.ror;
        const inflation = assumptions.macro.inflationRate;
        if (ror < inflation) {
            issues.push({ type: 'warning', title: 'Rate of return below inflation', detail: `ROR ${ror}% < inflation ${inflation}% = negative real returns (${(ror - inflation).toFixed(1)}%)`, section: 'Assumptions' });
        }

        if (assumptions.macro.healthcareInflation < assumptions.macro.inflationRate) {
            issues.push({ type: 'info', title: 'Healthcare inflation below general inflation', detail: `Healthcare ${assumptions.macro.healthcareInflation}% < general ${assumptions.macro.inflationRate}%. This is unusual.`, section: 'Assumptions' });
        }

        return issues;
    }, [assumptions, accounts]);

    // Section 3: Missing Data Alerts (context-based)
    const missingDataIssues = useMemo<Issue[]>(() => {
        const issues: Issue[] = [];

        if (accounts.length === 0) issues.push({ type: 'warning', title: 'No accounts configured', detail: 'Add savings or investment accounts.', section: 'Missing Data' });
        if (incomes.length === 0) issues.push({ type: 'warning', title: 'No income configured', detail: 'Add work income or other income sources.', section: 'Missing Data' });
        if (expenses.length === 0) issues.push({ type: 'info', title: 'No expenses configured', detail: 'Simulation assumes zero living expenses.', section: 'Missing Data' });

        // Check matchAccountId references
        incomes.forEach(inc => {
            if (inc instanceof WorkIncome && inc.matchAccountId) {
                const matchAccount = accounts.find(a => a.id === inc.matchAccountId);
                if (!matchAccount) {
                    issues.push({ type: 'error', title: `Match account not found: ${inc.name}`, detail: `Work income "${inc.name}" references non-existent match account.`, section: 'Missing Data' });
                }
            }
        });

        if (assumptions.priorities.length === 0 && accounts.length > 0) {
            issues.push({ type: 'info', title: 'No priority buckets configured', detail: 'Surplus cash will go to discretionary. Configure priority order for auto-investing.', section: 'Missing Data' });
        }

        const hasHealthcare = expenses.some(e => e instanceof HealthcareExpense);
        if (!hasHealthcare && expenses.length > 0) {
            issues.push({ type: 'info', title: 'No healthcare expenses', detail: 'Healthcare is often a significant retirement expense.', section: 'Missing Data' });
        }

        const birthYear = getBirthYear(assumptions.milestones);
        if (birthYear < 1930 || birthYear > currentYear - 10) {
            issues.push({ type: 'warning', title: 'Birth year may be incorrect', detail: `Birth year ${birthYear} seems unusual.`, section: 'Missing Data' });
        }

        return issues;
    }, [accounts, incomes, expenses, assumptions, currentYear]);

    // Section 1: Data Consistency (requires simulation)
    const consistencyIssues = useMemo<Issue[]>(() => {
        if (simulation.length === 0) return [];
        const issues: Issue[] = [];

        simulation.forEach((simYear, idx) => {
            const age = startAge + idx;
            const year = simYear.year;

            // Negative account balances
            simYear.accounts.forEach(acc => {
                if (acc.amount < -0.01 && !(acc instanceof DebtAccount || acc instanceof DeficitDebtAccount)) {
                    issues.push({ type: 'error', title: `Negative balance: ${acc.name}`, detail: `${acc.name} = ${toCurrency(acc.amount)} in ${year} (age ${age})`, section: 'Consistency' });
                }
            });

            // Deficit debt growing
            if (idx > 0) {
                const prevYear = simulation[idx - 1];
                simYear.accounts.forEach(acc => {
                    if (acc instanceof DeficitDebtAccount) {
                        const prev = prevYear.accounts.find(a => a.id === acc.id);
                        if (prev && acc.amount > prev.amount + 0.01) {
                            issues.push({ type: 'warning', title: `Deficit debt growing: ${acc.name}`, detail: `${toCurrencyShort(prev.amount)} -> ${toCurrencyShort(acc.amount)} in ${year}`, section: 'Consistency' });
                        }
                    }
                });
            }

            // RMD shortfall
            if (simYear.rmdDetails && simYear.rmdDetails.shortfall > 0) {
                issues.push({ type: 'error', title: `RMD shortfall in ${year}`, detail: `Required: ${toCurrency(simYear.rmdDetails.totalRMD)}, withdrawn: ${toCurrency(simYear.rmdDetails.totalWithdrawn)}. Penalty: ${toCurrency(simYear.rmdDetails.penalty)}`, section: 'Consistency' });
            }

            // Negative discretionary without withdrawals
            if (simYear.cashflow.discretionary < -1 && simYear.cashflow.withdrawals <= 0 && age >= getRetirementAge(assumptions.milestones)) {
                issues.push({ type: 'warning', title: `Negative cash flow in ${year}`, detail: `Discretionary: ${toCurrency(simYear.cashflow.discretionary)} with no withdrawals at age ${age}`, section: 'Consistency' });
            }
        });

        // Income/expense date conflicts
        incomes.forEach(inc => {
            if (inc.startDate && inc.end_date && inc.startDate > inc.end_date) {
                issues.push({ type: 'error', title: `Date conflict: ${inc.name}`, detail: `Start date after end date for income "${inc.name}"`, section: 'Consistency' });
            }
        });
        expenses.forEach(exp => {
            if (exp.startDate && exp.endDate && exp.startDate > exp.endDate) {
                issues.push({ type: 'error', title: `Date conflict: ${exp.name}`, detail: `Start date after end date for expense "${exp.name}"`, section: 'Consistency' });
            }
        });

        return issues;
    }, [simulation, startAge, incomes, expenses, getRetirementAge(assumptions.milestones)]);

    const allIssues = [...consistencyIssues, ...assumptionIssues, ...missingDataIssues];
    const filteredIssues = severityFilter === 'All' ? allIssues
        : severityFilter === 'Errors Only' ? allIssues.filter(i => i.type === 'error')
        : allIssues.filter(i => i.type === 'error' || i.type === 'warning');

    const errorCount = allIssues.filter(i => i.type === 'error').length;
    const warningCount = allIssues.filter(i => i.type === 'warning').length;
    const infoCount = allIssues.filter(i => i.type === 'info').length;

    const overallStatus = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'healthy';

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Panel className="flex items-center gap-4">
                <DropdownInput label="Severity" value={severityFilter} onChange={setSeverityFilter} options={['All', 'Errors Only', 'Warnings+']} />
            </Panel>

            {/* Overall Health Banner */}
            <div className={`rounded-lg p-4 border ${
                overallStatus === 'error' ? 'bg-negative-tint/20 border-negative-strong' :
                overallStatus === 'warning' ? 'bg-warning-tint/30 border-warning-strong/50' :
                'bg-positive-tint/20 border-positive-strong/50'
            }`}>
                <div className="flex items-center justify-between">
                    <span className={`text-lg font-bold ${
                        overallStatus === 'error' ? 'text-negative' :
                        overallStatus === 'warning' ? 'text-warning-bright' :
                        'text-positive'
                    }`}>
                        {overallStatus === 'error' ? 'Issues Found' : overallStatus === 'warning' ? 'Warnings Present' : 'All Checks Passed'}
                    </span>
                    <div className="flex gap-3 text-sm">
                        {errorCount > 0 && <span className="text-negative">{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>}
                        {warningCount > 0 && <span className="text-warning-bright">{warningCount} Warning{warningCount !== 1 ? 's' : ''}</span>}
                        {infoCount > 0 && <span className="text-info">{infoCount} Info</span>}
                    </div>
                </div>
            </div>

            {simulation.length === 0 && (
                <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg p-3 text-info text-sm">
                    Run simulation for additional runtime checks (data consistency, RMD shortfalls, negative balances).
                </div>
            )}

            {/* Issue Cards */}
            <div className="space-y-2">
                {filteredIssues.length === 0 ? (
                    <div className="text-content-muted text-sm p-4">No issues found at this severity level.</div>
                ) : (
                    filteredIssues.map((issue, i) => (
                        <div key={i} className={`rounded-lg p-3 border ${
                            issue.type === 'error' ? 'bg-negative-tint/20 border-negative-strong' :
                            issue.type === 'warning' ? 'bg-warning-tint/30 border-warning-strong/50' :
                            'bg-info-tint/20 border-info-strong/50'
                        }`}>
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <span className={`text-sm font-medium ${
                                        issue.type === 'error' ? 'text-negative' :
                                        issue.type === 'warning' ? 'text-warning-bright' :
                                        'text-info'
                                    }`}>{issue.title}</span>
                                    <p className="text-xs text-content-muted mt-1">{issue.detail}</p>
                                </div>
                                <span className="text-xs text-content-subtle whitespace-nowrap">{issue.section}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ============================================================================
// MAIN TESTING COMPONENT WITH TABS
// ============================================================================
const TESTING_TABS = ['Simulation Debug', 'Tax Debug', 'Tax Brackets', 'Social Security', 'Pensions', 'RMDs', 'Roth Analysis', 'Roth Debug', 'Ratios', 'Mortgage', 'QR Code', 'Withdrawals', 'Accounts', 'Income & Expenses', 'Cash Flow', 'EOY Projection', 'Validation'];

export default function Testing() {
    const { state: assumptionsState } = useContext(AssumptionsContext);
    const showExperimental = assumptionsState.display?.showExperimentalFeatures ?? false;

    const [activeTab, setActiveTab] = useState(() => {
        let saved = localStorage.getItem('stag_testing_tab');
        if (saved === 'Roth Conversions') saved = 'Roth Analysis';
        return saved && TESTING_TABS.includes(saved) ? saved : 'Simulation Debug';
    });

    // Persist tab selection
    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        localStorage.setItem('stag_testing_tab', tab);
    };

    useSubTabKeyboardNav(TESTING_TABS, activeTab, handleTabChange);

    if (!showExperimental) {
        return (
            <div className="w-full min-h-screen bg-surface-base text-content-bright p-8 flex items-center justify-center">
                <p className="text-content-subtle">Enable experimental features in Assumptions to access Testing.</p>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-surface-base text-content-bright p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-3xl font-bold mb-4 text-cat-fuchsia-soft">
                    Testing & Debugging
                </h2>

                {/* Tab Navigation */}
                <Panel padding="none" className="rounded-lg mb-4 flex overflow-x-auto custom-scrollbar">
                    {TESTING_TABS.map(tab => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            onClick={() => handleTabChange(tab)}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${
                                activeTab === tab
                                    ? 'text-positive-bright bg-surface-overlay border-b-2 border-positive-bright'
                                    : 'text-content-muted hover:bg-surface-overlay hover:text-white'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </Panel>

                {/* Tab Content */}
                <div data-sub-tab-content>
                    {activeTab === 'Simulation Debug' && <SimulationDebugTab />}
                    {activeTab === 'Tax Debug' && <TaxDebugTab />}
                    {activeTab === 'Tax Brackets' && <TaxBracketVisualizationTab />}
                    {activeTab === 'Social Security' && <SocialSecurityDebugTab />}
                    {activeTab === 'Pensions' && <PensionDebugTab />}
                    {activeTab === 'RMDs' && <RMDDebugTab />}
                    {activeTab === 'Roth Analysis' && <RothAnalysisDebugTab />}
                    {activeTab === 'Roth Debug' && <RothConversionDebugTab />}
                    {activeTab === 'Ratios' && <RatiosDebugTab />}
                    {activeTab === 'Mortgage' && <MortgageTestingTab />}
                    {activeTab === 'QR Code' && <QRCodeDebugTab />}
                    {activeTab === 'Withdrawals' && <WithdrawalDebugTab />}
                    {activeTab === 'Accounts' && <AccountsDebugTab />}
                    {activeTab === 'Income & Expenses' && <IncomeExpensesDebugTab />}
                    {activeTab === 'Cash Flow' && <CashFlowDebugTab />}
                    {activeTab === 'EOY Projection' && <EOYProjectionDebugTab />}
                    {activeTab === 'Validation' && <ValidationDebugTab />}
                </div>
            </div>
        </div>
    );
}