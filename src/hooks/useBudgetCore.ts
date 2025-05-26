
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_START_MONTH = '2025-06'; // App default start month updated

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
  const pseudoUserId = "localUser"; // For password-protected local storage
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
        // Ensure expenses array, isRolledOver flag, and subcategories array exist
        Object.values(parsedBudgets).forEach(month => {
          month.categories.forEach(cat => {
            if (!cat.expenses) cat.expenses = [];
            if (!cat.subcategories) cat.subcategories = [];
            cat.subcategories.forEach(subCat => {
              if(!subCat.expenses) subCat.expenses = [];
            });
          });
          if (month.isRolledOver === undefined) month.isRolledOver = false;
        });
        setBudgetMonths(parsedBudgets);
      } else {
        const newMonth = createNewMonthBudget(DEFAULT_START_MONTH);
        setBudgetMonths({ [DEFAULT_START_MONTH]: newMonth });
      }

      const storedDisplayMonth = localStorage.getItem(displayMonthKey);
      const currentBudgetsData = storedBudgets ? JSON.parse(storedBudgets) : {};

      if (storedDisplayMonth && Object.keys(currentBudgetsData).includes(storedDisplayMonth)) {
         setCurrentDisplayMonthId(storedDisplayMonth);
      } else {
        setCurrentDisplayMonthId(DEFAULT_START_MONTH);
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
        subcategories: [],
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
        updatedMonth.categories = payload.categories.map(catPayload => {
          const existingCat = monthToUpdate.categories.find(c => c.id === catPayload.id);
          return {
            id: catPayload.id || uuidv4(),
            name: catPayload.name,
            budgetedAmount: catPayload.budgetedAmount === undefined ? 0 : catPayload.budgetedAmount,
            expenses: catPayload.expenses || existingCat?.expenses || [],
            subcategories: (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => ({
              id: subCatPayload.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
              expenses: subCatPayload.expenses || existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id)?.expenses || [],
            })),
          };
        });
      }
      return { ...prev, [yearMonthId]: updatedMonth };
    });
  }, [createNewMonthBudget]);


  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    ensureMonthExists(yearMonthId);
    const newCategory: BudgetCategory = {
      id: uuidv4(),
      name: categoryName,
      budgetedAmount: 0,
      expenses: [],
      subcategories: [],
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

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories'>>) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = prev[yearMonthId];
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId ? { ...cat, ...updatedCategoryData, subcategories: cat.subcategories || [] } : cat
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

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    setBudgetMonths(prev => {
      const month = { ...prev[monthId] };
      if (!month) return prev;
      month.categories = month.categories.map(cat => {
        if (cat.id === parentCategoryId) {
          const newSubCategory: SubCategory = {
            id: uuidv4(),
            name: subCategoryName,
            budgetedAmount: subCategoryBudget,
            expenses: [],
          };
          return { ...cat, subcategories: [...(cat.subcategories || []), newSubCategory] };
        }
        return cat;
      });
      return { ...prev, [monthId]: month };
    });
  }, []);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    setBudgetMonths(prev => {
      const month = { ...prev[monthId] };
      if (!month) return prev;
      month.categories = month.categories.map(cat => {
        if (cat.id === parentCategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map(sub =>
              sub.id === subCategoryId ? { ...sub, name: newName, budgetedAmount: newBudget } : sub
            ),
          };
        }
        return cat;
      });
      return { ...prev, [monthId]: month };
    });
  }, []);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    setBudgetMonths(prev => {
      const month = { ...prev[monthId] };
      if (!month) return prev;
      month.categories = month.categories.map(cat => {
        if (cat.id === parentCategoryId) {
          return { ...cat, subcategories: (cat.subcategories || []).filter(sub => sub.id !== subCategoryId) };
        }
        return cat;
      });
      return { ...prev, [monthId]: month };
    });
  }, []);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, isSubCategory: boolean = false) => {
    ensureMonthExists(yearMonthId);
    const newExpense: Expense = {
      id: uuidv4(),
      description,
      amount,
      dateAdded: new Date().toISOString(),
    };
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      if (!month) return prev;
      if (month.isRolledOver) {
        console.warn(`Cannot add expense to ${yearMonthId} as it has been rolled over.`);
        return prev;
      }

      month.categories = month.categories.map(cat => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          return { ...cat, expenses: [...cat.expenses, newExpense] };
        } else if (isSubCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          return {
            ...cat,
            subcategories: cat.subcategories.map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...sub.expenses, newExpense] } : sub
            ),
          };
        }
        return cat;
      });
      return { ...prev, [yearMonthId]: month };
    });
  }, [ensureMonthExists]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      if (!month) return prev;
      if (month.isRolledOver) {
        console.warn(`Cannot delete expense from ${yearMonthId} as it has been rolled over.`);
        return prev;
      }
      month.categories = month.categories.map(cat => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          return { ...cat, expenses: cat.expenses.filter(exp => exp.id !== expenseId) };
        } else if (isSubCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          return {
            ...cat,
            subcategories: cat.subcategories.map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: sub.expenses.filter(exp => exp.id !== expenseId) } : sub
            ),
          };
        }
        return cat;
      });
      return { ...prev, [yearMonthId]: month };
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
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: cat.budgetedAmount,
      expenses: [], // Expenses are not carried over
      subcategories: (cat.subcategories || []).map(subCat => ({
        id: uuidv4(),
        name: subCat.name,
        budgetedAmount: subCat.budgetedAmount,
        expenses: [], // Expenses are not carried over
      })),
    }));

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      categories: newCategories,
      savingsGoal: sourceBudget.savingsGoal,
      isRolledOver: false,
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
        // Calculate unspent from main category expenses
        const mainCatSpent = cat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const mainCatUnspent = cat.budgetedAmount - mainCatSpent;
        if (mainCatUnspent > 0) {
          totalPositiveUnspent += mainCatUnspent;
        }
        // Calculate unspent from subcategories
        (cat.subcategories || []).forEach(subCat => {
            const subCatSpent = subCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            const subCatUnspent = subCat.budgetedAmount - subCatSpent;
            if (subCatUnspent > 0) {
                totalPositiveUnspent += subCatUnspent;
            }
        });
      }
    });

    if (totalPositiveUnspent <= 0) {
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
    addSubCategory,
    updateSubCategory,
    deleteSubCategory,
  };
};
