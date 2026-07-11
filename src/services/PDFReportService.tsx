/**
 * PDF Report Generation Service
 *
 * Generates a financial summary report with key metrics and net worth chart.
 * Uses @react-pdf/renderer for PDF generation and html2canvas for chart capture.
 */
import { pdf } from '@react-pdf/renderer';
import html2canvas from 'html2canvas';
import { FinancialReport } from './FinancialReport';
import { type SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { type AssumptionsState, getRetirementAge, getLifeExpectancy, getBirthYear } from '../components/Objects/Assumptions/AssumptionsContext';
import { type MonteCarloSummary } from './MonteCarloTypes';
import { type AnyAccount, DebtAccount, PropertyAccount } from '../components/Objects/Accounts/models';

// ============================================================================
// Types
// ============================================================================

export interface ReportData {
    // Demographics
    currentAge: number;
    retirementAge: number;
    lifeExpectancy: number;

    // Key metrics
    currentNetWorth: number;
    finalNetWorth: number;
    fiYear: number | null;
    fiAge: number | null;

    // Retirement
    withdrawalRate: number;
    withdrawalStrategy: string;
    projectedRetirementIncome: number;
    yearsToRetirement: number;

    // Monte Carlo (optional)
    monteCarloSuccessRate?: number;
    monteCarloScenarios?: number;
    monteCarloMedianFinalNW?: number;

    // Chart image (base64)
    netWorthChartImage?: string;

    // Generation info
    generatedDate: string;
    simulationYears: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate net worth from accounts
 */
function calculateNetWorth(accounts: AnyAccount[]): number {
    let assets = 0;
    let liabilities = 0;

    accounts.forEach(acc => {
        const val = acc.amount || 0;
        if (acc instanceof DebtAccount) {
            liabilities += val;
        } else {
            assets += val;
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                liabilities += acc.loanAmount;
            }
        }
    });

    return assets - liabilities;
}

/**
 * Find Financial Independence year (first year where passive income covers expenses)
 */
function findFIYear(
    simulation: SimulationYear[],
    assumptions: AssumptionsState
): { year: number; age: number } | null {
    const retirementAge = getRetirementAge(assumptions.milestones);
    const startYear = simulation.length > 0 ? simulation[0].year : new Date().getFullYear();
    const startAge = startYear - getBirthYear(assumptions.milestones);

    for (let i = 0; i < simulation.length; i++) {
        const year = simulation[i];
        const age = startAge + i;

        // FI = when withdrawals start or when we reach retirement age
        if (year.cashflow.withdrawals > 0 || age >= retirementAge) {
            return { year: year.year, age };
        }
    }

    return null;
}

// ============================================================================
// Chart Capture
// ============================================================================

/**
 * Capture a DOM element as a base64 PNG image
 * @param elementId - The DOM element ID to capture
 * @returns Base64 PNG string or null if capture fails
 */
export async function captureChart(elementId: string): Promise<string | null> {
    const element = document.getElementById(elementId);

    if (!element) {
        console.warn(`Chart element '${elementId}' not found`);
        return null;
    }

    try {
        const canvas = await html2canvas(element, {
            backgroundColor: 'var(--c-surface-raised)', // Dark background to match app theme
            scale: 2, // Higher resolution
            logging: false,
            useCORS: true,
        });

        return canvas.toDataURL('image/png');
    } catch (error) {
        console.error('Failed to capture chart:', error);
        return null;
    }
}

// ============================================================================
// Data Collection
// ============================================================================

/**
 * Collect all data needed for the PDF report from simulation and context state
 */
export function collectReportData(
    simulation: SimulationYear[],
    assumptions: AssumptionsState,
    monteCarloSummary: MonteCarloSummary | null,
    chartImage: string | null
): ReportData {
    if (simulation.length === 0) {
        throw new Error('No simulation data available');
    }

    const firstYear = simulation[0];
    const lastYear = simulation[simulation.length - 1];

    // Calculate key metrics
    const currentNetWorth = calculateNetWorth(firstYear.accounts);
    const finalNetWorth = calculateNetWorth(lastYear.accounts);

    // Find FI year
    const fiInfo = findFIYear(simulation, assumptions);

    // Find retirement year data
    const retirementAge = getRetirementAge(assumptions.milestones);
    const lifeExpectancy = getLifeExpectancy(assumptions.milestones);
    const retirementYearIndex = retirementAge - (new Date().getFullYear() - getBirthYear(assumptions.milestones));
    const retirementYear = simulation[retirementYearIndex] || lastYear;

    // Calculate projected retirement income
    const projectedRetirementIncome = retirementYear.cashflow.totalIncome;

    // Years to retirement
    const yearsToRetirement = Math.max(0,
        retirementAge - (new Date().getFullYear() - getBirthYear(assumptions.milestones))
    );

    return {
        // Demographics
        currentAge: new Date().getFullYear() - getBirthYear(assumptions.milestones),
        retirementAge,
        lifeExpectancy,

        // Key metrics
        currentNetWorth,
        finalNetWorth,
        fiYear: fiInfo?.year || null,
        fiAge: fiInfo?.age || null,

        // Retirement
        withdrawalRate: assumptions.investments.withdrawalRate,
        withdrawalStrategy: assumptions.investments.withdrawalStrategy,
        projectedRetirementIncome,
        yearsToRetirement,

        // Monte Carlo (optional)
        monteCarloSuccessRate: monteCarloSummary?.successRate,
        monteCarloScenarios: monteCarloSummary?.totalScenarios,
        monteCarloMedianFinalNW: monteCarloSummary?.medianCase?.finalNetWorth,

        // Chart
        netWorthChartImage: chartImage || undefined,

        // Meta
        generatedDate: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }),
        simulationYears: simulation.length,
    };
}

// ============================================================================
// PDF Generation
// ============================================================================

/**
 * Generate and download the PDF report
 */
export async function generatePDFReport(data: ReportData): Promise<void> {
    try {
        // Create the PDF document
        const doc = <FinancialReport data={data} />;

        // Generate the PDF blob
        const blob = await pdf(doc).toBlob();

        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        // Generate filename with date
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `stag_financial_summary_${dateStr}.pdf`);

        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Cleanup
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Failed to generate PDF:', error);
        throw new Error('Failed to generate PDF report');
    }
}
