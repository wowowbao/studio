
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
          if (!month.incomes) month.incomes = []; // Ensure incomes array exists
          month.categories.forEach(cat => {
            if (!cat.expenses) cat.expenses = [];
            if (!cat.subcategories) cat.subcategories = [];
            cat.subcategories.forEach(subCat => {
              if(!subCat.expenses) subCat.expenses = [];
            });
            if (cat.name?.toLowerCase() === 'savings' && cat.isSystemCategory === undefined) {
              cat.isSystemCategory = true;
            }
          });
          if (month.isRolledOver === undefined) month.isRolledOver = false;
          if (month.startingCreditCardDebt === undefined) month.startingCreditCardDebt = 0;
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

    return {
      id: yearMonthId,
      year,
      month,
      incomes: [], // Initialize with empty incomes array
      categories: DEFAULT_CATEGORIES.map(cat => ({
        id: uuidv4(),
        name: cat.name,
        budgetedAmount: 0,
        expenses: [],
        subcategories: [],
        isSystemCategory: cat.name.toLowerCase() === 'savings' ? true : false,
      })),
      savingsGoal: 0,
      isRolledOver: false,
      startingCreditCardDebt: Math.max(0, calculatedStartingDebt), // Ensure debt doesn't go negative
    };
  }, [budgetMonths]); // Add budgetMonths dependency

  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    setBudgetMonths(prev => {
      if (prev[yearMonthId]) {
        const month = { ...prev[yearMonthId] };
        if (month.incomes === undefined) month.incomes = [];
        if (month.startingCreditCardDebt === undefined) month.startingCreditCardDebt = 0;
        
        let savingsExists = false;
        let ccPaymentsExists = false;
        month.categories = month.categories.map(c => {
          if (c.name?.toLowerCase() === 'savings') {
            savingsExists = true;
            return { ...c, isSystemCategory: true };
          }
          if (c.name?.toLowerCase() === 'credit card payments') {
            ccPaymentsExists = true;
          }
          return c;
        });
        if (!savingsExists) {
          month.categories.push({
            id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true,
          });
        }
        if (!ccPaymentsExists) {
          month.categories.push({
            id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false,
          });
        }

        if (JSON.stringify(prev[yearMonthId]) !== JSON.stringify(month)) {
          return { ...prev, [yearMonthId]: month };
        }
        return prev;
      }
      const newMonth = createNewMonthBudget(yearMonthId);
      return { ...prev, [yearMonthId]: newMonth };
    });
    
    if (budgetMonths[yearMonthId]) {
      const month = { ...budgetMonths[yearMonthId] };
      if (month.incomes === undefined) month.incomes = [];
      if (month.startingCreditCardDebt === undefined) month.startingCreditCardDebt = 0;
      // Ensure special categories
       let savingsExists = false;
       let ccPaymentsExists = false;
        month.categories = month.categories.map(c => {
          if (c.name?.toLowerCase() === 'savings') {
            savingsExists = true;
            return { ...c, isSystemCategory: true };
          }
           if (c.name?.toLowerCase() === 'credit card payments') {
            ccPaymentsExists = true;
          }
          return c;
        });
        if (!savingsExists) {
          month.categories.push({
            id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true,
          });
        }
        if (!ccPaymentsExists) {
          month.categories.push({
             id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false,
          });
        }
      return month;
    }
    const newMonth = createNewMonthBudget(yearMonthId);
    return newMonth;
  }, [budgetMonths, createNewMonthBudget]);

  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prev => {
      const monthToUpdate = { ...(prev[yearMonthId] || createNewMonthBudget(yearMonthId)) };
      
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
            isSystemCategory: isSavings || existingCat?.isSystemCategory || false,
          };
        });
      }
      
      let savingsExists = false;
      let ccPaymentsExists = false;
      monthToUpdate.categories = monthToUpdate.categories.map(c => {
        if (c.name?.toLowerCase() === 'savings') {
          savingsExists = true;
          return { ...c, isSystemCategory: true };
        }
        if (c.name?.toLowerCase() === 'credit card payments') {
          ccPaymentsExists = true;
        }
        return c;
      });
      if (!savingsExists) {
        monthToUpdate.categories.push({
          id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true,
        });
      }
       if (!ccPaymentsExists) {
        monthToUpdate.categories.push({
          id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false,
        });
      }
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
      isSystemCategory: categoryName.toLowerCase() === 'savings',
    };
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: [...month.categories, newCategory],
        },
      };
    });
  }, [ensureMonthExists]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      return {
        ...prev,
        [yearMonthId]: {
          ...month,
          categories: month.categories.map(cat =>
            cat.id === categoryId ? { 
              ...cat, 
              ...updatedCategoryData, 
              name: cat.isSystemCategory && cat.name.toLowerCase() === 'savings' ? cat.name : updatedCategoryData.name || cat.name, 
              subcategories: cat.subcategories || [] 
            } : cat
          ),
        },
      };
    });
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    ensureMonthExists(yearMonthId);
    setBudgetMonths(prev => {
      const month = { ...prev[yearMonthId] };
      const categoryToDelete = month.categories.find(cat => cat.id === categoryId);
      if (categoryToDelete?.isSystemCategory && categoryToDelete.name.toLowerCase() === 'savings') {
        return prev; 
      }
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
        } else if (isSubCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
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
        } else if (isSubCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
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
        // Optionally show a warning: cannot add income to a rolled-over month
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
        // Optionally show a warning
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
    } else if (sourceBudget.id === prevMonthForTargetId) { // If source is the direct previous month
        const ccPaymentsCategorySource = sourceBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments"
        );
        const paymentsMadeLastMonthSource = ccPaymentsCategorySource
            ? ccPaymentsCategorySource.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthSource;
    }


    const newCategories = sourceBudget.categories.map(cat => ({
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: cat.budgetedAmount,
      expenses: [], 
      subcategories: (cat.subcategories || []).map(subCat => ({
        id: uuidv4(),
        name: subCat.name,
        budgetedAmount: subCat.budgetedAmount,
        expenses: [], 
      })),
      isSystemCategory: cat.isSystemCategory,
    }));

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      incomes: [], // Income is not carried over
      categories: newCategories,
      savingsGoal: sourceBudget.savingsGoal,
      isRolledOver: false,
      startingCreditCardDebt: Math.max(0, calculatedStartingDebtForTarget),
    };

    setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthData }));
    setCurrentDisplayMonthId(targetMonthId);
  }, [getBudgetForMonth, budgetMonths]);

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
      if (!(cat.isSystemCategory && cat.name.toLowerCase() === 'savings')) { // Exclude savings category itself
        // Calculate for parent category if no subcategories or if it has its own budget
        if (!cat.subcategories || cat.subcategories.length === 0) {
            const mainCatSpent = (cat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
            const mainCatUnspent = cat.budgetedAmount - mainCatSpent;
            if (mainCatUnspent > 0) {
                totalPositiveUnspent += mainCatUnspent;
            }
        }
        // Calculate for subcategories
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
      dateAdded: new Date().toISOString(), // Use current date for rollover entry
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
