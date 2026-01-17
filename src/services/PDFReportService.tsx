/**
 * PDF Report Generation Service
 *
 * Generates a financial summary report with key metrics and net worth chart.
 * Uses @react-pdf/renderer for PDF generation and html2canvas for chart capture.
 */
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import html2canvas from 'html2canvas';
import { SimulationYear } from '../components/Objects/Assumptions/SimulationEngine';
import { AssumptionsState } from '../components/Objects/Assumptions/AssumptionsContext';
import { MonteCarloSummary } from './MonteCarloTypes';
import { AnyAccount, DebtAccount, PropertyAccount } from '../components/Objects/Accounts/models';

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
// Styles
// ============================================================================

const styles = StyleSheet.create({
    page: {
        padding: 40,
        fontFamily: 'Helvetica',
        fontSize: 10,
        backgroundColor: '#ffffff',
    },
    header: {
        marginBottom: 20,
        paddingBottom: 10,
        borderBottom: '2 solid #1a365d',
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1a365d',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 10,
        color: '#666666',
    },
    section: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#1a365d',
        marginBottom: 8,
        paddingBottom: 4,
        borderBottom: '1 solid #e2e8f0',
    },
    metricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    metricBox: {
        width: '30%',
        padding: 12,
        backgroundColor: '#f7fafc',
        borderRadius: 4,
        textAlign: 'center',
    },
    metricLabel: {
        fontSize: 9,
        color: '#718096',
        marginBottom: 4,
    },
    metricValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#2d3748',
    },
    metricValueSmall: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#2d3748',
    },
    listItem: {
        flexDirection: 'row',
        marginBottom: 6,
    },
    listBullet: {
        width: 12,
        color: '#4a5568',
    },
    listText: {
        flex: 1,
        color: '#4a5568',
    },
    listValue: {
        fontWeight: 'bold',
        color: '#2d3748',
    },
    chartContainer: {
        marginTop: 8,
    },
    chartImage: {
        width: '100%',
        height: 220,
        objectFit: 'contain',
    },
    footer: {
        position: 'absolute',
        bottom: 30,
        left: 40,
        right: 40,
        textAlign: 'center',
        fontSize: 8,
        color: '#a0aec0',
        borderTop: '1 solid #e2e8f0',
        paddingTop: 8,
    },
    monteCarloSection: {
        backgroundColor: '#f0fff4',
        padding: 12,
        borderRadius: 4,
        marginTop: 8,
    },
    monteCarloTitle: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#276749',
        marginBottom: 6,
    },
    successRate: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#276749',
    },
    successRateLabel: {
        fontSize: 10,
        color: '#48bb78',
    },
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format currency for display in PDF
 */
function formatCurrency(value: number): string {
    if (Math.abs(value) >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(value) >= 1_000) {
        return `$${(value / 1_000).toFixed(0)}K`;
    }
    return `$${value.toFixed(0)}`;
}

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
    const retirementAge = assumptions.demographics.retirementAge;
    const startYear = simulation.length > 0 ? simulation[0].year : new Date().getFullYear();
    const startAge = startYear - assumptions.demographics.birthYear;

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
            backgroundColor: '#1a202c', // Dark background to match app theme
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
    const retirementYearIndex = assumptions.demographics.retirementAge - (new Date().getFullYear() - assumptions.demographics.birthYear);
    const retirementYear = simulation[retirementYearIndex] || lastYear;

    // Calculate projected retirement income
    const projectedRetirementIncome = retirementYear.cashflow.totalIncome;

    // Years to retirement
    const yearsToRetirement = Math.max(0,
        assumptions.demographics.retirementAge - (new Date().getFullYear() - assumptions.demographics.birthYear)
    );

    return {
        // Demographics
        currentAge: new Date().getFullYear() - assumptions.demographics.birthYear,
        retirementAge: assumptions.demographics.retirementAge,
        lifeExpectancy: assumptions.demographics.lifeExpectancy,

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
// PDF Component
// ============================================================================

interface FinancialReportProps {
    data: ReportData;
}

/**
 * React component that defines the PDF structure
 */
const FinancialReport: React.FC<FinancialReportProps> = ({ data }) => (
    <Document>
        <Page size="LETTER" style={styles.page}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.title}>Financial Planning Report</Text>
                <Text style={styles.subtitle}>Generated {data.generatedDate}</Text>
            </View>

            {/* Key Metrics */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Key Metrics</Text>
                <View style={styles.metricsRow}>
                    <View style={styles.metricBox}>
                        <Text style={styles.metricLabel}>Current Net Worth</Text>
                        <Text style={styles.metricValue}>{formatCurrency(data.currentNetWorth)}</Text>
                    </View>
                    <View style={styles.metricBox}>
                        <Text style={styles.metricLabel}>Retirement Age</Text>
                        <Text style={styles.metricValue}>{data.retirementAge}</Text>
                    </View>
                    <View style={styles.metricBox}>
                        <Text style={styles.metricLabel}>Final Net Worth</Text>
                        <Text style={styles.metricValue}>{formatCurrency(data.finalNetWorth)}</Text>
                    </View>
                </View>
            </View>

            {/* Retirement Readiness */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Retirement Readiness</Text>
                <View style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>
                        Years to retirement: <Text style={styles.listValue}>{data.yearsToRetirement}</Text>
                    </Text>
                </View>
                <View style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>
                        Projected retirement income: <Text style={styles.listValue}>{formatCurrency(data.projectedRetirementIncome)}/yr</Text>
                    </Text>
                </View>
                <View style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>
                        Withdrawal strategy: <Text style={styles.listValue}>{data.withdrawalStrategy} ({data.withdrawalRate}%)</Text>
                    </Text>
                </View>
                {data.fiYear && data.fiAge && (
                    <View style={styles.listItem}>
                        <Text style={styles.listBullet}>•</Text>
                        <Text style={styles.listText}>
                            Financial Independence: <Text style={styles.listValue}>{data.fiYear} (Age {data.fiAge})</Text>
                        </Text>
                    </View>
                )}
                <View style={styles.listItem}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>
                        Life expectancy: <Text style={styles.listValue}>Age {data.lifeExpectancy}</Text>
                    </Text>
                </View>
            </View>

            {/* Monte Carlo Analysis (if available) */}
            {data.monteCarloSuccessRate !== undefined && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Monte Carlo Analysis</Text>
                    <View style={styles.monteCarloSection}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View>
                                <Text style={styles.successRate}>{data.monteCarloSuccessRate.toFixed(0)}%</Text>
                                <Text style={styles.successRateLabel}>Success Rate</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                <View style={styles.listItem}>
                                    <Text style={styles.listText}>
                                        Scenarios: <Text style={styles.listValue}>{data.monteCarloScenarios}</Text>
                                    </Text>
                                </View>
                                {data.monteCarloMedianFinalNW !== undefined && (
                                    <View style={styles.listItem}>
                                        <Text style={styles.listText}>
                                            Median Final NW: <Text style={styles.listValue}>{formatCurrency(data.monteCarloMedianFinalNW)}</Text>
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    </View>
                </View>
            )}

            {/* Net Worth Chart */}
            {data.netWorthChartImage && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Net Worth Projection</Text>
                    <View style={styles.chartContainer}>
                        <Image style={styles.chartImage} src={data.netWorthChartImage} />
                    </View>
                </View>
            )}

            {/* Footer */}
            <Text style={styles.footer}>
                Generated by Stag Financial Planning • {data.simulationYears} year projection • This report is for informational purposes only
            </Text>
        </Page>
    </Document>
);

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
