/**
 * Shared "total taxes" summation so the Cashflow Sankey, the Data tab table/CSV,
 * and the Cashflow year-detail readout all agree on what "Total Taxes" means.
 *
 * The federal/state/FICA trio alone omits every retirement-era tax — withdrawal
 * ordinary tax (Traditional/RMD/HSA), capital gains, NIIT, the Medicare IRMAA
 * surcharge, and ACA subsidy repayment — so a retiree drawing a Traditional IRA
 * showed ~$0 taxes. This mirrors the 8-component sum the Sankey has always used
 * (cashflowSankeyData.ts).
 */
export interface TaxComponents {
    fed: number;
    state: number;
    fica: number;
    capitalGains?: number;
    withdrawalOrdinaryTax?: number;
    niit?: number;
    irmaa?: number;
    aca?: number;
}

export function totalTaxesOf(t: TaxComponents): number {
    return (
        t.fed +
        t.state +
        t.fica +
        (t.capitalGains || 0) +
        (t.withdrawalOrdinaryTax || 0) +
        (t.niit || 0) +
        (t.irmaa || 0) +
        (t.aca || 0)
    );
}
