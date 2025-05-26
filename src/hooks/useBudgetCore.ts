
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/firebase'; // Import auth to get current user
import type { User } from 'firebase/auth';

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

export const useBudgetCore = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(auth.currentUser);
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthId] = useState<string>(getCurrentYearMonth());
  const [isLoading, setIsLoading] = useState(true);

  // Listen to Firebase auth state changes to update currentUser
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setCurrentUser(user);
      // When user changes, we might need to reload/re-initialize budget data
      // This effect will trigger the data load/save effects below.
    });
    return () => unsubscribe();
  }, []);
  
  const getBudgetDataKey = useCallback(() => {
    return `budgetFlowData-${currentUser?.uid || 'guest'}`;
  }, [currentUser]);

  const getDisplayMonthKey = useCallback(() => {
    return `budgetFlowDisplayMonth-${currentUser?.uid || 'guest'}`;
  }, [currentUser]);


  // Load data from localStorage when component mounts or user changes
  useEffect(() => {
    setIsLoading(true);
    try {
      const budgetDataKey = getBudgetDataKey();
      const displayMonthKey = getDisplayMonthKey();

      const storedBudgets = localStorage.getItem(budgetDataKey);
      if (storedBudgets) {
        setBudgetMonths(JSON.parse(storedBudgets));
      } else {
        const initialMonthId = getCurrentYearMonth();
        const newMonth = createNewMonthBudget(initialMonthId);
        setBudgetMonths({ [initialMonthId]: newMonth });
      }
      
      const storedDisplayMonth = localStorage.getItem(displayMonthKey);
      // Validate if storedDisplayMonth is for the current user's data scope
      const currentBudgets = storedBudgets ? JSON.parse(storedBudgets) : {};
      if (storedDisplayMonth && Object.keys(currentBudgets).includes(storedDisplayMonth)) {
         setCurrentDisplayMonthId(storedDisplayMonth);
      } else {
        // If not valid or not present, default to current month
        const currentMonthDefault = getCurrentYearMonth();
        setCurrentDisplayMonthId(currentMonthDefault);
        // If initializing, ensure this default month exists in budgetMonths
        if (!currentBudgets[currentMonthDefault]) {
            const newMonth = createNewMonthBudget(currentMonthDefault);
            setBudgetMonths(prev => ({ ...prev, [currentMonthDefault]: newMonth }));
        }
      }

    } catch (error) {
      console.error("Failed to load budgets from localStorage:", error);
      const initialMonthId = getCurrentYearMonth();
      const newMonth = createNewMonthBudget(initialMonthId);
      setBudgetMonths({ [initialMonthId]: newMonth });
      setCurrentDisplayMonthId(initialMonthId);
    }
    setIsLoading(false);
  }, [currentUser, getBudgetDataKey, getDisplayMonthKey]); // Rerun on user change

  // Save data to localStorage when budgetMonths changes
  useEffect(() => {
    if (!isLoading) { // Only save if not initially loading
      try {
        const budgetDataKey = getBudgetDataKey();
        localStorage.setItem(budgetDataKey, JSON.stringify(budgetMonths));
      } catch (error) {
        console.error("Failed to save budgets to localStorage:", error);
      }
    }
  }, [budgetMonths, isLoading, getBudgetDataKey]);

  // Save display month to localStorage when it changes
  useEffect(() => {
    if(!isLoading) {
      const displayMonthKey = getDisplayMonthKey();
      localStorage.setItem(displayMonthKey, currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, isLoading, getDisplayMonthKey]);


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
        spentAmount: 0,
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
          spentAmount: cat.spentAmount === undefined ? 0 : cat.spentAmount,
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
      spentAmount: 0,
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


  const addExpense = useCallback((yearMonthId: string, categoryId: string, amount: number) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId ? { ...cat, spentAmount: cat.spentAmount + amount } : cat
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
      spentAmount: 0, 
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
    ensureMonthExists(prevMonthId); // Ensure month exists before setting it as current
    setCurrentDisplayMonthId(prevMonthId);
  }, [currentDisplayMonthId, ensureMonthExists]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    ensureMonthExists(nextMonthId); // Ensure month exists before setting it as current
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
    isLoading, // This now primarily reflects localStorage loading
    getBudgetForMonth,
    updateMonthBudget,
    addExpense,
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
