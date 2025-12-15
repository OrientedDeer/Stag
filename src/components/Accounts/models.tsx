export interface Account {
  id: string;
  name: string;
  balance: number;
}

// 2. Base Abstract Class
export abstract class BaseAccount implements Account {
  constructor(
    public id: string,
    public name: string,
    public balance: number
  ) {}
}

// 3. Concrete Classes

export class SavedAccount extends BaseAccount {
  // No extra properties
}

export class InvestedAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public vestedBalance: number
  ) {
    super(id, name, balance);
  }
}

export class PropertyAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public ownershipType: 'Financed' | 'Owned',
    public loanBalance: number,
    public apr: number,
    public interestType: 'Simple' | 'Compound',
    public monthlyPayment: number
  ) {
    super(id, name, balance);
  }
}

export class DebtAccount extends BaseAccount {
  constructor(
    id: string,
    name: string,
    balance: number,
    public apr: number,
    public interestType: 'Simple' | 'Compound',
    public monthlyPayment: number
  ) {
    super(id, name, balance);
  }
}

// Union type for use in State Management
export type AnyAccount = SavedAccount | InvestedAccount | PropertyAccount | DebtAccount;

export const ACCOUNT_CATEGORIES = [
  'Saved',
  'Invested',
  'Property',
  'Debt',
] as const;

export type AccountCategory = typeof ACCOUNT_CATEGORIES[number];

export const ACCOUNT_COLORS_BACKGROUND: Record<AccountCategory, string> = {
    Saved: "bg-chart-Fuchsia-50",
    Invested: "bg-chart-Blue-50",
    Property: "bg-chart-Yellow-50",
    Debt: "bg-chart-Red-50",
  };

export const CLASS_TO_CATEGORY: Record<string, AccountCategory> = {
    [SavedAccount.name]: 'Saved',
    [InvestedAccount.name]: 'Invested',
    [PropertyAccount.name]: 'Property',
    [DebtAccount.name]: 'Debt',
};

