
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
const getDisplayMonthKey = (userId?: string) => `budgetFlowDisplayMonth_${userId || 'guest'}`;
const getFirestoreUserBudgetDocRef = (userId: string) => doc(db, 'userBudgets', userId);


export const getYearMonthFromDate = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const parseYearMonth = (yearMonth: string): Date => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

// Ensures system categories ("Savings", "Credit Card Payments") exist, are correctly flagged, and named.
// It will create them if they are absent using defaults from DEFAULT_CATEGORIES.
// Returns { updatedCategories: BudgetCategory[], wasChanged: boolean }
const ensureSystemCategories = (categories: BudgetCategory[] | undefined, existingMonthData?: BudgetMonth): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let currentCategories = categories ? JSON.parse(JSON.stringify(categories)) : [];
  let wasActuallyChanged = !categories; // If categories was undefined, it's a change

  DEFAULT_CATEGORIES.forEach(defaultSysCat => {
    const existingSysCatIndex = currentCategories.findIndex((c: BudgetCategory) => c.name.toLowerCase() === defaultSysCat.name!.toLowerCase());
    if (existingSysCatIndex !== -1) {
      const cat = currentCategories[existingSysCatIndex];
      const originalCatJson = JSON.stringify(cat);
      cat.isSystemCategory = true; // Ensure flag
      cat.name = defaultSysCat.name!; // Ensure standard name
      cat.subcategories = []; // System cats don't have subs
      if (JSON.stringify(cat) !== originalCatJson) wasActuallyChanged = true;
    } else {
      // Add missing system category
      const newSysCat: BudgetCategory = {
        id: uuidv4(),
        name: defaultSysCat.name!,
        budgetedAmount: defaultSysCat.budgetedAmount || 0,
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
      };
      // Carry over budget from previous month if applicable
      if (existingMonthData && existingMonthData.id !== getYearMonthFromDate(new Date(0))) { // check not initial month
        const prevMonthId = getPreviousMonthId(existingMonthData.id);
        // This assumes budgetMonths state is available or passed in, which is not the case here.
        // For simplicity, we'll let budget carry-over be handled by createNewMonthBudget.
        // Here, we just ensure it exists with a default budget if added fresh.
      }
      currentCategories.push(newSysCat);
      wasActuallyChanged = true;
    }
  });
  
  // Ensure all categories have basic structure
  currentCategories.forEach((cat: BudgetCategory) => {
    const originalCatJson = JSON.stringify(cat);
    if (cat.budgetedAmount === undefined) cat.budgetedAmount = 0;
    if (!Array.isArray(cat.expenses)) cat.expenses = [];
    if (!cat.isSystemCategory) {
        if (!Array.isArray(cat.subcategories)) cat.subcategories = [];
        (cat.subcategories || []).forEach(sub => {
            if (sub.budgetedAmount === undefined) sub.budgetedAmount = 0;
            if (!Array.isArray(sub.expenses)) sub.expenses = [];
        });
    } else {
        if (cat.subcategories && cat.subcategories.length > 0) cat.subcategories = [];
    }
    if (JSON.stringify(cat) !== originalCatJson) wasActuallyChanged = true;
  });


  // Sort: System categories first, then others alphabetically
  currentCategories.sort((a: BudgetCategory, b: BudgetCategory) => {
    if (a.isSystemCategory && !b.isSystemCategory) return -1;
    if (!a.isSystemCategory && b.isSystemCategory) return 1;
    if (a.isSystemCategory && b.isSystemCategory) { // Order system categories
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1; // After Savings
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  const finalOriginalJson = categories ? JSON.stringify(categories.sort((a,b) => a.name.localeCompare(b.name))) : "[]";
  const finalNewJson = JSON.stringify(currentCategories.sort((a,b) => a.name.localeCompare(b.name)));

  if (finalOriginalJson !== finalNewJson) {
      wasActuallyChanged = true;
  }

  return { updatedCategories: currentCategories, wasChanged: wasActuallyChanged };
};


const getPreviousMonthId = (currentMonthId: string): string => {
  const currentDate = parseYearMonth(currentMonthId);
  currentDate.setMonth(currentDate.getMonth() - 1);
  return getYearMonthFromDate(currentDate);
};

export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonths, setBudgetMonthsState] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const initialAuthUser = authLoading ? undefined : (user || undefined);
      const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(initialAuthUser?.uid));
      if (storedDisplayMonth) return storedDisplayMonth;
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default June 2025
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(prevMonths => {
        const newMonths = typeof updater === 'function' ? updater(prevMonths) : updater;
        if (isUserAuthenticated && user && !isSaving) { // Added !isSaving to prevent loop during save
            saveBudgetMonthsToFirestore(user.uid, newMonths);
        } else if (!isUserAuthenticated && !isSaving) {
            localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(newMonths));
        }
        return newMonths;
    });
  }, [isUserAuthenticated, user, isSaving]); // isSaving added


  useEffect(() => {
    if (authLoading) return;
    const currentUid = user?.uid;
    const key = getDisplayMonthKey(currentUid);
    const storedMonthId = localStorage.getItem(key);
    if (storedMonthId) {
      if (currentDisplayMonthId !== storedMonthId) {
        setCurrentDisplayMonthIdState(storedMonthId);
      }
    } else {
      const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
      setCurrentDisplayMonthIdState(defaultMonth);
      localStorage.setItem(key, defaultMonth);
    }
  }, [user, authLoading, currentDisplayMonthId, setCurrentDisplayMonthIdState]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    if (!authLoading && typeof window !== "undefined") { // Ensure window is defined for localStorage
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading, setCurrentDisplayMonthIdState]);

  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return;
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        const { updatedCategories } = ensureSystemCategories(month.categories, month);
        monthsWithEnsuredCategories[monthId] = { ...month, categories: updatedCategories, incomes: month.incomes || [] };
      }
      await setDoc(docRef, { months: monthsWithEnsuredCategories }, { merge: true });
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    let calculatedStartingDebt = 0;
    let initialUserCategories: BudgetCategory[] = []; // Start with no user-defined categories

    let systemCategoriesToCarry: BudgetCategory[] = DEFAULT_CATEGORIES.map(sysDef => ({
        id: uuidv4(),
        name: sysDef.name!,
        budgetedAmount: sysDef.budgetedAmount || 0,
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
    }));

    if (prevMonthBudget) {
        systemCategoriesToCarry.forEach(sysCatToCarry => {
            const prevSysCat = prevMonthBudget.categories.find(c => c.isSystemCategory && c.name === sysCatToCarry.name);
            if (prevSysCat) {
                sysCatToCarry.budgetedAmount = prevSysCat.budgetedAmount; // Carry over budget
            }
        });
        
        const prevCCPaymentsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
        } else {
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0; // Carry debt if no payment cat
        }
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const combinedCategories = [...systemCategoriesToCarry, ...initialUserCategories];
    // Ensure flags are correct on the combined list. This will also sort them.
    const { updatedCategories: categoriesWithSystemFlags } = ensureSystemCategories(combinedCategories);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: categoriesWithSystemFlags,
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []);


 useEffect(() => {
    if (authLoading) {
      setIsLoadingDb(true);
      return;
    }
    setIsLoadingDb(true);
    let unsubscribe = () => {};
    let localProcessingTimeout: NodeJS.Timeout;

    const processAndUpdateState = (newRawMonths: Record<string, BudgetMonth>, source: 'firestore' | 'guest_init' | 'guest_storage') => {
        clearTimeout(localProcessingTimeout);

        localProcessingTimeout = setTimeout(() => {
            let processedMonths = { ...newRawMonths };
            let wasAnyDataStructurallyModified = false;

            Object.keys(processedMonths).forEach(monthId => {
                const monthData = { ...processedMonths[monthId] };
                let monthModified = false;

                monthData.incomes = monthData.incomes || [];
                
                const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategories(monthData.categories, monthData);
                if (catsChanged) {
                    monthData.categories = ensuredCategories;
                    monthModified = true;
                }

                if (monthData.isRolledOver === undefined) { monthData.isRolledOver = false; monthModified = true; }
                if (monthData.startingCreditCardDebt === undefined) { monthData.startingCreditCardDebt = 0; monthModified = true; }

                if (monthModified) {
                    processedMonths[monthId] = monthData;
                    wasAnyDataStructurallyModified = true;
                }
            });
            
            if (!processedMonths[currentDisplayMonthId]) {
                const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, processedMonths);
                processedMonths = { ...processedMonths, [currentDisplayMonthId]: newCurrentMonthData };
                wasAnyDataStructurallyModified = true;
            } else {
                const currentMonth = { ...processedMonths[currentDisplayMonthId] };
                const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategories(currentMonth.categories, currentMonth);
                if (currentMonthCatsChanged) {
                    currentMonth.categories = ensuredCurrentMonthCategories;
                    processedMonths[currentDisplayMonthId] = currentMonth;
                    wasAnyDataStructurallyModified = true;
                }
            }
            
            const finalProcessedMonths = processedMonths; // Alias for clarity

            setBudgetMonthsState(prevMonths => {
                 if (JSON.stringify(prevMonths) !== JSON.stringify(finalProcessedMonths)) {
                    if (isUserAuthenticated && user && source === 'firestore' && wasAnyDataStructurallyModified) {
                        // If structural changes happened due to ensureSystemCategories from a firestore read, save it back.
                        saveBudgetMonthsToFirestore(user.uid, finalProcessedMonths);
                    } else if (!isUserAuthenticated && wasAnyDataStructurallyModified) {
                        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(finalProcessedMonths));
                    }
                    return finalProcessedMonths;
                }
                return prevMonths;
            });
            
            setIsLoadingDb(false);
        }, 100); 
    };

    if (isUserAuthenticated && user) {
      const docRef = getFirestoreUserBudgetDocRef(user.uid);
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        let firestoreMonths: Record<string, BudgetMonth> = {};
        if (docSnap.exists()) {
          const data = docSnap.data() as { months: Record<string, BudgetMonth> };
          firestoreMonths = data.months || {};
        }
        processAndUpdateState(firestoreMonths, 'firestore');
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        processAndUpdateState({}, 'firestore');
      });
    } else { 
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let guestMonths: Record<string, BudgetMonth> = {};
      if (localData) {
        try {
          guestMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
        } catch (e) { console.error("Error parsing guest budget data", e); }
      }
      processAndUpdateState(guestMonths, localData ? 'guest_storage' : 'guest_init');
    }
    return () => {
        unsubscribe();
        clearTimeout(localProcessingTimeout);
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore, setBudgetMonthsState]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId];
    let needsUpdate = false;
    let finalMonthData: BudgetMonth;

    if (!monthData) {
      finalMonthData = createNewMonthBudget(yearMonthId, budgetMonths);
      needsUpdate = true;
    } else {
      let tempMonthData = JSON.parse(JSON.stringify(monthData)); // Deep clone to avoid direct state mutation
      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategories(tempMonthData.categories, tempMonthData);
      
      if (catsChanged) tempMonthData.categories = updatedCategories;
      if (tempMonthData.incomes === undefined) tempMonthData.incomes = [];
      if (tempMonthData.isRolledOver === undefined) tempMonthData.isRolledOver = false;
      if (tempMonthData.startingCreditCardDebt === undefined) tempMonthData.startingCreditCardDebt = 0;
      
      finalMonthData = tempMonthData;
      if (catsChanged || JSON.stringify(monthData) !== JSON.stringify(finalMonthData)) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setBudgetMonths(prev => {
        const newState = { ...prev, [yearMonthId]: finalMonthData };
        // Only trigger save if there's an actual change to prevent loops
        if (JSON.stringify(prev[yearMonthId]) !== JSON.stringify(finalMonthData)) {
          return newState; 
        }
        return prev;
      });
    }
    return finalMonthData;
  }, [budgetMonths, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let updatedMonth = JSON.parse(JSON.stringify(monthToUpdate)); // Deep clone
    
    if (payload.startingCreditCardDebt !== undefined) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
    }
      
    if (payload.categories) {
      const existingCategoriesMap = new Map(updatedMonth.categories.map((c: BudgetCategory) => [c.id, c]));
      const newCategoriesFromPayload: BudgetCategory[] = [];

      payload.categories.forEach(catPayload => {
        const existingCat = catPayload.id ? existingCategoriesMap.get(catPayload.id) : undefined;
        const id = catPayload.id || existingCat?.id || uuidv4();
        
        let budgetToSet = catPayload.budgetedAmount;
         if (budgetToSet === undefined) {
            budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
        }

        const existingSubcategoriesMap = new Map(existingCat?.subcategories?.map((sc: SubCategory) => [sc.id, sc]));
        let subcategoriesToSet = (catPayload.subcategories || []).map(subCatPayload => {
            const existingSubCat = subCatPayload.id ? existingSubcategoriesMap.get(subCatPayload.id) : undefined;
            return {
              id: subCatPayload.id || existingSubCat?.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
              expenses: existingSubCat?.expenses || [], 
            };
          });
        
        const defaultSysCatInfo = DEFAULT_CATEGORIES.find(dc => dc.name?.toLowerCase() === catPayload.name.toLowerCase());
        let isSysCat = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : !!defaultSysCatInfo);
        
        if(isSysCat) subcategoriesToSet = []; 

        if (!isSysCat && subcategoriesToSet.length > 0) {
             budgetToSet = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        newCategoriesFromPayload.push({
          id: id,
          name: catPayload.name,
          budgetedAmount: budgetToSet,
          expenses: existingCat?.expenses || [], 
          subcategories: subcategoriesToSet,
          isSystemCategory: isSysCat,
        });
      });
      updatedMonth.categories = newCategoriesFromPayload;
    }
    
    const { updatedCategories, wasChanged: systemFlagsChanged } = ensureSystemCategories(updatedMonth.categories, updatedMonth);
    updatedMonth.categories = updatedCategories;

    updatedMonth.categories.forEach((cat: BudgetCategory) => { 
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            cat.budgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
    });

    if (JSON.stringify(budgetMonths[yearMonthId]) !== JSON.stringify(updatedMonth)) {
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 

    const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
    let changed = false;
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      let currentCat = JSON.parse(JSON.stringify(cat)); 
      if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
        if (!currentCat.isSystemCategory && currentCat.subcategories && currentCat.subcategories.length > 0) {
            console.warn(`Attempted to add expense to parent category '${currentCat.name}' which has subcategories. Expense not added.`);
            return currentCat;
        }
        currentCat.expenses = [...(currentCat.expenses || []), newExpense];
        changed = true;
        return currentCat;
      } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find((sub:SubCategory) => sub.id === categoryOrSubCategoryId)) {
        currentCat.subcategories = (currentCat.subcategories || []).map((sub: SubCategory) =>
            sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
        );
        changed = true;
        return currentCat;
      }
      return currentCat;
    });

    if (changed) {
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;
    let changed = false;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      let currentCat = JSON.parse(JSON.stringify(cat));
      if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
        const initialLength = (currentCat.expenses || []).length;
        currentCat.expenses = (currentCat.expenses || []).filter((exp: Expense) => exp.id !== expenseId);
        if (currentCat.expenses.length !== initialLength) changed = true;
        return currentCat;
      } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find((sub: SubCategory) => sub.id === categoryOrSubCategoryId)) {
        currentCat.subcategories = (currentCat.subcategories || []).map((sub: SubCategory) => {
            if (sub.id === categoryOrSubCategoryId) {
              const initialLength = (sub.expenses || []).length;
              const newExpenses = (sub.expenses || []).filter((exp: Expense) => exp.id !== expenseId);
              if (newExpenses.length !== initialLength) changed = true;
              return { ...sub, expenses: newExpenses };
            }
            return sub;
          });
        return currentCat;
      }
      return currentCat;
    });

    if (changed) {
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId); 
    if (!sourceBudget) {
      ensureMonthExists(targetMonthId); // Creates if not exists
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    
    const systemCategoriesToCarry: BudgetCategory[] = DEFAULT_CATEGORIES.map(sysDef => ({
        id: uuidv4(),
        name: sysDef.name!,
        budgetedAmount: sysDef.budgetedAmount || 0,
        expenses: [],
        subcategories: [],
        isSystemCategory: true,
    }));

    const referenceMonthForSystemCats = prevMonthForTargetBudget || (sourceBudget.id === prevMonthForTargetId ? sourceBudget : sourceBudget);

    systemCategoriesToCarry.forEach(sysCatToCarry => {
        const refSysCat = referenceMonthForSystemCats.categories.find(c => c.isSystemCategory && c.name === sysCatToCarry.name);
        if (refSysCat) {
            sysCatToCarry.budgetedAmount = refSysCat.budgetedAmount;
        }
    });

    if (prevMonthForTargetBudget) { 
        const ccPaymentsCatRef = prevMonthForTargetBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        const paymentsMadeLastMonthRef = ccPaymentsCatRef ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;
    } else if (sourceBudget.id === prevMonthForTargetId) { // Duplicating to immediate next month from source
        const ccPaymentsCatRef = sourceBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        const paymentsMadeLastMonthRef = ccPaymentsCatRef ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;
    } else { // No relevant previous month, use source debt (e.g., duplicating far future month)
         calculatedStartingDebtForTarget = sourceBudget.startingCreditCardDebt || 0;
    }
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);
    const duplicatedUserCategories = sourceBudget.categories
        .filter(cat => !cat.isSystemCategory) 
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

      duplicatedUserCategories.forEach(cat => {
          if (cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum,sub) => sum + sub.budgetedAmount, 0);
          }
      });
    
    let finalCategoriesForNewMonth: BudgetCategory[] = [...systemCategoriesToCarry, ...duplicatedUserCategories];
    const { updatedCategories } = ensureSystemCategories(finalCategoriesForNewMonth); 

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
  }, [getBudgetForMonth, budgetMonths, setCurrentDisplayMonthId, ensureMonthExists, setBudgetMonths]);

  const navigateToPreviousMonth = useCallback(() => {
    const prevMonthId = getPreviousMonthId(currentDisplayMonthId);
    setCurrentDisplayMonthId(prevMonthId);
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    setCurrentDisplayMonthId(nextMonthId);
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

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
    
    return { success: true, message: "Month finalized and closed." };

  }, [getBudgetForMonth, setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const existingCat = monthToUpdate.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (existingCat) {
        console.warn(`Category "${categoryName}" already exists.`);
        return;
    }
    const defaultSysInfo = DEFAULT_CATEGORIES.find(dc => dc.name?.toLowerCase() === categoryName.toLowerCase());

    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], 
      isSystemCategory: !!defaultSysInfo, 
    };
    
    const { updatedCategories: tempCatsWithNew } = ensureSystemCategories([...monthToUpdate.categories, newCategory], monthToUpdate);
    
    const updatedMonth = { ...monthToUpdate, categories: tempCatsWithNew };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'id' | 'expenses'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        let newIsSystem = updatedCategoryData.isSystemCategory !== undefined ? updatedCategoryData.isSystemCategory : cat.isSystemCategory;
        
        const defaultSysInfo = DEFAULT_CATEGORIES.find(dc => dc.name?.toLowerCase() === newName.toLowerCase());
        if (defaultSysInfo) { // If name matches a system category name, enforce system properties
            newName = defaultSysInfo.name!;
            newIsSystem = true;
        } else if (cat.isSystemCategory && updatedCategoryData.name && updatedCategoryData.name.toLowerCase() !== cat.name.toLowerCase()){
            // If it *was* a system category and name is changing to non-system name, it's no longer system
            // However, we generally prevent renaming system categories directly. This path is less likely.
            newIsSystem = false;
        }


        if (newIsSystem) { // System categories can't have subs and name is fixed by ensureSystemCategories
            // Their budget is editable directly
        } else if (cat.subcategories && cat.subcategories.length > 0) { // Non-system with subs
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories } = ensureSystemCategories(newCategories, monthToUpdate);
      
      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
       if (JSON.stringify(budgetMonths[yearMonthId]?.categories) !== JSON.stringify(updatedMonth.categories)) {
            setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
       }
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories: finalCategories } = ensureSystemCategories(filteredCategories, monthToUpdate); // Re-ensure after delete
    const updatedMonth = { ...monthToUpdate, categories: finalCategories };

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    let parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return; 

    const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
    let changed = false;
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        changed = true;
        const updatedSubcategories = [...(cat.subcategories || []), newSubCategory];
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });

    if(changed){
        const { updatedCategories: finalCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate);
        const updatedMonth = { ...monthToUpdate, categories: finalCategories };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;
    let changed = false;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        changed = true;
        const updatedSubcategories = (cat.subcategories || []).map(sub =>
            sub.id === subCategoryId ? { ...sub, name: newName, budgetedAmount: newBudget } : sub
        );
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });
    if(changed){
        const { updatedCategories: finalCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate);
        const updatedMonth = { ...monthToUpdate, categories: finalCategories };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;
    let changed = false;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        changed = true;
        const updatedSubcategories = (cat.subcategories || []).filter(sub => sub.id !== subCategoryId);
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });
     if(changed){
        const { updatedCategories: finalCategories } = ensureSystemCategories(updatedCategoriesList, monthToUpdate);
        const updatedMonth = { ...monthToUpdate, categories: finalCategories };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoadingDb || authLoading || isSaving,
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
