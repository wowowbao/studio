
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
// DEFAULT_CATEGORIES is now empty, system categories are handled by ensureSystemCategoryFlags
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

// Ensures system categories ("Savings", "Credit Card Payments"), if present by name, are correctly flagged and named.
// It does NOT create them if they are absent from the input `categories` array.
// It does NOT modify their budgetedAmount automatically here (that's handled elsewhere for CC Payments).
// It also ensures system categories do not have subcategories.
// Returns true if any category was actually changed.
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categories) {
    return { updatedCategories: [], wasChanged: false };
  }
  
  let clonedCategories = JSON.parse(JSON.stringify(categories)); // Deep clone for mutation safety
  let wasActuallyChanged = false;

  const systemCategorySpecs = [
    { name: "Savings", defaultBudget: 0 }, // defaultBudget is not used to set amount here
    { name: "Credit Card Payments", defaultBudget: 0 } // defaultBudget is not used to set amount here
  ];

  clonedCategories.forEach((cat: BudgetCategory) => { // Iterate over the clone
    const originalCatJSON = JSON.stringify(cat);
    let categoryModifiedInLoop = false;

    const catNameLower = cat.name.toLowerCase();
    const matchedSpec = systemCategorySpecs.find(spec => spec.name.toLowerCase() === catNameLower);

    if (matchedSpec) {
      if (!cat.isSystemCategory) { cat.isSystemCategory = true; categoryModifiedInLoop = true; }
      if (cat.name !== matchedSpec.name) { cat.name = matchedSpec.name; categoryModifiedInLoop = true; }
      if (cat.subcategories && cat.subcategories.length > 0) { cat.subcategories = []; categoryModifiedInLoop = true; }
    } else {
      if (cat.isSystemCategory) { cat.isSystemCategory = false; categoryModifiedInLoop = true; }
    }

    if (cat.budgetedAmount === undefined) { cat.budgetedAmount = 0; categoryModifiedInLoop = true; }
    if (!Array.isArray(cat.expenses)) { cat.expenses = []; categoryModifiedInLoop = true; }
    
    if (!cat.isSystemCategory) {
        if (!Array.isArray(cat.subcategories)) { cat.subcategories = []; categoryModifiedInLoop = true; }
        (cat.subcategories || []).forEach(sub => {
            if (sub.budgetedAmount === undefined) { sub.budgetedAmount = 0; categoryModifiedInLoop = true; }
            if (!Array.isArray(sub.expenses)) { sub.expenses = []; categoryModifiedInLoop = true; }
        });
    } else {
        if (cat.subcategories && cat.subcategories.length > 0) { // Ensure system cats don't have subs
            cat.subcategories = [];
            categoryModifiedInLoop = true;
        }
    }
    
    if (categoryModifiedInLoop && JSON.stringify(cat) !== originalCatJSON) {
        wasActuallyChanged = true;
    }
  });

  if (!wasActuallyChanged) {
    return { updatedCategories: categories, wasChanged: false }; // Return original reference
  }
  return { updatedCategories: clonedCategories, wasChanged: true }; // Return new reference
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});
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
  }, [user, authLoading, currentDisplayMonthId]); // Added currentDisplayMonthId back to ensure effect runs if it's changed externally

  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    if (!authLoading) {
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);

  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return;
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        // System category flags are ensured before saving, though onSnapshot also handles this.
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories);
        monthsWithEnsuredCategories[monthId] = { ...month, categories: updatedCategories, incomes: month.incomes || [] };
      }
      await setDoc(docRef, { months: monthsWithEnsuredCategories }, { merge: true });
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

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    let calculatedStartingDebt = 0;
    let initialCategories: BudgetCategory[] = DEFAULT_CATEGORIES.map(cat => ({ ...cat, id: uuidv4(), expenses: [], subcategories: [] })); // Already empty

    if (prevMonthBudget) {
        const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Savings");
        if (prevSavingsCat) {
            initialCategories.push({ ...prevSavingsCat, id: uuidv4(), expenses: [], subcategories: [] }); // Carry over savings budget
        }

        const prevCCPaymentsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
            initialCategories.push({ ...prevCCPaymentsCat, id: uuidv4(), expenses: [], subcategories: [] }); // Carry over CC payment budget
        } else {
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0;
        }
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const { updatedCategories: categoriesWithSystemFlags, wasChanged } = ensureSystemCategoryFlags(initialCategories);
    
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
        clearTimeout(localProcessingTimeout); // Clear any pending processing

        localProcessingTimeout = setTimeout(() => { // Debounce processing slightly
            let processedMonths = { ...newRawMonths }; // Start with a copy
            let wasAnyDataStructurallyModified = false;

            Object.keys(processedMonths).forEach(monthId => {
                const monthData = { ...processedMonths[monthId] }; // Work on a copy of the month
                let monthModified = false;

                monthData.incomes = monthData.incomes || [];
                monthData.categories = monthData.categories || [];
                
                const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
                if (catsChanged) {
                    monthData.categories = ensuredCategories;
                    monthModified = true;
                }

                if (monthData.isRolledOver === undefined) { monthData.isRolledOver = false; monthModified = true; }
                if (monthData.startingCreditCardDebt === undefined) { monthData.startingCreditCardDebt = 0; monthModified = true; }

                if (monthModified) {
                    processedMonths[monthId] = monthData; // Update the entry in processedMonths with the modified month
                    wasAnyDataStructurallyModified = true;
                }
            });
            
            // Ensure current display month exists
            if (!processedMonths[currentDisplayMonthId]) {
                const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, processedMonths);
                processedMonths = { ...processedMonths, [currentDisplayMonthId]: newCurrentMonthData };
                wasAnyDataStructurallyModified = true;
            } else {
                // Also ensure system flags for the current display month if it existed
                const currentMonth = { ...processedMonths[currentDisplayMonthId] };
                const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
                if (currentMonthCatsChanged) {
                    currentMonth.categories = ensuredCurrentMonthCategories;
                    processedMonths[currentDisplayMonthId] = currentMonth;
                    wasAnyDataStructurallyModified = true;
                }
            }
            
            setBudgetMonths(prevMonths => {
                if (JSON.stringify(prevMonths) !== JSON.stringify(processedMonths)) {
                    return processedMonths;
                }
                return prevMonths;
            });

            // Persist if structurally modified during this processing step AND it's not just a Firestore echo of our own save
            if (wasAnyDataStructurallyModified && source !== 'firestore') { // Avoid saving back immediately if it's from Firestore snapshot unless it's a new month creation
                 if (isUserAuthenticated && user) {
                    saveBudgetMonthsToFirestore(user.uid, processedMonths);
                } else if (!isUserAuthenticated) {
                    localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(processedMonths));
                }
            }
            setIsLoadingDb(false);
        }, 50); // Small debounce to group rapid changes
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
        processAndUpdateState({}, 'firestore'); // Process with empty if error
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
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore, setBudgetMonths]); // Added setBudgetMonths

  useEffect(() => {
    if (!isLoadingDb && !authLoading && Object.keys(budgetMonths).length > 0 && !isSaving) {
      // This effect handles user-initiated changes that need saving.
      // The main loading effect handles initial load/sync persistence.
      // This might be redundant if saveBudgetMonthsToFirestore is called directly by mutation functions.
      // For now, keeping it cautious.
      // If 'changedDuringLoad' in the main effect correctly identifies initial structural changes that need saving, this might be less critical.
    }
  }, [budgetMonths, isLoadingDb, authLoading, user, isUserAuthenticated, saveBudgetMonthsToFirestore, isSaving]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId];
    let needsStateUpdate = false;
    let finalMonthData: BudgetMonth;

    if (!monthData) {
      finalMonthData = createNewMonthBudget(yearMonthId, budgetMonths);
      needsStateUpdate = true;
    } else {
      let tempMonthData = { ...monthData, categories: [...(monthData.categories || [])] }; // Shallow copy categories for modification
      let modified = false;

      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(tempMonthData.categories);
      if (catsChanged) {
        tempMonthData.categories = updatedCategories;
        modified = true;
      }
      // Ensure other fields are initialized (though main effect should handle this)
      if (tempMonthData.incomes === undefined) { tempMonthData.incomes = []; modified = true; }
      if (tempMonthData.isRolledOver === undefined) { tempMonthData.isRolledOver = false; modified = true; }
      if (tempMonthData.startingCreditCardDebt === undefined) { tempMonthData.startingCreditCardDebt = 0; modified = true; }
      
      finalMonthData = tempMonthData;
      if (modified && JSON.stringify(monthData) !== JSON.stringify(finalMonthData)) {
        needsStateUpdate = true;
      }
    }

    if (needsStateUpdate) {
      setBudgetMonths(prev => {
        const newState = { ...prev, [yearMonthId]: finalMonthData };
        if (JSON.stringify(prev) !== JSON.stringify(newState)) {
          return newState;
        }
        return prev;
      });
    }
    return finalMonthData;
  }, [budgetMonths, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let updatedMonth = { ...monthToUpdate, categories: monthToUpdate.categories ? [...monthToUpdate.categories.map(c => ({...c, subcategories: c.subcategories ? [...c.subcategories.map(sc => ({...sc}))] : []}))] : [] }; // Deep enough copy for categories
    
    if (payload.startingCreditCardDebt !== undefined) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
    }
      
    if (payload.categories) {
      // Create a map of existing categories for quick lookup and preserving expenses/ids
      const existingCategoriesMap = new Map(updatedMonth.categories.map(c => [c.id, c]));
      const newCategoriesFromPayload: BudgetCategory[] = [];

      payload.categories.forEach(catPayload => {
        const existingCat = catPayload.id ? existingCategoriesMap.get(catPayload.id) : undefined;
        const id = catPayload.id || existingCat?.id || uuidv4();
        
        let budgetToSet = catPayload.budgetedAmount;
         if (budgetToSet === undefined) {
            budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
        }

        const existingSubcategoriesMap = new Map(existingCat?.subcategories?.map(sc => [sc.id, sc]));
        let subcategoriesToSet = (catPayload.subcategories || []).map(subCatPayload => {
            const existingSubCat = subCatPayload.id ? existingSubcategoriesMap.get(subCatPayload.id) : undefined;
            return {
              id: subCatPayload.id || existingSubCat?.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
              expenses: existingSubCat?.expenses || [], 
            };
          });

        const isPotentiallySystem = ["savings", "credit card payments"].includes(catPayload.name.toLowerCase());
        let isSysCat = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : isPotentiallySystem);
        
        if(isSysCat) subcategoriesToSet = []; // System categories don't have subs

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
    
    const { updatedCategories, wasChanged: systemFlagsChanged } = ensureSystemCategoryFlags(updatedMonth.categories);
    updatedMonth.categories = updatedCategories;

    updatedMonth.categories.forEach(cat => { // Recalculate parent budget again after flag processing
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
      let currentCat = {...cat}; // work with a copy
      if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
        if (!currentCat.isSystemCategory && currentCat.subcategories && currentCat.subcategories.length > 0) {
            console.warn(`Attempted to add expense to parent category '${currentCat.name}' which has subcategories. Expense not added.`);
            return currentCat;
        }
        currentCat.expenses = [...(currentCat.expenses || []), newExpense];
        changed = true;
        return currentCat;
      } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        currentCat.subcategories = (currentCat.subcategories || []).map(sub =>
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
      let currentCat = {...cat};
      if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
        const initialLength = (currentCat.expenses || []).length;
        currentCat.expenses = (currentCat.expenses || []).filter(exp => exp.id !== expenseId);
        if (currentCat.expenses.length !== initialLength) changed = true;
        return currentCat;
      } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        currentCat.subcategories = (currentCat.subcategories || []).map(sub => {
            if (sub.id === categoryOrSubCategoryId) {
              const initialLength = (sub.expenses || []).length;
              const newExpenses = (sub.expenses || []).filter(exp => exp.id !== expenseId);
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
      const newMonth = ensureMonthExists(targetMonthId);
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    let systemCategoriesToCarryFromSourceOrPrev: BudgetCategory[] = [];

    const referenceMonthForDebtAndSystemCats = prevMonthForTargetBudget || (sourceBudget.id === prevMonthForTargetId ? sourceBudget : null);

    if (referenceMonthForDebtAndSystemCats) { 
        const ccPaymentsCatRef = referenceMonthForDebtAndSystemCats.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        const paymentsMadeLastMonthRef = ccPaymentsCatRef ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebtForTarget = (referenceMonthForDebtAndSystemCats.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;

        const savingsCatRef = referenceMonthForDebtAndSystemCats.categories.find(cat => cat.isSystemCategory && cat.name === "Savings");
        if (savingsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...savingsCatRef, id: uuidv4(), expenses: [], subcategories: []});
        
        if (ccPaymentsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...ccPaymentsCatRef, id: uuidv4(), expenses: [], subcategories: []});
    } else {
         calculatedStartingDebtForTarget = 0; 
         const sourceSavings = sourceBudget.categories.find(c => c.isSystemCategory && c.name === "Savings");
         if(sourceSavings) systemCategoriesToCarryFromSourceOrPrev.push({...sourceSavings, id: uuidv4(), expenses: [], subcategories: []});
         
         const sourceCC = sourceBudget.categories.find(c => c.isSystemCategory && c.name === "Credit Card Payments");
         if(sourceCC) systemCategoriesToCarryFromSourceOrPrev.push({...sourceCC, id: uuidv4(), expenses: [], subcategories: []});
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
    
    let finalCategoriesForNewMonth: BudgetCategory[] = [...systemCategoriesToCarryFromSourceOrPrev, ...duplicatedUserCategories];
    const { updatedCategories } = ensureSystemCategoryFlags(finalCategoriesForNewMonth); // Ensure flags on final list

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
    
    return { success: true, message: "Month finalized and closed. Any unspent operational funds are implicitly saved." };

  }, [getBudgetForMonth, setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const existingCat = monthToUpdate.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (existingCat) {
        console.warn(`Category "${categoryName}" already exists.`);
        return;
    }

    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    const { updatedCategories: tempCatsWithNew } = ensureSystemCategoryFlags([...monthToUpdate.categories, newCategory]);
    
    const updatedMonth = { ...monthToUpdate, categories: tempCatsWithNew };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id' | 'expenses'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        
        if (cat.isSystemCategory && updatedCategoryData.name !== undefined && updatedCategoryData.name.toLowerCase() !== cat.name.toLowerCase()) {
            newName = cat.name;
        }

        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget }; // Keep existing expenses and subcategories
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories, wasChanged: flagsChanged } = ensureSystemCategoryFlags(newCategories);
      let finalCategoriesToSave = finalCategories;

      if (flagsChanged || JSON.stringify(newCategories) !== JSON.stringify(finalCategories)) { // if flags changed the structure
         finalCategoriesToSave = finalCategories.map(cat => { // Re-derive parent budgets if flags changed things
            if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
                return {...cat, budgetedAmount: cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0)};
            }
            return cat;
          });
      }
      
      const updatedMonth = { ...monthToUpdate, categories: finalCategoriesToSave };
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
    const updatedMonth = { ...monthToUpdate, categories: filteredCategories };
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
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
    ensureMonthExists, // This is used by HomePage, keep it exported
    addCategoryToMonth,
    updateCategoryInMonth,
    deleteCategoryFromMonth,
    rolloverUnspentBudget,
    addSubCategory,
    updateSubCategory,
    deleteSubCategory,
  };
};

