
export interface Expense {
  id: string; // uuid
  description: string;
  amount: number;
  dateAdded: string; // ISO string date
}

export interface IncomeEntry {
  id: string; // uuid
  description: string;
  amount: number;
  dateAdded: string; // ISO string date
}

export interface SubCategory {
  id: string; // uuid
  name: string;
  budgetedAmount: number;
  expenses: Expense[];
}

export interface BudgetCategory {
  id: string; // uuid
  name: string;
  budgetedAmount: number;
  expenses: Expense[];
  subcategories?: SubCategory[];
  isSystemCategory?: boolean; // To identify special categories like "Credit Card Payments" or "Savings"
}

export interface BudgetMonth {
  id: string; // "YYYY-MM" format, e.g., "2024-07"
  year: number;
  month: number; // 1-12 (1 for January, 12 for December)
  incomes: IncomeEntry[];
  categories: BudgetCategory[];
  isRolledOver?: boolean; // Flag to indicate if unspent budget has been rolled over
  startingCreditCardDebt?: number; // Debt at the start of the month
}

export type BudgetUpdatePayload = Partial<Omit<BudgetMonth, 'id' | 'year' | 'month' | 'categories' | 'isRolledOver' | 'incomes'>> & {
  categories?: Array<Omit<BudgetCategory, 'id' | 'expenses' > & { id?: string; subcategories?: Array<Omit<SubCategory, 'id' | 'expenses'> & { id?: string; expenses?: SubCategory['expenses'] }>; expenses?: BudgetCategory['expenses'] }>;
  startingCreditCardDebt?: number;
};

// Default categories are now only system categories that should exist.
// User categories will be added by the user or AI setup.
export const DEFAULT_CATEGORIES: Array<Partial<BudgetCategory>> = [
  { name: "Savings", isSystemCategory: true, budgetedAmount: 0, expenses: [], subcategories: [] },
  { name: "Credit Card Payments", isSystemCategory: true, budgetedAmount: 0, expenses: [], subcategories: [] },
];
