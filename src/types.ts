export const ACCOUNT_CATEGORIES = [
  'Saved',
  'Invested',
  'Property',
  'Debt',
] as const;

// 2. Derive the TypeScript union type from the array
export interface Account {
  id: string;
  name: string;
  // Use the 'typeof' operator with '[]' to get the union of all array values
  category: typeof ACCOUNT_CATEGORIES[number]; 
  balance: number;
}