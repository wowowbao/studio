
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
  // Using a static pseudoUserId as per previous setup
  const pseudoUserId = "localUser"; 
  return `${baseKey}${pseudoUserId}`;
};

// Ensures system categories exist, are marked as such, and have no subcategories.
// Returns the updated categories array and a boolean indicating if any actual changes were made.
const ensureSystemCategories = (categories: BudgetCategory[], startingDebtForMonth: number): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = [...categories];
  let wasActuallyChanged = false;

  const systemCategoryDefinitions = [
    { name: "credit card payments", isSystemCategory: true }
    // "Savings" category is no longer a system/default category to be enforced here.
  ];

  systemCategoryDefinitions.forEach(sysDef => {
    const existingIndex = newCategories.findIndex(cat => cat.name.toLowerCase() === sysDef.name);
    let currentCat = existingIndex > -1 ? newCategories[existingIndex] : null;
    
    if (currentCat) {
      let categoryNeedsUpdate = false;
      let updatedCatData: Partial<BudgetCategory> = {};

      if (!currentCat.isSystemCategory) {
        updatedCatData.isSystemCategory = true;
        categoryNeedsUpdate = true;
      }
      if (currentCat.subcategories && currentCat.subcategories.length > 0) {
        updatedCatData.subcategories = []; // System categories should not have subcategories
        categoryNeedsUpdate = true;
      }
      
      // For "Credit Card Payments", budget is user-settable, not tied to startingDebt.
      // No specific budget update logic needed here for system categories beyond flags.

      if (categoryNeedsUpdate) {
        newCategories[existingIndex] = { ...currentCat, ...updatedCatData };
        wasActuallyChanged = true;
      }
    } else { // System category does not exist, add it
      newCategories.push({
        id: uuidv4(),
        name: sysDef.name.charAt(0).toUpperCase() + sysDef.name.slice(1), // Capitalize
        budgetedAmount: 0, // Default budget, user can edit
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
      });
      wasActuallyChanged = true;
    }
  });

  // Ensure "Savings" category is NOT present as a default system category.
  // If an old "Savings" category exists from previous data and is marked system, unmark it or remove it.
  // For simplicity, we'll just ensure it's not enforced. If user creates "Savings", it's a normal category.
  const savingsCatIndex = newCategories.findIndex(cat => cat.name.toLowerCase() === 'savings' && cat.isSystemCategory);
  if (savingsCatIndex > -1) {
    // Option 1: Remove it if it's an old system one
    // newCategories.splice(savingsCatIndex, 1);
    // wasActuallyChanged = true;
    // Option 2: Unmark it as system (safer if user might have expenses in it)
    // newCategories[savingsCatIndex] = { ...newCategories[savingsCatIndex], isSystemCategory: false };
    // wasActuallyChanged = true;
    // For now, let's assume if "Savings" category is being removed, it should be fully removed from default list.
    // The DEFAULT_CATEGORIES no longer includes it. This function primarily ensures *required* system cats.
  }


  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
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
          const { updatedCategories } = ensureSystemCategories(month.categories || [], month.startingCreditCardDebt || 0);
          month.categories = updatedCategories;
          // Ensure all categories have expenses/subcategories arrays
          month.categories.forEach(cat => {
            if (!cat.expenses) cat.expenses = [];
            if (!cat.subcategories && !cat.isSystemCategory) cat.subcategories = [];
            else if (cat.isSystemCategory) cat.subcategories = []; 
            (cat.subcategories || []).forEach(subCat => {
              if(!subCat.expenses) subCat.expenses = [];
            });
          });
          if (month.isRolledOver === undefined) month.isRolledOver = false;
          if (month.savingsGoal === undefined) {
            const prevMonthId = getPreviousMonthId(month.id);
            const prevMonth = parsedBudgets[prevMonthId];
            month.savingsGoal = prevMonth ? prevMonth.savingsGoal : 0;
          }
        });
        setBudgetMonths(parsedBudgets);
      } else {
        // Initialize first month if no stored budgets
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
    let initialSavingsGoal = 0; 

    if (prevMonthBudget) {
      const ccPaymentsCategory = prevMonthBudget.categories.find(
        cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
      );
      const paymentsMadeLastMonth = ccPaymentsCategory
        ? ccPaymentsCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0)
        : 0;
      calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
      initialSavingsGoal = prevMonthBudget.savingsGoal; // Carry over savings goal
    }
    
    const initialDebt = Math.max(0, calculatedStartingDebt);
    const defaultCatsPayload = DEFAULT_CATEGORIES.map(cat => ({
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: 0, 
      expenses: [],
      subcategories: [],
      isSystemCategory: cat.isSystemCategory || false,
    }));

    const { updatedCategories } = ensureSystemCategories(defaultCatsPayload, initialDebt);

    return {
      id: yearMonthId,
      year,
      month,
      incomes: [],
      categories: updatedCategories,
      savingsGoal: initialSavingsGoal,
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
    let needsStateUpdate = false;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId); 
      needsStateUpdate = true;
    } else {
      let changed = false;
      const currentCategories = monthData.categories || [];
      const currentStartingDebt = monthData.startingCreditCardDebt || 0;
      
      const { updatedCategories, wasChanged: categoriesWereChanged } = ensureSystemCategories(currentCategories, currentStartingDebt);
      if (categoriesWereChanged) {
        monthData = { ...monthData, categories: updatedCategories };
        changed = true;
      }

      if (monthData.incomes === undefined) {
        monthData = { ...monthData, incomes: [] };
        changed = true;
      }
       if (monthData.isRolledOver === undefined) {
        monthData = { ...monthData, isRolledOver: false };
        changed = true;
      }
       if (monthData.savingsGoal === undefined) {
        const prevMonthId = getPreviousMonthId(yearMonthId);
        const prevMonthBudget = budgetMonths[prevMonthId]; 
        monthData = { ...monthData, savingsGoal: prevMonthBudget ? prevMonthBudget.savingsGoal : 0 };
        changed = true;
      }
      if (changed) {
        needsStateUpdate = true;
      }
    }

    if (needsStateUpdate) {
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: monthData! }));
    }
    return monthData!;
  }, [budgetMonths, createNewMonthBudget]); 


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prev => {
      const existingMonth = prev[yearMonthId] || createNewMonthBudget(yearMonthId);
      let monthToUpdate = { ...existingMonth };
      let startingDebtForMonth = monthToUpdate.startingCreditCardDebt || 0;

      if (payload.savingsGoal !== undefined) {
        monthToUpdate.savingsGoal = payload.savingsGoal;
      }
      if (payload.startingCreditCardDebt !== undefined) {
        monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
        startingDebtForMonth = payload.startingCreditCardDebt; 
      }
      
      if (payload.categories) {
        monthToUpdate.categories = payload.categories.map(catPayload => {
          const existingCat = monthToUpdate.categories.find(c => c.id === catPayload.id);
          const isCCPayments = catPayload.name?.toLowerCase() === 'credit card payments';
          
          return {
            id: catPayload.id || uuidv4(),
            name: catPayload.name,
            budgetedAmount: catPayload.budgetedAmount !== undefined 
                            ? catPayload.budgetedAmount 
                            : (existingCat ? existingCat.budgetedAmount : 0),
            expenses: catPayload.expenses || existingCat?.expenses || [],
            subcategories: (isCCPayments && catPayload.isSystemCategory) ? [] : (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => ({
              id: subCatPayload.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
              expenses: subCatPayload.expenses || existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id)?.expenses || [],
            })),
            isSystemCategory: isCCPayments || catPayload.isSystemCategory || existingCat?.isSystemCategory || false,
          };
        });
      }
      
      const { updatedCategories } = ensureSystemCategories(monthToUpdate.categories, startingDebtForMonth); 
      monthToUpdate.categories = updatedCategories;
      if (monthToUpdate.incomes === undefined) monthToUpdate.incomes = [];

      return { ...prev, [yearMonthId]: monthToUpdate };
    });
  }, [createNewMonthBudget]); 


  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const newCategory: BudgetCategory = {
      id: uuidv4(),
      name: categoryName,
      budgetedAmount: 0,
      expenses: [],
      subcategories: [],
      isSystemCategory: false, 
    };
    
    const updatedCategoriesList = [...monthToUpdate.categories, newCategory];
    const { updatedCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate.startingCreditCardDebt || 0);

    setBudgetMonths(prev => ({
      ...prev,
      [yearMonthId]: {
        ...monthToUpdate, 
        categories: updatedCategories,
      },
    }));
  }, [ensureMonthExists]); 

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        if (cat.isSystemCategory) { // e.g. CC Payments
          return { ...cat, budgetedAmount: updatedCategoryData.budgetedAmount ?? cat.budgetedAmount };
        }
        return { ...cat, ...updatedCategoryData, subcategories: cat.subcategories || [] }; 
      }
      return cat;
    });
    
    const { updatedCategories } = ensureSystemCategories(newCategories, monthToUpdate.startingCreditCardDebt || 0);
    
    setBudgetMonths(prev => ({ 
      ...prev, 
      [yearMonthId]: {
        ...monthToUpdate, 
        categories: updatedCategories 
      }
    }));
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) {
      return; 
    }
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories } = ensureSystemCategories(filteredCategories, monthToUpdate.startingCreditCardDebt || 0);

    setBudgetMonths(prev => ({
      ...prev,
      [yearMonthId]: {
        ...monthToUpdate,
        categories: updatedCategories,
      },
    }));
  }, [ensureMonthExists]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (parentCat?.isSystemCategory) return; 

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
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

    setBudgetMonths(prev => ({ 
      ...prev, 
      [monthId]: {
        ...monthToUpdate,
        categories: updatedCategoriesList 
      } 
    }));
  }, [ensureMonthExists]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (parentCat?.isSystemCategory) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
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
    setBudgetMonths(prev => ({ 
      ...prev, 
      [monthId]: {
        ...monthToUpdate,
        categories: updatedCategoriesList
      }
    }));
  }, [ensureMonthExists]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (parentCat?.isSystemCategory) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        return { ...cat, subcategories: (cat.subcategories || []).filter(sub => sub.id !== subCategoryId) };
      }
      return cat;
    });
    setBudgetMonths(prev => ({ 
      ...prev, 
      [monthId]: {
        ...monthToUpdate,
        categories: updatedCategoriesList
      }
    }));
  }, [ensureMonthExists]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 

    const newExpense: Expense = {
      id: uuidv4(),
      description,
      amount,
      dateAdded,
    };
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
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
    setBudgetMonths(prev => ({ 
      ...prev, 
      [yearMonthId]: {
        ...monthToUpdate,
        categories: updatedCategoriesList
      }
    }));
  }, [ensureMonthExists]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
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
    setBudgetMonths(prev => ({ 
      ...prev, 
      [yearMonthId]: {
        ...monthToUpdate,
        categories: updatedCategoriesList
      }
    }));
  }, [ensureMonthExists]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = {
      id: uuidv4(),
      description,
      amount,
      dateAdded,
    };
    
    setBudgetMonths(prev => {
      const month = { ...monthToUpdate }; 
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
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    setBudgetMonths(prev => {
      const month = { ...monthToUpdate }; 
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
      ensureMonthExists(targetMonthId); 
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;

    if (prevMonthForTargetBudget) { 
        const ccPaymentsCategoryPrevTarget = prevMonthForTargetBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
        );
        const paymentsMadeLastMonthPrevTarget = ccPaymentsCategoryPrevTarget
            ? ccPaymentsCategoryPrevTarget.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthPrevTarget;
    } else if (sourceBudget.id === prevMonthForTargetId) { 
        const ccPaymentsCategorySource = sourceBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
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
      budgetedAmount: cat.budgetedAmount, 
      expenses: [], 
      subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || []).map(subCat => ({
        id: uuidv4(), 
        name: subCat.name,
        budgetedAmount: subCat.budgetedAmount, 
        expenses: [], 
      })),
      isSystemCategory: cat.isSystemCategory || false,
    }));

    const { updatedCategories } = ensureSystemCategories(newCategoriesBase, targetStartingDebt);

    const newMonthData: BudgetMonth = {
      id: targetMonthId,
      year: targetYear,
      month: targetMonthNum,
      incomes: [], 
      categories: updatedCategories,
      savingsGoal: sourceBudget.savingsGoal, 
      isRolledOver: false, 
      startingCreditCardDebt: targetStartingDebt,
    };

    setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthData }));
    setCurrentDisplayMonthId(targetMonthId); 
  }, [getBudgetForMonth, budgetMonths, ensureMonthExists, createNewMonthBudget]); 

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
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return; 
   
    setBudgetMonths(prev => ({
      ...prev,
      [yearMonthId]: {
        ...monthToUpdate, 
        savingsGoal: goal,
      },
    }));
  }, [ensureMonthExists]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId); 
    if (!monthBudget) {
      return { success: false, message: `Budget for ${yearMonthId} not found.` };
    }
    if (monthBudget.isRolledOver) {
      return { success: false, message: `Budget for ${yearMonthId} has already been rolled over.` };
    }

    let totalPositiveUnspentOperational = 0;
    monthBudget.categories.forEach(cat => {
      const catNameLower = cat.name.toLowerCase();
      if (!(cat.isSystemCategory && catNameLower === 'credit card payments')) { // Exclude CC Payments
        if (!cat.subcategories || cat.subcategories.length === 0) {
            const mainCatSpent = (cat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
            const mainCatUnspent = cat.budgetedAmount - mainCatSpent;
            if (mainCatUnspent > 0) {
                totalPositiveUnspentOperational += mainCatUnspent;
            }
        } else { 
            (cat.subcategories || []).forEach(subCat => {
                const subCatSpent = (subCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
                const subCatUnspent = subCat.budgetedAmount - subCatSpent;
                if (subCatUnspent > 0) {
                    totalPositiveUnspentOperational += subCatUnspent;
                }
            });
        }
      }
    });
    
    setBudgetMonths(prev => ({
      ...prev,
      [yearMonthId]: { ...prev[yearMonthId], isRolledOver: true }, // Use existing month object from prev state
    }));

    if (totalPositiveUnspentOperational <= 0) {
      return { success: true, message: "Month closed. No unspent funds from operational categories." };
    } else {
      return { success: true, message: `Month closed. $${totalPositiveUnspentOperational.toFixed(2)} from operational categories was unspent.` };
    }
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
