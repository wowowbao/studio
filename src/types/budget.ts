
export interface Expense {
  id: string; // uuid
  description: string;
  amount: number;
  dateAdded: string; // ISO string date
}

export interface BudgetCategory {
  id: string; // uuid
  name: string;
  // icon: string; // Lucide icon name - REMOVED
  budgetedAmount: number;
  expenses: Expense[]; // Changed from spentAmount
  // spentAmount is now a derived property
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
  // When updating categories, we expect the full category structure including expenses
  categories?: Array<Omit<BudgetCategory, 'id' | 'icon'> & { id?: string; spentAmount?: never }>;
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount'>[] = [
  { name: "Groceries", expenses: [] },
  { name: "Rent/Mortgage", expenses: [] },
  { name: "Utilities", expenses: [] },
  { name: "Transport", expenses: [] },
  { name: "Entertainment", expenses: [] },
  { name: "Health", expenses: [] },
  { name: "Savings", expenses: [] },
  { name: "Other", expenses: [] },
];
