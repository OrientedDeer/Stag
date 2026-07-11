/* Tab render profiler for Stag.
 * mode=dev : React Profiler pass (stag_perf=1, threshold=1ms) — per-commit
 *            actual/base durations, attributed to tabs by time-bucketing.
 * mode=prod: wall-clock pass — pushState nav + double-rAF main-thread block,
 *            i.e. what the user feels on a tab switch.
 * Usage: node profile-tabs.cjs <dev|prod> <baseURL>
 */
const { chromium } = require('@playwright/test');

const ROUTES = [
  ['/dashboard', 'Dashboard'],
  ['/current/accounts', 'Current/Accounts'],
  ['/current/income', 'Current/Income'],
  ['/current/expense', 'Current/Expense'],
  ['/current/taxes', 'Current/Taxes'],
  ['/budget', 'Budget'],
  ['/plan/assumptions', 'Plan/Assumptions'],
  ['/plan/allocation', 'Plan/Allocation'],
  ['/plan/withdrawal', 'Plan/Withdrawal'],
  ['/projection', 'Projection(Overview)'],
  ['CLICK:Risk', 'Projection>Risk(MC)'],
  ['CLICK:Strategy', 'Projection>Strategy(Tax)'],
  ['CLICK:Scenarios', 'Projection>Scenarios'],
  ['/testing', 'Testing'],
];

const mode = process.argv[2];
const base = process.argv[3];

async function clickSubTab(page, label) {
  // Main Future sub-tabs are role="tab" pills; the Scenarios toggle inside
  // Strategy is a plain button.
  const tab = page.getByRole('tab', { name: label, exact: true }).first();
  if (await tab.count()) return tab.click();
  return page.getByRole('button', { name: label, exact: true }).first().click();
}

async function navigate(page, route) {
  if (route.startsWith('CLICK:')) {
    await clickSubTab(page, route.slice(6));
  } else {
    await page.evaluate((r) => { window.location.hash = '#' + r; }, route);
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);

  const perfLines = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('[perf]')) perfLines.push({ ts: Date.now(), text: t });
  });

  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // App boots empty; load the demo dataset so the simulation has something to chew on.
  const seedBtn = page.getByText('+ Add Default Data');
  if (await seedBtn.count()) {
    await seedBtn.click();
    await page.waitForTimeout(4000);
  }
  // stress: clone the demo dataset's accounts/incomes/expenses xN (real
  // serialized shapes, fresh ids/names) to approximate a power-user profile.
  const mult = Number(process.argv[4] || 0);
  if (mult > 1) {
    await page.evaluate((n) => {
      const grow = (key, field) => {
        const raw = localStorage.getItem(key);
        if (!raw) return 0;
        const obj = JSON.parse(raw);
        const arr = obj[field];
        if (!Array.isArray(arr)) return 0;
        const out = [...arr];
        for (let i = 1; i < n; i++) {
          for (const item of arr) {
            const c = JSON.parse(JSON.stringify(item));
            if (c.id !== undefined) c.id = `${c.id}-x${i}`;
            if (c.name !== undefined) c.name = `${c.name} x${i}`;
            out.push(c);
          }
        }
        obj[field] = out;
        localStorage.setItem(key, JSON.stringify(obj));
        return out.length;
      };
      return [grow('user_accounts_data', 'accounts'), grow('user_incomes_data', 'incomes'), grow('user_expenses_data', 'expenses')];
    }, mult).then((counts) => console.log(`[stress] items after xN: accounts=${counts[0]} incomes=${counts[1]} expenses=${counts[2]}`));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(5000);
  }
  if (mode === 'dev') {
    await page.evaluate(() => {
      localStorage.setItem('stag_perf', '1');
      localStorage.setItem('stag_perf_threshold', '1');
    });
    await page.reload({ waitUntil: 'load' });
  }
  // Let boot + initial simulation fully settle before measuring tabs.
  await page.waitForTimeout(6000);

  const results = [];
  for (const [route, label] of ROUTES) {
    const t0 = Date.now();
    let wall = null;
    if (mode === 'prod' && !route.startsWith('CLICK:')) {
      wall = await page.evaluate(async (r) => {
        const s = performance.now();
        window.location.hash = '#' + r;
        // hashchange dispatches async — wait a tick, then paint-settle
        await new Promise((res) => setTimeout(res, 0));
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return performance.now() - s;
      }, route);
    } else if (mode === 'prod') {
      const s = Date.now();
      await clickSubTab(page, route.slice(6));
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      wall = Date.now() - s;
    } else {
      await navigate(page, route);
    }
    // The projection tab shows a spinner until the simulation lands — wait for
    // the sub-tab pills before measuring anything downstream of it.
    if (route === '/projection') {
      await page.getByRole('tab', { name: 'Risk' }).first().waitFor({ timeout: 60000 });
    }
    // settle: effects, lazy chunks, post-nav renders
    await page.waitForTimeout(route === '/testing' || route.startsWith('CLICK:') ? 4000 : 2500);
    const t1 = Date.now();
    const mine = perfLines.filter((l) => l.ts >= t0 && l.ts <= t1).map((l) => l.text);
    results.push({ label, wallMs: wall === null ? undefined : Math.round(wall * 10) / 10, commits: mine });
  }

  for (const r of results) {
    if (mode === 'prod') {
      console.log(`${r.label}: ${r.wallMs}ms`);
    } else {
      // parse actual= durations, report count + top 3
      const durs = r.commits
        .map((c) => /actual=([\d.]+)ms base=([\d.]+)ms/.exec(c))
        .filter(Boolean)
        .map((m) => ({ a: +m[1], b: +m[2] }));
      durs.sort((x, y) => y.a - x.a);
      const top = durs.slice(0, 3).map((d) => `${d.a}ms(base ${d.b})`).join(', ');
      const total = durs.reduce((s, d) => s + d.a, 0);
      console.log(`${r.label}: commits>=1ms=${durs.length} totalActual=${Math.round(total)}ms top=[${top}]`);
    }
  }
  await browser.close();
})().catch((e) => { console.error('PROFILE-FAILED', e.message); process.exit(1); });
