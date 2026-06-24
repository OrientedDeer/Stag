import { describe, it, expect } from 'vitest';
import { resolveIncomes } from '../../components/Objects/Assumptions/useSimulation';
import { WorkIncome } from '../../components/Objects/Income/models';

/**
 * Regression: resolveIncomes rebuilds a WorkIncome to bake in effective 401k
 * values when autoMax401k != 'custom'. The rebuild must carry forward the
 * percent-based employer match fields (employerMatchType/Percent/Max).
 *
 * Before the fix, the `new WorkIncome(...)` call stopped at endMilestoneId and
 * omitted the trailing three params, so employerMatchType reverted to 'fixed'
 * (with employerMatch === 0), zeroing the projected employer match for the
 * whole projection.
 */
describe('resolveIncomes preserves percent-based employer match', () => {
  function makePercentMatchJob(autoMax401k: 'roth' | 'traditional' | 'disabled'): WorkIncome {
    const job = new WorkIncome(
      'job-1',
      'Test Job',
      4000, // per-period salary (frequency: Monthly -> $48k/yr)
      'Monthly',
      'Yes',
      0, // preTax401k (per period)
      0, // insurance
      0, // roth401k (per period) — stays 0 so effective.roth differs, triggering the rebuild
      0, // employerMatch (fixed-dollar) — 0 because match is percent-based
      'acct-1', // matchAccountId
      null, // taxType
      'FIXED', // contributionGrowthStrategy
      new Date(2026, 0, 1), // startDate
      undefined, // end_date
      0, // hsaContribution
      autoMax401k,
    );
    // Percent-based employer match: 5% of salary, no cap.
    job.employerMatchType = 'percent';
    job.employerMatchPercent = 5;
    job.employerMatchMax = 0;
    return job;
  }

  it('keeps a non-zero percent match after resolveIncomes (autoMax401k = roth)', () => {
    const job = makePercentMatchJob('roth');
    const startYear = 2026;
    const startAge = 40;

    // Sanity: the original job has a non-zero percent-based match.
    expect(job.employerMatchType).toBe('percent');
    expect(job.getEffectiveAnnualEmployerMatch(startYear)).toBeGreaterThan(0);

    const resolved = resolveIncomes([job], startYear, startAge);
    const resolvedJob = resolved[0] as WorkIncome;

    // The resolveIncomes rebuild must have fired (autoMax401k='roth' caps roth401k).
    expect(resolvedJob).toBeInstanceOf(WorkIncome);
    expect(resolvedJob).not.toBe(job);

    // The percent match fields must survive the rebuild.
    expect(resolvedJob.employerMatchType).toBe('percent');
    expect(resolvedJob.employerMatchPercent).toBe(5);
    expect(resolvedJob.getEffectiveAnnualEmployerMatch(startYear)).toBeGreaterThan(0);
    expect(resolvedJob.getEffectiveAnnualEmployerMatch(startYear)).toBeCloseTo(
      job.getEffectiveAnnualEmployerMatch(startYear),
    );
  });

  it('carries the percent match cap through the rebuild (autoMax401k = traditional)', () => {
    const job = makePercentMatchJob('traditional');
    job.employerMatchMax = 1000; // annual cap
    const startYear = 2026;
    const startAge = 40;

    const resolved = resolveIncomes([job], startYear, startAge);
    const resolvedJob = resolved[0] as WorkIncome;

    expect(resolvedJob).not.toBe(job);
    expect(resolvedJob.employerMatchType).toBe('percent');
    expect(resolvedJob.employerMatchMax).toBe(1000);
    // 5% of $48k salary = $2,400, capped at $1,000.
    expect(resolvedJob.getEffectiveAnnualEmployerMatch(startYear)).toBeCloseTo(1000);
  });
});
