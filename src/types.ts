export const ACCOUNT_CATEGORIES = [
  'Saved',
  'Invested',
  'Property',
  'Debt',
] as const;

export const ACCOUNT_COLORS_BACKGROUND =[
  'bg-blue-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-red-500'
] as const;

export const ACCOUNT_COLORS_TEXT =[
  'text-white',
  'text-white',
  'text-white',
  'text-red-500'
] as const;

export interface Account {
  id: string;
  name: string;
  category: typeof ACCOUNT_CATEGORIES[number]; 
  bgcolor: typeof ACCOUNT_COLORS_BACKGROUND[number]; 
  txcolor: typeof ACCOUNT_COLORS_TEXT[number]; 
  balance: number;
}

type AccountCategory = typeof ACCOUNT_CATEGORIES[number]; 
type AccountColorClassBackground = typeof ACCOUNT_COLORS_BACKGROUND[number];
type AccountColorClassText = typeof ACCOUNT_COLORS_TEXT[number];

export type CategoryColorMapBackground = {
    [K in AccountCategory]: AccountColorClassBackground;
};
export type CategoryColorMapText = {
    [K in AccountCategory]: AccountColorClassText;
};

export const CATEGORY_COLOR_BACKGROUND_MAP: CategoryColorMapBackground = {
    'Saved': 'bg-blue-500',
    'Invested': 'bg-yellow-500',
    'Property': 'bg-purple-500',
    'Debt': 'bg-red-500',
};

export const CATEGORY_COLOR_TEXT_MAP: CategoryColorMapText = {
    'Saved': 'text-white',
    'Invested': 'text-white',
    'Property': 'text-white',
    'Debt': 'text-red-500',
};