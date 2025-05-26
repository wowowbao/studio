
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/hooks/useAuth'; // Import useAuth
import { db } from '@/lib/firebase'; // Import Firestore instance
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, getDoc } from 'firebase/firestore';

const DEFAULT_START_MONTH = '2025-06'; 

export const getYearMonthFromDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const parseYearMonth = (yearMonth: string): Date => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

// No longer user-specific prefix for localStorage, as it's for display month only
const DISPLAY_MONTH_KEY = 'budgetFlowDisplayMonth_global';


const ensureSystemCategories = (categories: BudgetCategory[], startingDebtForMonth: number): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? [...categories] : [];
  let wasActuallyChanged = false;

  const systemCategoryDefinitions = [
    { name: "Savings", isSystemCategory: true },
    { name: "Credit Card Payments", isSystemCategory: true }
  ];

  systemCategoryDefinitions.forEach(sysDef => {
    const existingIndex = newCategories.findIndex(cat => cat.name.toLowerCase() === sysDef.name.toLowerCase());
    let currentCat = existingIndex > -1 ? newCategories[existingIndex] : null;
    
    let categoryNeedsUpdate = false;
    let updatedCatData: Partial<BudgetCategory> = {};

    if (currentCat) {
      if (!currentCat.isSystemCategory) {
        updatedCatData.isSystemCategory = true;
        categoryNeedsUpdate = true;
      }
      if (currentCat.subcategories && currentCat.subcategories.length > 0) {
        updatedCatData.subcategories = []; 
        categoryNeedsUpdate = true;
      }
       if (currentCat.name !== sysDef.name) { // Ensure correct casing
        updatedCatData.name = sysDef.name;
        categoryNeedsUpdate = true;
      }
      
      if (categoryNeedsUpdate) {
        newCategories[existingIndex] = { ...currentCat, ...updatedCatData };
        wasActuallyChanged = true;
      }
    } else { 
      newCategories.push({
        id: uuidv4(),
        name: sysDef.name,
        budgetedAmount: 0, 
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
      });
      wasActuallyChanged = true;
    }
  });
  // Ensure "Credit Card Payments" budget is NOT tied to starting debt by default here. User sets it.
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, userId } = useAuth(); // Get user and userId from AuthContext
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthId] = useState<string>(DEFAULT_START_MONTH);
  const [isLoading, setIsLoading] = useState(true); // Firestore loading state

  const getPreviousMonthId = (currentMonthId: string): string => {
    const currentDate = parseYearMonth(currentMonthId);
    currentDate.setMonth(currentDate.getMonth() - 1);
    return getYearMonthFromDate(currentDate);
  };

  // Load initial data from Firestore when user logs in
  useEffect(() => {
    const loadData = async () => {
      if (userId) {
        setIsLoading(true);
        try {
          const budgetMonthsCol = collection(db, 'users', userId, 'budgetMonths');
          const snapshot = await getDocs(budgetMonthsCol);
          const fetchedMonths: Record<string, BudgetMonth> = {};
          let changedDuringLoad = false;

          snapshot.forEach(docSnap => {
            let monthData = { ...docSnap.data(), id: docSnap.id } as BudgetMonth;
            // Basic data sanitization / default values
            if (!monthData.incomes) monthData.incomes = [];
            if (!monthData.categories) monthData.categories = [];
            
            const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategories(monthData.categories, monthData.startingCreditCardDebt || 0);
            monthData.categories = updatedCategories;
            if(catsChanged) changedDuringLoad = true;

            monthData.categories.forEach(cat => {
              if (!cat.expenses) cat.expenses = [];
              if (!cat.subcategories && !cat.isSystemCategory) cat.subcategories = [];
              else if (cat.isSystemCategory) cat.subcategories = [];
              (cat.subcategories || []).forEach(subCat => {
                if (!subCat.expenses) subCat.expenses = [];
              });
            });
            if (monthData.isRolledOver === undefined) monthData.isRolledOver = false;
             if (monthData.startingCreditCardDebt === undefined) monthData.startingCreditCardDebt = 0;

            fetchedMonths[docSnap.id] = monthData;
          });

          // If system categories were added/modified during load, save changes back
          if (changedDuringLoad) {
            const batch = writeBatch(db);
            Object.values(fetchedMonths).forEach(month => {
              if (snapshot.docs.find(d => d.id === month.id)) { // Only update if it was an existing doc
                 const {id, ...dataToSave} = month; // Exclude id from data
                 batch.set(doc(db, 'users', userId, 'budgetMonths', id), dataToSave);
              }
            });
            await batch.commit();
          }

          setBudgetMonths(fetchedMonths);

          const storedDisplayMonth = localStorage.getItem(DISPLAY_MONTH_KEY);
          if (storedDisplayMonth && fetchedMonths[storedDisplayMonth]) {
            setCurrentDisplayMonthId(storedDisplayMonth);
          } else if (Object.keys(fetchedMonths).length > 0) {
             // Default to the most recent month or a sorted first month if no display month stored
            const sortedMonthIds = Object.keys(fetchedMonths).sort();
            setCurrentDisplayMonthId(sortedMonthIds[sortedMonthIds.length - 1] || DEFAULT_START_MONTH);
          } else {
            setCurrentDisplayMonthId(DEFAULT_START_MONTH);
          }

        } catch (error) {
          console.error("Failed to load budgets from Firestore:", error);
          setBudgetMonths({}); // Reset on error
          setCurrentDisplayMonthId(DEFAULT_START_MONTH);
        } finally {
          setIsLoading(false);
        }
      } else { // No user logged in
        setBudgetMonths({});
        setCurrentDisplayMonthId(DEFAULT_START_MONTH);
        setIsLoading(false); // Not loading if no user
      }
    };
    loadData();
  }, [userId]); // Reload data when user changes

  // Persist currentDisplayMonthId to localStorage
  useEffect(() => {
    localStorage.setItem(DISPLAY_MONTH_KEY, currentDisplayMonthId);
  }, [currentDisplayMonthId]);


  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    
    let calculatedStartingDebt = 0;
    let savingsBudgetCarryOver = 0;

    if (prevMonthBudget) {
      const ccPaymentsCategory = prevMonthBudget.categories.find(
        cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
      );
      const paymentsMadeLastMonth = ccPaymentsCategory
        ? ccPaymentsCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0)
        : 0;
      calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;

      const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.name.toLowerCase() === "savings" && cat.isSystemCategory);
      if (prevSavingsCat) {
        savingsBudgetCarryOver = prevSavingsCat.budgetedAmount;
      }
    }
    
    const initialDebt = Math.max(0, calculatedStartingDebt);
    let defaultCatsPayload = DEFAULT_CATEGORIES.map(cat => ({
      id: uuidv4(),
      name: cat.name,
      budgetedAmount: (cat.name.toLowerCase() === "savings") ? savingsBudgetCarryOver : 0,
      expenses: [],
      subcategories: [],
      isSystemCategory: cat.isSystemCategory || false,
    }));

    const { updatedCategories } = ensureSystemCategories(defaultCatsPayload, initialDebt);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: updatedCategories,
      isRolledOver: false,
      startingCreditCardDebt: initialDebt,
    };
  }, []); 

  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const saveMonthToFirestore = async (yearMonthId: string, monthData: BudgetMonth) => {
    if (!userId) return;
    try {
      const { id, ...dataToSave } = monthData; // Exclude id from the data to save
      await setDoc(doc(db, 'users', userId, 'budgetMonths', yearMonthId), dataToSave);
    } catch (error) {
      console.error(`Failed to save month ${yearMonthId} to Firestore:`, error);
      // Consider adding user feedback here (e.g., toast)
    }
  };

 const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId]; 
    let needsStateUpdate = false;
    let needsFirestoreSave = false;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId, budgetMonths); 
      needsStateUpdate = true;
      needsFirestoreSave = true;
    } else {
      let changed = false;
      const currentCategories = monthData.categories || [];
      const currentStartingDebt = monthData.startingCreditCardDebt || 0;
      
      const { updatedCategories, wasChanged: categoriesWereChanged } = ensureSystemCategories(currentCategories, currentStartingDebt);
      if (categoriesWereChanged) {
        monthData = { ...monthData, categories: updatedCategories };
        changed = true;
      }

      if (monthData.incomes === undefined) monthData.incomes = [];
      if (monthData.isRolledOver === undefined) monthData.isRolledOver = false;
      if (monthData.startingCreditCardDebt === undefined) monthData.startingCreditCardDebt = 0;
      
      if (changed) {
        needsStateUpdate = true;
        needsFirestoreSave = true; // If local data was corrected, save it back
      }
    }

    if (needsStateUpdate) {
      const finalMonthData = monthData!;
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: finalMonthData }));
      if (needsFirestoreSave && userId) {
        saveMonthToFirestore(yearMonthId, finalMonthData);
      }
    }
    return monthData!;
  }, [budgetMonths, createNewMonthBudget, userId ]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let updatedMonth = { ...monthToUpdate };
    let startingDebtForMonth = updatedMonth.startingCreditCardDebt || 0;

    if (payload.startingCreditCardDebt !== undefined) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
        startingDebtForMonth = payload.startingCreditCardDebt;
    }
      
    if (payload.categories) {
      updatedMonth.categories = payload.categories.map(catPayload => {
        const existingCat = updatedMonth.categories.find(c => c.id === catPayload.id);
        const catNameLower = catPayload.name?.toLowerCase();
        const isSystemCat = catNameLower === 'savings' || catNameLower === 'credit card payments';
        
        return {
          id: catPayload.id || uuidv4(),
          name: catPayload.name,
          budgetedAmount: catPayload.budgetedAmount !== undefined 
                          ? catPayload.budgetedAmount 
                          : (existingCat ? existingCat.budgetedAmount : 0),
          expenses: catPayload.expenses || existingCat?.expenses || [],
          subcategories: (isSystemCat && catPayload.isSystemCategory) ? [] : (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => ({
            id: subCatPayload.id || uuidv4(),
            name: subCatPayload.name,
            budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
            expenses: subCatPayload.expenses || existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id)?.expenses || [],
          })),
          isSystemCategory: catPayload.isSystemCategory || existingCat?.isSystemCategory || false,
        };
      });
    }
    
    const { updatedCategories } = ensureSystemCategories(updatedMonth.categories, startingDebtForMonth); 
    updatedMonth.categories = updatedCategories;
    if (updatedMonth.incomes === undefined) updatedMonth.incomes = [];

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 

    const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
    
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
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
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
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);


  const duplicateMonthBudget = useCallback(async (sourceMonthId: string, targetMonthId: string) => {
    if (!userId) return;
    const sourceBudget = getBudgetForMonth(sourceMonthId); 
    if (!sourceBudget) {
      const newMonth = createNewMonthBudget(targetMonthId, budgetMonths);
      setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonth }));
      await saveMonthToFirestore(targetMonthId, newMonth);
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    let savingsBudgetCarryOver = 0;

    if (prevMonthForTargetBudget) { 
        const ccPaymentsCategoryPrevTarget = prevMonthForTargetBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
        );
        const paymentsMadeLastMonthPrevTarget = ccPaymentsCategoryPrevTarget
            ? ccPaymentsCategoryPrevTarget.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthPrevTarget;

        const prevSavingsCat = prevMonthForTargetBudget.categories.find(cat => cat.name.toLowerCase() === "savings" && cat.isSystemCategory);
        if (prevSavingsCat) savingsBudgetCarryOver = prevSavingsCat.budgetedAmount;

    } else if (sourceBudget.id === prevMonthForTargetId) { 
        const ccPaymentsCategorySource = sourceBudget.categories.find(
            cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
        );
        const paymentsMadeLastMonthSource = ccPaymentsCategorySource
            ? ccPaymentsCategorySource.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthSource;
        
        const sourceSavingsCat = sourceBudget.categories.find(cat => cat.name.toLowerCase() === "savings" && cat.isSystemCategory);
        if (sourceSavingsCat) savingsBudgetCarryOver = sourceSavingsCat.budgetedAmount;
    } 
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);

    const newCategoriesBase = sourceBudget.categories.map(cat => ({
      id: uuidv4(), 
      name: cat.name,
      budgetedAmount: cat.name.toLowerCase() === "savings" ? savingsBudgetCarryOver : cat.budgetedAmount, 
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
      isRolledOver: false, 
      startingCreditCardDebt: targetStartingDebt,
    };

    setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthData }));
    await saveMonthToFirestore(targetMonthId, newMonthData);
    setCurrentDisplayMonthId(targetMonthId); 
  }, [getBudgetForMonth, budgetMonths, userId, createNewMonthBudget]); 

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

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId); 
    if (!monthBudget || !userId) {
      return { success: false, message: `Budget for ${yearMonthId} not found or user not logged in.` };
    }
    if (monthBudget.isRolledOver) {
      return { success: false, message: `Budget for ${yearMonthId} has already been rolled over.` };
    }

    let totalPositiveUnspentOperational = 0;
    monthBudget.categories.forEach(cat => {
      const catNameLower = cat.name.toLowerCase();
      if (!cat.isSystemCategory) { // Exclude Savings and CC Payments
        if (!cat.subcategories || cat.subcategories.length === 0) {
            const mainCatSpent = (cat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
            const mainCatUnspent = cat.budgetedAmount - mainCatSpent;
            if (mainCatUnspent > 0) totalPositiveUnspentOperational += mainCatUnspent;
        } else { 
            (cat.subcategories || []).forEach(subCat => {
                const subCatSpent = (subCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
                const subCatUnspent = subCat.budgetedAmount - subCatSpent;
                if (subCatUnspent > 0) totalPositiveUnspentOperational += subCatUnspent;
            });
        }
      }
    });
    
    const updatedMonth = { ...monthBudget, isRolledOver: true };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);

    if (totalPositiveUnspentOperational <= 0) {
      return { success: true, message: "Month closed. No unspent funds from operational categories." };
    } else {
      return { success: true, message: `Month closed. $${totalPositiveUnspentOperational.toFixed(2)} from operational categories was unspent (contributing to overall savings).` };
    }
  }, [getBudgetForMonth, userId]); 

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    const updatedCategoriesList = [...monthToUpdate.categories, newCategory];
    const { updatedCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate.startingCreditCardDebt || 0);

    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]); 

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        if (cat.isSystemCategory) { 
          return { ...cat, budgetedAmount: updatedCategoryData.budgetedAmount ?? cat.budgetedAmount };
        }
        return { ...cat, ...updatedCategoryData, subcategories: cat.subcategories || [] }; 
      }
      return cat;
    });
    
    const { updatedCategories } = ensureSystemCategories(newCategories, monthToUpdate.startingCreditCardDebt || 0);
    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories } = ensureSystemCategories(filteredCategories, monthToUpdate.startingCreditCardDebt || 0);

    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    saveMonthToFirestore(yearMonthId, updatedMonth);
  }, [ensureMonthExists]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (parentCat?.isSystemCategory) return; 

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
        return { ...cat, subcategories: [...(cat.subcategories || []), newSubCategory] };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    saveMonthToFirestore(monthId, updatedMonth);
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
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    saveMonthToFirestore(monthId, updatedMonth);
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
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    saveMonthToFirestore(monthId, updatedMonth);
  }, [ensureMonthExists]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoading || (userId && Object.keys(budgetMonths).length === 0 && currentDisplayMonthId !== DEFAULT_START_MONTH), // More nuanced loading
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
    rolloverUnspentBudget,
    addSubCategory,
    updateSubCategory,
    deleteSubCategory,
  };
};
