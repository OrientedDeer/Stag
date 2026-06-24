import { describe, it, expect } from "vitest";
import { getGrossIncome } from "../../components/Objects/Taxes/taxService/incomeAggregation";
import { WorkIncome } from "../../components/Objects/Income/models";

/**
 * Regression: getGrossIncome must include a percent-based Roth-401k employer match
 * in taxable ordinary income.
 *
 * For a Roth 401k income with employerMatchType='percent', the raw `employerMatch`
 * per-period field is 0 and the real match is computed from employerMatchPercent via
 * getEffectiveAnnualEmployerMatch(). The previous code added the raw `employerMatch`
 * field, so the percent-based match was dropped from taxable gross (understating tax).
 */
describe("getGrossIncome - Roth 401k percent employer match", () => {
    function makeRothPercentIncome(): WorkIncome {
        const inc = new WorkIncome(
            "w1",
            "Job",
            100000, // annual salary, paid annually
            "Annually",
            "Yes",
            0, // preTax401k
            0, // insurance
            0, // roth401k
            0, // employerMatch (raw per-period field — 0 for a percent match)
            "acct-match",
            "Roth 401k",
        );
        inc.employerMatchType = "percent";
        inc.employerMatchPercent = 5; // 5% of salary
        inc.employerMatchMax = 0; // no cap
        return inc;
    }

    it("includes the percent-based match in taxable gross", () => {
        const inc = makeRothPercentIncome();
        const year = 2026;

        const annualSalary = inc.getProratedAnnual(inc.amount, year);
        const expectedMatch = inc.getEffectiveAnnualEmployerMatch(year);
        // The percent match is real and non-zero even though the raw field is 0.
        expect(inc.employerMatch).toBe(0);
        expect(expectedMatch).toBeCloseTo(annualSalary * 0.05, 6);
        expect(expectedMatch).toBeGreaterThan(0);

        const gross = getGrossIncome([inc], year);

        // gross = annualized salary + the percent-based match
        expect(gross).toBeCloseTo(annualSalary + expectedMatch, 6);
    });
});