// Map Categories to their color palettes (using Tailwind classes for simplicity)
export const CATEGORY_PALETTES: Record<AccountCategory, string[]> = {
	Saved: ["bg-chart-Fuchsia-1", "bg-chart-Fuchsia-2", "bg-chart-Fuchsia-3", "bg-chart-Fuchsia-4", "bg-chart-Fuchsia-5", "bg-chart-Fuchsia-6", "bg-chart-Fuchsia-7", "bg-chart-Fuchsia-8", "bg-chart-Fuchsia-9", "bg-chart-Fuchsia-10", "bg-chart-Fuchsia-11", "bg-chart-Fuchsia-12", "bg-chart-Fuchsia-13", "bg-chart-Fuchsia-14", "bg-chart-Fuchsia-15", "bg-chart-Fuchsia-16", "bg-chart-Fuchsia-17", "bg-chart-Fuchsia-18", "bg-chart-Fuchsia-19", "bg-chart-Fuchsia-20", "bg-chart-Fuchsia-21", "bg-chart-Fuchsia-22", "bg-chart-Fuchsia-23", "bg-chart-Fuchsia-24", "bg-chart-Fuchsia-25", "bg-chart-Fuchsia-26", "bg-chart-Fuchsia-27", "bg-chart-Fuchsia-28", "bg-chart-Fuchsia-29", "bg-chart-Fuchsia-30", "bg-chart-Fuchsia-31", "bg-chart-Fuchsia-32", "bg-chart-Fuchsia-33", "bg-chart-Fuchsia-34", "bg-chart-Fuchsia-35", "bg-chart-Fuchsia-36", "bg-chart-Fuchsia-37", "bg-chart-Fuchsia-38", "bg-chart-Fuchsia-39", "bg-chart-Fuchsia-40", "bg-chart-Fuchsia-41", "bg-chart-Fuchsia-42", "bg-chart-Fuchsia-43", "bg-chart-Fuchsia-44", "bg-chart-Fuchsia-45", "bg-chart-Fuchsia-46", "bg-chart-Fuchsia-47", "bg-chart-Fuchsia-48", "bg-chart-Fuchsia-49", "bg-chart-Fuchsia-50", "bg-chart-Fuchsia-51", "bg-chart-Fuchsia-52", "bg-chart-Fuchsia-53", "bg-chart-Fuchsia-54", "bg-chart-Fuchsia-55", "bg-chart-Fuchsia-56", "bg-chart-Fuchsia-57", "bg-chart-Fuchsia-58", "bg-chart-Fuchsia-59", "bg-chart-Fuchsia-60", "bg-chart-Fuchsia-61", "bg-chart-Fuchsia-62", "bg-chart-Fuchsia-63", "bg-chart-Fuchsia-64", "bg-chart-Fuchsia-65", "bg-chart-Fuchsia-66", "bg-chart-Fuchsia-67", "bg-chart-Fuchsia-68", "bg-chart-Fuchsia-69", "bg-chart-Fuchsia-70", "bg-chart-Fuchsia-71", "bg-chart-Fuchsia-72", "bg-chart-Fuchsia-73", "bg-chart-Fuchsia-74", "bg-chart-Fuchsia-75", "bg-chart-Fuchsia-76", "bg-chart-Fuchsia-77", "bg-chart-Fuchsia-78", "bg-chart-Fuchsia-79", "bg-chart-Fuchsia-80", "bg-chart-Fuchsia-81", "bg-chart-Fuchsia-82", "bg-chart-Fuchsia-83", "bg-chart-Fuchsia-84", "bg-chart-Fuchsia-85", "bg-chart-Fuchsia-86", "bg-chart-Fuchsia-87", "bg-chart-Fuchsia-88", "bg-chart-Fuchsia-89", "bg-chart-Fuchsia-90", "bg-chart-Fuchsia-91", "bg-chart-Fuchsia-92", "bg-chart-Fuchsia-93", "bg-chart-Fuchsia-94", "bg-chart-Fuchsia-95", "bg-chart-Fuchsia-96", "bg-chart-Fuchsia-97", "bg-chart-Fuchsia-98", "bg-chart-Fuchsia-99", "bg-chart-Fuchsia-100"],
	Invested: ["bg-chart-Blue-1", "bg-chart-Blue-2", "bg-chart-Blue-3", "bg-chart-Blue-4", "bg-chart-Blue-5", "bg-chart-Blue-6", "bg-chart-Blue-7", "bg-chart-Blue-8", "bg-chart-Blue-9", "bg-chart-Blue-10", "bg-chart-Blue-11", "bg-chart-Blue-12", "bg-chart-Blue-13", "bg-chart-Blue-14", "bg-chart-Blue-15", "bg-chart-Blue-16", "bg-chart-Blue-17", "bg-chart-Blue-18", "bg-chart-Blue-19", "bg-chart-Blue-20", "bg-chart-Blue-21", "bg-chart-Blue-22", "bg-chart-Blue-23", "bg-chart-Blue-24", "bg-chart-Blue-25", "bg-chart-Blue-26", "bg-chart-Blue-27", "bg-chart-Blue-28", "bg-chart-Blue-29", "bg-chart-Blue-30", "bg-chart-Blue-31", "bg-chart-Blue-32", "bg-chart-Blue-33", "bg-chart-Blue-34", "bg-chart-Blue-35", "bg-chart-Blue-36", "bg-chart-Blue-37", "bg-chart-Blue-38", "bg-chart-Blue-39", "bg-chart-Blue-40", "bg-chart-Blue-41", "bg-chart-Blue-42", "bg-chart-Blue-43", "bg-chart-Blue-44", "bg-chart-Blue-45", "bg-chart-Blue-46", "bg-chart-Blue-47", "bg-chart-Blue-48", "bg-chart-Blue-49", "bg-chart-Blue-50", "bg-chart-Blue-51", "bg-chart-Blue-52", "bg-chart-Blue-53", "bg-chart-Blue-54", "bg-chart-Blue-55", "bg-chart-Blue-56", "bg-chart-Blue-57", "bg-chart-Blue-58", "bg-chart-Blue-59", "bg-chart-Blue-60", "bg-chart-Blue-61", "bg-chart-Blue-62", "bg-chart-Blue-63", "bg-chart-Blue-64", "bg-chart-Blue-65", "bg-chart-Blue-66", "bg-chart-Blue-67", "bg-chart-Blue-68", "bg-chart-Blue-69", "bg-chart-Blue-70", "bg-chart-Blue-71", "bg-chart-Blue-72", "bg-chart-Blue-73", "bg-chart-Blue-74", "bg-chart-Blue-75", "bg-chart-Blue-76", "bg-chart-Blue-77", "bg-chart-Blue-78", "bg-chart-Blue-79", "bg-chart-Blue-80", "bg-chart-Blue-81", "bg-chart-Blue-82", "bg-chart-Blue-83", "bg-chart-Blue-84", "bg-chart-Blue-85", "bg-chart-Blue-86", "bg-chart-Blue-87", "bg-chart-Blue-88", "bg-chart-Blue-89", "bg-chart-Blue-90", "bg-chart-Blue-91", "bg-chart-Blue-92", "bg-chart-Blue-93", "bg-chart-Blue-94", "bg-chart-Blue-95", "bg-chart-Blue-96", "bg-chart-Blue-97", "bg-chart-Blue-98", "bg-chart-Blue-99", "bg-chart-Blue-100"],
	Property: ["bg-chart-Yellow-1", "bg-chart-Yellow-2", "bg-chart-Yellow-3", "bg-chart-Yellow-4", "bg-chart-Yellow-5", "bg-chart-Yellow-6", "bg-chart-Yellow-7", "bg-chart-Yellow-8", "bg-chart-Yellow-9", "bg-chart-Yellow-10", "bg-chart-Yellow-11", "bg-chart-Yellow-12", "bg-chart-Yellow-13", "bg-chart-Yellow-14", "bg-chart-Yellow-15", "bg-chart-Yellow-16", "bg-chart-Yellow-17", "bg-chart-Yellow-18", "bg-chart-Yellow-19", "bg-chart-Yellow-20", "bg-chart-Yellow-21", "bg-chart-Yellow-22", "bg-chart-Yellow-23", "bg-chart-Yellow-24", "bg-chart-Yellow-25", "bg-chart-Yellow-26", "bg-chart-Yellow-27", "bg-chart-Yellow-28", "bg-chart-Yellow-29", "bg-chart-Yellow-30", "bg-chart-Yellow-31", "bg-chart-Yellow-32", "bg-chart-Yellow-33", "bg-chart-Yellow-34", "bg-chart-Yellow-35", "bg-chart-Yellow-36", "bg-chart-Yellow-37", "bg-chart-Yellow-38", "bg-chart-Yellow-39", "bg-chart-Yellow-40", "bg-chart-Yellow-41", "bg-chart-Yellow-42", "bg-chart-Yellow-43", "bg-chart-Yellow-44", "bg-chart-Yellow-45", "bg-chart-Yellow-46", "bg-chart-Yellow-47", "bg-chart-Yellow-48", "bg-chart-Yellow-49", "bg-chart-Yellow-50", "bg-chart-Yellow-51", "bg-chart-Yellow-52", "bg-chart-Yellow-53", "bg-chart-Yellow-54", "bg-chart-Yellow-55", "bg-chart-Yellow-56", "bg-chart-Yellow-57", "bg-chart-Yellow-58", "bg-chart-Yellow-59", "bg-chart-Yellow-60", "bg-chart-Yellow-61", "bg-chart-Yellow-62", "bg-chart-Yellow-63", "bg-chart-Yellow-64", "bg-chart-Yellow-65", "bg-chart-Yellow-66", "bg-chart-Yellow-67", "bg-chart-Yellow-68", "bg-chart-Yellow-69", "bg-chart-Yellow-70", "bg-chart-Yellow-71", "bg-chart-Yellow-72", "bg-chart-Yellow-73", "bg-chart-Yellow-74", "bg-chart-Yellow-75", "bg-chart-Yellow-76", "bg-chart-Yellow-77", "bg-chart-Yellow-78", "bg-chart-Yellow-79", "bg-chart-Yellow-80", "bg-chart-Yellow-81", "bg-chart-Yellow-82", "bg-chart-Yellow-83", "bg-chart-Yellow-84", "bg-chart-Yellow-85", "bg-chart-Yellow-86", "bg-chart-Yellow-87", "bg-chart-Yellow-88", "bg-chart-Yellow-89", "bg-chart-Yellow-90", "bg-chart-Yellow-91", "bg-chart-Yellow-92", "bg-chart-Yellow-93", "bg-chart-Yellow-94", "bg-chart-Yellow-95", "bg-chart-Yellow-96", "bg-chart-Yellow-97", "bg-chart-Yellow-98", "bg-chart-Yellow-99", "bg-chart-Yellow-100"],
	Debt: ["bg-chart-Red-1", "bg-chart-Red-2", "bg-chart-Red-3", "bg-chart-Red-4", "bg-chart-Red-5", "bg-chart-Red-6", "bg-chart-Red-7", "bg-chart-Red-8", "bg-chart-Red-9", "bg-chart-Red-10", "bg-chart-Red-11", "bg-chart-Red-12", "bg-chart-Red-13", "bg-chart-Red-14", "bg-chart-Red-15", "bg-chart-Red-16", "bg-chart-Red-17", "bg-chart-Red-18", "bg-chart-Red-19", "bg-chart-Red-20", "bg-chart-Red-21", "bg-chart-Red-22", "bg-chart-Red-23", "bg-chart-Red-24", "bg-chart-Red-25", "bg-chart-Red-26", "bg-chart-Red-27", "bg-chart-Red-28", "bg-chart-Red-29", "bg-chart-Red-30", "bg-chart-Red-31", "bg-chart-Red-32", "bg-chart-Red-33", "bg-chart-Red-34", "bg-chart-Red-35", "bg-chart-Red-36", "bg-chart-Red-37", "bg-chart-Red-38", "bg-chart-Red-39", "bg-chart-Red-40", "bg-chart-Red-41", "bg-chart-Red-42", "bg-chart-Red-43", "bg-chart-Red-44", "bg-chart-Red-45", "bg-chart-Red-46", "bg-chart-Red-47", "bg-chart-Red-48", "bg-chart-Red-49", "bg-chart-Red-50", "bg-chart-Red-51", "bg-chart-Red-52", "bg-chart-Red-53", "bg-chart-Red-54", "bg-chart-Red-55", "bg-chart-Red-56", "bg-chart-Red-57", "bg-chart-Red-58", "bg-chart-Red-59", "bg-chart-Red-60", "bg-chart-Red-61", "bg-chart-Red-62", "bg-chart-Red-63", "bg-chart-Red-64", "bg-chart-Red-65", "bg-chart-Red-66", "bg-chart-Red-67", "bg-chart-Red-68", "bg-chart-Red-69", "bg-chart-Red-70", "bg-chart-Red-71", "bg-chart-Red-72", "bg-chart-Red-73", "bg-chart-Red-74", "bg-chart-Red-75", "bg-chart-Red-76", "bg-chart-Red-77", "bg-chart-Red-78", "bg-chart-Red-79", "bg-chart-Red-80", "bg-chart-Red-81", "bg-chart-Red-82", "bg-chart-Red-83", "bg-chart-Red-84", "bg-chart-Red-85", "bg-chart-Red-86", "bg-chart-Red-87", "bg-chart-Red-88", "bg-chart-Red-89", "bg-chart-Red-90", "bg-chart-Red-91", "bg-chart-Red-92", "bg-chart-Red-93", "bg-chart-Red-94", "bg-chart-Red-95", "bg-chart-Red-96", "bg-chart-Red-97", "bg-chart-Red-98", "bg-chart-Red-99", "bg-chart-Red-100"]
};