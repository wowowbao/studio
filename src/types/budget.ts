
export interface Expense {
  id: string; // uuid
  description: string;
  amount: number;
  dateAdded: string; // ISO string date
}

export interface BudgetCategory {
  id: string; // uuid
  name: string;
  icon: string; // Lucide icon name
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
  categories?: Array<Omit<BudgetCategory, 'id'> & { id?: string; spentAmount?: never }>;
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount'>[] = [
  { name: "Groceries", icon: "ShoppingCart", expenses: [] },
  { name: "Rent/Mortgage", icon: "Home", expenses: [] },
  { name: "Utilities", icon: "Zap", expenses: [] },
  { name: "Transport", icon: "Car", expenses: [] },
  { name: "Entertainment", icon: "Gamepad2", expenses: [] },
  { name: "Health", icon: "HeartPulse", expenses: [] },
  { name: "Savings", icon: "PiggyBank", expenses: [] },
  { name: "Other", icon: "MoreHorizontal", expenses: [] },
];
