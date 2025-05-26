
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
  isSystemCategory?: boolean; // To identify special categories like "Savings" or "Credit Card Payments"
}

export interface BudgetMonth {
  id: string; // "YYYY-MM" format, e.g., "2024-07"
  year: number;
  month: number; // 1-12 (1 for January, 12 for December)
  incomes: IncomeEntry[];
  categories: BudgetCategory[];
  savingsGoal: number; // Overall monthly savings goal target
  isRolledOver?: boolean; // Flag to indicate if unspent budget has been rolled over
  startingCreditCardDebt?: number; // Debt at the start of the month
}

export type BudgetUpdatePayload = Partial<Omit<BudgetMonth, 'id' | 'year' | 'month' | 'categories' | 'isRolledOver' | 'incomes'>> & {
  categories?: Array<Omit<BudgetCategory, 'id'> & { id?: string; subcategories?: Array<Omit<SubCategory, 'id'> & { id?: string }> }>;
  startingCreditCardDebt?: number;
};

export const DEFAULT_CATEGORIES: Omit<BudgetCategory, 'id' | 'budgetedAmount' | 'subcategories' | 'expenses'>[] = [
  { name: "Savings", isSystemCategory: true },
  { name: "Credit Card Payments", isSystemCategory: true },
  { name: "Groceries" },
  { name: "Rent/Mortgage" },
  { name: "Utilities" },
  { name: "Transport" },
  { name: "Entertainment" },
  { name: "Health" },
  { name: "Other" },
];
