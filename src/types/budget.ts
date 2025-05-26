
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
  isSystemCategory?: boolean; // To identify special categories like "Savings"
}

export interface BudgetMonth {
  id: string; // "YYYY-MM" format, e.g., "2024-07"
  year: number;
  month: number; // 1-12 (1 for January, 12 for December)
  monthlyIncome: number; // Total income for the month
  categories: BudgetCategory[];
  savingsGoal: number; // Overall monthly savings goal target
  isRolledOver?: boolean; // Flag to indicate if unspent budget has been rolled over
}

export type BudgetUpdatePayload = Partial<Omit<BudgetMonth, 'id' | 'year' | 'month' | 'categories' | 'isRolledOver'>> & {
  categories?: Array<Omit<BudgetCategory, 'id' | 'isSystemCategory'> & { id?: string; subcategories?: Array<Omit<SubCategory, 'id'> & { id?: string }> }>;
  monthlyIncome?: number;
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount' | 'subcategories' | 'expenses'>[] = [
  { name: "Savings", isSystemCategory: true }, // Mark Savings as a system category
  { name: "Groceries" },
  { name: "Rent/Mortgage" },
  { name: "Utilities" },
  { name: "Transport" },
  { name: "Entertainment" },
  { name: "Health" },
  { name: "Other" },
];
