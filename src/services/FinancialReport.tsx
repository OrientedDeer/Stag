import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { ReportData } from './PDFReportService';

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
        borderBottom: '1 solid var(--c-content-emphasis)',
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
        color: 'var(--c-content-muted)',
        borderTop: '1 solid var(--c-content-emphasis)',
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

// ============================================================================
// PDF Component
// ============================================================================

interface FinancialReportProps {
    data: ReportData;
}

/**
 * React component that defines the PDF structure
 */
export const FinancialReport: React.FC<FinancialReportProps> = ({ data }) => (
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
