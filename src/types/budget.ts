
export interface Expense {
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
  budgetedAmount: number; // Budget for the main category itself, if it doesn't have subcategories or if it's a "parent-level" budget
  expenses: Expense[];
  subcategories?: SubCategory[];
}

export interface BudgetMonth {
  id: string; // "YYYY-MM" format, e.g., "2024-07"
  year: number;
  month: number; // 1-12 (1 for January, 12 for December)
  categories: BudgetCategory[];
  savingsGoal: number; // Monthly savings goal
  isRolledOver?: boolean; // Flag to indicate if unspent budget has been rolled over
}

export type BudgetUpdatePayload = Partial<Omit<BudgetMonth, 'id' | 'year' | 'month' | 'categories' | 'isRolledOver'>> & {
  categories?: Array<Omit<BudgetCategory, 'id'> & { id?: string; subcategories?: Array<Omit<SubCategory, 'id'> & { id?: string }> }>;
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount' | 'subcategories'>[] = [
  { name: "Groceries", expenses: [] },
  { name: "Rent/Mortgage", expenses: [] },
  { name: "Utilities", expenses: [] },
  { name: "Transport", expenses: [] },
  { name: "Entertainment", expenses: [] },
  { name: "Health", expenses: [] },
  { name: "Savings", expenses: [] },
  { name: "Other", expenses: [] },
];
