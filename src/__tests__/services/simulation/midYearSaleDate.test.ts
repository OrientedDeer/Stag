import { describe, it, expect } from "vitest";
import { midYearSaleDate } from "../../../services/simulation/dates";

/**
 * #179: three sites (WithdrawalPlanner snapshotDate, AccountGrowth ESPP saleDate,
 * AccountGrowth RSU saleDate) must classify/tax lots at the SAME date. They now
 * share midYearSaleDate. This test pins the date so an accidental change trips a
 * red test instead of silently diverging the lots-taxed from the lots-removed.
 */
describe("midYearSaleDate", () => {
    it("is June 15 of the given year, in LOCAL time (not UTC)", () => {
        const d = midYearSaleDate(2030);
        // Local-time getters per the repo's local-not-UTC date-only convention.
        expect(d.getFullYear()).toBe(2030);
        expect(d.getMonth()).toBe(5); // 0-based: 5 = June
        expect(d.getDate()).toBe(15);
        // Midnight local time — no time component leaks in.
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
        expect(d.getSeconds()).toBe(0);
        expect(d.getMilliseconds()).toBe(0);
    });

    it("tracks the requested year", () => {
        expect(midYearSaleDate(2001).getFullYear()).toBe(2001);
        expect(midYearSaleDate(2099).getFullYear()).toBe(2099);
    });

    it("returns a fresh Date each call (no shared mutable instance)", () => {
        const a = midYearSaleDate(2040);
        const b = midYearSaleDate(2040);
        expect(a).not.toBe(b);
        expect(a.getTime()).toBe(b.getTime());
    });
});
