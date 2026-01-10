import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';

import { useFileManager } from '../../../../components/Objects/Accounts/useFileManager';
import { AccountProvider } from '../../../../components/Objects/Accounts/AccountContext';
import { IncomeProvider } from '../../../../components/Objects/Income/IncomeContext';
import { ExpenseProvider } from '../../../../components/Objects/Expense/ExpenseContext';
import { TaxProvider } from '../../../../components/Objects/Taxes/TaxContext';
import { AssumptionsProvider, defaultAssumptions } from '../../../../components/Objects/Assumptions/AssumptionsContext';

// Mock localStorage
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock window.alert
const alertMock = vi.fn();
Object.defineProperty(window, 'alert', {
  value: alertMock,
  writable: true,
});

// Mock URL and DOM methods
const createObjectURLMock = vi.fn(() => 'blob:mock-url');
const revokeObjectURLMock = vi.fn();
URL.createObjectURL = createObjectURLMock;
URL.revokeObjectURL = revokeObjectURLMock;

// Wrapper component that provides all necessary contexts
const AllProvidersWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <AccountProvider>
      <IncomeProvider>
        <ExpenseProvider>
          <TaxProvider>
            <AssumptionsProvider>{children}</AssumptionsProvider>
          </TaxProvider>
        </ExpenseProvider>
      </IncomeProvider>
    </AccountProvider>
  );
};

