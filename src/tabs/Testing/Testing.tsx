import { useState, useMemo, useContext, useEffect, useCallback, useRef } from 'react';
import jsQR from 'jsqr';
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
import { WorkIncome, FutureSocialSecurityIncome, CurrentSocialSecurityIncome, PassiveIncome, FERSPensionIncome, CSRSPensionIncome } from '../../components/Objects/Income/models';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { getSimulationInputHash } from '../../services/simulationHash';
import {
    getTaxParameters,
    getMarginalTaxRate,
    getCombinedMarginalRate,
    getGrossIncome,
    getPreTaxExemptions,
    getEarnedIncome,
    getFicaExemptions,
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
    findRothConversionWindows
} from '../../services/TaxOptimizationService';
// TODO: Re-implement tax optimization functions per TAX_OPTIMIZATION_SPEC.md
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
    getFERSCOLA,
    checkCSRSEligibility,
    calculateCSRSBasicBenefit,
    getCSRSCOLA,
    PENSION_SYSTEM_COMPARISON
} from '../../data/PensionData';
import { SavedAccount, InvestedAccount, DebtAccount, DeficitDebtAccount, PropertyAccount, ESPPAccount, AnyAccount } from '../../components/Objects/Accounts/models';
import { formatCompactCurrency } from '../Future/tabs/FutureUtils';
import { SimulationYear } from '../../services/simulation/types';
import RothConversionDebugTab from './RothConversionDebug';

// Helper to format currency
const toCurrency = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

