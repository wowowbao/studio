
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, SubCategory, IncomeEntry } from '@/types/budget';
import { useContext, createContext } from 'react';

interface BudgetContextType {
  budgetMonths: Record<string, BudgetMonth>;
  currentDisplayMonthId: string;
  currentBudgetMonth: BudgetMonth | undefined;
  isLoading: boolean;
  getBudgetForMonth: (yearMonthId: string) => BudgetMonth | undefined;
  updateMonthBudget: (yearMonthId: string, payload: BudgetUpdatePayload) => void;
  addExpense: (yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory?: boolean) => void;
  deleteExpense: (yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory?: boolean) => void;
  addIncome: (yearMonthId: string, description: string, amount: number, dateAdded: string) => void;
  deleteIncome: (yearMonthId: string, incomeId: string) => void;
  duplicateMonthBudget: (sourceMonthId: string, targetMonthId: string) => void;
  navigateToPreviousMonth: () => void;
  navigateToNextMonth: () => void;
  setCurrentDisplayMonthId: (yearMonthId: string) => void;
  ensureMonthExists: (yearMonthId: string) => BudgetMonth;
  addCategoryToMonth: (yearMonthId: string, categoryName: string) => void;
  updateCategoryInMonth: (yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => void;
  deleteCategoryFromMonth: (yearMonthId: string, categoryId: string) => void;
  // setSavingsGoalForMonth: (yearMonthId: string, goal: number) => void; // Removed
  rolloverUnspentBudget: (yearMonthId: string) => { success: boolean; message: string };
  addSubCategory: (monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => void;
  updateSubCategory: (monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => void;
  deleteSubCategory: (monthId: string, parentCategoryId: string, subCategoryId: string) => void;
}

export const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

export const useBudget = (): BudgetContextType => {
  const context = useContext(BudgetContext);
  if (!context) {
    throw new Error('useBudget must be used within a BudgetProvider');
  }
  return context;
};
