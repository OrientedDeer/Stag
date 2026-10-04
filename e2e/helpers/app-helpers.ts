import { type Page, expect } from '@playwright/test';

/**
 * Helper functions for Stag E2E tests
 */

/**
 * Clear all localStorage and reload the page to start fresh
 */
export async function clearAllStorage(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/**
 * Wait for localStorage debounce to complete (500ms + buffer)
 */
export async function waitForLocalStorageSave(page: Page) {
  await page.waitForTimeout(700);
}

/**
 * Navigate to a specific section in the app via sidebar
 * Maps friendly names to routes
 */
export async function navigateToTab(page: Page, tabName: string) {
  // Map of tab names to their sidebar link text
  const tabMappings: Record<string, string> = {
    'Accounts': 'Accounts',
    'Income': 'Income',
    'Expenses': 'Expenses',
    'Taxes': 'Taxes',
    'Assumptions': 'Assumptions',
    'Allocation': 'Allocation',
    'Withdrawal': 'Withdrawal',
    'Future': 'Projection',
    'Charts': 'Projection',
    'Projection': 'Projection',
  };

  const linkText = tabMappings[tabName] || tabName;

  // Find and click the sidebar link
  const link = page.getByRole('link', { name: new RegExp(`^${linkText}$`, 'i') });
  await link.click();

  // Wait for navigation to complete
  await page.waitForLoadState('networkidle');
}

/**
 * Add a work income
 */
export async function addWorkIncome(
  page: Page,
  name: string,
  amount: number,
  frequency: 'Annually' | 'Monthly' | 'Bi-Weekly' = 'Annually'
) {
  // Click add income button
  await page.getByRole('button', { name: /add income/i }).first().click();

  // Select Work Income type (two-step modal)
  await page.getByRole('button', { name: /work income/i }).click();

  // Fill in details
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByLabel(/amount/i).first().fill(amount.toString());

  // Select frequency if dropdown exists
  const frequencySelect = page.getByLabel(/frequency/i);
  if (await frequencySelect.isVisible().catch(() => false)) {
    await frequencySelect.selectOption(frequency);
  }

  // Save
  await page.getByRole('button', { name: /save/i }).click();
  await waitForLocalStorageSave(page);
}

/**
 * Run the simulation and wait for it to complete
 */
export async function runSimulation(page: Page) {
  const recalcButton = page.getByRole('button', { name: /recalculate/i });
  await recalcButton.click();

  // Wait for loading to start and finish (if there's a loading indicator)
  // The simulation should complete within 10 seconds
  await page.waitForTimeout(2000);
}

/**
 * Verify that the app is in a pristine/empty state
 */
export async function verifyPristineState(page: Page) {
  // Check for setup warning or empty state indicators
  const setupWarning = page.getByText(/add accounts|no accounts|get started/i);
  await expect(setupWarning.first()).toBeVisible({ timeout: 5000 });
}

/**
 * Get localStorage value by key
 */
export async function getLocalStorageItem(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}
