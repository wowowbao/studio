
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_START_MONTH = '2025-06'; 

export const getYearMonthFromDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const parseYearMonth = (yearMonth: string): Date => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

const BUDGET_DATA_KEY_PREFIX = 'budgetFlowData_';
const DISPLAY_MONTH_KEY_PREFIX = 'budgetFlowDisplayMonth_';

const getUserSpecificKey = (baseKey: string) => {
  const pseudoUserId = "localUser"; 
  return `${baseKey}${pseudoUserId}`;
};

// Ensures system categories exist, are marked as such, and have no subcategories.
// Does NOT dictate their budgetedAmount.
const ensureSystemCategories = (categories: BudgetCategory[]): BudgetCategory[] => {
  let newCategories = [...categories];
  const systemCategoryNames = ["savings", "credit card payments"];

  systemCategoryNames.forEach(sysName => {
    const existingIndex = newCategories.findIndex(cat => cat.name.toLowerCase() === sysName);
    if (existingIndex > -1) {
      newCategories[existingIndex] = {
        ...newCategories[existingIndex],
        isSystemCategory: true,
        subcategories: [], // System categories don't have subs
      };
    } else {
      // If it doesn't exist, add it with default values
      newCategories.push({
        id: uuidv4(),
        name: sysName.charAt(0).toUpperCase() + sysName.slice(1), // Capitalize
        budgetedAmount: 0, // Default to 0, user can set their own budget
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
      });
    }
  });
  return newCategories;
};