const toCurrencyShort = (num: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

// ============================================================================
// COPY-FRIENDLY TEXT SUMMARY
// ============================================================================
function generateYearSummaryText(simYear: SimulationYear, age: number, accountsContext: AnyAccount[]): string {
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
        const isSaved = acc instanceof SavedAccount;
        const isDebt = acc instanceof DebtAccount || acc instanceof DeficitDebtAccount;
        const isProperty = acc instanceof PropertyAccount;
        const type = isInvested ? (acc as InvestedAccount).taxType :
            isESPP ? 'ESPP' : isSaved ? 'Savings' : isDebt ? 'Debt' : isProperty ? 'Property' : 'Unknown';
        lines.push(`  ${acc.name} (${type}): ${fmt(acc.amount)}`);
        totalBalance += acc.amount;
    }
    lines.push(`  Total: ${fmt(totalBalance)}`);
    lines.push('');

    // INCOME
    lines.push('INCOME');
    for (const inc of simYear.incomes) {
        const className = (inc as { className?: string }).className || inc.constructor.name;
        const amount = inc.getProratedAnnual(inc.amount, simYear.year);
        if (inc instanceof WorkIncome) {
            const parts: string[] = [];
            if (inc.preTax401k > 0) parts.push(`preTax401k: ${fmt(inc.preTax401k)}`);
            if (inc.roth401k > 0) parts.push(`roth401k: ${fmt(inc.roth401k)}`);
            if (inc.employerMatch > 0) parts.push(`match: ${fmt(inc.employerMatch)}`);
            if (inc.insurance > 0) parts.push(`insurance: ${fmt(inc.insurance)}`);
            if (inc.hsaContribution > 0) parts.push(`hsa: ${fmt(inc.hsaContribution)}`);
            const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
            lines.push(`  Work: ${inc.name} — ${fmt(amount)}${detail}`);
        } else if (className === 'FutureSocialSecurityIncome' || className === 'CurrentSocialSecurityIncome') {
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
        for (const [name, amount] of withdrawalEntries) {
            const account = simYear.accounts.find(a => a.name === name);
            const isTraditional = account instanceof InvestedAccount &&
                ((account as InvestedAccount).taxType === 'Traditional 401k' || (account as InvestedAccount).taxType === 'Traditional IRA');
            const isBrokerage = account instanceof InvestedAccount && (account as InvestedAccount).taxType === 'Brokerage';
            const taxable = isTraditional || isBrokerage || account instanceof ESPPAccount;
            lines.push(`  ${name}: ${fmt(amount)}${taxable ? ' (taxable)' : ''}`);
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
    lines.push(`  Cap Gains Tax: ${fmt(simYear.taxDetails.capitalGains)} | Withdrawal Tax: ${fmt(simYear.taxDetails.withdrawalOrdinaryTax)} | NIIT: ${fmt(simYear.taxDetails.niit)} | Early-Withdraw Penalty: ${fmt(penalty)}`);
    const totalTax = simYear.taxDetails.fed + simYear.taxDetails.state + simYear.taxDetails.fica +
        simYear.taxDetails.capitalGains + simYear.taxDetails.withdrawalOrdinaryTax + simYear.taxDetails.niit;
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
            className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
            <span className="font-semibold text-white flex items-center gap-2">
                {title}
                {count !== undefined && <span className="text-xs bg-gray-600 px-2 py-0.5 rounded">{count}</span>}
            </span>
            <span className="text-gray-400">{expandedSections[section] ? '▼' : '▶'}</span>
        </button>
    );

    // Extract detailed account info
    const accountDetails = simYear.accounts.map(acc => {
        const isInvested = acc instanceof InvestedAccount;
        const isESPP = acc instanceof ESPPAccount;
        const isSaved = acc instanceof SavedAccount;
        const isDebt = acc instanceof DebtAccount || acc instanceof DeficitDebtAccount;
        const isProperty = acc instanceof PropertyAccount;

        return {
            id: acc.id,
            name: acc.name,
            amount: acc.amount,
            type: isInvested ? (acc as InvestedAccount).taxType :
                  isESPP ? 'ESPP' :
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
        } else if (className === 'FutureSocialSecurityIncome' || className === 'CurrentSocialSecurityIncome') {
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

    // Calculate withdrawal breakdown with capital gains info
    const withdrawalBreakdown = Object.entries(simYear.cashflow.withdrawalDetail).map(([name, amount]) => {
        // Find the account to get its type
        const account = simYear.accounts.find(a => a.name === name);
        const isBrokerage = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Brokerage');
        const isESPP = account instanceof ESPPAccount;
        const isTraditional = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Traditional 401k' || (account as InvestedAccount).taxType === 'Traditional IRA');
        const isRoth = account instanceof InvestedAccount &&
            ((account as InvestedAccount).taxType === 'Roth 401k' || (account as InvestedAccount).taxType === 'Roth IRA');

        return {
            name,
            amount,
            type: isBrokerage ? 'Brokerage' : isESPP ? 'ESPP' : isTraditional ? 'Traditional' : isRoth ? 'Roth' : 'Other',
            isTaxable: isTraditional || isBrokerage || isESPP
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
                    <div className="mt-2 bg-gray-900 rounded-lg p-3 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-gray-400 border-b border-gray-700">
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
                                    <tr key={acc.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-white">{acc.name}</td>
                                        <td className="p-2 text-gray-400 text-xs">{acc.type}</td>
                                        <td className={`p-2 text-right font-mono ${acc.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                            {toCurrencyShort(acc.amount)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-400">
                                            {acc.costBasis !== undefined ? toCurrencyShort(acc.costBasis) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-mono ${(acc.unrealizedGains || 0) > 0 ? 'text-lime-400' : 'text-gray-500'}`}>
                                            {acc.unrealizedGains !== undefined ? toCurrencyShort(acc.unrealizedGains) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-500 text-xs">
                                            {acc.apr !== undefined ? `${acc.apr}%` : acc.lotCount !== undefined ? `${acc.lotCount} lots` : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-gray-600">
                                <tr className="font-semibold">
                                    <td className="p-2 text-white" colSpan={2}>Total</td>
                                    <td className="p-2 text-right font-mono text-blue-400">
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
                    <div className="mt-2 bg-gray-900 rounded-lg p-3 space-y-3">
                        {Object.entries(incomeByCategory).map(([category, items]) => (
                            <div key={category}>
                                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{category}</div>
                                <div className="space-y-1">
                                    {items.map((inc, idx) => (
                                        <div key={idx} className="flex justify-between items-start bg-gray-800/50 rounded p-2">
                                            <div>
                                                <span className="text-white">{inc.name}</span>
                                                <span className="text-gray-500 text-xs ml-2">({inc.frequency})</span>
                                                {Object.keys(inc.additionalInfo).length > 0 && (
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {Object.entries(inc.additionalInfo).map(([k, v]) => (
                                                            <span key={k} className="mr-3">
                                                                {k}: {typeof v === 'number' ? toCurrencyShort(v) : v}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="font-mono text-green-400">{toCurrencyShort(inc.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="flex justify-between border-t border-gray-700 pt-2 font-semibold">
                            <span className="text-white">Total Income</span>
                            <span className="font-mono text-green-400">{toCurrencyShort(simYear.cashflow.totalIncome)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* 3. Withdrawals */}
            <div>
                <SectionHeader title="Withdrawals" section="withdrawals" count={withdrawalBreakdown.length} />
                {expandedSections.withdrawals && (
                    <div className="mt-2 bg-gray-900 rounded-lg p-3">
                        {withdrawalBreakdown.length === 0 ? (
                            <div className="text-gray-500 text-sm">No withdrawals this year</div>
                        ) : (
                            <>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-gray-400 border-b border-gray-700">
                                            <th className="text-left p-2">Account</th>
                                            <th className="text-left p-2">Type</th>
                                            <th className="text-right p-2">Amount</th>
                                            <th className="text-center p-2">Taxable</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {withdrawalBreakdown.map((w, idx) => (
                                            <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                                                <td className="p-2 text-white">{w.name}</td>
                                                <td className="p-2 text-gray-400 text-xs">{w.type}</td>
                                                <td className="p-2 text-right font-mono text-purple-400">{toCurrencyShort(w.amount)}</td>
                                                <td className="p-2 text-center">
                                                    {w.isTaxable ? <span className="text-yellow-400">●</span> : <span className="text-gray-600">○</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="border-t border-gray-600">
                                        <tr className="font-semibold">
                                            <td className="p-2 text-white" colSpan={2}>Total Withdrawals</td>
                                            <td className="p-2 text-right font-mono text-purple-400">
                                                {toCurrencyShort(simYear.cashflow.withdrawals)}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                                {simYear.taxDetails.capitalGains > 0 && (
                                    <div className="mt-2 p-2 bg-gray-800 rounded text-sm">
                                        <div className="text-gray-400 text-xs uppercase mb-1">Capital Gains from Brokerage/ESPP</div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">Capital Gains Tax Paid</span>
                                            <span className="font-mono text-amber-400">{toCurrencyShort(simYear.taxDetails.capitalGains)}</span>
                                        </div>
                                    </div>
                                )}
                                {simYear.taxDetails.withdrawalOrdinaryTax > 0 && (
                                    <div className="mt-2 p-2 bg-gray-800 rounded text-sm">
                                        <div className="text-gray-400 text-xs uppercase mb-1">Withdrawal Ordinary Tax</div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-300">Tax on Roth Earnings / Traditional / HSA</span>
                                            <span className="font-mono text-purple-400">{toCurrencyShort(simYear.taxDetails.withdrawalOrdinaryTax)}</span>
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
                    <div className="mt-2 bg-gray-900 rounded-lg p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">User Contributions</div>
                                <div className="font-mono text-blue-400">{toCurrencyShort(simYear.cashflow.investedUser)}</div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">Employer Match</div>
                                <div className="font-mono text-cyan-400">{toCurrencyShort(simYear.cashflow.investedMatch)}</div>
                            </div>
                        </div>
                        {bucketDetails.length > 0 && (
                            <div>
                                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Priority Bucket Allocations</div>
                                <div className="space-y-1">
                                    {bucketDetails.map((b, idx) => (
                                        <div key={idx} className="flex justify-between bg-gray-800/50 rounded p-2">
                                            <span className="text-gray-300">{b.name}</span>
                                            <span className="font-mono text-green-400">{toCurrencyShort(b.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="flex justify-between border-t border-gray-700 pt-2 font-semibold">
                            <span className="text-white">Total Invested</span>
                            <span className="font-mono text-blue-400">{toCurrencyShort(simYear.cashflow.totalInvested)}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* 5. Taxes */}
            <div>
                <SectionHeader title="Tax Breakdown" section="taxes" />
                {expandedSections.taxes && (
                    <div className="mt-2 bg-gray-900 rounded-lg p-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">Federal Tax</div>
                                <div className="font-mono text-amber-400">{toCurrencyShort(simYear.taxDetails.fed)}</div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">State Tax</div>
                                <div className="font-mono text-amber-400">{toCurrencyShort(simYear.taxDetails.state)}</div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">FICA</div>
                                <div className="font-mono text-amber-400">{toCurrencyShort(simYear.taxDetails.fica)}</div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-2">
                                <div className="text-xs text-gray-400">Total Tax</div>
                                <div className="font-mono text-red-400 font-bold">{toCurrencyShort(totalTax)}</div>
                            </div>
                        </div>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Pre-Tax Deductions (401k, HSA)</span>
                                <span className="font-mono text-gray-300">{toCurrencyShort(simYear.taxDetails.preTax)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Insurance Costs</span>
                                <span className="font-mono text-gray-300">{toCurrencyShort(simYear.taxDetails.insurance)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Post-Tax Deductions</span>
                                <span className="font-mono text-gray-300">{toCurrencyShort(simYear.taxDetails.postTax)}</span>
                            </div>
                            {simYear.taxDetails.capitalGains > 0 && (
                                <div className="flex justify-between text-lime-400">
                                    <span>Capital Gains Tax (Brokerage/ESPP)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.capitalGains)}</span>
                                </div>
                            )}
                            {simYear.taxDetails.withdrawalOrdinaryTax > 0 && (
                                <div className="flex justify-between text-purple-400">
                                    <span>Withdrawal Tax (Roth Earnings/Traditional)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.withdrawalOrdinaryTax)}</span>
                                </div>
                            )}
                            {simYear.taxDetails.niit > 0 && (
                                <div className="flex justify-between text-orange-400">
                                    <span>NIIT (3.8% Net Investment Income Tax)</span>
                                    <span className="font-mono">{toCurrencyShort(simYear.taxDetails.niit)}</span>
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
                        <div className="mt-2 bg-gray-900 rounded-lg p-3">
                            <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="bg-purple-900/30 border border-purple-700/50 rounded p-2">
                                    <div className="text-xs text-purple-300">Amount Converted</div>
                                    <div className="font-mono text-purple-400 font-bold">
                                        {toCurrencyShort(simYear.rothConversion.amount)}
                                    </div>
                                </div>
                                <div className="bg-red-900/30 border border-red-700/50 rounded p-2">
                                    <div className="text-xs text-red-300">Tax Cost</div>
                                    <div className="font-mono text-red-400">
                                        {toCurrencyShort(simYear.rothConversion.taxCost)}
                                    </div>
                                </div>
                                <div className="bg-gray-800/50 rounded p-2">
                                    <div className="text-xs text-gray-400">Effective Rate</div>
                                    <div className="font-mono text-white">
                                        {((simYear.rothConversion.taxCost / simYear.rothConversion.amount) * 100).toFixed(1)}%
                                    </div>
                                </div>
                            </div>
                            {Object.keys(simYear.rothConversion.fromAccounts).length > 0 && (
                                <div className="space-y-2 text-sm">
                                    <div className="text-xs text-gray-400 uppercase">Transfer Details</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <div className="text-gray-500 text-xs mb-1">From (Traditional)</div>
                                            {Object.entries(simYear.rothConversion.fromAccounts).map(([name, amt]) => (
                                                <div key={name} className="flex justify-between bg-gray-800/50 rounded p-1 px-2">
                                                    <span className="text-gray-300 truncate">{name}</span>
                                                    <span className="font-mono text-red-400">-{toCurrencyShort(amt)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div>
                                            <div className="text-gray-500 text-xs mb-1">To (Roth)</div>
                                            {Object.entries(simYear.rothConversion.toAccounts).map(([name, amt]) => (
                                                <div key={name} className="flex justify-between bg-gray-800/50 rounded p-1 px-2">
                                                    <span className="text-gray-300 truncate">{name}</span>
                                                    <span className="font-mono text-green-400">+{toCurrencyShort(amt)}</span>
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
                        className="w-full flex items-center justify-between p-3 bg-orange-900/30 hover:bg-orange-900/40 border border-orange-700/50 rounded-lg transition-colors"
                    >
                        <span className="font-semibold text-orange-300">Required Minimum Distributions</span>
                        <span className="text-orange-400">{expandedSections['rmd'] ? '▼' : '▶'}</span>
                    </button>
                    {expandedSections['rmd'] && (
                        <div className="mt-2 bg-gray-900 rounded-lg p-3">
                            <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="bg-gray-800/50 rounded p-2">
                                    <div className="text-xs text-gray-400">Required RMD</div>
                                    <div className="font-mono text-orange-400">{toCurrencyShort(simYear.rmdDetails.totalRMD)}</div>
                                </div>
                                <div className="bg-gray-800/50 rounded p-2">
                                    <div className="text-xs text-gray-400">Actually Withdrawn</div>
                                    <div className="font-mono text-white">{toCurrencyShort(simYear.rmdDetails.totalWithdrawn)}</div>
                                </div>
                                {simYear.rmdDetails.shortfall > 0 && (
                                    <div className="bg-red-900/30 border border-red-700/50 rounded p-2">
                                        <div className="text-xs text-red-300">Shortfall (25% penalty)</div>
                                        <div className="font-mono text-red-400">{toCurrencyShort(simYear.rmdDetails.penalty)}</div>
                                    </div>
                                )}
                            </div>
                            {simYear.rmdDetails.accountBreakdown.length > 0 && (
                                <div className="text-sm">
                                    <div className="text-xs text-gray-400 uppercase mb-1">Per-Account Breakdown</div>
                                    {simYear.rmdDetails.accountBreakdown.map((rmd, idx) => (
                                        <div key={idx} className="flex justify-between bg-gray-800/50 rounded p-2 mb-1">
                                            <span className="text-gray-300">{rmd.accountName}</span>
                                            <span className="font-mono text-orange-400">{toCurrencyShort(rmd.rmdAmount)}</span>
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

    const executeSimulation = useCallback(() => {
        return runSimulationWithOptimization(
            getLifeExpectancy(assumptions.milestones) - startAge,
            accounts,
            incomes,
            expenses,
            assumptions,
            taxState
        );
    }, [assumptions, accounts, incomes, expenses, taxState]);

    const handleRecalculate = useCallback(() => {
        setIsLoading(true);
        setTimeout(() => {
            const newSimulation = executeSimulation();
            dispatchSimulation({
                type: 'SET_SIMULATION_WITH_HASH',
                payload: { simulation: newSimulation, inputHash: currentInputHash }
            });
            setIsLoading(false);
        }, 50);
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
            taxDetails: { fed: number; state: number; fica: number; capitalGains: number; withdrawalOrdinaryTax: number; earlyWithdrawalPenalty?: number };
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
                } else if (inc instanceof FutureSocialSecurityIncome || inc instanceof CurrentSocialSecurityIncome) {
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
                    earlyWithdrawalPenalty: simYear.taxDetails.earlyWithdrawalPenalty,
                },
                logs: simYear.logs || [],
            });
        });

        return { issues, yearData };
    }, [simulation, startAge, retirementAge]);

    if (simulation.length === 0 || isLoading) {
        return (
            <div className="text-center py-8 text-gray-400">
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
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Current Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Start Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Retirement Age:</span>
                        <span className="ml-2 text-white">{retirementAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Accounts:</span>
                        <span className="ml-2 text-white">{accounts.length}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Withdrawal Strategy:</span>
                        <span className="ml-2 text-white">{assumptions.withdrawalStrategy?.length || 0} buckets</span>
                    </div>
                </div>
                {assumptions.withdrawalStrategy && assumptions.withdrawalStrategy.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Withdrawal Order: </span>
                        {assumptions.withdrawalStrategy.map((bucket, idx) => {
                            const acc = accounts.find(a => a.id === bucket.accountId);
                            return (
                                <span key={bucket.accountId} className="text-xs bg-gray-800 px-2 py-1 rounded mr-2">
                                    {idx + 1}. {acc?.name || 'Unknown'}
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Issues Summary */}
            {analysis && analysis.issues.length > 0 && (
                <div className="bg-red-900/20 p-4 rounded-xl border border-red-800">
                    <h3 className="text-lg font-bold text-red-400 mb-3">
                        Issues Found ({analysis.issues.length})
                    </h3>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                        {analysis.issues.map((issue, idx) => (
                            <div
                                key={idx}
                                className={`text-sm p-2 rounded cursor-pointer hover:bg-gray-800 ${
                                    issue.severity === 'error' ? 'bg-red-900/30 text-red-300' :
                                    issue.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                                    'bg-blue-900/30 text-blue-300'
                                }`}
                                onClick={() => setSelectedYear(issue.year)}
                            >
                                <span className="font-mono">{issue.year} (Age {issue.age})</span>
                                <span className="mx-2 text-gray-500">|</span>
                                <span className="font-semibold">{issue.type}</span>
                                <span className="mx-2 text-gray-500">|</span>
                                <span>{issue.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Year-by-Year Data Table */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-800 gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-white">
                        Simulation Data (Click row for details)
                    </h3>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={multiAgesInput}
                            onChange={(e) => setMultiAgesInput(e.target.value)}
                            placeholder="ages e.g. 35, 45, 55"
                            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-sm text-white font-mono w-48 focus:outline-none focus:border-blue-500"
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
                            className="px-3 py-1 rounded-lg text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors whitespace-nowrap"
                        >
                            {multiCopyText}
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-800 sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-gray-400">Year</th>
                                <th className="p-2 text-left text-gray-400">Age</th>
                                <th className="p-2 text-left text-gray-400">Phase</th>
                                <th className="p-2 text-right text-gray-400">Income</th>
                                <th className="p-2 text-right text-gray-400">Expenses</th>
                                <th className="p-2 text-right text-gray-400">Withdrawals</th>
                                <th className="p-2 text-right text-gray-400">Discretionary</th>
                                <th className="p-2 text-right text-gray-400">Net Worth</th>
                            </tr>
                        </thead>
                        <tbody>
                            {analysis?.yearData.map(row => {
                                const hasIssue = analysis.issues.some(i => i.year === row.year);
                                return (
                                    <tr
                                        key={`${row.year}-${row.isEndOfYearProjection ? 'eoy' : 'main'}`}
                                        className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                            selectedYear === row.year ? 'bg-blue-900/30' : ''
                                        } ${hasIssue ? 'bg-red-900/10' : ''} ${row.isEndOfYearProjection ? 'opacity-60 italic' : ''}`}
                                        onClick={() => setSelectedYear(row.year)}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.isEndOfYearProjection ? `Rest of ${row.year}` : row.year}
                                        </td>
                                        <td className="p-2">{row.age}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                                row.isRetired ? 'bg-amber-900/50 text-amber-300' : 'bg-green-900/50 text-green-300'
                                            }`}>
                                                {row.isRetired ? 'Retired' : 'Working'}
                                            </span>
                                        </td>
                                        <td className="p-2 text-right font-mono text-green-400">{toCurrencyShort(row.totalIncome)}</td>
                                        <td className="p-2 text-right font-mono text-red-400">{toCurrencyShort(row.totalExpenses)}</td>
                                        <td className="p-2 text-right font-mono text-purple-400">
                                            {row.totalWithdrawals > 0 ? toCurrencyShort(row.totalWithdrawals) : '-'}
                                        </td>
                                        <td className={`p-2 text-right font-mono ${row.discretionary < 0 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                            {toCurrencyShort(row.discretionary)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-blue-400">{toCurrencyShort(row.netWorth)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Year Details */}
            {selectedYearData && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
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
                                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-gray-700 text-gray-300 hover:bg-gray-600"
                            >
                                {copyButtonText}
                            </button>
                            <button
                                onClick={() => setShowDetailedView(!showDetailedView)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    showDetailedView
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
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
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Account Balances</h4>
                            <div className="space-y-1 text-sm">
                                {Object.entries(selectedYearData.accountBalances).map(([name, bal]) => (
                                    <div key={name} className="flex justify-between">
                                        <span className="text-gray-400">{name}</span>
                                        <span className="font-mono text-white">{toCurrencyShort(bal)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Work Income Details */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Work Income</h4>
                            {selectedYearData.workIncomes.length === 0 ? (
                                <span className="text-gray-500 text-sm">No work income</span>
                            ) : (
                                <div className="space-y-2 text-sm">
                                    {selectedYearData.workIncomes.map(wi => (
                                        <div key={wi.name} className="border-b border-gray-700 pb-2">
                                            <div className="font-semibold text-white">{wi.name}</div>
                                            <div className="flex justify-between text-gray-400">
                                                <span>Salary:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.amount)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.contrib401k > 0 && selectedYearData.isRetired ? 'text-red-400' : 'text-gray-400'}`}>
                                                <span>401k Contrib:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.contrib401k)}</span>
                                            </div>
                                            <div className={`flex justify-between ${wi.employerMatch > 0 && selectedYearData.isRetired ? 'text-red-400' : 'text-gray-400'}`}>
                                                <span>Employer Match:</span>
                                                <span className="font-mono">{toCurrencyShort(wi.employerMatch)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Other Income (Social Security + Interest) */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Other Income</h4>
                            <div className="space-y-2 text-sm">
                                {/* Social Security */}
                                <div className="flex justify-between text-gray-400">
                                    <span>Social Security:</span>
                                    <span className={`font-mono ${selectedYearData.socialSecurityIncome > 0 ? 'text-cyan-400' : 'text-gray-500'}`}>
                                        {selectedYearData.socialSecurityIncome > 0 ? toCurrencyShort(selectedYearData.socialSecurityIncome) : '-'}
                                    </span>
                                </div>
                                {/* Interest Income */}
                                {selectedYearData.interestIncome.length === 0 ? (
                                    <div className="flex justify-between text-gray-400">
                                        <span>Interest Income:</span>
                                        <span className="font-mono text-gray-500">-</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-gray-400 mt-2">Interest Income:</div>
                                        {selectedYearData.interestIncome.map(ii => (
                                            <div key={ii.name} className="flex justify-between pl-2">
                                                <span className="text-gray-500">{ii.name}</span>
                                                <span className="font-mono text-yellow-400">{toCurrencyShort(ii.amount)}</span>
                                            </div>
                                        ))}
                                        <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                                            <span className="text-gray-400">Total Interest:</span>
                                            <span className="font-mono text-yellow-400">
                                                {toCurrencyShort(selectedYearData.interestIncome.reduce((sum, ii) => sum + ii.amount, 0))}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Withdrawals */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Withdrawals</h4>
                            {Object.keys(selectedYearData.withdrawalDetail).length === 0 ? (
                                <span className="text-gray-500 text-sm">No withdrawals</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {Object.entries(selectedYearData.withdrawalDetail).map(([name, amt]) => (
                                        <div key={name} className="flex justify-between">
                                            <span className="text-gray-400">{name}</span>
                                            <span className="font-mono text-purple-400">{toCurrencyShort(amt)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Bucket Allocations */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Priority Buckets</h4>
                            {Object.keys(selectedYearData.bucketDetail).length === 0 ? (
                                <span className="text-gray-500 text-sm">No allocations</span>
                            ) : (
                                <div className="space-y-1 text-sm">
                                    {Object.entries(selectedYearData.bucketDetail).map(([id, amt]) => {
                                        const acc = accounts.find(a => a.id === id);
                                        return (
                                            <div key={id} className="flex justify-between">
                                                <span className="text-gray-400">{acc?.name || id}</span>
                                                <span className="font-mono text-green-400">{toCurrencyShort(amt)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tax Breakdown */}
                    <div className="mt-4 bg-gray-800 p-3 rounded-lg">
                        <h4 className="font-semibold text-gray-300 mb-2">Tax Breakdown</h4>
                        {(() => {
                            const fedRaw = selectedYearData.taxDetails.fed;
                            const penalty = selectedYearData.taxDetails.earlyWithdrawalPenalty ?? 0;
                            const fedIncomeTax = Math.max(0, fedRaw - penalty);
                            return (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <span className="text-gray-400">Federal Income Tax:</span>
                                <span className={`ml-2 font-mono ${fedIncomeTax > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(fedIncomeTax)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">Early-Withdraw Penalty:</span>
                                <span className={`ml-2 font-mono ${penalty > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(penalty)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">State Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.state > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.state)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">FICA:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.fica > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.fica)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">Cap Gains Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.capitalGains > 0 ? 'text-lime-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.capitalGains)}
                                </span>
                            </div>
                            <div>
                                <span className="text-gray-400">Withdrawal Tax:</span>
                                <span className={`ml-2 font-mono ${selectedYearData.taxDetails.withdrawalOrdinaryTax > 0 ? 'text-purple-400' : 'text-gray-500'}`}>
                                    {toCurrencyShort(selectedYearData.taxDetails.withdrawalOrdinaryTax)}
                                </span>
                            </div>
                        </div>
                            );
                        })()}
                        <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500">
                            Cap Gains Tax is from brokerage/ESPP withdrawals.
                            Withdrawal Tax is from Roth earnings (5-year rule), Traditional, or HSA non-medical.
                            Early-Withdraw Penalty is the 10% penalty on Traditional pre-59½ and Roth conversion 5-year-rule withdrawals (also bundled into the engine's `taxDetails.fed`).
                            {selectedYearData.isRetired && (selectedYearData.taxDetails.fed - (selectedYearData.taxDetails.earlyWithdrawalPenalty ?? 0)) > 0 && selectedYearData.taxDetails.capitalGains === 0 && selectedYearData.taxDetails.withdrawalOrdinaryTax === 0 && (
                                <span className="text-amber-400 block mt-1">
                                    Federal income tax in retirement with $0 withdrawal taxes may indicate ordinary income (Roth conversion, etc.) above the standard deduction.
                                </span>
                            )}
                        </div>
                    </div>
                    </>
                    )}

                    {/* Logs (shown in both views) */}
                    {selectedYearData.logs.length > 0 && (
                        <div className="mt-4 bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Simulation Logs</h4>
                            <div className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
                                {selectedYearData.logs.map((log, idx) => (
                                    <div key={idx} className="text-gray-400">{log}</div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
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
            const nextMortgage = currentMortgage.increment(assumptions);

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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
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
                </div>

                {/* --- Results Table --- */}
                <div className="rounded-xl border border-gray-800 overflow-hidden shadow-2xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider font-semibold">
                            <tr>
                                <th className="p-4 border-b border-gray-800">Year</th>
                                <th className="p-4 border-b border-gray-800 text-right">Valuation</th>
                                <th className="p-4 border-b border-gray-800 text-right text-red-400">Interest</th>
                                <th className="p-4 border-b border-gray-800 text-right text-emerald-400">Principal</th>
                                <th className="p-4 border-b border-gray-800 text-right text-orange-400">Taxes</th>
                                <th className="p-4 border-b border-gray-800 text-right text-yellow-400">Ins/Maint</th>
                                <th className="p-4 border-b border-gray-800 text-right">PMI/HOA</th>
                                <th className="p-4 border-b border-gray-800 text-right font-bold text-white">Total Outflow</th>
                                <th className="p-4 border-b border-gray-800 text-right text-blue-400">Remaining Bal</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 bg-gray-950">
                            {simulationData.map((row) => (
                                <tr key={row.year} className="hover:bg-gray-900/40 transition-colors">
                                    <td className="p-4 font-mono text-gray-500">{row.year}</td>
                                    <td className="p-4 text-right font-mono text-gray-300">{toCurrency(row.valuation)}</td>
                                    <td className="p-4 text-right font-mono text-red-500/80">{toCurrency(row.interestPaid)}</td>
                                    <td className="p-4 text-right font-mono text-emerald-500/80">{toCurrency(row.principalPaid)}</td>
                                    <td className="p-4 text-right font-mono text-orange-500/80">{toCurrency(row.propertyTax)}</td>
                                    <td className="p-4 text-right font-mono text-yellow-500/80">{toCurrency(row.insurance + row.repairs)}</td>
                                    <td className="p-4 text-right font-mono text-gray-400">{toCurrency(row.pmi + row.hoa)}</td>
                                    <td className="p-4 text-right font-mono font-bold text-gray-200 bg-gray-900/20">{toCurrency(row.totalCost)}</td>
                                    <td className="p-4 text-right font-mono text-blue-400 font-semibold">{toCurrency(row.endBalance)}</td>
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

            // FICA — derive SS vs Medicare split for display
            const ficaExemptions = getFicaExemptions(incomes, year);
            const ficaTaxableBase = Math.max(0, earnedIncome - ficaExemptions);
            const ssWageBase = fedParams.socialSecurityWageBase;
            const ssTax = Math.min(ficaTaxableBase, ssWageBase) * fedParams.socialSecurityTaxRate;
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

    if (simulation.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400">
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
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
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
            </div>

            {/* Summary Header */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Tax Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Filing Status:</span>
                        <span className="ml-2 text-white">{filingStatus}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">State:</span>
                        <span className="ml-2 text-white">{taxState.stateResidency}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Deduction Method:</span>
                        <span className="ml-2 text-white">{taxState.deductionMethod}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Current Year:</span>
                        <span className="ml-2 text-white">{currentYear}</span>
                    </div>
                </div>
            </div>

            {/* Year-by-Year Tax Table */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                    Tax Breakdown by Year (Click for details)
                </h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-800 sticky top-0">
                            <tr>
                                <th className="p-2 text-left text-gray-400">Year</th>
                                <th className="p-2 text-left text-gray-400">Age</th>
                                <th className="p-2 text-right text-gray-400">Gross Income</th>
                                <th className="p-2 text-right text-gray-400">Taxable</th>
                                <th className="p-2 text-right text-gray-400">Federal</th>
                                <th className="p-2 text-right text-gray-400">State</th>
                                <th className="p-2 text-right text-gray-400">FICA</th>
                                <th className="p-2 text-right text-gray-400">Cap Gains</th>
                                <th className="p-2 text-right text-gray-400">Total</th>
                                <th className="p-2 text-right text-gray-400">Eff. Rate</th>
                                <th className="p-2 text-right text-gray-400">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {taxData.map(row => row && (
                                <tr
                                    key={row.year}
                                    className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                        selectedYear === row.year ? 'bg-blue-900/30' : ''
                                    }`}
                                    onClick={() => setSelectedYear(row.year)}
                                >
                                    <td className="p-2 font-mono">{row.year}</td>
                                    <td className="p-2">{row.age}</td>
                                    <td className="p-2 text-right font-mono text-green-400">{toCurrencyShort(row.grossIncome)}</td>
                                    <td className="p-2 text-right font-mono text-gray-300">{toCurrencyShort(row.taxableIncome)}</td>
                                    <td className="p-2 text-right font-mono text-amber-400">{toCurrencyShort(row.federalTax)}</td>
                                    <td className="p-2 text-right font-mono text-yellow-400">{toCurrencyShort(row.stateTax)}</td>
                                    <td className="p-2 text-right font-mono text-orange-400">{toCurrencyShort(row.totalFica)}</td>
                                    <td className="p-2 text-right font-mono text-lime-400">{toCurrencyShort(row.capitalGainsTax)}</td>
                                    <td className="p-2 text-right font-mono text-red-400 font-semibold">{toCurrencyShort(row.totalTax)}</td>
                                    <td className="p-2 text-right font-mono text-gray-400">{(row.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right font-mono text-gray-400">{(row.marginalInfo.rate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Selected Year Details */}
            {selectedData && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-4">
                        Year {selectedData.year} Details (Age {selectedData.age})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Income Breakdown */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Income</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Gross Income:</span>
                                    <span className="font-mono text-green-400">{toCurrencyShort(selectedData.grossIncome)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Earned Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.earnedIncome)}</span>
                                </div>
                                {selectedData.ssBenefits > 0 && (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">SS Benefits:</span>
                                            <span className="font-mono text-cyan-400">{toCurrencyShort(selectedData.ssBenefits)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Taxable SS ({((selectedData.taxableSS / selectedData.ssBenefits) * 100).toFixed(0)}%):</span>
                                            <span className="font-mono text-cyan-300">{toCurrencyShort(selectedData.taxableSS)}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Deductions */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Deductions</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Pre-Tax (401k, etc):</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.preTaxDeductions)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Above-Line:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.aboveLineDeductions)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-400">AGI:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.agi)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Standard Ded:</span>
                                    <span className={`font-mono ${!selectedData.usingItemized ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {toCurrencyShort(selectedData.standardDeduction)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Itemized Ded:</span>
                                    <span className={`font-mono ${selectedData.usingItemized ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {toCurrencyShort(selectedData.itemizedDeductions)}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">SALT Cap:</span>
                                    <span className="font-mono text-gray-400">{toCurrencyShort(selectedData.saltCap)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Taxable Income:</span>
                                    <span className="font-mono text-white font-semibold">{toCurrencyShort(selectedData.taxableIncome)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Federal Tax Brackets */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Federal Brackets</h4>
                            <div className="space-y-1 text-sm">
                                {selectedData.bracketBreakdown.map((bracket, i) => (
                                    <div key={i} className="flex justify-between">
                                        <span className="text-gray-400">{(bracket.rate * 100).toFixed(0)}% on {toCurrencyShort(bracket.amount)}:</span>
                                        <span className="font-mono text-amber-400">{toCurrencyShort(bracket.tax)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Total Federal:</span>
                                    <span className="font-mono text-amber-400 font-semibold">{toCurrencyShort(selectedData.federalTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Effective Rate:</span>
                                    <span className="font-mono text-gray-300">{(selectedData.effectiveRate * 100).toFixed(2)}%</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Marginal Rate:</span>
                                    <span className="font-mono text-gray-300">{(selectedData.marginalInfo.rate * 100).toFixed(0)}%</span>
                                </div>
                                {selectedData.marginalInfo.headroom < Infinity && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Headroom:</span>
                                        <span className="font-mono text-gray-300">{toCurrencyShort(selectedData.marginalInfo.headroom)}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* State Tax */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">State Tax ({taxState.stateResidency})</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Standard Ded:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateStandardDeduction)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Taxable Income:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.stateTaxableIncome)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">State Tax:</span>
                                    <span className="font-mono text-yellow-400 font-semibold">{toCurrencyShort(selectedData.stateTax)}</span>
                                </div>
                            </div>
                        </div>

                        {/* FICA */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">FICA / Payroll</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">FICA Taxable:</span>
                                    <span className="font-mono text-white">{toCurrencyShort(selectedData.ficaTaxableBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">SS Wage Base:</span>
                                    <span className="font-mono text-gray-400">{toCurrencyShort(selectedData.ssWageBase)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Social Security (6.2%):</span>
                                    <span className="font-mono text-orange-400">{toCurrencyShort(selectedData.ssTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Medicare (1.45%):</span>
                                    <span className="font-mono text-orange-400">{toCurrencyShort(selectedData.medicareTax)}</span>
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1">
                                    <span className="text-gray-300 font-medium">Total FICA:</span>
                                    <span className="font-mono text-orange-400 font-semibold">{toCurrencyShort(selectedData.totalFica)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Capital Gains */}
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">Capital Gains</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Cap Gains Tax:</span>
                                    <span className="font-mono text-lime-400">{toCurrencyShort(selectedData.capitalGainsTax)}</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                    From brokerage account withdrawals. Taxed at preferential long-term rates (0/15/20%).
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total Summary */}
                    <div className="mt-4 p-3 bg-gray-800 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold text-white">Total Tax Burden</span>
                            <span className="text-xl font-mono text-red-400 font-bold">{toCurrencyShort(selectedData.totalTax)}</span>
                        </div>
                        <div className="text-sm text-gray-400 mt-1">
                            {((selectedData.totalTax / selectedData.grossIncome) * 100).toFixed(1)}% of gross income
                        </div>
                    </div>
                </div>
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
        return incomes.filter(inc =>
            inc instanceof FutureSocialSecurityIncome || inc instanceof CurrentSocialSecurityIncome
        );
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 bg-gray-900 p-6 rounded-xl border border-gray-800">
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
            </div>

            {/* Configuration */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">Social Security Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Full Retirement Age:</span>
                        <span className="ml-2 text-white">{fra}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Years of Earnings:</span>
                        <span className="ml-2 text-white">{earningsHistory.length}</span>
                        {priorYearsWorked > 0 && (
                            <span className="ml-1 text-xs text-cyan-400">({priorYearsWorked} prior)</span>
                        )}
                    </div>
                    <div>
                        <span className="text-gray-400">SS Income Objects:</span>
                        <span className="ml-2 text-white">{ssIncomes.length}</span>
                    </div>
                </div>
                {ssIncomes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Current SS Incomes: </span>
                        {ssIncomes.map((inc, idx) => (
                            <span key={idx} className="text-xs bg-cyan-900/50 px-2 py-1 rounded mr-2">
                                {inc.name}: {toCurrencyShort(inc.amount)}/mo
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Bend Points Info */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">PIA Bend Points (Year {birthYear + 62})</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">First Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.first)}</div>
                        <div className="text-xs text-gray-400">90% of AIME up to this amount</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">Second Bend Point</div>
                        <div className="text-2xl font-mono text-white">{toCurrencyShort(bendPoints.second)}</div>
                        <div className="text-xs text-gray-400">32% of AIME between bend points</div>
                    </div>
                    <div className="bg-gray-800 p-3 rounded-lg">
                        <div className="text-cyan-400 font-semibold">Above Second</div>
                        <div className="text-2xl font-mono text-white">15%</div>
                        <div className="text-xs text-gray-400">of AIME above second bend point</div>
                    </div>
                </div>
            </div>

            {/* Claiming Age Comparison */}
            {claimingAnalysis && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                        Benefit by Claiming Age
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Claiming Age</th>
                                    <th className="p-2 text-right text-gray-400">AIME</th>
                                    <th className="p-2 text-right text-gray-400">PIA (at FRA)</th>
                                    <th className="p-2 text-right text-gray-400">Adjustment</th>
                                    <th className="p-2 text-right text-gray-400">Monthly Benefit</th>
                                    <th className="p-2 text-right text-gray-400">Annual Benefit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {claimingAnalysis.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${
                                            row.age === highlightClaimingAge ? 'bg-purple-900/30 ring-1 ring-purple-500' :
                                            row.age === fra ? 'bg-cyan-900/20' : ''
                                        }`}
                                        onClick={() => setHighlightClaimingAge(row.age)}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-purple-900/50 px-1 rounded text-purple-400">Selected</span>
                                            )}
                                            {row.age === fra && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-cyan-900/50 px-1 rounded text-cyan-400">FRA</span>
                                            )}
                                            {row.age === 70 && row.age !== highlightClaimingAge && (
                                                <span className="ml-2 text-xs bg-green-900/50 px-1 rounded text-green-400">MAX</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.aime)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{toCurrencyShort(row.pia)}</td>
                                        <td className={`p-2 text-right font-mono ${
                                            row.adjustmentFactor < 1 ? 'text-red-400' :
                                            row.adjustmentFactor > 1 ? 'text-green-400' : 'text-white'
                                        }`}>
                                            {(row.adjustmentFactor * 100).toFixed(1)}%
                                        </td>
                                        <td className="p-2 text-right font-mono text-cyan-400 font-semibold">
                                            {toCurrencyShort(row.adjustedBenefit)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-cyan-300">
                                            {toCurrencyShort(row.annualBenefit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Earnings History */}
            {earningsHistory.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                        Earnings History (from Simulation)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Year</th>
                                    <th className="p-2 text-right text-gray-400">Earnings</th>
                                    <th className="p-2 text-right text-gray-400">SS Wage Base</th>
                                    <th className="p-2 text-right text-gray-400">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {earningsHistory.map(record => {
                                    const wageBase = getWageBase(record.year, 0.025, assumptions.macro.inflationAdjusted);
                                    const atMax = record.amount >= wageBase * 0.99;
                                    return (
                                        <tr key={record.year} className="border-t border-gray-800">
                                            <td className="p-2 font-mono">{record.year}</td>
                                            <td className="p-2 text-right font-mono text-green-400">
                                                {toCurrencyShort(record.amount)}
                                            </td>
                                            <td className="p-2 text-right font-mono text-gray-400">
                                                {toCurrencyShort(wageBase)}
                                            </td>
                                            <td className="p-2 text-right">
                                                {atMax ? (
                                                    <span className="text-xs bg-green-900/50 px-2 py-0.5 rounded text-green-400">At Max</span>
                                                ) : (
                                                    <span className="text-xs text-gray-500">
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
                    <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
                        Top 35 years of indexed earnings are used to calculate AIME. Earnings after age 60 are not indexed.
                    </div>
                </div>
            )}

            {/* Detailed PIA Breakdown */}
            {detailedBreakdown && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-3">PIA Calculation Breakdown</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">AIME Calculation</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Index Year (Age 60):</span>
                                    <span className="font-mono text-white">{detailedBreakdown.indexYear}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Top 35 Earnings Sum:</span>
                                    <span className="font-mono text-white">
                                        {toCurrencyShort(detailedBreakdown.indexedEarnings.reduce((a, b) => a + b, 0))}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">÷ 420 months:</span>
                                    <span className="font-mono text-cyan-400 font-semibold">
                                        {toCurrencyShort(detailedBreakdown.aime)}/mo
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded-lg">
                            <h4 className="font-semibold text-gray-300 mb-2">PIA Formula</h4>
                            <div className="space-y-1 text-sm font-mono">
                                <div className="text-gray-400">
                                    90% × min({toCurrencyShort(detailedBreakdown.aime)}, {toCurrencyShort(detailedBreakdown.bendPoints.first)})
                                </div>
                                <div className="text-gray-400">
                                    + 32% × amount between ${detailedBreakdown.bendPoints.first} and ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="text-gray-400">
                                    + 15% × amount above ${detailedBreakdown.bendPoints.second}
                                </div>
                                <div className="flex justify-between border-t border-gray-700 pt-1 mt-2">
                                    <span className="text-gray-300">= PIA:</span>
                                    <span className="text-cyan-400 font-semibold">{toCurrencyShort(detailedBreakdown.pia)}/mo</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {simulation.length === 0 && (
                <div className="text-center py-8 text-gray-400">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-gray-900 p-6 rounded-xl border border-gray-800">
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
            </div>

            {/* What-If RMD Projection */}
            {whatIfProjection && whatIfProjection.length > 0 && (
                <div className="bg-linear-to-r from-amber-900/30 to-orange-900/30 p-4 rounded-xl border border-amber-700/50">
                    <h3 className="text-lg font-bold text-amber-300 mb-3">
                        What-If RMD Projection ({toCurrencyShort(additionalBalance)} starting balance, {growthRate}% growth)
                    </h3>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-amber-900/30 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-amber-300">Age</th>
                                    <th className="p-2 text-right text-amber-300">Balance (BOY)</th>
                                    <th className="p-2 text-right text-amber-300">Dist. Period</th>
                                    <th className="p-2 text-right text-amber-300">RMD Amount</th>
                                    <th className="p-2 text-right text-amber-300">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {whatIfProjection.map(row => (
                                    <tr
                                        key={row.age}
                                        className={`border-t border-amber-800/30 ${
                                            row.age === focusAge ? 'bg-amber-900/40 ring-1 ring-amber-500' : ''
                                        }`}
                                    >
                                        <td className="p-2 font-mono">
                                            {row.age}
                                            {row.age === rmdStartAge && (
                                                <span className="ml-2 text-xs bg-amber-900/50 px-1 rounded text-amber-400">Start</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">{toCurrencyShort(row.balance)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{row.distributionPeriod.toFixed(1)}</td>
                                        <td className="p-2 text-right font-mono text-amber-400 font-semibold">{toCurrencyShort(row.rmdAmount)}</td>
                                        <td className="p-2 text-right font-mono text-gray-400">{row.percentOfBalance.toFixed(1)}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Configuration */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">RMD Configuration</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <span className="text-gray-400">Birth Year:</span>
                        <span className="ml-2 text-white">{birthYear}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">RMD Start Age:</span>
                        <span className="ml-2 text-white">{rmdStartAge}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">RMD-Eligible Accounts:</span>
                        <span className="ml-2 text-white">{rmdAccounts.length}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Current Age:</span>
                        <span className="ml-2 text-white">{startAge}</span>
                    </div>
                </div>
                {rmdAccounts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                        <span className="text-gray-400 text-sm">Traditional Accounts: </span>
                        {rmdAccounts.map((acc, idx) => (
                            <span key={idx} className="text-xs bg-amber-900/50 px-2 py-1 rounded mr-2">
                                {acc.name}: {toCurrencyShort(acc.amount)}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* RMD Start Age Rules */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">SECURE Act 2.0 RMD Rules</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear <= 1950 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1950 or earlier</div>
                        <div className="text-2xl font-mono text-white">Age 72</div>
                    </div>
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear > 1950 && birthYear <= 1959 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1951-1959</div>
                        <div className="text-2xl font-mono text-white">Age 73</div>
                    </div>
                    <div className={`bg-gray-800 p-3 rounded-lg ${birthYear >= 1960 ? 'ring-2 ring-amber-500' : ''}`}>
                        <div className="text-amber-400 font-semibold">Born 1960 or later</div>
                        <div className="text-2xl font-mono text-white">Age 75</div>
                    </div>
                </div>
            </div>

            {/* RMD Table by Year - from Simulation */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <h3 className="text-lg font-bold text-white p-4 border-b border-gray-800">
                    RMD by Year (From Your Simulation)
                    <span className="ml-2 text-xs font-normal text-gray-500">
                        Based on your Traditional 401k/IRA accounts
                    </span>
                </h3>
                {rmdData.length === 0 || rmdAccounts.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
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
                            <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                    <th className="p-2 text-left text-gray-400">Year</th>
                                    <th className="p-2 text-left text-gray-400">Age</th>
                                    <th className="p-2 text-right text-gray-400">Distribution Period</th>
                                    <th className="p-2 text-right text-gray-400">Traditional Balance</th>
                                    <th className="p-2 text-right text-gray-400">Required RMD</th>
                                    <th className="p-2 text-right text-gray-400">% of Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rmdData.map(row => (
                                    <tr
                                        key={row.year}
                                        className={`border-t border-gray-800 ${
                                            row.age === row.rmdStartAge ? 'bg-amber-900/20' : ''
                                        } ${!row.required ? 'opacity-50' : ''}`}
                                    >
                                        <td className="p-2 font-mono">{row.year}</td>
                                        <td className="p-2">
                                            {row.age}
                                            {row.age === row.rmdStartAge && (
                                                <span className="ml-2 text-xs bg-amber-900/50 px-1 rounded text-amber-400">RMD Starts</span>
                                            )}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-400">
                                            {row.required ? row.distributionPeriod.toFixed(1) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-white">
                                            {toCurrencyShort(row.totalTraditionalBalance)}
                                        </td>
                                        <td className="p-2 text-right font-mono text-amber-400 font-semibold">
                                            {row.required ? toCurrencyShort(row.totalRMD) : '-'}
                                        </td>
                                        <td className="p-2 text-right font-mono text-gray-400">
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
            </div>

            {/* Distribution Period Table */}
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                <h3 className="text-lg font-bold text-white mb-3">IRS Uniform Lifetime Table (Excerpt)</h3>
                <div className="grid grid-cols-4 md:grid-cols-6 gap-2 text-sm">
                    {[73, 75, 80, 85, 90, 95].map(age => (
                        <div key={age} className={`bg-gray-800 p-2 rounded text-center ${
                            startAge === age ? 'ring-2 ring-amber-500' : ''
                        }`}>
                            <div className="text-gray-400 text-xs">Age {age}</div>
                            <div className="font-mono text-white">{getDistributionPeriod(age).toFixed(1)}</div>
                            <div className="text-xs text-amber-400">
                                {(100 / getDistributionPeriod(age)).toFixed(1)}%
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 text-xs text-gray-500">
                    Distribution Period = Life expectancy factor. RMD = Prior Year Balance ÷ Distribution Period.
                    The percentage shown is the effective withdrawal rate for that age.
                </div>
            </div>
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
        0.10: 'bg-green-600',
        0.12: 'bg-green-500',
        0.22: 'bg-yellow-500',
        0.24: 'bg-orange-500',
        0.32: 'bg-red-500',
        0.35: 'bg-red-600',
        0.37: 'bg-red-700'
    };

    if (simulation.length === 0) {
        return <div className="text-gray-400 text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Detailed breakdown by year */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-2">Bracket Details by Year</h3>
                <p className="text-gray-400 text-sm mb-4">
                    Per-year tax breakdown from the simulation. Effective rate is total tax / gross income; marginal rate is the federal bracket the last dollar of taxable income lands in. Penalty is the 10% early-withdrawal penalty (split out from federal income tax for clarity).
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Year</th>
                                <th className="text-left p-2 text-gray-400">Age</th>
                                <th className="text-right p-2 text-gray-400">AGI+LTCG</th>
                                <th className="text-right p-2 text-gray-400">Std Ded</th>
                                <th className="text-right p-2 text-gray-400">Taxable</th>
                                <th className="text-right p-2 text-gray-400">Fed</th>
                                <th className="text-right p-2 text-gray-400">Penalty</th>
                                <th className="text-right p-2 text-gray-400">State</th>
                                <th className="text-right p-2 text-gray-400">FICA</th>
                                <th className="text-right p-2 text-gray-400">LTCG</th>
                                <th className="text-right p-2 text-gray-400">NIIT</th>
                                <th className="text-right p-2 text-gray-400">Total</th>
                                <th className="text-right p-2 text-gray-400">Effective</th>
                                <th className="text-right p-2 text-gray-400">Marginal</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bracketData.map((data: any) => (
                                <tr key={data.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                    <td className="p-2 text-white">{data.year}</td>
                                    <td className="p-2 text-gray-300">{data.age}</td>
                                    <td className="p-2 text-right text-gray-300">{toCurrencyShort(data.grossIncome)}</td>
                                    <td className="p-2 text-right text-gray-400">{toCurrencyShort(data.standardDeduction)}</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(data.taxableIncome)}</td>
                                    <td className="p-2 text-right text-red-400">{toCurrencyShort(data.fedIncomeTax)}</td>
                                    <td className={`p-2 text-right ${data.penalty > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>{data.penalty > 0 ? toCurrencyShort(data.penalty) : '—'}</td>
                                    <td className="p-2 text-right text-red-300">{toCurrencyShort(data.stateTax)}</td>
                                    <td className="p-2 text-right text-red-300">{toCurrencyShort(data.ficaTax)}</td>
                                    <td className="p-2 text-right text-red-300">{toCurrencyShort(data.ltcgTax)}</td>
                                    <td className="p-2 text-right text-red-300">{toCurrencyShort(data.niitTax)}</td>
                                    <td className="p-2 text-right text-red-500 font-medium">{toCurrencyShort(data.totalTax)}</td>
                                    <td className="p-2 text-right text-amber-400">{(data.effectiveRate * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right text-orange-400">{(data.marginalRate * 100).toFixed(0)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bracket thresholds over time */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-2">
                    Federal Bracket Thresholds Over Time ({filingStatus})
                </h3>
                <p className="text-gray-400 text-sm mb-4">
                    {assumptions.macro.inflationAdjusted
                        ? `Shows how tax bracket thresholds inflate based on ${assumptions.macro.inflationRate}% assumed inflation rate.`
                        : 'Inflation adjustment is disabled. Bracket thresholds remain at current year values.'}
                </p>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Year</th>
                                <th className="text-right p-2 text-gray-400">Std Ded</th>
                                {[10, 12, 22, 24, 32, 35, 37].map(rate => (
                                    <th key={rate} className="text-right p-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${bracketColors[rate / 100] || 'bg-gray-600'} text-white`}>
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
                                    <tr key={data.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-white font-medium">{data.year}</td>
                                        <td className="p-2 text-right text-green-400">{toCurrencyShort(params.standardDeduction)}</td>
                                        {params.brackets.map((bracket, i) => {
                                            const nextBracket = params.brackets[i + 1];
                                            return (
                                                <td key={i} className="p-2 text-right text-gray-300">
                                                    {toCurrencyShort(bracket.threshold)}
                                                    {nextBracket && (
                                                        <span className="text-gray-500 text-xs ml-1">
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
            </div>

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
            const reducedBenefit = baseBenefit * (1 - eligibility.reductionPercent / 100);

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
            const reducedBenefit = baseBenefit * (1 - eligibility.reductionPercent / 100);

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
                const annualBenefit = baseBenefit * reductionFactor;

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
                const reductionFactor = 1 - eligibility.reductionPercent / 100;
                const annualBenefit = baseBenefit * reductionFactor;

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
            <div className="text-gray-400 text-center py-8">
                <p>No pension or work income data to analyze.</p>
                <p className="text-sm mt-2">Add a FERS or CSRS pension to see detailed calculations.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* FERS vs CSRS Comparison */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Pension System Comparison</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <h4 className="font-semibold text-cyan-400 mb-2">FERS</h4>
                        <ul className="text-sm text-gray-300 space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.FERS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.FERS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.FERS.socialSecurity}</li>
                            <li>• Supplement: {PENSION_SYSTEM_COMPARISON.FERS.supplement}</li>
                        </ul>
                    </div>
                    <div className="bg-gray-800 p-4 rounded-lg">
                        <h4 className="font-semibold text-amber-400 mb-2">CSRS</h4>
                        <ul className="text-sm text-gray-300 space-y-1">
                            <li>• {PENSION_SYSTEM_COMPARISON.CSRS.basicBenefitFormula}</li>
                            <li>• COLA: {PENSION_SYSTEM_COMPARISON.CSRS.cola}</li>
                            <li>• Social Security: {PENSION_SYSTEM_COMPARISON.CSRS.socialSecurity}</li>
                            <li>• Max Benefit: {PENSION_SYSTEM_COMPARISON.CSRS.maxBenefit}</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Retirement Age Explorer */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Retirement Age Explorer</h3>
                <p className="text-sm text-gray-400 mb-4">
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
                    <div className={`p-4 rounded-lg mb-6 ${selectedAgeData.eligible ? 'bg-green-900/20 border border-green-700/50' : 'bg-yellow-900/20 border border-yellow-700/50'}`}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <div className="text-gray-400 text-xs">Retire at Age</div>
                                <div className="text-2xl font-bold text-white">{selectedAgeData.age}</div>
                                <div className="text-xs text-gray-500">Year {birthYear + selectedAgeData.age}</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-xs">Years of Service</div>
                                <div className="text-2xl font-bold text-white">{selectedAgeData.yearsOfService}</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-xs">Annual Benefit</div>
                                <div className="text-2xl font-bold text-green-400">{toCurrencyShort(selectedAgeData.annualBenefit)}</div>
                                <div className="text-xs text-gray-400">{toCurrencyShort(selectedAgeData.monthlyBenefit)}/mo</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-xs">Reduction</div>
                                <div className={`text-2xl font-bold ${selectedAgeData.reductionPercent > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                    {selectedAgeData.reductionPercent > 0 ? `-${selectedAgeData.reductionPercent.toFixed(1)}%` : 'None'}
                                </div>
                            </div>
                        </div>
                        <div className={`mt-3 text-sm ${selectedAgeData.eligible ? 'text-green-400' : 'text-yellow-400'}`}>
                            {selectedAgeData.message}
                        </div>
                    </div>
                )}

                {/* Comparison Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="text-left p-2 text-gray-400">Age</th>
                                <th className="text-center p-2 text-gray-400">YOS</th>
                                <th className="text-right p-2 text-gray-400">High-3</th>
                                <th className="text-right p-2 text-gray-400">Reduction</th>
                                <th className="text-right p-2 text-gray-400">Annual</th>
                                <th className="text-right p-2 text-gray-400">Monthly</th>
                                <th className="text-right p-2 text-gray-400">Lifetime*</th>
                                <th className="text-left p-2 text-gray-400">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {explorerData.map((row) => (
                                <tr
                                    key={row.age}
                                    className={`border-b border-gray-800 cursor-pointer transition-colors ${
                                        row.isSelected
                                            ? 'bg-blue-900/30 border-blue-700'
                                            : row.age === mra
                                            ? 'bg-cyan-900/10'
                                            : 'hover:bg-gray-800/50'
                                    }`}
                                    onClick={() => setExplorerRetirementAge(row.age)}
                                >
                                    <td className="p-2 text-white font-medium">
                                        {row.age}
                                        {row.age === mra && <span className="ml-1 text-xs text-cyan-400">(MRA)</span>}
                                        {row.age === 62 && <span className="ml-1 text-xs text-green-400">(62)</span>}
                                    </td>
                                    <td className="p-2 text-center text-gray-300">{row.yearsOfService}</td>
                                    <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.high3)}</td>
                                    <td className={`p-2 text-right ${row.reductionPercent > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                        {row.reductionPercent > 0 ? `-${row.reductionPercent.toFixed(1)}%` : '0%'}
                                    </td>
                                    <td className="p-2 text-right text-white font-semibold">{toCurrencyShort(row.annualBenefit)}</td>
                                    <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.monthlyBenefit)}</td>
                                    <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.lifetimeBenefit)}</td>
                                    <td className="p-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                            row.eligible ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'
                                        }`}>
                                            {row.eligible ? 'Eligible' : 'Reduced'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    * Lifetime benefit assumes life expectancy of {getLifeExpectancy(assumptions.milestones)}.
                    {assumptions.macro.inflationAdjusted
                        ? ' Values shown in today\'s dollars (real). COLA growth excluded as it roughly offsets inflation.'
                        : ` Values shown in future dollars (nominal) with ${assumptions.macro.inflationRate}% annual COLA applied.`
                    }
                    {' '}Click a row to select that retirement age.
                </p>
            </div>

            {/* FERS Pensions */}
            {fersDetails.map((detail, idx) => (
                <div key={idx} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-cyan-400 mb-4">
                        FERS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">MRA (Birth {birthYear})</div>
                            <div className="text-xl font-bold text-white">{detail.mra}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-gray-800 p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Multiplier ({detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'})</span>
                                <span className="text-gray-300">{detail.pension.retirementAge >= 62 && detail.pension.yearsOfService >= 20 ? '1.1%' : '1.0%'} per year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Base Benefit ({detail.pension.yearsOfService} years × High-3)</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-red-400">
                                    <span>MRA+10 Early Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-gray-700 pt-2">
                                <span className="text-green-400 font-semibold">Final Annual Benefit</span>
                                <span className="text-green-400 font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Monthly</span>
                                <span className="text-gray-300">{toCurrency(detail.reducedBenefit / 12)}/month</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-green-400' : 'text-red-400'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">
                            Benefit Projection {assumptions.macro.inflationAdjusted ? '(Today\'s Dollars)' : `(Nominal with ${assumptions.macro.inflationRate}% COLA)`}
                        </h4>
                        <div className="text-xs text-gray-400 mb-2">
                            {assumptions.macro.inflationAdjusted
                                ? "Values shown in today's dollars. COLA growth excluded as it roughly offsets inflation."
                                : "FERS COLA: None before age 62. After 62: Full if CPI ≤ 2%, 2% if 2-3%, CPI-1% if > 3%"
                            }
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700">
                                        <th className="text-left p-2 text-gray-400">Age</th>
                                        <th className="text-left p-2 text-gray-400">Year</th>
                                        <th className="text-right p-2 text-gray-400">COLA</th>
                                        <th className="text-right p-2 text-gray-400">Annual Benefit</th>
                                        <th className="text-right p-2 text-gray-400">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className={`border-b border-gray-800 ${row.age === 62 ? 'bg-cyan-900/20' : ''}`}>
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-gray-300">{row.year}</td>
                                            <td className="p-2 text-right text-cyan-400">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.benefit / 12)}</td>
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
                <div key={idx} className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-amber-400 mb-4">
                        CSRS Pension: {detail.pension.name}
                    </h3>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Years of Service</div>
                            <div className="text-xl font-bold text-white">{detail.pension.yearsOfService}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">High-3 Salary</div>
                            <div className="text-xl font-bold text-white">{toCurrencyShort(detail.pension.high3Salary)}</div>
                        </div>
                        <div className="bg-gray-800 p-3 rounded">
                            <div className="text-gray-400 text-xs">Retirement Age</div>
                            <div className="text-xl font-bold text-white">{detail.pension.retirementAge}</div>
                        </div>
                    </div>

                    {/* Benefit Calculation Breakdown */}
                    <div className="bg-gray-800 p-4 rounded mb-4">
                        <h4 className="font-semibold text-white mb-3">CSRS Benefit Calculation</h4>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">First 5 years @ 1.5%</span>
                                <span className="text-gray-300">{toCurrency(Math.min(detail.pension.yearsOfService, 5) * detail.pension.high3Salary * 0.015)}</span>
                            </div>
                            {detail.pension.yearsOfService > 5 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Years 6-10 @ 1.75%</span>
                                    <span className="text-gray-300">{toCurrency(Math.min(detail.pension.yearsOfService - 5, 5) * detail.pension.high3Salary * 0.0175)}</span>
                                </div>
                            )}
                            {detail.pension.yearsOfService > 10 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Years 11+ @ 2.0%</span>
                                    <span className="text-gray-300">{toCurrency((detail.pension.yearsOfService - 10) * detail.pension.high3Salary * 0.02)}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-400">Base Benefit</span>
                                <span className="text-white font-semibold">{toCurrency(detail.baseBenefit)}/year</span>
                            </div>
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>Max (80% of High-3)</span>
                                <span>{toCurrency(detail.pension.high3Salary * 0.8)}</span>
                            </div>
                            {detail.eligibility.reductionPercent > 0 && (
                                <div className="flex justify-between text-red-400">
                                    <span>Early Retirement Reduction</span>
                                    <span>-{detail.eligibility.reductionPercent}%</span>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-gray-700 pt-2">
                                <span className="text-green-400 font-semibold">Final Annual Benefit</span>
                                <span className="text-green-400 font-bold">{toCurrency(detail.reducedBenefit)}/year</span>
                            </div>
                        </div>
                    </div>

                    {/* Eligibility */}
                    <div className={`p-3 rounded mb-4 ${detail.eligibility.eligible ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}>
                        <div className={`font-semibold ${detail.eligibility.eligible ? 'text-green-400' : 'text-red-400'}`}>
                            {detail.eligibility.message}
                        </div>
                    </div>

                    {/* COLA Projection */}
                    <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-semibold text-white mb-3">
                            Benefit Projection {assumptions.macro.inflationAdjusted ? '(Today\'s Dollars)' : `(Nominal with ${assumptions.macro.inflationRate}% COLA)`}
                        </h4>
                        <div className="text-xs text-gray-400 mb-2">
                            {assumptions.macro.inflationAdjusted
                                ? "Values shown in today's dollars. COLA growth excluded as it roughly offsets inflation."
                                : "CSRS receives full CPI COLA regardless of age."
                            }
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-700">
                                        <th className="text-left p-2 text-gray-400">Age</th>
                                        <th className="text-left p-2 text-gray-400">Year</th>
                                        <th className="text-right p-2 text-gray-400">COLA</th>
                                        <th className="text-right p-2 text-gray-400">Annual Benefit</th>
                                        <th className="text-right p-2 text-gray-400">Monthly</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.colaProjection.slice(0, 15).map((row: any) => (
                                        <tr key={row.age} className="border-b border-gray-800">
                                            <td className="p-2 text-white">{row.age}</td>
                                            <td className="p-2 text-gray-300">{row.year}</td>
                                            <td className="p-2 text-right text-amber-400">{row.cola.toFixed(1)}%</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(row.benefit)}</td>
                                            <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.benefit / 12)}</td>
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
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-white mb-4">High-3 Salary Tracking (From Simulation)</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Your High-3 is the average of your highest 3 consecutive years of salary.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-700">
                                    <th className="text-left p-2 text-gray-400">Year</th>
                                    <th className="text-left p-2 text-gray-400">Age</th>
                                    <th className="text-right p-2 text-gray-400">Year -2</th>
                                    <th className="text-right p-2 text-gray-400">Year -1</th>
                                    <th className="text-right p-2 text-gray-400">Current</th>
                                    <th className="text-right p-2 text-gray-400">High-3 Avg</th>
                                </tr>
                            </thead>
                            <tbody>
                                {high3Tracking.high3History.map((row: any) => (
                                    <tr key={row.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-white">{row.year}</td>
                                        <td className="p-2 text-gray-300">{row.age}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.salaries[0])}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(row.salaries[1])}</td>
                                        <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.salaries[2])}</td>
                                        <td className="p-2 text-right text-green-400 font-semibold">{toCurrencyShort(row.high3)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// ROTH ANALYSIS DEBUG TAB
// ============================================================================

// --- Section 1: Recommendation Summary ---
function RothRecommendationSummary({ currentRate, retirementRate, currentFedRate, currentStateRate, retirementFedRate, retirementStateRate }: {
    currentRate: number;
    retirementRate: number;
    currentFedRate: number;
    currentStateRate: number;
    retirementFedRate: number;
    retirementStateRate: number;
}) {
    const diff = currentRate - retirementRate;
    const verdict = diff > 0.02 ? 'pretax' : diff < -0.02 ? 'roth' : 'close';

    const bannerStyles = {
        pretax: 'bg-blue-900/30 border-blue-700/50',
        roth: 'bg-green-900/30 border-green-700/50',
        close: 'bg-yellow-900/30 border-yellow-700/50'
    };
    const textStyles = {
        pretax: 'text-blue-300',
        roth: 'text-green-300',
        close: 'text-yellow-300'
    };
    const verdictText = {
        pretax: 'Pre-Tax Wins',
        roth: 'Roth Wins',
        close: 'Close Call'
    };
    const explanations = {
        pretax: `Your current marginal rate (${(currentRate * 100).toFixed(1)}%) is higher than your projected retirement rate (${(retirementRate * 100).toFixed(1)}%). Every $1 contributed pre-tax saves you ${(currentRate * 100).toFixed(1)}% today; you'll only pay ${(retirementRate * 100).toFixed(1)}% on withdrawal.`,
        roth: `Your projected retirement rate (${(retirementRate * 100).toFixed(1)}%) exceeds your current marginal rate (${(currentRate * 100).toFixed(1)}%). Paying tax now at the lower rate and withdrawing tax-free is more efficient.`,
        close: `Your current rate (${(currentRate * 100).toFixed(1)}%) and retirement rate (${(retirementRate * 100).toFixed(1)}%) are within 2% of each other. Consider splitting contributions or using bracket-filling strategies.`
    };

    return (
        <div className="space-y-4">
            <div className={`p-4 rounded-lg border ${bannerStyles[verdict]}`}>
                <h3 className={`text-2xl font-bold ${textStyles[verdict]} text-center`}>{verdictText[verdict]}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                    <span className="text-gray-400 text-sm">Current Marginal Rate</span>
                    <p className="text-white text-2xl font-bold">{(currentRate * 100).toFixed(1)}%</p>
                    <p className="text-gray-400 text-xs mt-1">Fed: {(currentFedRate * 100).toFixed(1)}% | State: {(currentStateRate * 100).toFixed(1)}%</p>
                    <p className="text-gray-500 text-xs">FICA excluded (applies to both paths)</p>
                </div>
                <div className="bg-gray-800 p-4 rounded-lg text-center">
                    <span className="text-gray-400 text-sm">Projected Retirement Rate</span>
                    <p className="text-white text-2xl font-bold">{(retirementRate * 100).toFixed(1)}%</p>
                    <p className="text-gray-400 text-xs mt-1">Fed: {(retirementFedRate * 100).toFixed(1)}% | State: {(retirementStateRate * 100).toFixed(1)}%</p>
                    <p className="text-gray-500 text-xs">Median effective rate in retirement</p>
                </div>
            </div>
            <p className="text-gray-300 text-sm">{explanations[verdict]}</p>
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
        'Working': 'text-blue-400',
        'Gap': 'text-green-400',
        'SS/Pension': 'text-amber-400',
        'RMD': 'text-purple-400'
    };

    return (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-4">Tax Rate Timeline</h3>
            <p className="text-gray-400 text-sm mb-4">Year-by-year marginal and effective rates. Green "Gap" years are prime conversion windows.</p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-700">
                            <th className="text-left p-2 text-gray-400">Year</th>
                            <th className="text-left p-2 text-gray-400">Age</th>
                            <th className="text-left p-2 text-gray-400">Phase</th>
                            <th className="text-right p-2 text-gray-400">Gross Income</th>
                            <th className="text-right p-2 text-gray-400">Taxable Income</th>
                            <th className="text-right p-2 text-gray-400">Fed Marginal</th>
                            <th className="text-right p-2 text-gray-400">Effective Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {timelineData.map(row => (
                            <tr key={row.year} className={`border-b border-gray-800 hover:bg-gray-800/50 ${row.phase === 'Gap' ? 'bg-green-900/10' : ''}`}>
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-gray-300">{row.age}</td>
                                <td className={`p-2 font-semibold ${phaseColors[row.phase]}`}>{row.phase}</td>
                                <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.grossIncome)}</td>
                                <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.taxableIncome)}</td>
                                <td className="p-2 text-right text-white font-semibold">{(row.federalMarginalRate * 100).toFixed(0)}%</td>
                                <td className={`p-2 text-right font-semibold ${
                                    row.effectiveRate > 0.3 ? 'text-red-400' :
                                    row.effectiveRate > 0.15 ? 'text-amber-400' : 'text-green-400'
                                }`}>
                                    {(row.effectiveRate * 100).toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
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
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Bracket Headroom Analysis</h3>
                <p className="text-gray-400 text-center py-4">No retirement years in simulation or no Traditional account balances.</p>
            </div>
        );
    }

    // Collect unique bracket rates from the data
    const bracketRates = headroomData[0]?.bracketHeadrooms.map(b => b.rate) || [];

    return (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-4">Bracket Headroom Analysis</h3>
            <p className="text-gray-400 text-sm mb-4">Room available in each federal bracket during retirement. Shows how much you can convert and stay within the target bracket.</p>
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
                    <thead className="sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-700">
                            <th className="text-left p-2 text-gray-400">Year</th>
                            <th className="text-left p-2 text-gray-400">Age</th>
                            <th className="text-right p-2 text-gray-400">Taxable Inc</th>
                            {bracketRates.map(rate => (
                                <th key={rate} className="text-right p-2 text-gray-400">{(rate * 100).toFixed(0)}% Room</th>
                            ))}
                            <th className="text-right p-2 text-gray-400">Total Room</th>
                            <th className="text-right p-2 text-gray-400">Trad. Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        {headroomData.map(row => (
                            <tr key={row.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-gray-300">{row.age}</td>
                                <td className="p-2 text-right text-gray-300">{toCurrencyShort(row.taxableIncome)}</td>
                                {row.bracketHeadrooms.map(bh => (
                                    <td key={bh.rate} className={`p-2 text-right ${bh.headroom > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                                        {bh.headroom > 0 ? toCurrencyShort(bh.headroom) : '-'}
                                    </td>
                                ))}
                                <td className="p-2 text-right text-green-400 font-semibold">{toCurrencyShort(row.totalHeadroom)}</td>
                                <td className="p-2 text-right text-blue-400">{toCurrencyShort(row.traditionalBalance)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
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
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Conversion Windows</h3>
                <p className="text-gray-400 text-center py-4">No low-tax conversion windows found. This may mean your retirement income already fills higher brackets, or you have no Traditional account balance.</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-4">Conversion Windows</h3>
            <p className="text-gray-400 text-sm mb-4">Years where Roth conversions can be done at rates below your retirement rate. Effective rate includes the SS "tax torpedo" effect.</p>

            {windowSummary && (
                <div className="bg-gray-800 p-3 rounded-lg mb-4 flex flex-wrap gap-4 text-sm">
                    <span className="text-white">Window: Ages <span className="text-green-400 font-semibold">{windowSummary.firstAge}-{windowSummary.lastAge}</span> ({windowSummary.totalYears} years)</span>
                    <span className="text-white">Total Headroom: <span className="text-green-400 font-semibold">{toCurrencyShort(windowSummary.totalHeadroom)}</span></span>
                    <span className="text-white">Total Tax Cost: <span className="text-red-400 font-semibold">{toCurrencyShort(windowSummary.totalTaxCost)}</span></span>
                    <span className="text-white">Avg Rate: <span className="text-amber-400 font-semibold">{(windowSummary.avgRate * 100).toFixed(1)}%</span></span>
                </div>
            )}

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-900">
                        <tr className="border-b border-gray-700">
                            <th className="text-left p-2 text-gray-400">Year</th>
                            <th className="text-left p-2 text-gray-400">Age</th>
                            <th className="text-right p-2 text-gray-400">Bracket Room</th>
                            <th className="text-right p-2 text-gray-400">Trad. Available</th>
                            <th className="text-right p-2 text-gray-400">Optimal Conv</th>
                            <th className="text-right p-2 text-gray-400">Tax Cost</th>
                            <th className="text-right p-2 text-gray-400">Effective Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {windows.map(row => (
                            <tr key={row.year} className={`border-b border-gray-800 hover:bg-gray-800/50 ${row.hasTorpedo ? 'bg-yellow-900/10' : ''}`}>
                                <td className="p-2 text-white">{row.year}</td>
                                <td className="p-2 text-gray-300">{row.age}</td>
                                <td className="p-2 text-right text-green-400">{toCurrencyShort(row.bracketHeadroom)}</td>
                                <td className="p-2 text-right text-blue-400">{toCurrencyShort(row.traditionalAvailable)}</td>
                                <td className="p-2 text-right text-white font-semibold">{toCurrencyShort(row.optimalConversion)}</td>
                                <td className="p-2 text-right text-red-400">{toCurrencyShort(row.taxCost)}</td>
                                <td className={`p-2 text-right font-semibold ${row.hasTorpedo ? 'text-yellow-400' : 'text-green-400'}`}>
                                    {(row.effectiveRate * 100).toFixed(1)}%{row.hasTorpedo ? '*' : ''}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {windows.some(w => w.hasTorpedo) && (
                <p className="text-yellow-400/80 text-xs mt-2">
                    * Effective rate exceeds bracket rate due to SS "tax torpedo" — conversions push Social Security benefits into taxable territory, increasing total tax beyond the marginal bracket rate.
                </p>
            )}
        </div>
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
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Roth vs Pre-Tax Contribution Comparison</h3>
                <p className="text-gray-400 text-center py-4">No active work income with 401k contributions found.</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-4">Roth vs Pre-Tax Contribution Comparison</h3>
            <p className="text-gray-400 text-sm mb-4">Compares the after-tax terminal wealth of contributing the full 401k limit as all pre-tax vs all Roth.</p>

            {comparisons.map((comp, idx) => (
                <div key={idx} className="mb-6 last:mb-0">
                    <div className="bg-gray-800 p-3 rounded-lg mb-3">
                        <div className="flex flex-wrap gap-4 text-sm">
                            <span className="text-white font-semibold">{comp.jobName}</span>
                            <span className="text-gray-400">Current: {toCurrencyShort(comp.currentPreTax)} pre-tax / {toCurrencyShort(comp.currentRoth)} Roth</span>
                            <span className="text-gray-400">Limit: {toCurrencyShort(comp.limit)}</span>
                            <span className="text-gray-400">{comp.yearsToRetirement} yrs to retirement</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-3">
                        <div className={`p-4 rounded-lg border ${comp.winner === 'pretax' ? 'border-blue-700/50 bg-blue-900/20' : 'border-gray-700 bg-gray-800'}`}>
                            <h4 className="text-blue-400 font-semibold mb-2">All Pre-Tax</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-gray-400">Contribution</span><span className="text-white">{toCurrencyShort(comp.limit)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Tax saved today</span><span className="text-green-400">{toCurrencyShort(comp.limit * comp.currentMarginalRate)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Future value</span><span className="text-white">{toCurrencyShort(comp.preTaxPath.futureValue)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Tax at withdrawal</span><span className="text-red-400">-{toCurrencyShort(comp.preTaxPath.taxAtWithdrawal)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Reinvested savings</span><span className="text-green-400">+{toCurrencyShort(comp.preTaxPath.reinvestedSavings)}</span></div>
                                <div className="flex justify-between border-t border-gray-600 pt-1 mt-1"><span className="text-white font-semibold">After-tax total</span><span className="text-white font-semibold">{toCurrencyShort(comp.preTaxPath.total)}</span></div>
                            </div>
                        </div>
                        <div className={`p-4 rounded-lg border ${comp.winner === 'roth' ? 'border-green-700/50 bg-green-900/20' : 'border-gray-700 bg-gray-800'}`}>
                            <h4 className="text-green-400 font-semibold mb-2">All Roth</h4>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span className="text-gray-400">Contribution</span><span className="text-white">{toCurrencyShort(comp.limit)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Tax paid today</span><span className="text-red-400">-{toCurrencyShort(comp.limit * comp.currentMarginalRate)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Future value</span><span className="text-white">{toCurrencyShort(comp.rothPath.futureValue)}</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">Tax at withdrawal</span><span className="text-green-400">$0</span></div>
                                <div className="flex justify-between"><span className="text-gray-400">&nbsp;</span><span>&nbsp;</span></div>
                                <div className="flex justify-between border-t border-gray-600 pt-1 mt-1"><span className="text-white font-semibold">After-tax total</span><span className="text-white font-semibold">{toCurrencyShort(comp.rothPath.total)}</span></div>
                            </div>
                        </div>
                    </div>

                    <div className={`p-3 rounded-lg border ${comp.winner === 'pretax' ? 'bg-blue-900/20 border-blue-700/50' : 'bg-green-900/20 border-green-700/50'}`}>
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <span className={`font-semibold ${comp.winner === 'pretax' ? 'text-blue-300' : 'text-green-300'}`}>
                                {comp.winner === 'pretax' ? 'Pre-Tax' : 'Roth'} wins by {toCurrencyShort(comp.advantage)} ({((comp.advantage / Math.min(comp.preTaxPath.total, comp.rothPath.total)) * 100).toFixed(1)}% better)
                            </span>
                            <span className="text-gray-400 text-sm">Breakeven retirement rate: {(comp.breakEvenRate * 100).toFixed(1)}%</span>
                        </div>
                    </div>

                    {comp.optimalSplit && (
                        <div className="mt-3 bg-gray-800 p-3 rounded-lg border border-gray-700">
                            <h4 className="text-amber-400 font-semibold text-sm mb-1">Optimal Split</h4>
                            <p className="text-gray-300 text-sm">
                                Pre-tax: {toCurrencyShort(comp.optimalSplit.preTax)} | Roth: {toCurrencyShort(comp.optimalSplit.roth)}
                            </p>
                            <p className="text-gray-400 text-xs mt-1">{comp.optimalSplit.explanation}</p>
                        </div>
                    )}
                </div>
            ))}
        </div>
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

    // --- Section 1 Data: Current vs Retirement Rate ---
    const rateComparison = useMemo(() => {
        if (simulation.length === 0) return null;

        // Current marginal rate (fed + state, no FICA)
        const firstYear = simulation[0];
        const grossIncome = getGrossIncome(firstYear.incomes, firstYear.year);
        const preTaxDeductions = getPreTaxExemptions(firstYear.incomes, firstYear.year, currentAge);
        const marginal = getCombinedMarginalRate(grossIncome, preTaxDeductions, taxState, firstYear.year, assumptions, false);

        // Retirement rate: median effective fed+state rate
        const retirementEffective = getMedianRetirementTaxRate(simulation, retirementYear);

        // Get retirement fed vs state breakdown from median year
        const retirementYears = simulation.filter(s => s.year >= retirementYear);
        let retFed = 0, retState = 0;
        if (retirementYears.length > 0) {
            const fedRates = retirementYears.map(sy => {
                const inc = sy.cashflow.totalIncome;
                return inc > 0 ? sy.taxDetails.fed / inc : 0;
            }).sort((a, b) => a - b);
            const stateRates = retirementYears.map(sy => {
                const inc = sy.cashflow.totalIncome;
                return inc > 0 ? sy.taxDetails.state / inc : 0;
            }).sort((a, b) => a - b);
            const mid = Math.floor(fedRates.length / 2);
            retFed = fedRates.length % 2 === 0 ? (fedRates[mid - 1] + fedRates[mid]) / 2 : fedRates[mid];
            retState = stateRates.length % 2 === 0 ? (stateRates[mid - 1] + stateRates[mid]) / 2 : stateRates[mid];
        }

        return {
            currentRate: marginal.federal + marginal.state,
            currentFedRate: marginal.federal,
            currentStateRate: marginal.state,
            retirementRate: retirementEffective,
            retirementFedRate: retFed,
            retirementStateRate: retState
        };
    }, [simulation, taxState, assumptions, currentAge, retirementYear]);

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
            const hasSS = simYear.incomes.some(inc => inc instanceof FutureSocialSecurityIncome || inc instanceof CurrentSocialSecurityIncome);
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

        const opportunities = findRothConversionWindows(simulation, assumptions);
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

        const retirementRate = rateComparison?.retirementRate || 0.15;
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
    }, [simulation, incomes, taxState, assumptions, currentYear, currentAge, retirementAge, ror, rateComparison]);

    if (simulation.length === 0) {
        return <div className="text-gray-400 text-center py-8">No simulation data. Run a simulation first.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Section 1: Recommendation Summary */}
            <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4">Contribution Recommendation</h3>
                {rateComparison ? (
                    <RothRecommendationSummary {...rateComparison} />
                ) : (
                    <p className="text-gray-400">Unable to calculate rate comparison.</p>
                )}
            </div>

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
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
                <h3 className="text-xl font-bold text-white mb-4">QR Code Image Decoder</h3>
                <p className="text-gray-400 mb-4">
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
                        className="px-6 py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Select QR Code Image
                    </button>
                )}

                {status === 'loading' && (
                    <div className="flex items-center gap-3 text-gray-400">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Decoding QR code...
                    </div>
                )}

                {status === 'error' && (
                    <div className="space-y-4">
                        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h4 className="text-red-400 font-semibold">Decode Failed</h4>
                                    <p className="text-red-400/80 text-sm mt-1">{errorMessage}</p>
                                    {debugInfo && <p className="text-gray-500 text-xs mt-2">{debugInfo}</p>}
                                </div>
                            </div>
                            <button
                                onClick={handleReset}
                                className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                            >
                                Try Again
                            </button>
                        </div>
                        {previewUrl && (
                            <div className="bg-gray-800 rounded-lg p-4">
                                <p className="text-gray-400 text-sm mb-2">Uploaded image:</p>
                                <img src={previewUrl} alt="Uploaded QR" className="max-w-75 mx-auto border border-gray-700 rounded" />
                            </div>
                        )}
                    </div>
                )}

                {status === 'success' && decodedData && (
                    <div className="space-y-4">
                        <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-green-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <div>
                                    <h4 className="text-green-400 font-semibold">QR Code Decoded!</h4>
                                    <ul className="text-gray-300 text-sm mt-2 space-y-1">
                                        <li>• {decodedData.accounts} account{decodedData.accounts !== 1 ? 's' : ''}</li>
                                        <li>• {decodedData.incomes} income source{decodedData.incomes !== 1 ? 's' : ''}</li>
                                        <li>• {decodedData.expenses} expense{decodedData.expenses !== 1 ? 's' : ''}</li>
                                    </ul>
                                    <p className="text-gray-500 text-xs mt-2">
                                        Compressed: {(decodedData.compressedSize / 1024).toFixed(2)} KB →
                                        Raw: {(decodedData.rawSize / 1024).toFixed(2)} KB
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleReset}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleImport}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                            >
                                Import Data
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Raw JSON Preview (collapsed by default) */}
            {rawJson && (
                <details className="bg-gray-900 rounded-lg border border-gray-800">
                    <summary className="p-4 cursor-pointer text-gray-400 hover:text-white">
                        View Raw JSON ({(rawJson.length / 1024).toFixed(2)} KB)
                    </summary>
                    <pre className="p-4 pt-0 text-xs text-gray-500 overflow-auto max-h-96">
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

    if (simulation.length === 0) return <div className="text-gray-400 p-4">No simulation data available.</div>;

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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center gap-4 mb-2">
                    <h3 className="text-lg font-bold text-white">Year: {simYear.year}</h3>
                    <span className="text-sm text-gray-400">({selectedYearIdx + 1} of {simulation.length})</span>
                </div>
                <input
                    type="range"
                    min={0}
                    max={simulation.length - 1}
                    value={selectedYearIdx}
                    onChange={(e) => setSelectedYearIdx(parseInt(e.target.value))}
                    className="w-full"
                />
            </div>

            {/* Accounts Breakdown */}
            <div className="space-y-2">
                <h4 className="text-gray-400 font-medium">Accounts by Type</h4>
                <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-green-400 font-medium">Savings (Liquid)</span>
                        <span className="text-green-400 font-bold">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
                    </div>
                    {savedAccounts.map((acc) => (
                        <div key={acc.id} className="flex justify-between text-xs text-gray-300">
                            <span>• {acc.name}</span>
                            <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                        </div>
                    ))}
                </div>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-400 font-medium">Invested (Not Liquid)</span>
                        <span className="text-gray-400">{formatCompactCurrency(totalInvested, { forceExact })}</span>
                    </div>
                    {investedAccounts.map((acc) => (
                        <div key={acc.id} className="flex justify-between text-xs text-gray-400">
                            <span>• {acc.name} ({acc.taxType})</span>
                            <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                        </div>
                    ))}
                </div>
                {propertyAccounts.length > 0 && (
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-gray-400 font-medium">Property (Not Liquid)</span>
                            <span className="text-gray-400">{formatCompactCurrency(totalProperty, { forceExact })}</span>
                        </div>
                        {propertyAccounts.map((acc) => (
                            <div key={acc.id} className="flex justify-between text-xs text-gray-400">
                                <span>• {acc.name}</span>
                                <span>{formatCompactCurrency(acc.amount, { forceExact })}</span>
                            </div>
                        ))}
                    </div>
                )}
                {debtAccounts.length > 0 && (
                    <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-red-400 font-medium">Debt</span>
                            <span className="text-red-400">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
                        </div>
                        {debtAccounts.map((acc) => (
                            <div key={acc.id} className="flex justify-between text-xs text-gray-300">
                                <span>• {acc.name}</span>
                                <span>-{formatCompactCurrency(acc.amount, { forceExact })}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Emergency Fund Calculation */}
            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
                <h4 className="text-blue-400 font-medium mb-2">Emergency Fund Calculation</h4>
                <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Liquid Assets (Savings only):</span>
                        <span className="text-white">{formatCompactCurrency(totalLiquid, { forceExact })}</span>
                    </div>
                    <div className="border-t border-blue-700/20 my-2"></div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Total Expenses:</span>
                        <span className="text-white">{formatCompactCurrency(cashflow.totalExpense, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                        <span className="pl-2">- Federal Tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.fed || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                        <span className="pl-2">- State Tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.state || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                        <span className="pl-2">- FICA:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.fica || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                        <span className="pl-2">- 401k/Pre-tax:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.preTax || 0, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                        <span className="pl-2">- Insurance:</span>
                        <span>-{formatCompactCurrency(simYear.taxDetails.insurance || 0, { forceExact })}</span>
                    </div>
                    {(simYear.taxDetails.postTax || 0) > 0 && (
                        <div className="flex justify-between text-gray-400">
                            <span className="pl-2">- Post-tax:</span>
                            <span>-{formatCompactCurrency(simYear.taxDetails.postTax || 0, { forceExact })}</span>
                        </div>
                    )}
                    <div className="flex justify-between border-t border-blue-700/30 pt-1">
                        <span className="text-gray-300">= Living Expenses:</span>
                        <span className="text-white font-medium">{formatCompactCurrency(livingExpenses, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Monthly Living Expenses:</span>
                        <span className="text-white">{formatCompactCurrency(monthlyLivingExpenses, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between border-t border-blue-700/30 pt-1 mt-1">
                        <span className="text-blue-400 font-medium">Emergency Fund Months:</span>
                        <span className="text-blue-400 font-bold">
                            {formatCompactCurrency(totalLiquid, { forceExact })} / {formatCompactCurrency(monthlyLivingExpenses, { forceExact })} = {emergencyMonths.toFixed(1)} mo
                        </span>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-800 rounded-lg p-3">
                <h4 className="text-gray-300 font-medium mb-2">Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Total Assets:</span>
                        <span className="text-white">{formatCompactCurrency(totalAssets, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Total Debt:</span>
                        <span className="text-red-400">-{formatCompactCurrency(totalDebt, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Net Worth:</span>
                        <span className="text-green-400">{formatCompactCurrency(netWorth, { forceExact })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Total Income:</span>
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

    if (simulation.length === 0) return <div className="text-gray-400 p-4">No simulation data available. Run the simulation first.</div>;

    // Compute lifetime withdrawal totals by account
    // Note: withdrawalDetail is keyed by account NAME, not ID
    const lifetimeWithdrawals: Record<string, { name: string; total: number; drainedYear: number | null }> = {};
    simulation.forEach((simYear, idx) => {
        const age = startAge + idx;
        const detail = simYear.cashflow.withdrawalDetail || {};
        for (const [accName, amount] of Object.entries(detail)) {
            if (!lifetimeWithdrawals[accName]) {
                lifetimeWithdrawals[accName] = { name: accName, total: 0, drainedYear: null };
            }
            lifetimeWithdrawals[accName].total += amount;
            // Check if account hit zero
            const acc = simYear.accounts.find(a => a.name === accName);
            if (acc && acc.amount <= 0 && amount > 0 && lifetimeWithdrawals[accName].drainedYear === null) {
                lifetimeWithdrawals[accName].drainedYear = simYear.year;
            }
        }
        // Also detect zero balances even without withdrawal in that year
        if (age >= retirementAge) {
            simYear.accounts.forEach(acc => {
                if (lifetimeWithdrawals[acc.name] && acc.amount <= 0 && lifetimeWithdrawals[acc.name].drainedYear === null && lifetimeWithdrawals[acc.name].total > 0) {
                    lifetimeWithdrawals[acc.name].drainedYear = simYear.year;
                }
            });
        }
    });

    // Detect early withdrawal penalties (withdrawals from tax-advantaged before 59.5)
    // Note: withdrawalDetail is keyed by account NAME
    const penaltyYears: Array<{ year: number; age: number; accountName: string; amount: number; penalty: number }> = [];
    simulation.forEach((simYear, idx) => {
        const age = startAge + idx;
        if (age >= 60) return; // 59.5 check - use 60 as conservative boundary
        const detail = simYear.cashflow.withdrawalDetail || {};
        for (const [accName, amount] of Object.entries(detail)) {
            if (amount <= 0) continue;
            const acc = simYear.accounts.find(a => a.name === accName);
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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
                <DropdownInput label="Show Years" value={yearFilter} onChange={setYearFilter} options={['All Years', 'Retirement Only']} />
            </div>

            {/* Section 1: Withdrawal Order */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Withdrawal Order</h3>
                <p className="text-sm text-gray-400 mb-3">
                    Strategy: <span className="text-green-400">{assumptions.investments.withdrawalStrategy}</span> at {assumptions.investments.withdrawalRate}% |
                    Configured order: {assumptions.withdrawalStrategy.map(b => b.name).join(' → ') || 'None configured'}
                </p>

                {/* Lifetime summary */}
                {Object.keys(lifetimeWithdrawals).length > 0 && (
                    <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                        {Object.entries(lifetimeWithdrawals).map(([id, data]) => (
                            <div key={id} className={`rounded-lg p-2 border ${data.drainedYear ? 'border-red-700/50 bg-red-900/10' : 'border-gray-700 bg-gray-800/50'}`}>
                                <div className="text-xs text-gray-400">{data.name}</div>
                                <div className="text-sm font-bold text-white">{toCurrencyShort(data.total)}</div>
                                {data.drainedYear && <div className="text-xs text-red-400">Drained in {data.drainedYear}</div>}
                            </div>
                        ))}
                    </div>
                )}

                {/* Year-by-year table */}
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
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
                                    <tr key={simYear.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-gray-300">{simYear.year}</td>
                                        <td className="p-2 text-gray-400">{age}</td>
                                        <td className="p-2 text-right text-white font-medium">{toCurrencyShort(total)}</td>
                                        {assumptions.withdrawalStrategy.map(b => {
                                            const acc = simYear.accounts.find(a => a.id === b.accountId);
                                            const accName = acc?.name || b.name;
                                            const amt = detail[accName] || 0;
                                            const drained = acc && acc.amount <= 0;
                                            return (
                                                <td key={b.id} className={`p-2 text-right ${drained ? 'text-red-400' : amt > 0 ? 'text-green-400' : 'text-gray-600'}`}>
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
            </div>

            {/* Section 2: Early Withdrawal Penalties */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Early Withdrawal Penalties</h3>
                {penaltyYears.length === 0 ? (
                    <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 text-green-400">
                        No early withdrawal penalties detected. All tax-advantaged withdrawals occur after age 59.5.
                    </div>
                ) : (
                    <>
                        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 mb-3 text-yellow-300">
                            {penaltyYears.length} early withdrawal(s) detected before age 59.5. Total penalties: {toCurrency(penaltyYears.reduce((s, p) => s + p.penalty, 0))}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-gray-400 border-b border-gray-700">
                                        <th className="text-left p-2">Year</th>
                                        <th className="text-left p-2">Age</th>
                                        <th className="text-left p-2">Account</th>
                                        <th className="text-right p-2">Withdrawal</th>
                                        <th className="text-right p-2">10% Penalty</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {penaltyYears.map((p, i) => (
                                        <tr key={i} className="border-b border-gray-800">
                                            <td className="p-2 text-gray-300">{p.year}</td>
                                            <td className="p-2 text-gray-400">{p.age}</td>
                                            <td className="p-2 text-white">{p.accountName}</td>
                                            <td className="p-2 text-right text-yellow-300">{toCurrency(p.amount)}</td>
                                            <td className="p-2 text-right text-red-400">{toCurrency(p.penalty)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* Section 3: Guyton-Klinger Details */}
            {isGKStrategy && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                    <h3 className="text-lg font-bold text-white mb-3">Guyton-Klinger Guardrail Details</h3>
                    <p className="text-sm text-gray-400 mb-3">
                        Target Rate: {assumptions.investments.withdrawalRate}% |
                        Upper Guardrail: {assumptions.investments.gkUpperGuardrail}x |
                        Lower Guardrail: {assumptions.investments.gkLowerGuardrail}x |
                        Adjustment: {assumptions.investments.gkAdjustmentPercent}%
                    </p>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
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
                                    const triggerColor = sa?.guardrailTriggered === 'capital-preservation' ? 'text-red-400'
                                        : sa?.guardrailTriggered === 'prosperity' ? 'text-blue-400' : 'text-green-400';
                                    return (
                                        <tr key={simYear.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                            <td className="p-2 text-gray-300">{simYear.year}</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(sw.amount)}</td>
                                            <td className="p-2 text-right text-gray-400">{sw.targetWithdrawalRate.toFixed(2)}%</td>
                                            <td className="p-2 text-right text-gray-300">{sw.currentWithdrawalRate.toFixed(2)}%</td>
                                            <td className={`p-2 text-center font-medium ${triggerColor}`}>
                                                {sa?.guardrailTriggered || 'none'}
                                            </td>
                                            <td className="p-2 text-right text-gray-300">
                                                {sa?.actualAdjustment ? `${sa.actualAdjustment > 0 ? '+' : ''}${toCurrencyShort(sa.actualAdjustment)}` : '—'}
                                            </td>
                                            <td className="p-2 text-yellow-300 text-xs">{sa?.warning || ''}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
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

    if (simulation.length === 0) return <div className="text-gray-400 p-4">No simulation data available. Run the simulation first.</div>;

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
                const withdrawal = withdrawals[acc.name] || 0;
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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
                <DropdownInput label="Account" value={accountFilter} onChange={setAccountFilter} options={accountOptions} />
            </div>

            {/* Section 1: Investment Returns */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Investment Returns</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
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
                                const color = realReturn > 0 ? 'text-green-400' : realReturn > -2 ? 'text-yellow-300' : 'text-red-400';
                                return (
                                    <tr key={d.year} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-gray-400">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.totalGrowth)}</td>
                                        <td className="p-2 text-right text-gray-300">{d.portfolioReturn.toFixed(1)}%</td>
                                        <td className={`p-2 text-right font-medium ${color}`}>{realReturn.toFixed(1)}%</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 2: Contribution Limits */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Contribution Limits</h3>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
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
                                const utilColor = d.util401k >= 95 ? 'text-green-400' : d.util401k >= 50 ? 'text-yellow-300' : 'text-gray-400';
                                return (
                                    <tr key={d.year} className="border-b border-gray-800">
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-gray-400">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.actual401k)}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(d.limit401k)}</td>
                                        <td className={`p-2 text-right font-medium ${utilColor}`}>{d.util401k.toFixed(0)}%</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.actualHSA)}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(d.limitHSA)}</td>
                                        <td className="p-2 text-center">{d.catchUp ? <span className="text-blue-400 text-xs">50+</span> : ''}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 3: Employer Matching */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Employer Matching & Vesting</h3>
                {matchingData.length === 0 ? (
                    <div className="text-gray-400">No employer match accounts found.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
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
                                        <tr key={`${d.year}-${i}`} className="border-b border-gray-800">
                                            <td className="p-2 text-gray-300">{d.year}</td>
                                            <td className="p-2 text-white">{ma.name}</td>
                                            <td className="p-2 text-right text-gray-300">{toCurrencyShort(ma.employerBal)}</td>
                                            <td className={`p-2 text-right ${ma.vestedPct >= 1 ? 'text-green-400' : 'text-yellow-300'}`}>
                                                {(ma.vestedPct * 100).toFixed(0)}%
                                            </td>
                                            <td className="p-2 text-right text-red-400">{ma.unvested > 0 ? toCurrencyShort(ma.unvested) : '—'}</td>
                                            <td className="p-2 text-right text-green-400">{ma.matchContrib > 0 ? toCurrencyShort(ma.matchContrib) : '—'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
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

    if (simulation.length === 0) return <div className="text-gray-400 p-4">No simulation data available. Run the simulation first.</div>;

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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
                <ToggleInput
                    label="Today's Dollars (inflation-adjusted)"
                    enabled={showRealDollars}
                    setEnabled={setShowRealDollars}
                />
            </div>

            {/* Section 1: Salary Projections */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Salary Projections</h3>
                {salaryData.length === 0 ? (
                    <div className="text-gray-400">No work income found.</div>
                ) : (
                    <>
                        <div className="mb-3 flex gap-4 text-sm">
                            <span className="text-gray-400">Total Lifetime Earnings: <span className="text-white font-bold">{toCurrencyShort(salaryData.reduce((s, d) => s + d.nominalSalary, 0))}</span></span>
                            <span className="text-gray-400">Avg Real Growth: <span className="text-green-400">{salaryData.length > 1 ? (salaryData.reduce((s, d) => s + d.yoyGrowth, 0) / (salaryData.length - 1)).toFixed(1) : 0}%</span></span>
                        </div>
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-gray-900">
                                    <tr className="text-gray-400 border-b border-gray-700">
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
                                        <tr key={i} className="border-b border-gray-800">
                                            <td className="p-2 text-gray-300">{d.year}</td>
                                            <td className="p-2 text-gray-400">{d.age}</td>
                                            <td className="p-2 text-white">{d.name}</td>
                                            <td className="p-2 text-right text-white">{toCurrencyShort(d.nominalSalary)}</td>
                                            <td className={`p-2 text-right ${d.yoyGrowth > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                                                {showRealDollars ? toCurrencyShort(d.realSalary) : `${d.yoyGrowth.toFixed(1)}%`}
                                            </td>
                                            <td className="p-2 text-right text-blue-400">{toCurrencyShort(showRealDollars ? d.realContrib : d.totalContrib)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* Section 2: Expense Breakdown */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Expense Breakdown</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-400">Fixed</div>
                        <div className="text-lg font-bold text-white">{expenseData.fixedPct.toFixed(0)}%</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-400">Discretionary</div>
                        <div className="text-lg font-bold text-white">{(100 - expenseData.fixedPct).toFixed(0)}%</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-400">Largest Category</div>
                        <div className="text-lg font-bold text-green-400">{largestCategory}</div>
                    </div>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
                                <th className="text-left p-2">Category</th>
                                {simulation.slice(0, Math.min(simulation.length, 10)).map((sy) => (
                                    <th key={sy.year} className="text-right p-2">{sy.year}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(expenseData.categoryTotals).map(([cat, vals]) => (
                                <tr key={cat} className="border-b border-gray-800">
                                    <td className="p-2 text-white">{cat}</td>
                                    {vals.slice(0, 10).map((v, i) => (
                                        <td key={i} className="p-2 text-right text-gray-300">{v > 0 ? toCurrencyShort(v) : '—'}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 3: Healthcare Costs */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Healthcare Costs</h3>
                {healthcareData.length === 0 ? (
                    <div className="text-gray-400">No healthcare expenses found.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-left p-2">Age</th>
                                    <th className="text-right p-2">Annual Cost</th>
                                    <th className="text-right p-2">{showRealDollars ? 'Real Cost' : '% of Income'}</th>
                                    <th className="text-center p-2">Medicare</th>
                                </tr>
                            </thead>
                            <tbody>
                                {healthcareData.map(d => (
                                    <tr key={d.year} className={`border-b border-gray-800 ${d.isMedicare ? 'bg-blue-900/10' : ''}`}>
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-gray-400">{d.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.totalHealthcare)}</td>
                                        <td className="p-2 text-right text-gray-300">
                                            {showRealDollars ? toCurrencyShort(d.realCost) : `${d.pctOfIncome.toFixed(1)}%`}
                                        </td>
                                        <td className="p-2 text-center">{d.isMedicare ? <span className="text-blue-400 text-xs">65+</span> : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
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

    if (simulation.length === 0) return <div className="text-gray-400 p-4">No simulation data available. Run the simulation first.</div>;

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
                if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount || acc instanceof PropertyAccount) {
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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
                <DropdownInput label="Period" value={periodFilter} onChange={setPeriodFilter} options={['All Years', 'Accumulation', 'Retirement']} />
            </div>

            {/* Section 1: Priority Waterfall */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Priority Waterfall</h3>
                {assumptions.priorities.length === 0 ? (
                    <div className="text-gray-400">No priority buckets configured.</div>
                ) : (
                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-right p-2">Surplus</th>
                                    {assumptions.priorities.map(b => (
                                        <th key={b.id} className="text-right p-2">{b.name}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {waterfallData.map(d => (
                                    <tr key={d.year} className="border-b border-gray-800">
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.preBucketSurplus)}</td>
                                        {d.buckets.map((b, i) => (
                                            <td key={i} className={`p-2 text-right ${b.allocated > 0 ? (b.hit ? 'text-yellow-300' : 'text-green-400') : 'text-gray-600'}`}>
                                                {b.allocated > 0 ? toCurrencyShort(b.allocated) : '—'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Section 2: Net Worth Timeline */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Net Worth Timeline</h3>
                <div className="mb-3 text-sm text-gray-400">
                    Peak: <span className="text-green-400 font-bold">{toCurrencyShort(netWorthData.peakNW)}</span> in {netWorthData.peakYear}
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
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
                                const changeColor = change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-500';
                                return (
                                    <tr key={d.year} className={`border-b border-gray-800 ${d.age === retirementAge ? 'border-t-2 border-t-yellow-600' : ''}`}>
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-gray-400">{d.age}</td>
                                        <td className="p-2 text-right text-green-400">{toCurrencyShort(d.assets)}</td>
                                        <td className="p-2 text-right text-red-400">{d.liabilities > 0 ? toCurrencyShort(d.liabilities) : '—'}</td>
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
            </div>

            {/* Section 3: Cash Flow Summary */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Cash Flow Summary</h3>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
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
                                const srColor = d.savingsRate >= 20 ? 'text-green-400' : d.savingsRate >= 10 ? 'text-yellow-300' : 'text-red-400';
                                return (
                                    <tr key={d.year} className={`border-b border-gray-800 ${d.isRetired ? 'bg-blue-900/5' : ''}`}>
                                        <td className="p-2 text-gray-300">{d.year}</td>
                                        <td className="p-2 text-gray-400">{d.age}</td>
                                        <td className="p-2 text-right text-green-400">{toCurrencyShort(d.totalIncome)}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(d.livingExpenses)}</td>
                                        <td className="p-2 text-right text-gray-400">{toCurrencyShort(d.taxes)}</td>
                                        <td className="p-2 text-right text-blue-400">{d.totalInvested > 0 ? toCurrencyShort(d.totalInvested) : '—'}</td>
                                        <td className={`p-2 text-right font-medium ${d.isRetired ? 'text-gray-500' : srColor}`}>
                                            {d.isRetired ? 'N/A' : `${d.savingsRate.toFixed(0)}%`}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 4: Inflation Impact */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Inflation Impact</h3>
                <p className="text-sm text-gray-400 mb-3">Rate: {(inflationRate * 100).toFixed(1)}% | Shows erosion of purchasing power over time.</p>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900">
                            <tr className="text-gray-400 border-b border-gray-700">
                                <th className="text-left p-2">Year</th>
                                <th className="text-left p-2">Age</th>
                                <th className="text-right p-2">$1 Today =</th>
                                <th className="text-right p-2">Nominal Income</th>
                                <th className="text-right p-2">Real Income</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inflationData.filter((_, i) => i % 5 === 0 || i === inflationData.length - 1).map(d => (
                                <tr key={d.year} className="border-b border-gray-800">
                                    <td className="p-2 text-gray-300">{d.year}</td>
                                    <td className="p-2 text-gray-400">{d.age}</td>
                                    <td className="p-2 text-right text-yellow-300">${(d.purchasingPower * 100).toFixed(0)}¢</td>
                                    <td className="p-2 text-right text-white">{toCurrencyShort(d.nominalIncome)}</td>
                                    <td className="p-2 text-right text-green-400">{toCurrencyShort(d.realIncome)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// VALIDATION DEBUG TAB
// ============================================================================
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
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-4">
                <DropdownInput label="Severity" value={severityFilter} onChange={setSeverityFilter} options={['All', 'Errors Only', 'Warnings+']} />
            </div>

            {/* Overall Health Banner */}
            <div className={`rounded-lg p-4 border ${
                overallStatus === 'error' ? 'bg-red-900/20 border-red-800' :
                overallStatus === 'warning' ? 'bg-yellow-900/30 border-yellow-700/50' :
                'bg-green-900/20 border-green-700/50'
            }`}>
                <div className="flex items-center justify-between">
                    <span className={`text-lg font-bold ${
                        overallStatus === 'error' ? 'text-red-400' :
                        overallStatus === 'warning' ? 'text-yellow-300' :
                        'text-green-400'
                    }`}>
                        {overallStatus === 'error' ? 'Issues Found' : overallStatus === 'warning' ? 'Warnings Present' : 'All Checks Passed'}
                    </span>
                    <div className="flex gap-3 text-sm">
                        {errorCount > 0 && <span className="text-red-400">{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>}
                        {warningCount > 0 && <span className="text-yellow-300">{warningCount} Warning{warningCount !== 1 ? 's' : ''}</span>}
                        {infoCount > 0 && <span className="text-blue-400">{infoCount} Info</span>}
                    </div>
                </div>
            </div>

            {simulation.length === 0 && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 text-blue-400 text-sm">
                    Run simulation for additional runtime checks (data consistency, RMD shortfalls, negative balances).
                </div>
            )}

            {/* Issue Cards */}
            <div className="space-y-2">
                {filteredIssues.length === 0 ? (
                    <div className="text-gray-400 text-sm p-4">No issues found at this severity level.</div>
                ) : (
                    filteredIssues.map((issue, i) => (
                        <div key={i} className={`rounded-lg p-3 border ${
                            issue.type === 'error' ? 'bg-red-900/20 border-red-800' :
                            issue.type === 'warning' ? 'bg-yellow-900/30 border-yellow-700/50' :
                            'bg-blue-900/20 border-blue-700/50'
                        }`}>
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <span className={`text-sm font-medium ${
                                        issue.type === 'error' ? 'text-red-400' :
                                        issue.type === 'warning' ? 'text-yellow-300' :
                                        'text-blue-400'
                                    }`}>{issue.title}</span>
                                    <p className="text-xs text-gray-400 mt-1">{issue.detail}</p>
                                </div>
                                <span className="text-xs text-gray-500 whitespace-nowrap">{issue.section}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// ============================================================================
// TAX OPTIMIZATION DEBUG TAB
// ============================================================================
function TaxOptimizationDebugTab() {
    const { state: assumptions } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes: _incomes } = useContext(IncomeContext);
    const { state: taxState } = useContext(TaxContext);
    const filingStatus = taxState.filingStatus;
    const { simulation: rawSimulation } = useContext(SimulationContext);
    const simulation = useMemo(() => rawSimulation.filter(y => !y.isEndOfYearProjection), [rawSimulation]);

    const currentYear = new Date().getFullYear();
    const birthYear = getBirthYear(assumptions.milestones);
    const retirementAge = getRetirementAge(assumptions.milestones);
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
    const currentAge = currentYear - birthYear;
    const isEnabled = assumptions.investments.taxOptimizationEnabled;

    // Current Traditional balance
    const currentTraditionalBalance = useMemo(() =>
        accounts
            .filter(acc => acc instanceof InvestedAccount && (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
            .reduce((sum, acc) => sum + acc.amount, 0),
        [accounts]
    );

    // Current Roth balance
    const currentRothBalance = useMemo(() =>
        accounts
            .filter(acc => acc instanceof InvestedAccount && (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA'))
            .reduce((sum, acc) => sum + acc.amount, 0),
        [accounts]
    );

    // TODO: Re-implement per TAX_OPTIMIZATION_SPEC.md
    const targetResult = useMemo(() => ({
        targetBalance: currentTraditionalBalance,
        targetAge: 73,
        targetBracket: 0.12,
        projectedFixedIncome: 0,
        projectedRMD: 0,
        rationale: "Tax optimization pending reimplementation"
    }), [currentTraditionalBalance]);

    // TODO: Re-implement per TAX_OPTIMIZATION_SPEC.md
    const conversionPlan = useMemo(() => ({
        schedule: [] as { year: number; age: number; amount: number; bracketBeforeConversion: number; bracketAfterConversion: number; estimatedTaxCost: number }[],
        totalConversionNeeded: 0,
        targetTraditionalBalance: 0,
        projectedLifetimeTaxSavings: 0
    }), []);

    // TODO: Re-implement per TAX_OPTIMIZATION_SPEC.md
    const testDeficit = 50000;
    const smartOrder = useMemo(() =>
        [] as { accountId: string; accountName: string; amount: number; reason: string; taxType: 'tax-free' | 'pre-tax' | 'capital-gains' }[],
        []
    );

    // Calculate lifetime taxes from simulation. Total matches the Year Inspector
    // convention (Testing.tsx:174) and YearSolver.ts:1357: fed already includes
    // ordinary federal income tax + early-withdrawal penalty; capitalGains, niit,
    // and withdrawalOrdinaryTax are separate line items that all add into total.
    const lifetimeTaxes = useMemo(() => {
        const empty = { total: 0, federal: 0, state: 0, fica: 0, capitalGains: 0, withdrawalOrdinary: 0, niit: 0, penalty: 0 };
        if (simulation.length === 0) return empty;
        return simulation.reduce((acc, s) => {
            const fed = s.taxDetails.fed;
            const state = s.taxDetails.state;
            const fica = s.taxDetails.fica;
            const cg = s.taxDetails.capitalGains;
            const wot = s.taxDetails.withdrawalOrdinaryTax ?? 0;
            const niit = s.taxDetails.niit ?? 0;
            const penalty = s.taxDetails.earlyWithdrawalPenalty ?? 0;
            return {
                total: acc.total + fed + state + fica + cg + wot + niit,
                federal: acc.federal + fed,
                state: acc.state + state,
                fica: acc.fica + fica,
                capitalGains: acc.capitalGains + cg,
                withdrawalOrdinary: acc.withdrawalOrdinary + wot,
                niit: acc.niit + niit,
                penalty: acc.penalty + penalty,
            };
        }, empty);
    }, [simulation]);

    // Extract Roth conversions from simulation
    const simulationConversions = useMemo(() => {
        if (simulation.length === 0) return [];
        return simulation
            .filter(s => s.rothConversion && s.rothConversion.amount > 0)
            .map(s => ({
                year: s.year,
                age: s.year - birthYear,
                amount: s.rothConversion!.amount,
                taxCost: s.rothConversion!.taxCost
            }));
    }, [simulation, birthYear]);




    // Year navigation state
    const startYear = simulation.length > 0 ? simulation[0].year : currentYear;
    const endYear = simulation.length > 0 ? simulation[simulation.length - 1].year : startYear;
    const [selectedYear, setSelectedYear] = useState(startYear);

    // Get data for the selected year
    const selectedYearIndex = simulation.findIndex(s => s.year === selectedYear);
    const yearData = simulation[selectedYearIndex] || simulation[0];
    const selectedAge = selectedYear - birthYear;

    // Calculate net worth for selected year
    const selectedNetWorth = useMemo(() => {
        if (!yearData) return 0;
        return yearData.accounts.reduce((sum, acc) => {
            if (acc instanceof DebtAccount) return sum - acc.amount;
            if (acc instanceof PropertyAccount) return sum + acc.amount - (acc.loanAmount || 0);
            return sum + acc.amount;
        }, 0);
    }, [yearData]);

    // AGI-equivalent for the selected year (for effective-rate denominator). Mirrors
    // the Tax Brackets tab logic: gross income (cashflow + Roth conversion) minus
    // pre-tax deductions, applying the SS taxability formula, plus LTCG (which sits
    // below the AGI line in the calc but is part of total income for effective rate).
    const selectedYearTax = useMemo(() => {
        if (!yearData) return null;
        const fedParams = getTaxParameters(selectedYear, filingStatus, 'federal', undefined, assumptions);
        if (!fedParams) return null;

        const rothConversionAmount = yearData.rothConversion?.amount ?? 0;
        const grossIncome = yearData.cashflow.totalIncome + rothConversionAmount;
        const preTaxDeductions = getPreTaxExemptions(yearData.incomes, selectedYear, selectedAge);
        const aboveLineDeductions = getYesDeductions(yearData.expenses, selectedYear);
        const totalPreTax = preTaxDeductions + aboveLineDeductions;
        const ssBenefits = getSocialSecurityBenefits(yearData.incomes, selectedYear);
        const agiExcludingSS = grossIncome - ssBenefits - totalPreTax;
        const taxableSS = getTaxableSocialSecurityBenefits(ssBenefits, agiExcludingSS, 0, filingStatus);
        const agi = grossIncome - ssBenefits + taxableSS - totalPreTax;
        const ltcgAmount = yearData.taxDetails.longTermCapitalGains ?? 0;
        const agiPlusLTCG = Math.max(0, agi) + ltcgAmount;

        const fed = yearData.taxDetails.fed;
        const state = yearData.taxDetails.state;
        const fica = yearData.taxDetails.fica;
        const cg = yearData.taxDetails.capitalGains;
        const wot = yearData.taxDetails.withdrawalOrdinaryTax ?? 0;
        const niit = yearData.taxDetails.niit ?? 0;
        const penalty = yearData.taxDetails.earlyWithdrawalPenalty ?? 0;
        const totalTax = fed + state + fica + cg + wot + niit;

        return { agiPlusLTCG, fed, state, fica, cg, wot, niit, penalty, totalTax };
    }, [yearData, selectedYear, selectedAge, filingStatus, assumptions]);

    // Get Traditional and Roth balances for selected year
    const selectedYearBalances = useMemo(() => {
        if (!yearData) return { traditional: 0, roth: 0, brokerage: 0 };
        return {
            traditional: yearData.accounts
                .filter(acc => acc instanceof InvestedAccount && (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0),
            roth: yearData.accounts
                .filter(acc => acc instanceof InvestedAccount && (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA'))
                .reduce((sum, acc) => sum + acc.amount, 0),
            brokerage: yearData.accounts
                .filter(acc => acc instanceof InvestedAccount && acc.taxType === 'Brokerage')
                .reduce((sum, acc) => sum + acc.amount, 0)
        };
    }, [yearData]);

    return (
        <div className="space-y-6">
            {/* Year Selector */}
            {simulation.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                    <h3 className="text-lg font-bold text-white mb-2">Year: {selectedYear} (Age {selectedAge})</h3>
                    <div className="flex items-center gap-6">
                        <div className="w-full">
                            <input
                                type="range"
                                min={startYear}
                                max={endYear}
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(Number(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                                <span>{startYear}</span>
                                <span>{endYear}</span>
                            </div>
                        </div>
                        <div className="flex gap-4 text-white min-w-fit text-sm">
                            <div>
                                <span className="text-gray-400">Net Worth:</span>
                                <span className="text-green-400 ml-1">{toCurrencyShort(selectedNetWorth)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Selected Year Tax Details */}
            {yearData && selectedYearTax && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                    <h3 className="text-lg font-bold text-white mb-3">Tax Details for {selectedYear}</h3>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Federal Tax</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.fed)}</div>
                            <div className="text-xs text-gray-500">incl. {toCurrencyShort(selectedYearTax.penalty)} penalty</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">State Tax</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.state)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">FICA</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.fica)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Capital Gains Tax</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.cg)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Withdrawal Ordinary Tax</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.wot)}</div>
                            <div className="text-xs text-gray-500">Roth earnings, Trad, HSA</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">NIIT</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.niit)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Total Tax</div>
                            <div className="text-lg font-bold text-red-400">{toCurrencyShort(selectedYearTax.totalTax)}</div>
                            <div className="text-xs text-gray-500">
                                {selectedYearTax.agiPlusLTCG > 0 ? `${((selectedYearTax.totalTax / selectedYearTax.agiPlusLTCG) * 100).toFixed(1)}% effective` : '—'}
                            </div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">AGI + LTCG</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(selectedYearTax.agiPlusLTCG)}</div>
                            <div className="text-xs text-gray-500">Effective-rate denom.</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Living Expenses</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(yearData.cashflow.livingExpenses)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Withdrawals</div>
                            <div className="text-lg font-bold text-yellow-400">{toCurrencyShort(yearData.cashflow.withdrawals)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Total Income (cashflow)</div>
                            <div className="text-lg font-bold text-white">{toCurrencyShort(yearData.cashflow.totalIncome)}</div>
                            <div className="text-xs text-gray-500">Pre-withdrawal income</div>
                        </div>
                    </div>

                    {/* Account Balances for Selected Year */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Traditional Balance</div>
                            <div className="text-lg font-bold text-orange-400">{toCurrencyShort(selectedYearBalances.traditional)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Roth Balance</div>
                            <div className="text-lg font-bold text-blue-400">{toCurrencyShort(selectedYearBalances.roth)}</div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Brokerage Balance</div>
                            <div className="text-lg font-bold text-green-400">{toCurrencyShort(selectedYearBalances.brokerage)}</div>
                        </div>
                    </div>

                    {/* Roth Conversion for Selected Year */}
                    {yearData.rothConversion && yearData.rothConversion.amount > 0 && (
                        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                            <div className="text-sm text-blue-400 font-semibold mb-2">Roth Conversion This Year</div>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                    <span className="text-gray-400">Amount: </span>
                                    <span className="text-white">{toCurrencyShort(yearData.rothConversion.amount)}</span>
                                </div>
                                <div>
                                    <span className="text-gray-400">Tax Cost: </span>
                                    <span className="text-red-400">{toCurrencyShort(yearData.rothConversion.taxCost)}</span>
                                </div>
                                <div>
                                    <span className="text-gray-400">Effective Rate: </span>
                                    <span className="text-yellow-400">
                                        {((yearData.rothConversion.taxCost / yearData.rothConversion.amount) * 100).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Status Banner */}
            <div className={`rounded-xl border p-4 ${isEnabled ? 'bg-green-900/20 border-green-700/50' : 'bg-gray-900 border-gray-800'}`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            Tax Optimization
                            <span className={`px-2 py-0.5 text-xs rounded ${isEnabled ? 'bg-green-600' : 'bg-gray-600'}`}>
                                {isEnabled ? 'ENABLED' : 'DISABLED'}
                            </span>
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">
                            {isEnabled
                                ? 'Smart withdrawal ordering and auto Roth conversions are active.'
                                : 'Enable in Withdrawal tab to activate smart withdrawals and conversions.'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Section 1: Target Balance Calculation */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 opacity-40">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    Target Traditional Balance
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">TODO</span>
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    Calculates the ideal Traditional 401k/IRA balance at RMD age to keep RMDs within target bracket.
                    <span className="block text-gray-500 italic mt-1">Pending reimplementation per TAX_OPTIMIZATION_SPEC.md — values shown are placeholders.</span>
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Current Traditional</div>
                        <div className="text-lg font-bold text-white">{toCurrencyShort(currentTraditionalBalance)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Target Balance</div>
                        <div className="text-lg font-bold text-green-400">{toCurrencyShort(targetResult.targetBalance)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Target Age</div>
                        <div className="text-lg font-bold text-white">Age {targetResult.targetAge}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Target Bracket</div>
                        <div className="text-lg font-bold text-white">{(targetResult.targetBracket * 100).toFixed(0)}%</div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Projected Fixed Income (at RMD age)</div>
                        <div className="text-sm text-white">{toCurrency(targetResult.projectedFixedIncome)}</div>
                        <div className="text-xs text-gray-500">SS + Pensions + Rental</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Projected Annual RMD</div>
                        <div className="text-sm text-white">{toCurrency(targetResult.projectedRMD)}</div>
                        <div className="text-xs text-gray-500">At target balance</div>
                    </div>
                </div>

                <div className="mt-3 text-xs text-gray-500">
                    Rationale: {targetResult.rationale}
                </div>
            </div>

            {/* Section 2: Conversion Plan */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 opacity-40">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    Roth Conversion Plan
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">TODO</span>
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    Multi-year schedule to convert excess Traditional balance to Roth.
                    <span className="block text-gray-500 italic mt-1">Pending reimplementation per TAX_OPTIMIZATION_SPEC.md — values shown are placeholders.</span>
                </p>

                <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Total to Convert</div>
                        <div className="text-lg font-bold text-yellow-400">{toCurrencyShort(conversionPlan.totalConversionNeeded)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Scheduled Conversions</div>
                        <div className="text-lg font-bold text-white">{conversionPlan.schedule.length} years</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Projected Tax Savings</div>
                        <div className="text-lg font-bold text-green-400">{toCurrencyShort(conversionPlan.projectedLifetimeTaxSavings)}</div>
                    </div>
                </div>

                {conversionPlan.schedule.length > 0 && (
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-left p-2">Age</th>
                                    <th className="text-right p-2">Amount</th>
                                    <th className="text-right p-2">Bracket Before</th>
                                    <th className="text-right p-2">Bracket After</th>
                                    <th className="text-right p-2">Est. Tax Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                                {conversionPlan.schedule.map((item, idx) => (
                                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-gray-300">{item.year}</td>
                                        <td className="p-2 text-gray-400">{item.age}</td>
                                        <td className="p-2 text-right text-white font-medium">{toCurrencyShort(item.amount)}</td>
                                        <td className="p-2 text-right text-gray-400">{(item.bracketBeforeConversion * 100).toFixed(0)}%</td>
                                        <td className="p-2 text-right text-yellow-400">{(item.bracketAfterConversion * 100).toFixed(0)}%</td>
                                        <td className="p-2 text-right text-red-400">{toCurrencyShort(item.estimatedTaxCost)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {conversionPlan.schedule.length === 0 && (
                    <div className="text-center text-gray-500 py-4">
                        No conversions needed - balance is at or below target.
                    </div>
                )}
            </div>

            {/* Section 3: Simulation Conversions (Actual) */}
            {simulationConversions.length > 0 && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                    <h3 className="text-lg font-bold text-white mb-3">Actual Conversions (from Simulation)</h3>
                    <p className="text-sm text-gray-400 mb-4">
                        Roth conversions executed during simulation run.
                    </p>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Total Converted</div>
                            <div className="text-lg font-bold text-white">
                                {toCurrencyShort(simulationConversions.reduce((s, c) => s + c.amount, 0))}
                            </div>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <div className="text-xs text-gray-400">Total Tax Paid</div>
                            <div className="text-lg font-bold text-red-400">
                                {toCurrencyShort(simulationConversions.reduce((s, c) => s + c.taxCost, 0))}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-900">
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left p-2">Year</th>
                                    <th className="text-left p-2">Age</th>
                                    <th className="text-right p-2">Amount</th>
                                    <th className="text-right p-2">Tax Cost</th>
                                    <th className="text-right p-2">Effective Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {simulationConversions.map((c, idx) => (
                                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-gray-300">{c.year}</td>
                                        <td className="p-2 text-gray-400">{c.age}</td>
                                        <td className="p-2 text-right text-white">{toCurrencyShort(c.amount)}</td>
                                        <td className="p-2 text-right text-red-400">{toCurrencyShort(c.taxCost)}</td>
                                        <td className="p-2 text-right text-yellow-400">
                                            {((c.taxCost / c.amount) * 100).toFixed(1)}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Section 4: Smart Withdrawal Order Test */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 opacity-40">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                    Smart Withdrawal Order (Test)
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">TODO</span>
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                    Simulated withdrawal order for a ${testDeficit.toLocaleString()} deficit at age {Math.max(currentAge, retirementAge)}.
                    <span className="block text-gray-500 italic mt-1">Pending reimplementation per TAX_OPTIMIZATION_SPEC.md — values shown are placeholders.</span>
                </p>

                {smartOrder.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-gray-400 border-b border-gray-700">
                                    <th className="text-left p-2">#</th>
                                    <th className="text-left p-2">Account</th>
                                    <th className="text-right p-2">Amount</th>
                                    <th className="text-left p-2">Tax Type</th>
                                    <th className="text-left p-2">Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {smartOrder.map((order, idx) => (
                                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                                        <td className="p-2 text-gray-400">{idx + 1}</td>
                                        <td className="p-2 text-white">{order.accountName}</td>
                                        <td className="p-2 text-right text-green-400">{toCurrencyShort(order.amount)}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 text-xs rounded ${
                                                order.taxType === 'tax-free' ? 'bg-green-600' :
                                                order.taxType === 'pre-tax' ? 'bg-yellow-600' : 'bg-blue-600'
                                            }`}>
                                                {order.taxType}
                                            </span>
                                        </td>
                                        <td className="p-2 text-gray-400">{order.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center text-gray-500 py-4">
                        No accounts available for withdrawal.
                    </div>
                )}
            </div>

            {/* Section 5: Lifetime Tax Summary */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Lifetime Tax Summary</h3>
                <p className="text-sm text-gray-400 mb-4">
                    Total taxes paid across the entire simulation (ages {currentAge} to {lifeExpectancy}).
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Total Taxes</div>
                        <div className="text-lg font-bold text-red-400">{toCurrencyShort(lifetimeTaxes.total)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Federal</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.federal)}</div>
                        <div className="text-xs text-gray-500">incl. penalty</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">State</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.state)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">FICA</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.fica)}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Capital Gains</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.capitalGains)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Withdrawal Ordinary</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.withdrawalOrdinary)}</div>
                        <div className="text-xs text-gray-500">Roth earnings, Trad, HSA</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">NIIT</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.niit)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Early-Withdraw Penalty</div>
                        <div className="text-sm text-white">{toCurrencyShort(lifetimeTaxes.penalty)}</div>
                        <div className="text-xs text-gray-500">already in Federal</div>
                    </div>
                </div>
            </div>

            {/* Section 6: Account Balances */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <h3 className="text-lg font-bold text-white mb-3">Current Account Balances</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Traditional (401k/IRA)</div>
                        <div className="text-lg font-bold text-yellow-400">{toCurrencyShort(currentTraditionalBalance)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Roth (401k/IRA)</div>
                        <div className="text-lg font-bold text-green-400">{toCurrencyShort(currentRothBalance)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Brokerage</div>
                        <div className="text-lg font-bold text-blue-400">
                            {toCurrencyShort(accounts.filter(a => a instanceof InvestedAccount && a.taxType === 'Brokerage').reduce((s, a) => s + a.amount, 0))}
                        </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3">
                        <div className="text-xs text-gray-400">Savings/Cash</div>
                        <div className="text-lg font-bold text-white">
                            {toCurrencyShort(accounts.filter(a => a instanceof SavedAccount).reduce((s, a) => s + a.amount, 0))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// MAIN TESTING COMPONENT WITH TABS
// ============================================================================
const TESTING_TABS = ['Simulation Debug', 'Tax Debug', 'Tax Brackets', 'Social Security', 'Pensions', 'RMDs', 'Roth Analysis', 'Tax Opt', 'Roth Debug', 'Ratios', 'Mortgage', 'QR Code', 'Withdrawals', 'Accounts', 'Income & Expenses', 'Cash Flow', 'Validation'];

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

    if (!showExperimental) {
        return (
            <div className="w-full min-h-screen bg-gray-950 text-gray-100 p-8 flex items-center justify-center">
                <p className="text-gray-500">Enable experimental features in Assumptions to access Testing.</p>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen bg-gray-950 text-gray-100 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto">
                <h2 className="text-3xl font-bold mb-4 text-fuchsia-500">
                    Testing & Debugging
                </h2>

                {/* Tab Navigation */}
                <div className="bg-gray-900 rounded-lg mb-4 flex border border-gray-800 overflow-x-auto custom-scrollbar">
                    {TESTING_TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => handleTabChange(tab)}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${
                                activeTab === tab
                                    ? 'text-green-300 bg-gray-800 border-b-2 border-green-300'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'Simulation Debug' && <SimulationDebugTab />}
                {activeTab === 'Tax Debug' && <TaxDebugTab />}
                {activeTab === 'Tax Brackets' && <TaxBracketVisualizationTab />}
                {activeTab === 'Social Security' && <SocialSecurityDebugTab />}
                {activeTab === 'Pensions' && <PensionDebugTab />}
                {activeTab === 'RMDs' && <RMDDebugTab />}
                {activeTab === 'Roth Analysis' && <RothAnalysisDebugTab />}
                {activeTab === 'Tax Opt' && <TaxOptimizationDebugTab />}
                {activeTab === 'Roth Debug' && <RothConversionDebugTab />}
                {activeTab === 'Ratios' && <RatiosDebugTab />}
                {activeTab === 'Mortgage' && <MortgageTestingTab />}
                {activeTab === 'QR Code' && <QRCodeDebugTab />}
                {activeTab === 'Withdrawals' && <WithdrawalDebugTab />}
                {activeTab === 'Accounts' && <AccountsDebugTab />}
                {activeTab === 'Income & Expenses' && <IncomeExpensesDebugTab />}
                {activeTab === 'Cash Flow' && <CashFlowDebugTab />}
                {activeTab === 'Validation' && <ValidationDebugTab />}
            </div>
        </div>
    );
}