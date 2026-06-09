import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';

test.describe('ESPP Feature', () => {
  test.setTimeout(30000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should create an ESPP account', async ({ page }) => {
    // Navigate to Accounts tab
    await navigateToTab(page, 'Accounts');

    // Click on Invested tab
    await page.getByRole('button', { name: /^invested$/i }).click();

    // Click Add ESPP button
    await page.getByRole('button', { name: /add espp/i }).click();

    // Fill in ESPP account details
    await page.getByLabel(/name/i).first().fill('Company ESPP');
    await page.getByLabel(/current value/i).first().fill('5000');

    // Add the account
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Verify the account appears - use first() to avoid chart label conflict
    await expect(page.getByText('Company ESPP').first()).toBeVisible();
  });

  test('should display ESPP holdings summary when account is expanded', async ({ page }) => {
    // Create an ESPP account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add espp/i }).click();
    await page.getByLabel(/name/i).first().fill('Company ESPP');
    await page.getByLabel(/current value/i).first().fill('10000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Wait for the account card to appear
    await page.waitForSelector('text=Company ESPP');

    // Click on the expand button using aria-label
    await page.getByRole('button', { name: /expand company espp account details/i }).click();

    // Verify ESPP holdings summary is visible
    await expect(page.getByText(/ESPP Holdings Summary/i)).toBeVisible({ timeout: 5000 });
  });

  test('should have ESPP fields on WorkIncome card', async ({ page }) => {
    // Navigate to Income tab
    await navigateToTab(page, 'Income');

    // Click Add Income button
    await page.getByRole('button', { name: /add income/i }).click();

    // Select Work Income type in the two-step modal
    await page.getByRole('button', { name: /^work$/i }).click();

    // Fill in income details
    await page.getByLabel(/income name/i).fill('Tech Job');
    await page.getByLabel(/gross amount.*\(\$\)/i).fill('100000');

    // Add the income
    await page.getByRole('button', { name: /add income/i }).last().click();
    await waitForLocalStorageSave(page);

    // Expand the card to see ESPP fields
    await page.getByRole('button', { name: /expand tech job income details/i }).click();

    // On the expanded card, ESPP Contribution should be visible
    await expect(page.getByText(/ESPP Contribution/i)).toBeVisible({ timeout: 5000 });
  });

  test('should create ESPP account with advanced fields', async ({ page }) => {
    // Navigate to Accounts tab
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();

    // Click Add ESPP button
    await page.getByRole('button', { name: /add espp/i }).click();

    // Fill in basic ESPP details
    await page.getByLabel(/name/i).first().fill('Advanced ESPP');
    await page.getByLabel(/current value/i).first().fill('25000');

    // Fill in advanced fields
    await page.getByLabel(/stock ticker/i).fill('AAPL');
    await page.getByLabel(/current share price/i).fill('175');
    await page.getByLabel(/min holding.*days/i).fill('365');

    // Add the account
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Verify the account appears
    await expect(page.getByText('Advanced ESPP').first()).toBeVisible();

    // Expand and verify fields are saved
    await page.getByRole('button', { name: /expand advanced espp account details/i }).click();

    // Verify the ticker and other fields are visible
    await expect(page.getByLabel(/stock ticker/i)).toHaveValue('AAPL');
  });

  test('should add and display manual ESPP lot', async ({ page }) => {
    // Create an ESPP account first
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add espp/i }).click();
    await page.getByLabel(/name/i).first().fill('Manual Lots ESPP');
    await page.getByLabel(/current value/i).first().fill('10000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Expand the account
    await page.getByRole('button', { name: /expand manual lots espp account details/i }).click();

    // Click Add Lot button
    await page.getByRole('button', { name: /\+ add lot/i }).click();

    // Fill in lot details
    await page.getByLabel(/grant date/i).fill('2022-01-01');
    await page.getByLabel(/purchase date/i).fill('2022-06-30');
    await page.getByLabel(/number of shares/i).fill('50');
    await page.getByLabel(/purchase price.*share/i).fill('80');
    await page.getByLabel(/fmv at grant/i).fill('100');
    await page.getByLabel(/fmv at purchase/i).fill('95');

    // Save the lot
    await page.getByRole('button', { name: /add lot/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify the lot appears in the list
    await expect(page.getByText(/50.*shares/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\$80\.00.*sh/i)).toBeVisible();
  });

  test('should show qualifying/disqualifying status for lots', async ({ page }) => {
    // Create an ESPP account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add espp/i }).click();
    await page.getByLabel(/name/i).first().fill('Status Test ESPP');
    await page.getByLabel(/current value/i).first().fill('10000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Expand the account
    await page.getByRole('button', { name: /expand status test espp account details/i }).click();

    // Add a recent lot (should be disqualifying)
    await page.getByRole('button', { name: /\+ add lot/i }).click();
    const today = new Date();
    const recentGrant = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    const recentPurchase = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    await page.getByLabel(/grant date/i).fill(recentGrant.toISOString().split('T')[0]);
    await page.getByLabel(/purchase date/i).fill(recentPurchase.toISOString().split('T')[0]);
    await page.getByLabel(/number of shares/i).fill('25');
    await page.getByLabel(/purchase price.*share/i).fill('90');
    await page.getByLabel(/fmv at grant/i).fill('100');
    await page.getByLabel(/fmv at purchase/i).fill('105');
    await page.getByRole('button', { name: /add lot/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify the lot shows as disqualifying (the badge on the lot)
    await expect(page.getByText('Disqualifying', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('should allow editing and deleting ESPP lots', async ({ page }) => {
    // Create ESPP account with a lot
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add espp/i }).click();
    await page.getByLabel(/name/i).first().fill('Edit Test ESPP');
    await page.getByLabel(/current value/i).first().fill('10000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Expand and add a lot
    await page.getByRole('button', { name: /expand edit test espp account details/i }).click();
    await page.getByRole('button', { name: /\+ add lot/i }).click();
    await page.getByLabel(/grant date/i).fill('2023-01-01');
    await page.getByLabel(/purchase date/i).fill('2023-06-30');
    await page.getByLabel(/number of shares/i).fill('100');
    await page.getByLabel(/purchase price.*share/i).fill('50');
    await page.getByLabel(/fmv at grant/i).fill('60');
    await page.getByLabel(/fmv at purchase/i).fill('65');
    await page.getByRole('button', { name: /add lot/i }).last().click();
    await waitForLocalStorageSave(page);

    // Verify lot is visible
    await expect(page.getByText(/100.*shares/i)).toBeVisible();

    // Click delete button on the lot
    await page.getByRole('button', { name: /delete lot/i }).click();
    await waitForLocalStorageSave(page);

    // Verify lot is removed - the text should now say "No lots yet"
    await expect(page.getByText(/no lots yet/i)).toBeVisible({ timeout: 5000 });
  });

  test('should display withdrawal preference dropdown on ESPP card', async ({ page }) => {
    // Create ESPP account
    await navigateToTab(page, 'Accounts');
    await page.getByRole('button', { name: /^invested$/i }).click();
    await page.getByRole('button', { name: /add espp/i }).click();
    await page.getByLabel(/name/i).first().fill('Pref Test ESPP');
    await page.getByLabel(/current value/i).first().fill('15000');
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    // Expand the account
    await page.getByRole('button', { name: /expand pref test espp account details/i }).click();

    // Verify withdrawal preference dropdown is visible
    await expect(page.getByText(/withdrawal preference/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/fifo/i)).toBeVisible();
  });
});
