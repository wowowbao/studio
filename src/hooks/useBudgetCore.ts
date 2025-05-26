
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
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

// Ensures system categories ("Savings", "Credit Card Payments"), if present by name, are correctly flagged and named.
// It does NOT create them if they are absent. It does NOT modify their budgetedAmount.
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? JSON.parse(JSON.stringify(categories)) : []; // Deep copy
  let wasActuallyChanged = false;

  const systemCategorySpecs = [
    { name: "Savings" },
    { name: "Credit Card Payments" }
  ];

  newCategories.forEach((cat: BudgetCategory, index: number) => {
    const catNameLower = cat.name.toLowerCase();
    let originalCatJSON = JSON.stringify(cat); // For precise change detection

    const matchedSpec = systemCategorySpecs.find(spec => spec.name.toLowerCase() === catNameLower);

    if (matchedSpec) { // Category name matches a system category spec
      if (!cat.isSystemCategory || cat.name !== matchedSpec.name || (cat.subcategories && cat.subcategories.length > 0)) {
        cat.isSystemCategory = true;
        cat.name = matchedSpec.name; // Standardize name
        cat.subcategories = []; // System categories cannot have subcategories
      }
    } else { // Category name does NOT match any system category spec
      if (cat.isSystemCategory) {
        cat.isSystemCategory = false; // Ensure it's not flagged as system
      }
    }
    
    if (JSON.stringify(cat) !== originalCatJSON) {
        wasActuallyChanged = true;
        newCategories[index] = cat; 
    }
  });

  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => getYearMonthFromDate(new Date(2025, 5, 1))); // Default to June 2025
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(user?.uid));
    if (storedDisplayMonth) {
      setCurrentDisplayMonthIdState(storedDisplayMonth);
    } else {
      const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
      setCurrentDisplayMonthIdState(defaultMonth);
      localStorage.setItem(getDisplayMonthKey(user?.uid), defaultMonth);
    }
  }, [user, authLoading]);

  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
     if (!authLoading) {
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);

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
    let initialCategories: BudgetCategory[] = []; // Start with no user-defined categories by default

    if (prevMonthBudget) {
      const ccPaymentsCategoryPrev = prevMonthBudget.categories.find(
        cat => cat.name === "Credit Card Payments" && cat.isSystemCategory
      );
      const paymentsMadeLastMonth = ccPaymentsCategoryPrev
        ? ccPaymentsCategoryPrev.expenses.reduce((sum, exp) => sum + exp.amount, 0)
        : 0;
      calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;

      // Carry over system categories with their budgeted amounts
      const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.name === "Savings" && cat.isSystemCategory);
      if (prevSavingsCat) {
        initialCategories.push({
          id: uuidv4(),
          name: "Savings",
          budgetedAmount: prevSavingsCat.budgetedAmount, // Carry over budget
          expenses: [],
          subcategories: [],
          isSystemCategory: true,
        });
      }
      if (ccPaymentsCategoryPrev) { // Carried from prev month
        initialCategories.push({
          id: uuidv4(),
          name: "Credit Card Payments",
          budgetedAmount: ccPaymentsCategoryPrev.budgetedAmount, // Carry over budget
          expenses: [],
          subcategories: [],
          isSystemCategory: true,
        });
      }
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const { updatedCategories } = ensureSystemCategoryFlags(initialCategories); // Ensure flags are correct
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: updatedCategories,
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []); 

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
          let loadedMonths = data.months || {};
          let changedDuringLoad = false;

          Object.keys(loadedMonths).forEach(monthId => {
            const monthData = loadedMonths[monthId];
            monthData.incomes = monthData.incomes || [];
            monthData.categories = monthData.categories || [];
            
            const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
            if(catsChanged) {
                monthData.categories = updatedCategories;
                changedDuringLoad = true;
            }

            monthData.categories.forEach(cat => {
              cat.expenses = cat.expenses || [];
              if (!cat.isSystemCategory) {
                cat.subcategories = cat.subcategories || [];
                cat.subcategories.forEach(subCat => {
                  subCat.expenses = subCat.expenses || [];
                });
              } else {
                cat.subcategories = []; // Ensure system cats don't have subs
              }
            });
            monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
            monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;
          });
          
          setBudgetMonths(loadedMonths);
          if (changedDuringLoad && user) { 
              saveBudgetMonthsToFirestore(user.uid, loadedMonths);
          }
        } else { 
          const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
          const initialData = { [currentDisplayMonthId]: initialMonth };
          setBudgetMonths(initialData);
          if (user) { 
            saveBudgetMonthsToFirestore(user.uid, initialData);
          }
        }
        setIsLoading(false);
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        setIsLoading(false);
      });
      return () => unsubscribe();
    } else { 
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let changedDuringGuestLoad = false;
      let guestMonthsToSet: Record<string, BudgetMonth> = {};

      if (localData) {
        try {
          const parsedData = JSON.parse(localData) as Record<string, BudgetMonth>;
          Object.keys(parsedData).forEach(monthId => {
            const monthData = parsedData[monthId];
            monthData.incomes = monthData.incomes || [];
            monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
            monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;
            monthData.categories = monthData.categories || [];
            const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
            if(catsChanged) {
                monthData.categories = updatedCategories;
                changedDuringGuestLoad = true;
            }
            monthData.categories.forEach(cat => {
              cat.expenses = cat.expenses || [];
              if (!cat.isSystemCategory) {
                cat.subcategories = cat.subcategories || [];
                cat.subcategories.forEach(subCat => {
                  subCat.expenses = subCat.expenses || [];
                });
              } else {
                cat.subcategories = [];
              }
            });
            guestMonthsToSet[monthId] = monthData;
          });
        } catch (e) {
          console.error("Error parsing guest budget data from localStorage", e);
          const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
          guestMonthsToSet = { [currentDisplayMonthId]: initialMonth };
          changedDuringGuestLoad = true;
        }
      } else { 
         const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
         guestMonthsToSet = { [currentDisplayMonthId]: initialMonth };
         changedDuringGuestLoad = true;
      }
      setBudgetMonths(guestMonthsToSet);
      if (changedDuringGuestLoad) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(guestMonthsToSet));
      }
      setIsLoading(false);
    }
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore]);


  useEffect(() => {
    if (!isLoading && !authLoading && Object.keys(budgetMonths).length > 0) { 
      if (isUserAuthenticated && user) {
        saveBudgetMonthsToFirestore(user.uid, budgetMonths);
      } else if (!isUserAuthenticated) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(budgetMonths));
      }
    }
  }, [budgetMonths, isLoading, authLoading, user, isUserAuthenticated, saveBudgetMonthsToFirestore]);


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
      
      const { updatedCategories, wasChanged: categoriesWereChanged } = ensureSystemCategoryFlags(currentCategories);
      if (categoriesWereChanged) {
        monthData = { ...monthData, categories: updatedCategories };
        changed = true;
      }

      monthData.incomes = monthData.incomes || [];
      monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
      monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;
      
      if (changed) { // Only set needsStateUpdate if a meaningful change occurred
        needsStateUpdate = true;
      }
    }

    if (needsStateUpdate && monthData) { // Ensure monthData is not null
      const finalMonthData = monthData; 
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: finalMonthData }));
    }
    return monthData!; // monthData should always be defined here due to createNewMonthBudget
  }, [budgetMonths, createNewMonthBudget]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let updatedMonth = { ...monthToUpdate };
    
    if (payload.startingCreditCardDebt !== undefined) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
    }
      
    if (payload.categories) {
      updatedMonth.categories = payload.categories.map(catPayload => {
        const existingCat = monthToUpdate.categories.find(c => c.id === catPayload.id);
        
        let budgetToSet = catPayload.budgetedAmount;
        if (budgetToSet === undefined) {
            budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
        }

        return {
          id: catPayload.id || uuidv4(),
          name: catPayload.name,
          budgetedAmount: budgetToSet,
          expenses: existingCat?.expenses || [], 
          subcategories: (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => {
            const existingSubCat = existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id);
            return {
              id: subCatPayload.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
              expenses: existingSubCat?.expenses || [], 
            };
          }),
          isSystemCategory: catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : false),
        };
      });
    }
    
    const { updatedCategories } = ensureSystemCategoryFlags(updatedMonth.categories); 
    updatedMonth.categories = updatedCategories;

    updatedMonth.incomes = updatedMonth.incomes || [];

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
    let systemCategoriesToCarry: BudgetCategory[] = [];


    if (prevMonthForTargetBudget) { 
        const ccPaymentsCategoryPrevTarget = prevMonthForTargetBudget.categories.find(
            cat => cat.name === "Credit Card Payments" && cat.isSystemCategory
        );
        const paymentsMadeLastMonthPrevTarget = ccPaymentsCategoryPrevTarget
            ? ccPaymentsCategoryPrevTarget.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthPrevTarget;

        const prevSavingsCat = prevMonthForTargetBudget.categories.find(cat => cat.name === "Savings" && cat.isSystemCategory);
        if (prevSavingsCat) systemCategoriesToCarry.push({...prevSavingsCat, id: uuidv4(), expenses: []});
        if (ccPaymentsCategoryPrevTarget) systemCategoriesToCarry.push({...ccPaymentsCategoryPrevTarget, id: uuidv4(), expenses: []});

    } else if (sourceBudget.id === prevMonthForTargetId) { 
        const ccPaymentsCategorySource = sourceBudget.categories.find(
            cat => cat.name === "Credit Card Payments" && cat.isSystemCategory
        );
        const paymentsMadeLastMonthSource = ccPaymentsCategorySource
            ? ccPaymentsCategorySource.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthSource;
        
        const sourceSavingsCat = sourceBudget.categories.find(cat => cat.name === "Savings" && cat.isSystemCategory);
        if (sourceSavingsCat) systemCategoriesToCarry.push({...sourceSavingsCat, id: uuidv4(), expenses: []});
        if (ccPaymentsCategorySource) systemCategoriesToCarry.push({...ccPaymentsCategorySource, id: uuidv4(), expenses: []});
    } 
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);

    const duplicatedUserCategories = sourceBudget.categories
        .filter(cat => !cat.isSystemCategory) // Only duplicate non-system categories
        .map(cat => ({
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
            isSystemCategory: false,
      }));
    
    const finalCategoriesForNewMonth = [...systemCategoriesToCarry, ...duplicatedUserCategories];
    const { updatedCategories } = ensureSystemCategoryFlags(finalCategoriesForNewMonth);


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
    
    return { success: true, message: "Month closed. Any unspent operational funds are implicitly saved." };

  }, [getBudgetForMonth]); 

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    const updatedCategoriesList = [...monthToUpdate.categories, newCategory];
    const { updatedCategories } = ensureSystemCategoryFlags(updatedCategoriesList);

    const updatedMonth = { ...monthToUpdate, categories: updatedCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]); 

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        
        if (cat.isSystemCategory && updatedCategoryData.name !== undefined && updatedCategoryData.name !== cat.name) {
            newName = cat.name; 
        }
        return { ...cat, name: newName, budgetedAmount: newBudget, subcategories: cat.subcategories || [] };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories, wasChanged: flagsChanged } = ensureSystemCategoryFlags(newCategories);
      const finalCategories = flagsChanged ? updatedCategories : newCategories;
      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const updatedMonth = { ...monthToUpdate, categories: filteredCategories };
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

    