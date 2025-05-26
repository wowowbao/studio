
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import { DEFAULT_CATEGORIES }
from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';

// localStorage keys
const GUEST_BUDGET_MONTHS_KEY = 'budgetFlowGuestBudgetMonths';
const getDisplayMonthKey = (userId: string | null | undefined) => `budgetFlowDisplayMonth_${userId || 'guest'}`;
const getFirestoreUserBudgetDocRef = (userId: string) => doc(db, 'userBudgets', userId);


export const getYearMonthFromDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const parseYearMonth = (yearMonth: string): Date => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

const ensureSystemCategories = (categories: BudgetCategory[] | undefined, startingDebtForMonth: number): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
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
      if (currentCat.name !== sysDef.name) { 
        updatedCatData.name = sysDef.name;
        categoryNeedsUpdate = true;
      }
      if (sysDef.name.toLowerCase() === "credit card payments" && currentCat.budgetedAmount !== startingDebtForMonth && false) { // This logic was removed, keeping structure for history
        // No longer forcing budget to starting debt
      }
      
      if (categoryNeedsUpdate) {
        newCategories[existingIndex] = { ...currentCat, ...updatedCatData };
        wasActuallyChanged = true;
      }
    } else { 
      let newCatBudget = 0;
      if (sysDef.name.toLowerCase() === "credit card payments" && false) { // This logic was removed
        // newCatBudget = startingDebtForMonth;
      }
      newCategories.push({
        id: uuidv4(),
        name: sysDef.name,
        budgetedAmount: newCatBudget, 
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
      });
      wasActuallyChanged = true;
    }
  });
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => getYearMonthFromDate(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false); 

  // Load display month from localStorage or set default
  useEffect(() => {
    if (authLoading) return; 

    const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(user?.uid));
    if (storedDisplayMonth) {
      setCurrentDisplayMonthIdState(storedDisplayMonth);
    } else {
      const defaultMonth = getYearMonthFromDate(new Date());
      setCurrentDisplayMonthIdState(defaultMonth);
      localStorage.setItem(getDisplayMonthKey(user?.uid), defaultMonth);
    }
  }, [user, authLoading]);

  // Save display month to localStorage when it changes
  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
     if (!authLoading) {
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);


  // Load budget data from Firestore (if user) or localStorage (if guest)
  useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }
    setIsLoading(true);

    if (isUserAuthenticated && user) {
      const docRef = getFirestoreUserBudgetDocRef(user.uid);
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as { months: Record<string, BudgetMonth> };
          let initialMonths = data.months || {};
          let changedDuringLoad = false;

          Object.keys(initialMonths).forEach(monthId => {
            const monthData = initialMonths[monthId];
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
          });
          
          setBudgetMonths(initialMonths);
          if (changedDuringLoad) {
              saveBudgetMonthsToFirestore(user.uid, initialMonths);
          }
        } else {
          const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0); // Pass 0 for initial debt for new user
          const initialData = { [currentDisplayMonthId]: initialMonth };
          setBudgetMonths(initialData);
          saveBudgetMonthsToFirestore(user.uid, initialData);
        }
        setIsLoading(false);
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        setIsLoading(false);
      });
      return () => unsubscribe();
    } else { // Guest user
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      if (localData) {
        try {
          const parsedData = JSON.parse(localData);
          // Basic validation/migration for guest data structure
          Object.values(parsedData as Record<string, BudgetMonth>).forEach(month => {
            if (!month.incomes) month.incomes = [];
            if (month.isRolledOver === undefined) month.isRolledOver = false;
            if (month.startingCreditCardDebt === undefined) month.startingCreditCardDebt = 0;
            if (!month.categories) month.categories = [];
             const { updatedCategories } = ensureSystemCategories(month.categories, month.startingCreditCardDebt || 0);
             month.categories = updatedCategories;
          });
          setBudgetMonths(parsedData);
        } catch (e) {
          console.error("Error parsing guest budget data from localStorage", e);
          setBudgetMonths({});
        }
      } else {
         const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
         setBudgetMonths({ [currentDisplayMonthId]: initialMonth });
      }
      setIsLoading(false);
    }
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId]); // currentDisplayMonthId might be needed to initialize for guest


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      await setDoc(docRef, { months: monthsToSave }, { merge: true });
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Effect to save to Firestore or localStorage when budgetMonths changes
  useEffect(() => {
    if (!isLoading && !authLoading) {
      if (isUserAuthenticated && user && Object.keys(budgetMonths).length > 0) {
        saveBudgetMonthsToFirestore(user.uid, budgetMonths);
      } else if (!isUserAuthenticated && Object.keys(budgetMonths).length > 0) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(budgetMonths));
      }
    }
  }, [budgetMonths, isLoading, authLoading, user, isUserAuthenticated, saveBudgetMonthsToFirestore]);


  const getPreviousMonthId = (currentMonthId: string): string => {
    const currentDate = parseYearMonth(currentMonthId);
    currentDate.setMonth(currentDate.getMonth() - 1);
    return getYearMonthFromDate(currentDate);
  };
  
  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>, currentStartingDebt?: number): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    
    let calculatedStartingDebt = currentStartingDebt !== undefined ? currentStartingDebt : 0;
    let savingsBudgetCarryOver = 0; 
    let ccPaymentBudgetCarryOver = 0;

    if (prevMonthBudget) {
      const ccPaymentsCategoryPrev = prevMonthBudget.categories.find(
        cat => cat.name.toLowerCase() === "credit card payments" && cat.isSystemCategory
      );
      const paymentsMadeLastMonth = ccPaymentsCategoryPrev
        ? ccPaymentsCategoryPrev.expenses.reduce((sum, exp) => sum + exp.amount, 0)
        : 0;
      calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;

      const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.name.toLowerCase() === "savings" && cat.isSystemCategory);
      if (prevSavingsCat) savingsBudgetCarryOver = prevSavingsCat.budgetedAmount;
      
      if (ccPaymentsCategoryPrev) ccPaymentBudgetCarryOver = ccPaymentsCategoryPrev.budgetedAmount;
    }
    
    const initialDebt = Math.max(0, calculatedStartingDebt);
    let defaultCatsPayload = DEFAULT_CATEGORIES.map(catDef => {
      let budget = 0; // Default budget to 0
      if (catDef.name.toLowerCase() === "savings") budget = savingsBudgetCarryOver;
      else if (catDef.name.toLowerCase() === "credit card payments") budget = ccPaymentBudgetCarryOver;
      
      return {
        id: uuidv4(),
        name: catDef.name,
        budgetedAmount: budget,
        expenses: [],
        subcategories: [],
        isSystemCategory: catDef.isSystemCategory || false,
      };
    });

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

 const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId]; 
    let needsStateUpdate = false;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId, budgetMonths); 
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

      if (monthData.incomes === undefined) { monthData.incomes = []; changed = true; }
      if (monthData.isRolledOver === undefined) { monthData.isRolledOver = false; changed = true; }
      if (monthData.startingCreditCardDebt === undefined) { monthData.startingCreditCardDebt = 0; changed = true; }
      
      if (changed) {
        needsStateUpdate = true;
      }
    }

    if (needsStateUpdate) {
      const finalMonthData = monthData!; 
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: finalMonthData }));
    }
    return monthData!;
  }, [budgetMonths, createNewMonthBudget]);


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
        
        let isSystemCat = false;
        if (existingCat?.isSystemCategory) {
            isSystemCat = true; 
        } else if (catNameLower === 'savings' || catNameLower === 'credit card payments') {
            isSystemCat = true;
        }
        
        return {
          id: catPayload.id || uuidv4(),
          name: catPayload.name,
          budgetedAmount: catPayload.budgetedAmount !== undefined 
                          ? catPayload.budgetedAmount 
                          : (existingCat ? existingCat.budgetedAmount : 0),
          expenses: catPayload.expenses || existingCat?.expenses || [],
          subcategories: (isSystemCat) ? [] : (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => ({
            id: subCatPayload.id || uuidv4(),
            name: subCatPayload.name,
            budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
            expenses: subCatPayload.expenses || existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id)?.expenses || [],
          })),
          isSystemCategory: isSystemCat,
        };
      });
    }
    
    const { updatedCategories } = ensureSystemCategories(updatedMonth.categories, startingDebtForMonth); 
    updatedMonth.categories = updatedCategories;
    if (updatedMonth.incomes === undefined) updatedMonth.incomes = [];

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
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
  }, [ensureMonthExists]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId); 
    if (!sourceBudget) {
      const newMonth = createNewMonthBudget(targetMonthId, budgetMonths);
      setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonth }));
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    let savingsBudgetCarryOver = 0;
    let ccPaymentBudgetCarryOver = 0;


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
        if (ccPaymentsCategoryPrevTarget) ccPaymentBudgetCarryOver = ccPaymentsCategoryPrevTarget.budgetedAmount;


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
        if (ccPaymentsCategorySource) ccPaymentBudgetCarryOver = ccPaymentsCategorySource.budgetedAmount;
    } 
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);

    const newCategoriesBase = sourceBudget.categories.map(cat => {
      let budget = cat.budgetedAmount;
      if (cat.name.toLowerCase() === "savings") budget = savingsBudgetCarryOver; 
      else if (cat.name.toLowerCase() === "credit card payments") budget = ccPaymentBudgetCarryOver;

      return {
        id: uuidv4(), 
        name: cat.name,
        budgetedAmount: budget, 
        expenses: [], 
        subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || []).map(subCat => ({
          id: uuidv4(), 
          name: subCat.name,
          budgetedAmount: subCat.budgetedAmount, 
          expenses: [], 
        })),
        isSystemCategory: cat.isSystemCategory || false,
      };
    });

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
    setCurrentDisplayMonthId(targetMonthId); 
  }, [getBudgetForMonth, budgetMonths, createNewMonthBudget, setCurrentDisplayMonthId]); 

  const navigateToPreviousMonth = useCallback(() => {
    const prevMonthId = getPreviousMonthId(currentDisplayMonthId);
    ensureMonthExists(prevMonthId); 
    setCurrentDisplayMonthId(prevMonthId);
  }, [currentDisplayMonthId, ensureMonthExists, setCurrentDisplayMonthId]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    ensureMonthExists(nextMonthId); 
    setCurrentDisplayMonthId(nextMonthId);
  }, [currentDisplayMonthId, ensureMonthExists, setCurrentDisplayMonthId]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId); 
    if (!monthBudget) {
      return { success: false, message: `Budget for ${yearMonthId} not found.` };
    }
    if (monthBudget.isRolledOver) {
      return { success: false, message: `Budget for ${yearMonthId} has already been finalized.` };
    }

    const updatedMonth = { ...monthBudget, isRolledOver: true };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    
    return { success: true, message: "Month closed and finalized. Any unspent operational funds are implicitly saved." };

  }, [getBudgetForMonth]); 

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    const updatedCategoriesList = [...monthToUpdate.categories, newCategory];
    const { updatedCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate.startingCreditCardDebt || 0);

    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
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
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories } = ensureSystemCategories(filteredCategories, monthToUpdate.startingCreditCardDebt || 0);

    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
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
  }, [ensureMonthExists]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoading || authLoading || isSaving,
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

