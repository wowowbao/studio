
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_START_MONTH = '2025-06'; // App default start month

// Helper to get current YYYY-MM string - now used as a fallback, not primary default
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
  const pseudoUserId = "localUser"; 
  return `${baseKey}${pseudoUserId}`;
};


export const useBudgetCore = () => {
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthId] = useState<string>(DEFAULT_START_MONTH);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    setIsLoading(true);
    try {
      const budgetKey = getUserSpecificKey(BUDGET_DATA_KEY_PREFIX);
      const displayMonthKey = getUserSpecificKey(DISPLAY_MONTH_KEY_PREFIX);

      const storedBudgets = localStorage.getItem(budgetKey);
      if (storedBudgets) {
        const parsedBudgets = JSON.parse(storedBudgets) as Record<string, BudgetMonth>;
        // Ensure expenses array and isRolledOver flag exist for all categories/months
        Object.values(parsedBudgets).forEach(month => {
          month.categories.forEach(cat => {
            if (!cat.expenses) {
              cat.expenses = [];
            }
          });
          if (month.isRolledOver === undefined) {
            month.isRolledOver = false;
          }
        });
        setBudgetMonths(parsedBudgets);
      } else {
        // If no stored budgets, initialize with the default start month
        const newMonth = createNewMonthBudget(DEFAULT_START_MONTH);
        setBudgetMonths({ [DEFAULT_START_MONTH]: newMonth });
      }
      
      const storedDisplayMonth = localStorage.getItem(displayMonthKey);
      const currentBudgetsData = storedBudgets ? JSON.parse(storedBudgets) : {};

      // If stored display month exists and is part of loaded budgets, use it. Otherwise, default to DEFAULT_START_MONTH.
      if (storedDisplayMonth && Object.keys(currentBudgetsData).includes(storedDisplayMonth)) {
         setCurrentDisplayMonthId(storedDisplayMonth);
      } else {
        setCurrentDisplayMonthId(DEFAULT_START_MONTH);
        // Ensure the default start month budget exists if we're setting it as current
        setBudgetMonths(prev => {
          if (!prev[DEFAULT_START_MONTH]) {
            const newMonth = createNewMonthBudget(DEFAULT_START_MONTH);
            return { ...prev, [DEFAULT_START_MONTH]: newMonth };
          }
          return prev;
        });
      }

    } catch (error) {
      console.error("Failed to load budgets from localStorage:", error);
      // Fallback to default start month on error
      const newMonth = createNewMonthBudget(DEFAULT_START_MONTH);
      setBudgetMonths({ [DEFAULT_START_MONTH]: newMonth });
      setCurrentDisplayMonthId(DEFAULT_START_MONTH);
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
        expenses: [],
      })),
      savingsGoal: 0,
      isRolledOver: false,
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
          expenses: cat.expenses || (monthToUpdate.categories.find(c => c.id === cat.id)?.expenses) || [],
        }));
      }
      // isRolledOver is handled by rolloverUnspentBudget
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
      if (!month) return prev; 
      if (month.isRolledOver) {
        console.warn(`Cannot add expense to ${yearMonthId} as it has been rolled over.`);
        // Optionally, inform the user via toast or alert here
        return prev;
      }
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
      if (month.isRolledOver) {
        console.warn(`Cannot delete expense from ${yearMonthId} as it has been rolled over.`);
         // Optionally, inform the user
        return prev;
      }
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
    const newCategories = sourceBudget.categories.map(cat => ({
      ...cat,
      id: uuidv4(), 
      expenses: [], 
    }));

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      categories: newCategories,
      savingsGoal: sourceBudget.savingsGoal,
      isRolledOver: false, // New month is not rolled over
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
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      if (month.isRolledOver) {
        console.warn(`Cannot set savings goal for ${yearMonthId} as it has been rolled over.`);
        // Optionally, inform the user
        return prev;
      }
      return {
      ...prev,
      [yearMonthId]: {
        ...month,
        savingsGoal: goal,
      },
    }});
  }, [ensureMonthExists]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId);
    if (!monthBudget) {
      return { success: false, message: `Budget for ${yearMonthId} not found.` };
    }
    if (monthBudget.isRolledOver) {
      return { success: false, message: `Budget for ${yearMonthId} has already been rolled over.` };
    }

    const savingsCategory = monthBudget.categories.find(cat => cat.name.toLowerCase() === 'savings');
    if (!savingsCategory) {
      return { success: false, message: "Savings category not found. Please create one to enable rollover." };
    }

    let totalPositiveUnspent = 0;
    monthBudget.categories.forEach(cat => {
      if (cat.name.toLowerCase() !== 'savings') {
        const spentAmount = cat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const unspentInCategory = cat.budgetedAmount - spentAmount;
        if (unspentInCategory > 0) {
          totalPositiveUnspent += unspentInCategory;
        }
      }
    });

    if (totalPositiveUnspent <= 0) {
      // Mark as rolled over even if no positive unspent, to prevent repeated attempts
      setBudgetMonths(prev => ({
        ...prev,
        [yearMonthId]: { ...prev[yearMonthId], isRolledOver: true },
      }));
      return { success: true, message: "No unspent budget to rollover. Month marked as closed." };
    }

    const rolloverExpense: Expense = {
      id: uuidv4(),
      description: `Rolled over unspent budget from ${yearMonthId}`,
      amount: totalPositiveUnspent,
      dateAdded: new Date().toISOString(),
    };

    setBudgetMonths(prev => {
      const updatedMonth = { ...prev[yearMonthId] };
      updatedMonth.categories = updatedMonth.categories.map(cat => {
        if (cat.id === savingsCategory.id) {
          return { ...cat, expenses: [...cat.expenses, rolloverExpense] };
        }
        return cat;
      });
      updatedMonth.isRolledOver = true;
      return { ...prev, [yearMonthId]: updatedMonth };
    });
    return { success: true, message: `Successfully rolled over $${totalPositiveUnspent.toFixed(2)} to savings for ${yearMonthId}.` };
  }, [getBudgetForMonth]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading,
    getBudgetForMonth,
    updateMonthBudget,
    addExpense,
    deleteExpense,
    duplicateMonthBudget,
    navigateToPreviousMonth,
    navigateToNextMonth,
    setCurrentDisplayMonthId,
    ensureMonthExists,
    addCategoryToMonth,
    updateCategoryInMonth,
    deleteCategoryFromMonth,
    setSavingsGoalForMonth,
    rolloverUnspentBudget,
  };
};
