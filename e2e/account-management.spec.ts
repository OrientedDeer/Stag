import { test, expect } from '@playwright/test';
import {
  clearAllStorage,
  waitForLocalStorageSave,
  navigateToTab,
} from './helpers/app-helpers';
import { testAccounts } from './fixtures/test-data';

test.describe('Account Management', () => {
  test.setTimeout(10000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearAllStorage(page);
    await page.goto('/');
  });

  test('should add a savings account', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Switch to Cash tab and click the add cash button
    await page.getByRole('button', { name: /^cash$/i }).click();
    await page.getByRole('button', { name: /add cash/i }).click();

    // Fill in savings account details
    await page.getByLabel(/name/i).first().fill(testAccounts.savings.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.savings.amount.toString());

    // Save the account
    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testAccounts.savings.name).first()).toBeVisible();
  });

  test('should add an invested account', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Switch to Invested tab
    await page.getByRole('button', { name: /^invested$/i }).click();

    // Click add investment button
    await page.getByRole('button', { name: /add investment/i }).click();

    await page.getByLabel(/name/i).first().fill(testAccounts.investment.name);
    await page.getByLabel(/amount.*\(\$\)/i).first().fill(testAccounts.investment.amount.toString());

    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testAccounts.investment.name).first()).toBeVisible();
  });

  test('should add a property account', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Switch to Property tab
    await page.getByRole('button', { name: /^property$/i }).click();

    // Click add property button
    await page.getByRole('button', { name: /add property/i }).click();

    await page.getByLabel(/name/i).first().fill(testAccounts.property.name);
    await page.getByLabel(/value.*\(\$\)|amount.*\(\$\)/i).first().fill(testAccounts.property.amount.toString());

    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testAccounts.property.name).first()).toBeVisible();
  });

  test('should add a debt account', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Switch to Debt tab
    await page.getByRole('button', { name: /^debt$/i }).click();

    // Click add debt button
    await page.getByRole('button', { name: /add debt/i }).click();

    await page.getByLabel(/name/i).first().fill(testAccounts.debt.name);
    await page.getByLabel(/amount.*\(\$\)|balance.*\(\$\)/i).first().fill(testAccounts.debt.amount.toString());

    await page.getByRole('button', { name: /add account/i }).click();
    await waitForLocalStorageSave(page);

    await expect(page.getByText(testAccounts.debt.name).first()).toBeVisible();
  });

  test('should have export and import buttons', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Verify export/import buttons exist
    await expect(page.getByRole('button', { name: /export backup/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /import backup/i })).toBeVisible();
  });

  test('should have delete all data button', async ({ page }) => {
    await navigateToTab(page, 'Accounts');

    // Verify delete all button exists
    await expect(page.getByRole('button', { name: /delete all data/i })).toBeVisible();
  });
});
