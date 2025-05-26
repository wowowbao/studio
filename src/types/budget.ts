
export interface BudgetCategory {
  id: string; // uuid
  name: string;
  icon: string; // Lucide icon name
  budgetedAmount: number;
  spentAmount: number;
}

export interface BudgetMonth {
  id: string; // "YYYY-MM" format, e.g., "2024-07"
  year: number;
  month: number; // 1-12 (1 for January, 12 for December)
  categories: BudgetCategory[];
  savingsGoal: number; // Monthly savings goal
}

export type BudgetUpdatePayload = Partial<Omit<BudgetMonth, 'id' | 'year' | 'month' | 'categories'>> & {
  categories?: BudgetCategory[];
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount' | 'spentAmount'>[] = [
  { name: "Groceries", icon: "ShoppingCart" },
  { name: "Rent/Mortgage", icon: "Home" },
  { name: "Utilities", icon: "Zap" },
  { name: "Transport", icon: "Car" },
  { name: "Entertainment", icon: "Gamepad2" },
  { name: "Health", icon: "HeartPulse" }, // Changed from Heart to HeartPulse
  { name: "Savings", icon: "PiggyBank" },
  { name: "Other", icon: "MoreHorizontal" },
];