export const useBudgetCore = () => {
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthId] = useState<string>(DEFAULT_START_MONTH);
  const [isLoading, setIsLoading] = useState(true);

  const getPreviousMonthId = (currentMonthId: string): string => {
    const currentDate = parseYearMonth(currentMonthId);
    currentDate.setMonth(currentDate.getMonth() - 1);
    return getYearMonthFromDate(currentDate);
  };

  useEffect(() => {
    setIsLoading(true);
    try {
      const budgetKey = getUserSpecificKey(BUDGET_DATA_KEY_PREFIX);
      const displayMonthKey = getUserSpecificKey(DISPLAY_MONTH_KEY_PREFIX);

      const storedBudgets = localStorage.getItem(budgetKey);
      if (storedBudgets) {
        const parsedBudgets = JSON.parse(storedBudgets) as Record<string, BudgetMonth>;
        Object.values(parsedBudgets).forEach(month => {
          if (!month.incomes) month.incomes = []; 
          // Ensure system categories are correctly flagged without overriding user-set budgets for them
          month.categories = ensureSystemCategories(month.categories || []);
          month.categories.forEach(cat => {
            if (!cat.expenses) cat.expenses = [];
            if (!cat.subcategories && !cat.isSystemCategory) cat.subcategories = [];
            else if (cat.isSystemCategory) cat.subcategories = []; // Already handled by ensureSystemCategories
            (cat.subcategories || []).forEach(subCat => {
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
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = budgetMonths[prevMonthId]; 
    let calculatedStartingDebt = 0;

    if (prevMonthBudget) {
      const ccPaymentsCategory = prevMonthBudget.categories.find(
        cat => cat.name.toLowerCase() === "credit card payments"
      );
      const paymentsMadeLastMonth = ccPaymentsCategory
        ? ccPaymentsCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0)
        : 0;
      calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
    }
    
    const initialDebt = Math.max(0, calculatedStartingDebt);
    const defaultCats = DEFAULT_CATEGORIES.map(cat => ({
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: 0, // All categories start with 0 budget
      expenses: [],
      subcategories: [],
      isSystemCategory: cat.isSystemCategory || false,
    }));

    return {
      id: yearMonthId,
      year,
      month,
      incomes: [],
      categories: ensureSystemCategories(defaultCats), // Ensures system flags are set
      savingsGoal: 0,
      isRolledOver: false,
      startingCreditCardDebt: initialDebt,
    };
  }, [budgetMonths]); 

  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

 const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId];
    let needsUpdate = false;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId);
      needsUpdate = true;
    } else {
      // Ensure system categories are correctly flagged without overriding user-set budgets
      const updatedCategories = ensureSystemCategories(monthData.categories || []);
      if (JSON.stringify(monthData.categories) !== JSON.stringify(updatedCategories)) {
        monthData = { ...monthData, categories: updatedCategories };
        needsUpdate = true;
      }
      if (monthData.incomes === undefined) {
        monthData = { ...monthData, incomes: [] };
        needsUpdate = true;
      }
       if (monthData.isRolledOver === undefined) {
        monthData = { ...monthData, isRolledOver: false };
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: monthData! }));
    }
    return monthData!;
  }, [budgetMonths, createNewMonthBudget]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prev => {
      const existingMonth = prev[yearMonthId] || createNewMonthBudget(yearMonthId);
      let monthToUpdate = { ...existingMonth };

      if (payload.savingsGoal !== undefined) {
        monthToUpdate.savingsGoal = payload.savingsGoal;
      }
      if (payload.startingCreditCardDebt !== undefined) {
        monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
      }
      
      if (payload.categories) {
        monthToUpdate.categories = payload.categories.map(catPayload => {
          const existingCat = monthToUpdate.categories.find(c => c.id === catPayload.id);
          const isSavings = catPayload.name?.toLowerCase() === 'savings';
          const isCCPayments = catPayload.name?.toLowerCase() === 'credit card payments';

          return {
            id: catPayload.id || uuidv4(),
            name: catPayload.name,
            budgetedAmount: catPayload.budgetedAmount !== undefined 
                            ? catPayload.budgetedAmount 
                            : (existingCat ? existingCat.budgetedAmount : 0),
            expenses: catPayload.expenses || existingCat?.expenses || [],
            subcategories: (isSavings || isCCPayments) ? [] : (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => ({
              id: subCatPayload.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
              expenses: subCatPayload.expenses || existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id)?.expenses || [],
            })),
            isSystemCategory: isSavings || isCCPayments || existingCat?.isSystemCategory || false,
          };
        });
      }
      
      monthToUpdate.categories = ensureSystemCategories(monthToUpdate.categories); // Ensure flags
      if (monthToUpdate.incomes === undefined) monthToUpdate.incomes = [];

      return { ...prev, [yearMonthId]: monthToUpdate };
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
      isSystemCategory: false, 
    };
    setBudgetMonths(prev => {
      const currentMonthData = { ...prev[yearMonthId] };
      currentMonthData.categories = ensureSystemCategories([...currentMonthData.categories, newCategory]);
      return {
        ...prev,
        [yearMonthId]: currentMonthData,
      };
    });
  }, [ensureMonthExists]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const currentMonthData = { ...prev[yearMonthId] };
      currentMonthData.categories = currentMonthData.categories.map(cat => {
        if (cat.id === categoryId) {
          if (cat.isSystemCategory) { // Prevent renaming system categories
            return { 
              ...cat, 
              budgetedAmount: updatedCategoryData.budgetedAmount ?? cat.budgetedAmount, // Allow budget update
            };
          }
          return { 
            ...cat, 
            ...updatedCategoryData, 
            subcategories: cat.subcategories || [] 
          };
        }
        return cat;
      });
      currentMonthData.categories = ensureSystemCategories(currentMonthData.categories);
      return {
        ...prev,
        [yearMonthId]: currentMonthData,
      };
    });
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const currentMonthData = { ...prev[yearMonthId] };
      const categoryToDelete = currentMonthData.categories.find(cat => cat.id === categoryId);
      if (categoryToDelete?.isSystemCategory) {
        return prev; 
      }
      currentMonthData.categories = currentMonthData.categories.filter(cat => cat.id !== categoryId);
      return {
        ...prev,
        [yearMonthId]: currentMonthData,
      };
    });
  }, [ensureMonthExists]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    setBudgetMonths(prev => {
      const month = { ...prev[monthId] };
      if (!month) return prev;

      const parentCat = month.categories.find(cat => cat.id === parentCategoryId);
      if (parentCat?.isSystemCategory) return prev; 

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
      const parentCat = month.categories.find(cat => cat.id === parentCategoryId);
      if (parentCat?.isSystemCategory) return prev;

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

      const parentCat = month.categories.find(cat => cat.id === parentCategoryId);
      if (parentCat?.isSystemCategory) return prev;

      month.categories = month.categories.map(cat => {
        if (cat.id === parentCategoryId) {
          return { ...cat, subcategories: (cat.subcategories || []).filter(sub => sub.id !== subCategoryId) };
        }
        return cat;
      });
      return { ...prev, [monthId]: month };
    });
  }, []);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    ensureMonthExists(yearMonthId);
    const newExpense: Expense = {
      id: uuidv4(),
      description,
      amount,
      dateAdded,
    };
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      if (!month) return prev;
      if (month.isRolledOver) {
        return prev;
      }

      month.categories = month.categories.map(cat => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          return { ...cat, expenses: [...(cat.expenses || []), newExpense] };
        } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
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
        return prev;
      }
      month.categories = month.categories.map(cat => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          return { ...cat, expenses: (cat.expenses || []).filter(exp => exp.id !== expenseId) };
        } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: (sub.expenses || []).filter(exp => exp.id !== expenseId) } : sub
            ),
          };
        }
        return cat;
      });
      return { ...prev, [yearMonthId]: month };
    });
  }, [ensureMonthExists]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    ensureMonthExists(yearMonthId);
    const newIncomeEntry: IncomeEntry = {
      id: uuidv4(),
      description,
      amount,
      dateAdded,
    };
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      if (!month) return prev;
      if (month.isRolledOver) {
        return prev;
      }
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          incomes: [...(month.incomes || []), newIncomeEntry],
        },
      };
    });
  }, [ensureMonthExists]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      if (!month) return prev;
      if (month.isRolledOver) {
        return prev;
      }
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          incomes: (month.incomes || []).filter(inc => inc.id !== incomeId),
        },
      };
    });
  }, [ensureMonthExists]);


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId);
    if (!sourceBudget) {
      console.warn(`Source budget ${sourceMonthId} not found for duplication.`);
      ensureMonthExists(targetMonthId); 
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId];
    let calculatedStartingDebtForTarget = 0;

    if (prevMonthForTargetBudget) {
        const ccPaymentsCategoryPrevTarget = prevMonthForTargetBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments"
        );
        const paymentsMadeLastMonthPrevTarget = ccPaymentsCategoryPrevTarget
            ? ccPaymentsCategoryPrevTarget.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthPrevTarget;
    } else if (sourceBudget.id === prevMonthForTargetId) { 
        const ccPaymentsCategorySource = sourceBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments"
        );
        const paymentsMadeLastMonthSource = ccPaymentsCategorySource
            ? ccPaymentsCategorySource.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthSource;
    }
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);

    const newCategoriesBase = sourceBudget.categories.map(cat => ({
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: cat.budgetedAmount, // Carry over user-set budgeted amount
      expenses: [], 
      subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || []).map(subCat => ({
        id: uuidv4(),
        name: subCat.name,
        budgetedAmount: subCat.budgetedAmount,
        expenses: [], 
      })),
      isSystemCategory: cat.isSystemCategory || false,
    }));

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      incomes: [], 
      categories: ensureSystemCategories(newCategoriesBase),
      savingsGoal: sourceBudget.savingsGoal,
      isRolledOver: false,
      startingCreditCardDebt: targetStartingDebt,
    };

    setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthData }));
    setCurrentDisplayMonthId(targetMonthId);
  }, [getBudgetForMonth, budgetMonths, ensureMonthExists]);

  const navigateToPreviousMonth = useCallback(() => {
    const prevMonthId = getPreviousMonthId(currentDisplayMonthId);
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
      const month = { ...prev[yearMonthId] };
      if (month.isRolledOver) {
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

    const savingsCategory = monthBudget.categories.find(cat => cat.name.toLowerCase() === 'savings' && cat.isSystemCategory);
    if (!savingsCategory) {
      return { success: false, message: "Savings category not found. Please ensure it exists to enable rollover." };
    }

    let totalPositiveUnspent = 0;
    monthBudget.categories.forEach(cat => {
      const catNameLower = cat.name.toLowerCase();
      // Exclude system categories like "Savings" and "Credit Card Payments" from rollover calculation
      if (!(cat.isSystemCategory && (catNameLower === 'savings' || catNameLower === 'credit card payments'))) {
        if (!cat.subcategories || cat.subcategories.length === 0) {
            const mainCatSpent = (cat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
            const mainCatUnspent = cat.budgetedAmount - mainCatSpent;
            if (mainCatUnspent > 0) {
                totalPositiveUnspent += mainCatUnspent;
            }
        }
        (cat.subcategories || []).forEach(subCat => {
            const subCatSpent = (subCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
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
          return { ...cat, expenses: [...(cat.expenses || []), rolloverExpense] };
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
    addIncome,
    deleteIncome,
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