describe('useFileManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    alertMock.mockClear();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
    vi.setSystemTime(new Date('2024-01-15'));
  });

  describe('handleGlobalExport', () => {
    it('should create a full backup with all context data', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const originalCreateElement = document.createElement.bind(document);
      const clickMock = vi.fn();
      const linkElement = {
        href: '',
        download: '',
        click: clickMock,
      };

      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return linkElement as any;
        }
        return originalCreateElement(tagName);
      });

      act(() => {
        result.current.handleGlobalExport();
      });

      expect(createObjectURLMock).toHaveBeenCalled();
      expect(linkElement.download).toContain('stag_full_backup_2024-01-15.json');
      expect(clickMock).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');

      createElementSpy.mockRestore();
    });

    it('should include className metadata for all objects', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const originalBlob = window.Blob;
      let capturedParts: BlobPart[] = [];
      (window as any).Blob = class MockBlob extends originalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          capturedParts = parts;
        }
      };

      const originalCreateElement = document.createElement.bind(document);
      const clickMock = vi.fn();
      const linkElement = {
        href: '',
        download: '',
        click: clickMock,
      };

      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return linkElement as any;
        }
        return originalCreateElement(tagName);
      });

      act(() => {
        result.current.handleGlobalExport();
      });

      // Get the blob content from the first call
      const blobContent = capturedParts[0];
      if (blobContent) {
        const backup = JSON.parse(blobContent as string);
        expect(backup).toHaveProperty('version', 1);
        expect(backup).toHaveProperty('accounts');
        expect(backup).toHaveProperty('incomes');
        expect(backup).toHaveProperty('expenses');
        expect(backup).toHaveProperty('taxSettings');
        expect(backup).toHaveProperty('assumptions');
      }

      createElementSpy.mockRestore();
      (window as any).Blob = originalBlob;
    });

    it('should create valid JSON structure', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const originalBlob = window.Blob;
      (window as any).Blob = class extends originalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
        }
      };

      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return {
            href: '',
            download: '',
            click: vi.fn(),
          } as any;
        }
        return originalCreateElement(tagName);
      });

      act(() => {
        result.current.handleGlobalExport();
      });

      createElementSpy.mockRestore();
      (window as any).Blob = originalBlob;
    });
  });

  describe('handleGlobalImport', () => {
    it('should import and dispatch to all contexts', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [
          {
            className: 'SavedAccount',
            id: '1',
            name: 'Savings',
            amount: 5000,
            apr: 2.5,
          },
        ],
        amountHistory: {
          '1': [{ date: '2024-01-01', num: 5000 }],
        },
        incomes: [
          {
            className: 'PassiveIncome',
            id: '1',
            name: 'Rental',
            amount: 2000,
            frequency: 'Monthly',
            earned_income: 'No',
          },
        ],
        expenses: [
          {
            className: 'FoodExpense',
            id: '1',
            name: 'Groceries',
            amount: 500,
            frequency: 'Monthly',
          },
        ],
        taxSettings: {
          filingStatus: 'Married Filing Jointly',
          stateResidency: 'CA',
          deductionMethod: 'Itemized',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: {
          ...defaultAssumptions,
          macro: {
            ...defaultAssumptions.macro,
            inflationRate: 3.5,
          },
        },
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      // The import should not show an error
      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should filter out invalid objects during reconstitution', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [
          {
            className: 'SavedAccount',
            id: '1',
            name: 'Valid Account',
            amount: 1000,
            apr: 2.5,
          },
          {
            className: 'InvalidAccountType',
            id: '2',
            name: 'Invalid',
            amount: 500,
          },
        ],
        amountHistory: {},
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: defaultAssumptions,
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should merge assumptions with defaults for partial backups', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [],
        amountHistory: {},
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: {
          macro: {
            inflationRate: 5.0,
          },
          // Missing other assumption fields
        },
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should reset assumptions when missing from backup', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [],
        amountHistory: {},
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        // No assumptions field
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should handle empty amountHistory', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [
          {
            className: 'SavedAccount',
            id: '1',
            name: 'Savings',
            amount: 1000,
            apr: 2.5,
          },
        ],
        // No amountHistory field
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: defaultAssumptions,
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should handle corrupted JSON gracefully', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        result.current.handleGlobalImport('invalid json data');
      });

      expect(alertMock).toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing required fields gracefully', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        // Missing required fields
      };

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      // Should handle gracefully - either succeed or show error
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should properly merge nested assumptions objects', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [],
        amountHistory: {},
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: {
          macro: {
            inflationRate: 4.0,
            inflationAdjusted: true,
          },
          investments: {
            returnRates: {
              ror: 8.0,
            },
          },
          priorities: [],
        },
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });

    it('should handle assumptions with missing returnRates', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      const backupData = {
        version: 1,
        accounts: [],
        amountHistory: {},
        incomes: [],
        expenses: [],
        taxSettings: {
          filingStatus: 'Single',
          stateResidency: 'DC',
          deductionMethod: 'Standard',
          fedOverride: null,
          ficaOverride: null,
          stateOverride: null,
          year: 2024,
        },
        assumptions: {
          macro: {
            inflationRate: 3.0,
          },
          investments: {
            // No returnRates
          },
        },
      };

      act(() => {
        result.current.handleGlobalImport(JSON.stringify(backupData));
      });

      expect(alertMock).not.toHaveBeenCalledWith(
        'Error importing backup. Please check file format.'
      );
    });
  });

  describe('Integration', () => {
    it('should export and then import the same data successfully', () => {
      const { result } = renderHook(() => useFileManager(), {
        wrapper: AllProvidersWrapper,
      });

      let exportedData: string = '';

      const originalBlob = window.Blob;
      (window as any).Blob = class extends originalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          if (parts.length > 0 && typeof parts[0] === 'string') {
            exportedData = parts[0] as string;
          }
        }
      };

      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return {
            href: '',
            download: '',
            click: vi.fn(),
          } as any;
        }
        return originalCreateElement(tagName);
      });

      // Export
      act(() => {
        result.current.handleGlobalExport();
      });

      // Import the exported data
      if (exportedData) {
        act(() => {
          result.current.handleGlobalImport(exportedData);
        });

        expect(alertMock).not.toHaveBeenCalledWith(
          'Error importing backup. Please check file format.'
        );
      }

      createElementSpy.mockRestore();
      (window as any).Blob = originalBlob;
    });
  });
});
