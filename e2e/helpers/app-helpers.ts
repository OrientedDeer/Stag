import { type Page } from '@playwright/test';

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
 * Get localStorage value by key
 */
export async function getLocalStorageItem(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}
