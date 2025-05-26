
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

// Ensures system categories ("Savings", "Credit Card Payments") are correctly flagged and named if they exist.
// It does NOT create them if they are absent.
// Returns { updatedCategories: BudgetCategory[], wasChanged: boolean }
const ensureSystemCategoryFlags = (categories: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categories) {
    return { updatedCategories: [], wasChanged: false };
  }

  let wasActuallyChanged = false;
  const originalCategoriesJSON = JSON.stringify(categories);

  let processedCategories = categories.map(cat => {
    const originalCatJSON = JSON.stringify(cat);
    let modifiedCat = { ...cat };

    // Ensure basic structure
    modifiedCat.budgetedAmount = modifiedCat.budgetedAmount ?? 0;
    modifiedCat.expenses = Array.isArray(modifiedCat.expenses) ? modifiedCat.expenses : [];
    
    const isSavings = modifiedCat.name.toLowerCase() === "savings";
    const isCCPayments = modifiedCat.name.toLowerCase() === "credit card payments";

    if (isSavings || isCCPayments) {
      if (!modifiedCat.isSystemCategory) {
        modifiedCat.isSystemCategory = true;
        wasActuallyChanged = true;
      }
      if (isSavings && modifiedCat.name !== "Savings") {
        modifiedCat.name = "Savings";
        wasActuallyChanged = true;
      }
      if (isCCPayments && modifiedCat.name !== "Credit Card Payments") {
        modifiedCat.name = "Credit Card Payments";
        wasActuallyChanged = true;
      }
      // System categories cannot have subcategories
      if (modifiedCat.subcategories && modifiedCat.subcategories.length > 0) {
        modifiedCat.subcategories = [];
        wasActuallyChanged = true;
      }
    } else { // Non-system category
      if (modifiedCat.isSystemCategory) { // Was incorrectly flagged as system
        modifiedCat.isSystemCategory = false;
        wasActuallyChanged = true;
      }
      modifiedCat.subcategories = Array.isArray(modifiedCat.subcategories) ? modifiedCat.subcategories : [];
      (modifiedCat.subcategories || []).forEach(sub => {
        sub.budgetedAmount = sub.budgetedAmount ?? 0;
        sub.expenses = Array.isArray(sub.expenses) ? sub.expenses : [];
      });
    }
    if(JSON.stringify(modifiedCat) !== originalCatJSON && !wasActuallyChanged) {
        // This condition implies a structural change like initializing an array,
        // which should also be considered a change for saving purposes.
        wasActuallyChanged = true;
    }
    return modifiedCat;
  });

  // Sort: System categories first, then others alphabetically
  processedCategories.sort((a, b) => {
    if (a.isSystemCategory && !b.isSystemCategory) return -1;
    if (!a.isSystemCategory && b.isSystemCategory) return 1;
    if (a.isSystemCategory && b.isSystemCategory) {
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1;
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  if (JSON.stringify(processedCategories) !== originalCategoriesJSON) {
    wasActuallyChanged = true;
  }

  return { updatedCategories: processedCategories, wasChanged: wasActuallyChanged };
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
      // Defer reading from localStorage until after mount to avoid hydration issues.
      // Set a default, and let useEffect handle the actual localStorage read.
      return getYearMonthFromDate(new Date(2025, 5, 1)); // Default June 2025
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default for SSR
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSaving, setIsSaving] = useState(false); // Tracks if a save operation is in progress

  // Effect for initializing currentDisplayMonthId from localStorage
  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { // Ensure this runs only client-side and after auth state is known
      const key = getDisplayMonthKey(user?.uid);
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) {
        setCurrentDisplayMonthIdState(storedMonthId);
      } else {
        const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
        setCurrentDisplayMonthIdState(defaultMonth);
        localStorage.setItem(key, defaultMonth);
      }
    }
  }, [user, authLoading]);


  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(prevMonths => {
        const newMonths = typeof updater === 'function' ? updater(prevMonths) : updater;
        if (isUserAuthenticated && user && !isSaving) {
            saveBudgetMonthsToFirestore(user.uid, newMonths);
        } else if (!isUserAuthenticated && typeof window !== "undefined" && !isSaving) {
            localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(newMonths));
        }
        return newMonths;
    });
  }, [isUserAuthenticated, user, isSaving]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    if (!authLoading && typeof window !== "undefined") {
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
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories);
        monthsWithEnsuredCategories[monthId] = { ...month, categories: updatedCategories, incomes: month.incomes || [] };
      }
      // Only save if there's actual data to save to prevent overwriting with empty object on initial load for new user
      if (Object.keys(monthsWithEnsuredCategories).length > 0 || Object.keys(budgetMonths).length > 0) {
          await setDoc(docRef, { months: monthsWithEnsuredCategories }, { merge: true });
      }
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSaving(false);
    }
  }, [budgetMonths]); // Added budgetMonths dependency

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    
    let calculatedStartingDebt = 0;
    let systemCategoriesToCarry: BudgetCategory[] = [];

    if (prevMonthBudget) {
        prevMonthBudget.categories.forEach(prevCat => {
            if (prevCat.isSystemCategory && (prevCat.name === "Savings" || prevCat.name === "Credit Card Payments")) {
                systemCategoriesToCarry.push({
                    id: uuidv4(),
                    name: prevCat.name,
                    budgetedAmount: prevCat.budgetedAmount, // Carry over budget
                    expenses: [],
                    subcategories: [],
                    isSystemCategory: true,
                });
            }
        });
        
        const prevCCPaymentsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
        } else {
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0;
        }
    } else { // No previous month, so ensure system cats are at least considered if added manually or by AI later
        // This part is tricky; ensureSystemCategoryFlags will handle their properties if they get added.
        // For a truly new budget, we start with no categories.
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(systemCategoriesToCarry);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: finalCategories, // Start with carried system cats or empty if no prev month with them
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
    let localProcessingTimeout: NodeJS.Timeout | null = null;

    const processAndUpdateState = (newRawMonths: Record<string, BudgetMonth>, source: 'firestore' | 'guest_init' | 'guest_storage') => {
        if (localProcessingTimeout) clearTimeout(localProcessingTimeout);

        localProcessingTimeout = setTimeout(() => {
            let processedMonths = { ...newRawMonths };
            let wasAnyDataStructurallyModified = false;

            Object.keys(processedMonths).forEach(monthId => {
                const monthData = { ...processedMonths[monthId] };
                let monthModified = false;

                monthData.incomes = Array.isArray(monthData.incomes) ? monthData.incomes : [];
                
                const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
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
                const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
                if (currentMonthCatsChanged) {
                    currentMonth.categories = ensuredCurrentMonthCategories;
                    processedMonths[currentDisplayMonthId] = currentMonth;
                    wasAnyDataStructurallyModified = true;
                }
            }
            
            const finalProcessedMonths = processedMonths;

            setBudgetMonthsState(prevMonths => {
                 if (JSON.stringify(prevMonths) !== JSON.stringify(finalProcessedMonths)) {
                    if (isUserAuthenticated && user && source === 'firestore' && wasAnyDataStructurallyModified && !isSaving) {
                         saveBudgetMonthsToFirestore(user.uid, finalProcessedMonths);
                    } else if (!isUserAuthenticated && typeof window !== "undefined" && wasAnyDataStructurallyModified && !isSaving) {
                        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(finalProcessedMonths));
                    }
                    return finalProcessedMonths;
                }
                return prevMonths;
            });
            
            setIsLoadingDb(false);
        }, 150); // Slightly increased debounce
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
    } else if (typeof window !== "undefined") { // Guest mode, only run on client
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let guestMonths: Record<string, BudgetMonth> = {};
      if (localData) {
        try {
          guestMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
        } catch (e) { console.error("Error parsing guest budget data", e); }
      }
      processAndUpdateState(guestMonths, localData ? 'guest_storage' : 'guest_init');
    } else { // SSR for guest or initial load before client-side localStorage access
        processAndUpdateState({}, 'guest_init');
    }
    return () => {
        unsubscribe();
        if (localProcessingTimeout) clearTimeout(localProcessingTimeout);
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore, isSaving]); // Added isSaving


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
      let tempMonthData = JSON.parse(JSON.stringify(monthData)); 
      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(tempMonthData.categories);
      
      if (catsChanged) tempMonthData.categories = updatedCategories;
      tempMonthData.incomes = Array.isArray(tempMonthData.incomes) ? tempMonthData.incomes : [];
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
    if (monthToUpdate.isRolledOver) return; // Don't update if month is closed

    let updatedMonth = JSON.parse(JSON.stringify(monthToUpdate));
    
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
        
        const isSavingsByName = catPayload.name.toLowerCase() === "savings";
        const isCCPaymentsByName = catPayload.name.toLowerCase() === "credit card payments";
        let isSysCat = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : (isSavingsByName || isCCPaymentsByName));
        
        let finalName = catPayload.name;
        if(isSavingsByName) { finalName = "Savings"; isSysCat = true; }
        if(isCCPaymentsByName) { finalName = "Credit Card Payments"; isSysCat = true; }

        if(isSysCat) subcategoriesToSet = []; 

        if (!isSysCat && subcategoriesToSet.length > 0) {
             budgetToSet = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        newCategoriesFromPayload.push({
          id: id,
          name: finalName,
          budgetedAmount: budgetToSet,
          expenses: existingCat?.expenses || [], 
          subcategories: subcategoriesToSet,
          isSystemCategory: isSysCat,
        });
      });
      updatedMonth.categories = newCategoriesFromPayload;
    }
    
    const { updatedCategories } = ensureSystemCategoryFlags(updatedMonth.categories);
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
      ensureMonthExists(targetMonthId); 
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    
    const systemCategoriesToCarry: BudgetCategory[] = [];
    const referenceMonthForSystemCats = prevMonthForTargetBudget || (sourceBudget.id === prevMonthForTargetId ? sourceBudget : sourceBudget);

    referenceMonthForSystemCats.categories.forEach(refCat => {
      if (refCat.isSystemCategory && (refCat.name === "Savings" || refCat.name === "Credit Card Payments")) {
        systemCategoriesToCarry.push({
          id: uuidv4(),
          name: refCat.name,
          budgetedAmount: refCat.budgetedAmount, // Carry over budget from reference month
          expenses: [],
          subcategories: [],
          isSystemCategory: true,
        });
      }
    });
     // If reference month didn't have one of the system cats, ensure they are added if they were in source (unlikely if sys cats are managed well)
    (["Savings", "Credit Card Payments"] as const).forEach(sysCatName => {
        if (!systemCategoriesToCarry.find(sc => sc.name === sysCatName)) {
            const sourceSysCat = sourceBudget.categories.find(c => c.isSystemCategory && c.name === sysCatName);
            if (sourceSysCat) {
                 systemCategoriesToCarry.push({
                    id: uuidv4(), name: sourceSysCat.name, budgetedAmount: sourceSysCat.budgetedAmount, expenses: [], subcategories: [], isSystemCategory: true,
                });
            }
        }
    });


    if (prevMonthForTargetBudget) { 
        const ccPaymentsCatRef = prevMonthForTargetBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        const paymentsMadeLastMonthRef = ccPaymentsCatRef ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebtForTarget = (prevMonthForTargetBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;
    } else if (sourceBudget.id === prevMonthForTargetId) { 
        const ccPaymentsCatRef = sourceBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        const paymentsMadeLastMonthRef = ccPaymentsCatRef ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebtForTarget = (sourceBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;
    } else { 
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

    const newRolloverState = !monthBudget.isRolledOver;
    const updatedMonth = { ...monthBudget, isRolledOver: newRolloverState };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));

    if (newRolloverState) { // Just closed
        return { success: true, message: "Month finalized and closed." };
    } else { // Just reopened
        return { success: true, message: "Month reopened for editing." };
    }
  }, [getBudgetForMonth, setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    if (monthToUpdate.isRolledOver) return;

    const existingCat = monthToUpdate.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (existingCat) {
        console.warn(`Category "${categoryName}" already exists.`);
        return;
    }
    
    const isSavingsByName = categoryName.toLowerCase() === "savings";
    const isCCPaymentsByName = categoryName.toLowerCase() === "credit card payments";
    let isSysCat = isSavingsByName || isCCPaymentsByName;
    let finalName = categoryName;
    if (isSavingsByName) finalName = "Savings";
    if (isCCPaymentsByName) finalName = "Credit Card Payments";

    const newCategory: BudgetCategory = {
      id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [], 
      isSystemCategory: isSysCat, 
    };
    
    const { updatedCategories: tempCatsWithNew } = ensureSystemCategoryFlags([...monthToUpdate.categories, newCategory]);
    
    const updatedMonth = { ...monthToUpdate, categories: tempCatsWithNew };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'id' | 'expenses'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;

    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        let newIsSystem = updatedCategoryData.isSystemCategory !== undefined ? updatedCategoryData.isSystemCategory : cat.isSystemCategory;
        
        const isSavingsByName = newName.toLowerCase() === "savings";
        const isCCPaymentsByName = newName.toLowerCase() === "credit card payments";

        if (isSavingsByName) { newName = "Savings"; newIsSystem = true; }
        if (isCCPaymentsByName) { newName = "Credit Card Payments"; newIsSystem = true; }

        if (cat.isSystemCategory && newName !== cat.name) { // Prevent renaming system categories to non-system names
            newName = cat.name; // Revert to original system name
            newIsSystem = true;
        }
        
        if (newIsSystem) { 
           // Budget is editable directly for system categories
        } else if (cat.subcategories && cat.subcategories.length > 0) { // Non-system with subs
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(newCategories);
      
      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
       if (JSON.stringify(budgetMonths[yearMonthId]?.categories) !== JSON.stringify(updatedMonth.categories)) {
            setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
       }
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;

    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(filteredCategories);
    const updatedMonth = { ...monthToUpdate, categories: finalCategories };

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver) return;

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
        const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(updatedCategoriesList);
        const updatedMonth = { ...monthToUpdate, categories: finalCategories };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver) return;

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
        const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(updatedCategoriesList);
        const updatedMonth = { ...monthToUpdate, categories: finalCategories };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver) return;

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
        const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(updatedCategoriesList);
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
