
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload } from '@/types/budget';
import { useContext, createContext } from 'react';

interface BudgetContextType {
  budgetMonths: Record<string, BudgetMonth>;
  currentDisplayMonthId: string;
  currentBudgetMonth: BudgetMonth | undefined;
  isLoading: boolean;
  getBudgetForMonth: (yearMonthId: string) => BudgetMonth | undefined;
  updateMonthBudget: (yearMonthId: string, payload: BudgetUpdatePayload) => void;
  addExpense: (yearMonthId: string, categoryId: string, amount: number, description: string) => void;
  deleteExpense: (yearMonthId: string, categoryId: string, expenseId: string) => void;
  duplicateMonthBudget: (sourceMonthId: string, targetMonthId: string) => void;
  navigateToPreviousMonth: () => void;
  navigateToNextMonth: () => void;
  setCurrentDisplayMonthId: (yearMonthId: string) => void;
  ensureMonthExists: (yearMonthId: string) => BudgetMonth;
  addCategoryToMonth: (yearMonthId: string, categoryName: string) => void; // Removed icon
  updateCategoryInMonth: (yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'icon'>>) => void; // Removed icon
  deleteCategoryFromMonth: (yearMonthId: string, categoryId: string) => void;
  setSavingsGoalForMonth: (yearMonthId: string, goal: number) => void;
  rolloverUnspentBudget: (yearMonthId: string) => { success: boolean; message: string };
}

export const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

export const useBudget = (): BudgetContextType => {
  const context = useContext(BudgetContext);
  if (!context) {
    throw new Error('useBudget must be used within a BudgetProvider');
  }
  return context;
};
