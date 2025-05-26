
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

// Helper to get current YYYY-MM string
export const getCurrentYearMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Helper to get YYYY-MM string from Date object
export const getYearMonthFromDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Helper to parse YYYY-MM string to Date object (first day of month)
export const parseYearMonth = (yearMonth: string): Date => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

const BUDGET_DATA_KEY_PREFIX = 'budgetFlowData_'; 
const DISPLAY_MONTH_KEY_PREFIX = 'budgetFlowDisplayMonth_';

// Function to get user-specific storage key
const getUserSpecificKey = (baseKey: string) => {
  // For this password-protected version, we use a static "user" ID.
  // If proper auth were re-added, this would use the actual user UID.
  const pseudoUserId = "localUser"; 
  return `${baseKey}${pseudoUserId}`;
};


export const useBudgetCore = () => {
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthId] = useState<string>(getCurrentYearMonth());
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    setIsLoading(true);
    try {
      const budgetKey = getUserSpecificKey(BUDGET_DATA_KEY_PREFIX);
      const displayMonthKey = getUserSpecificKey(DISPLAY_MONTH_KEY_PREFIX);

      const storedBudgets = localStorage.getItem(budgetKey);
      if (storedBudgets) {
        const parsedBudgets = JSON.parse(storedBudgets);
        // Ensure expenses array exists for all categories (data migration for older structures)
        Object.values(parsedBudgets as Record<string, BudgetMonth>).forEach(month => {
          month.categories.forEach(cat => {
            if (!cat.expenses) {
              cat.expenses = [];
            }
          });
        });
        setBudgetMonths(parsedBudgets);
      } else {
        const initialMonthId = getCurrentYearMonth();
        const newMonth = createNewMonthBudget(initialMonthId);
        setBudgetMonths({ [initialMonthId]: newMonth });
      }
      
      const storedDisplayMonth = localStorage.getItem(displayMonthKey);
      const currentBudgetsData = storedBudgets ? JSON.parse(storedBudgets) : {};

      if (storedDisplayMonth && Object.keys(currentBudgetsData).includes(storedDisplayMonth)) {
         setCurrentDisplayMonthId(storedDisplayMonth);
      } else {
        const currentMonthDefault = getCurrentYearMonth();
        setCurrentDisplayMonthId(currentMonthDefault);
        setBudgetMonths(prev => {
          if (!prev[currentMonthDefault]) {
            const newMonth = createNewMonthBudget(currentMonthDefault);
            return { ...prev, [currentMonthDefault]: newMonth };
          }
          return prev;
        });
      }

    } catch (error) {
      console.error("Failed to load budgets from localStorage:", error);
      const initialMonthId = getCurrentYearMonth();
      const newMonth = createNewMonthBudget(initialMonthId);
      setBudgetMonths({ [initialMonthId]: newMonth });
      setCurrentDisplayMonthId(initialMonthId);
    }
    setIsLoading(false);
  }, []); 

  useEffect(() => {
    if (!isLoading) { 
      try {
        const budgetKey = getUserSpecificKey(BUDGET_DATA_KEY_PREFIX);
        localStorage.setItem(budgetKey, JSON.stringify(budgetMonths));
      } catch (error) {
        console.error("Failed to save budgets to localStorage:", error);
      }
    }
  }, [budgetMonths, isLoading]);

  useEffect(() => {
    if(!isLoading) {
      const displayMonthKey = getUserSpecificKey(DISPLAY_MONTH_KEY_PREFIX);
      localStorage.setItem(displayMonthKey, currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, isLoading]);


  const createNewMonthBudget = useCallback((yearMonthId: string): BudgetMonth => {
    const [year, month] = yearMonthId.split('-').map(Number);
    return {
      id: yearMonthId,
      year,
      month,
      categories: DEFAULT_CATEGORIES.map(cat => ({
        ...cat,
        id: uuidv4(),
        budgetedAmount: 0,
        expenses: [], // Initialize expenses array
      })),
      savingsGoal: 0,
    };
  }, []);

  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);
  
  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    if (budgetMonths[yearMonthId]) {
      return budgetMonths[yearMonthId];
    }
    const newMonth = createNewMonthBudget(yearMonthId);
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: newMonth }));
    return newMonth;
  }, [budgetMonths, createNewMonthBudget]);

  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prev => {
      const monthToUpdate = prev[yearMonthId] || createNewMonthBudget(yearMonthId);
      const updatedMonth = { ...monthToUpdate };

      if (payload.savingsGoal !== undefined) {
        updatedMonth.savingsGoal = payload.savingsGoal;
      }
      if (payload.categories) {
        updatedMonth.categories = payload.categories.map(cat => ({
          id: cat.id || uuidv4(),
          name: cat.name,
          icon: cat.icon,
          budgetedAmount: cat.budgetedAmount === undefined ? 0 : cat.budgetedAmount,
          // Ensure expenses array exists, preserving existing if not explicitly overwritten
          expenses: cat.expenses || (monthToUpdate.categories.find(c => c.id === cat.id)?.expenses) || [],
        }));
      }
      return { ...prev, [yearMonthId]: updatedMonth };
    });
  }, [createNewMonthBudget]);


  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string, icon: string) => {
    ensureMonthExists(yearMonthId);
    const newCategory: BudgetCategory = {
      id: uuidv4(),
      name: categoryName,
      icon,
      budgetedAmount: 0,
      expenses: [],
    };
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: [...month.categories, newCategory],
        },
      };
    });
  }, [ensureMonthExists]);
  
  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<BudgetCategory>) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId ? { ...cat, ...updatedCategoryData } : cat
          ),
        },
      };
    });
  }, [ensureMonthExists]);

  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.filter(cat => cat.id !== categoryId),
        },
      };
    });
  }, [ensureMonthExists]);


  const addExpense = useCallback((yearMonthId: string, categoryId: string, amount: number, description: string) => {
    ensureMonthExists(yearMonthId);
    const newExpense: Expense = {
      id: uuidv4(),
      description,
      amount,
      dateAdded: new Date().toISOString(),
    };
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      if (!month) return prev; // Should not happen if ensureMonthExists works
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId 
            ? { ...cat, expenses: [...cat.expenses, newExpense] } 
            : cat
          ),
        },
      };
    });
  }, [ensureMonthExists]);

  const deleteExpense = useCallback((yearMonthId: string, categoryId: string, expenseId: string) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      if (!month) return prev;
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId
            ? { ...cat, expenses: cat.expenses.filter(exp => exp.id !== expenseId) }
            : cat
          ),
        },
      };
    });
  }, [ensureMonthExists]);


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId);
    if (!sourceBudget) {
      console.warn(`Source month ${sourceMonthId} not found for duplication.`);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    // Duplicate categories with their budgeted amounts, but reset expenses
    const newCategories = sourceBudget.categories.map(cat => ({
      ...cat,
      id: uuidv4(), 
      expenses: [], // Reset expenses for the new month
    }));

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      categories: newCategories,
      savingsGoal: sourceBudget.savingsGoal,
    };

    setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthData }));
    setCurrentDisplayMonthId(targetMonthId); 
  }, [getBudgetForMonth]);

  const navigateToPreviousMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() - 1);
    const prevMonthId = getYearMonthFromDate(currentDate);
    ensureMonthExists(prevMonthId); 
    setCurrentDisplayMonthId(prevMonthId);
  }, [currentDisplayMonthId, ensureMonthExists]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    ensureMonthExists(nextMonthId); 
    setCurrentDisplayMonthId(nextMonthId);
  }, [currentDisplayMonthId, ensureMonthExists]);
  
  const setSavingsGoalForMonth = useCallback((yearMonthId: string, goal: number) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => ({
      ...prev,
      [yearMonthId]: {
        ...prev[yearMonthId],
        savingsGoal: goal,
      },
    }));
  }, [ensureMonthExists]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading,
    getBudgetForMonth,
    updateMonthBudget,
    addExpense,
    deleteExpense, // Added deleteExpense
    duplicateMonthBudget,
    navigateToPreviousMonth,
    navigateToNextMonth,
    setCurrentDisplayMonthId,
    ensureMonthExists,
    addCategoryToMonth,
    updateCategoryInMonth,
    deleteCategoryFromMonth,
    setSavingsGoalForMonth,
  };
};
