
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow';
import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';


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

const getPreviousMonthId = (currentMonthId: string): string => {
  const currentDate = parseYearMonth(currentMonthId);
  currentDate.setMonth(currentDate.getMonth() - 1);
  return getYearMonthFromDate(currentDate);
};

const ensureSystemCategoryFlags = (categories: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categories) {
    return { updatedCategories: [], wasChanged: false };
  }

  let wasActuallyChanged = false;
  const originalCategoriesJSON = JSON.stringify(categories); 

  let processedCategories = categories.map(cat => {
    let modifiedCat = { ...cat }; 
    modifiedCat.budgetedAmount = modifiedCat.budgetedAmount ?? 0;
    modifiedCat.expenses = Array.isArray(modifiedCat.expenses) ? modifiedCat.expenses : [];
    
    const nameLower = modifiedCat.name.toLowerCase();
    const isSavings = nameLower === "savings";
    const isCCPayments = nameLower === "credit card payments";

    if (isSavings || isCCPayments) {
      if (!modifiedCat.isSystemCategory) { modifiedCat.isSystemCategory = true; wasActuallyChanged = true; }
      if (isSavings && modifiedCat.name !== "Savings") { modifiedCat.name = "Savings"; wasActuallyChanged = true; }
      if (isCCPayments && modifiedCat.name !== "Credit Card Payments") { modifiedCat.name = "Credit Card Payments"; wasActuallyChanged = true; }
      if (modifiedCat.subcategories && modifiedCat.subcategories.length > 0) { modifiedCat.subcategories = []; wasActuallyChanged = true;}
    } else { 
      if (modifiedCat.isSystemCategory) { modifiedCat.isSystemCategory = false; wasActuallyChanged = true; }
      modifiedCat.subcategories = Array.isArray(modifiedCat.subcategories) ? modifiedCat.subcategories.map(sub => {
        let subModified = false;
        let newSub = {...sub};
        if(newSub.budgetedAmount === undefined) { newSub.budgetedAmount = 0; subModified = true; }
        if(!Array.isArray(newSub.expenses)) { newSub.expenses = []; subModified = true; }
        if(subModified) wasActuallyChanged = true;
        return newSub;
      }) : [];
    }
    return modifiedCat;
  });
  
  const sortedCategories = [...processedCategories].sort((a, b) => {
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

  if (JSON.stringify(sortedCategories) !== originalCategoriesJSON) {
    wasActuallyChanged = true;
  }
  
  return { updatedCategories: wasActuallyChanged ? sortedCategories : categories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonthsState, setBudgetMonthsState] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
     if (typeof window !== "undefined") {
      const key = getDisplayMonthKey(user?.uid); // user might be null initially
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) return storedMonthId;
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // June 2025
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSavingDb, setIsSavingDb] = useState(false); 
  
  const localSaveDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneForUserRef = useRef<Record<string, boolean>>({});


  useEffect(() => {
    // Effect to persist currentDisplayMonthId to localStorage when it changes or when user logs in/out
    if (typeof window !== "undefined" && !authLoading) { 
      const key = getDisplayMonthKey(user?.uid);
      localStorage.setItem(key, currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, user, authLoading]);

  useEffect(() => {
    // Effect to load currentDisplayMonthId from localStorage on initial auth state change
    if (typeof window !== "undefined" && !authLoading) {
      const key = getDisplayMonthKey(user?.uid);
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId && storedMonthId !== currentDisplayMonthId) {
         setCurrentDisplayMonthIdState(storedMonthId);
      } else if (!storedMonthId) {
        // If nothing stored for this user/guest, ensure default is set
        const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
        if (defaultMonth !== currentDisplayMonthId) {
            setCurrentDisplayMonthIdState(defaultMonth);
        }
        localStorage.setItem(key, defaultMonth);
      }
    }
  }, [user, authLoading, currentDisplayMonthId]); // currentDisplayMonthId added to ensure consistency if default changes


  useEffect(() => {
    // Reset initial load tracker when authentication status changes (e.g., user logs in or out)
    initialLoadDoneForUserRef.current = {};
  }, [isUserAuthenticated]);


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId || isSavingDb) return; 
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSavingDb(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      let hasMeaningfulDataToSave = false;
      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories);
        monthsWithEnsuredCategories[monthId] = { 
            ...month, 
            categories: updatedCategories, 
            incomes: month.incomes || [],
            startingCreditCardDebt: month.startingCreditCardDebt || 0,
            isRolledOver: month.isRolledOver || false,
        };
        if ((month.categories && month.categories.length > 0) || (month.incomes && month.incomes.length > 0) || month.startingCreditCardDebt || month.isRolledOver) {
            hasMeaningfulDataToSave = true;
        }
      }
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length > 0) { // Save even if it's an empty structure for a user
          await setDoc(docRef, { months: monthsWithEnsuredCategories }); 
      }
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSavingDb(false);
    }
  }, [isSavingDb]); 

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(prevMonths => {
        const newMonths = typeof updater === 'function' ? updater(prevMonths) : updater;
        
        if (localSaveDebounceTimeoutRef.current) {
            clearTimeout(localSaveDebounceTimeoutRef.current);
        }
        localSaveDebounceTimeoutRef.current = setTimeout(() => {
            if (isUserAuthenticated && user) {
                saveBudgetMonthsToFirestore(user.uid, newMonths);
            } else if (!isUserAuthenticated && typeof window !== "undefined") {
                localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(newMonths));
            }
        }, 750); 
        
        return newMonths;
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    // Persistence to localStorage is handled by the separate useEffect hook
  }, []); 

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];
    
    let calculatedStartingDebt = 0;
    let systemCategoriesToCarry: BudgetCategory[] = [];

    if (prevMonthBudget) {
        (prevMonthBudget.categories || []).forEach(prevCat => {
            if (prevCat.isSystemCategory && (prevCat.name === "Savings" || prevCat.name === "Credit Card Payments")) {
                systemCategoriesToCarry.push({
                    id: uuidv4(), 
                    name: prevCat.name,
                    budgetedAmount: prevCat.budgetedAmount, 
                    expenses: [],
                    subcategories: [], 
                    isSystemCategory: true,
                });
            }
        });
        
        const prevCCPaymentsCat = (prevMonthBudget.categories || []).find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            const paymentsMadeLastMonth = (prevCCPaymentsCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
        } else {
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0;
        }
    } else {
        // If no previous month, create default system categories (Savings and CC Payments with 0 budget)
        // These will be properly flagged by ensureSystemCategoryFlags if needed
        systemCategoriesToCarry.push({ id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
        systemCategoriesToCarry.push({ id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    // ensureSystemCategoryFlags will process systemCategoriesToCarry if needed
    // Here, we just pass them along; processAndSetBudgetData will handle the definitive flagging.
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: systemCategoriesToCarry, 
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []); 


  const processAndSetBudgetData = useCallback((rawMonths: Record<string, BudgetMonth>) => {
    let processedMonths = JSON.parse(JSON.stringify(rawMonths)); // Deep clone to avoid mutating original
    let wasAnyDataStructurallyModified = false;

    // Ensure currentDisplayMonthId exists in processedMonths
    if (!processedMonths[currentDisplayMonthId]) {
        processedMonths[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedMonths);
        wasAnyDataStructurallyModified = true;
    }

    // Ensure all months have correct structure (system flags, default arrays, etc.)
    Object.keys(processedMonths).forEach(monthId => {
      const month = processedMonths[monthId]; // Direct reference for modification
      let monthChangedDuringProcessing = false;
      
      if (!Array.isArray(month.incomes)) {
        month.incomes = [];
        monthChangedDuringProcessing = true;
      }
      if (!Array.isArray(month.categories)) {
        month.categories = [];
        monthChangedDuringProcessing = true;
      }
      
      const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(month.categories);
      if (catsStructurallyChanged) {
        month.categories = updatedCategories;
        monthChangedDuringProcessing = true;
      }
      
      if (month.isRolledOver === undefined) {
        month.isRolledOver = false;
        monthChangedDuringProcessing = true;
      }
      if (month.startingCreditCardDebt === undefined) {
        month.startingCreditCardDebt = 0;
        monthChangedDuringProcessing = true;
      }

      if (monthChangedDuringProcessing) {
        wasAnyDataStructurallyModified = true; // Flag if any month was structurally modified
      }
    });
    
    const currentMonthsJSON = JSON.stringify(budgetMonthsState);
    const newProcessedMonthsJSON = JSON.stringify(processedMonths);

    if (currentMonthsJSON !== newProcessedMonthsJSON) {
        setBudgetMonths(processedMonths);
    }
  }, [currentDisplayMonthId, createNewMonthBudget, ensureSystemCategoryFlags, budgetMonthsState, setBudgetMonths]);


 useEffect(() => {
    // Effect to load budget data from Firestore or localStorage
    if (authLoading) {
      setIsLoadingDb(true);
      return;
    }

    const currentUserKey = user?.uid || 'guest';
    const isInitialLoadForThisKey = !initialLoadDoneForUserRef.current[currentUserKey];

    if (isInitialLoadForThisKey) {
      setIsLoadingDb(true); 
    }

    let unsubscribe = () => {};

    if (isUserAuthenticated && user) {
      const docRef = getFirestoreUserBudgetDocRef(user.uid);
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        let firestoreMonths: Record<string, BudgetMonth> = {};
        if (docSnap.exists()) {
          const data = docSnap.data() as { months: Record<string, BudgetMonth> };
          firestoreMonths = data.months || {};
        }
        processAndSetBudgetData(firestoreMonths);
        
        if (isInitialLoadForThisKey) {
          initialLoadDoneForUserRef.current[user.uid] = true;
        }
        setIsLoadingDb(false); 
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        processAndSetBudgetData({});
        if (isInitialLoadForThisKey) {
          initialLoadDoneForUserRef.current[user.uid!] = true; // Use user.uid as it exists here
        }
        setIsLoadingDb(false);
      });
    } else if (typeof window !== "undefined") {
      // Guest user
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let guestMonths: Record<string, BudgetMonth> = {};
      if (localData) {
        try {
          guestMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
        } catch (e) {
          console.error("Error parsing guest budget data:", e);
          localStorage.removeItem(GUEST_BUDGET_MONTHS_KEY);
        }
      }
      processAndSetBudgetData(guestMonths);
      
      if (isInitialLoadForThisKey) {
        initialLoadDoneForUserRef.current['guest'] = true;
      }
      setIsLoadingDb(false); 
    } else {
      // Fallback (SSR or no window)
      processAndSetBudgetData({});
      if (isInitialLoadForThisKey) {
        initialLoadDoneForUserRef.current['guest'] = true;
      }
      setIsLoadingDb(false);
    }

    return () => {
      unsubscribe();
      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current);
      }
    };
  }, [user, isUserAuthenticated, authLoading, processAndSetBudgetData]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    // This function's primary goal is to return a valid month structure.
    // The main loading effect and processAndSetBudgetData handle the actual state setting.
    // It can be simplified if we rely on processAndSetBudgetData to always populate currentDisplayMonthId.
    if (budgetMonthsState[yearMonthId]) {
        // Perform a quick check and structural update if needed, but don't trigger full setBudgetMonths from here.
        const month = { ...budgetMonthsState[yearMonthId] };
        let changed = false;
        if (!Array.isArray(month.incomes)) { month.incomes = []; changed = true; }
        if (!Array.isArray(month.categories)) { month.categories = []; changed = true; }
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories);
        if (catsChanged) { month.categories = updatedCategories; changed = true; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; changed = true; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; changed = true; }
        
        // If changed, this month in budgetMonthsState might be stale.
        // The processAndSetBudgetData should eventually correct it.
        // For immediate use, return the corrected structure.
        return changed ? month : budgetMonthsState[yearMonthId];
    }
    // If month does not exist, create it conceptually.
    // The main data loading useEffect -> processAndSetBudgetData is responsible for actually adding it to state.
    return createNewMonthBudget(yearMonthId, budgetMonthsState);
  }, [budgetMonthsState, createNewMonthBudget, ensureSystemCategoryFlags, currentDisplayMonthId]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); // Gets a potentially corrected structure
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    let updatedMonth = JSON.parse(JSON.stringify(monthToUpdate)); // Deep clone for modification
    let changed = false;
    
    if (payload.startingCreditCardDebt !== undefined && updatedMonth.startingCreditCardDebt !== payload.startingCreditCardDebt) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
        changed = true;
    }
      
    if (payload.categories) {
      const existingCategoriesMap = new Map((updatedMonth.categories || []).map((c: BudgetCategory) => [c.id, c]));
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
      changed = true; 
    }
    
    const { updatedCategories, wasChanged: sysFlagsChanged } = ensureSystemCategoryFlags(updatedMonth.categories);
    if (sysFlagsChanged) { // if ensureSystemCategoryFlags made a change, reflect it
        updatedMonth.categories = updatedCategories;
        changed = true;
    }

    (updatedMonth.categories || []).forEach((cat: BudgetCategory) => { 
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            const newParentBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            if (cat.budgetedAmount !== newParentBudget) {
                cat.budgetedAmount = newParentBudget;
                changed = true;
            }
        }
    });

    if (changed || JSON.stringify(budgetMonthsState[yearMonthId]) !== JSON.stringify(updatedMonth)) {
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, budgetMonthsState, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return; 

    const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
    let changed = false;
    
    const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;
    let changed = false;

    const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user]);

  const navigateToPreviousMonth = useCallback(() => {
    setCurrentDisplayMonthId(getPreviousMonthId(currentDisplayMonthId));
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    setCurrentDisplayMonthId(getYearMonthFromDate(currentDate));
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId);
    if (!monthBudget) {
      return { success: false, message: `Budget for ${yearMonthId} not found.` };
    }

    const newRolloverState = !monthBudget.isRolledOver;
    const updatedMonth = { ...monthBudget, isRolledOver: newRolloverState };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));

    if (newRolloverState) { 
        return { success: true, message: "Month finalized and closed." };
    } else { 
        return { success: true, message: "Month reopened for editing." };
    }
  }, [getBudgetForMonth, setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    const existingCat = (monthToUpdate.categories || []).find(c => c.name.toLowerCase() === categoryName.toLowerCase());
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
    
    let tempCatsWithNew = [...(monthToUpdate.categories || []), newCategory];
    const { updatedCategories: finalCatsWithNew } = ensureSystemCategoryFlags(tempCatsWithNew);
        
    const updatedMonth = { ...monthToUpdate, categories: finalCatsWithNew };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id' | 'expenses'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    let categoryUpdated = false;
    let newCategories = (monthToUpdate.categories || []).map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        
        const isSavingsByName = newName.toLowerCase() === "savings";
        const isCCPaymentsByName = newName.toLowerCase() === "credit card payments";
        let newIsSystem = cat.isSystemCategory; 

        if (isSavingsByName) { newName = "Savings"; newIsSystem = true; }
        else if (isCCPaymentsByName) { newName = "Credit Card Payments"; newIsSystem = true; }
        else if (newIsSystem && !isSavingsByName && !isCCPaymentsByName) { 
            // Trying to rename a system category to a non-system name - prevent this if it was originally system
            // Or allow, but ensure isSystem is false. For now, let's assume if it's system, it stays system (or is Savings/CC)
             newName = cat.name; // Keep original system name if it's not becoming Savings/CC
        }

        if (newIsSystem) { 
            // System cats don't have subs, their budget is directly editable
        } else if (cat.subcategories && cat.subcategories.length > 0) { 
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(newCategories);
      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
       if (JSON.stringify(budgetMonthsState[yearMonthId]?.categories) !== JSON.stringify(updatedMonth.categories)) {
            setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
       }
    }
  }, [ensureMonthExists, budgetMonthsState, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    const categoryToDelete = (monthToUpdate.categories || []).find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = (monthToUpdate.categories || []).filter(cat => cat.id !== categoryId);
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(filteredCategories);
    const updatedMonth = { ...monthToUpdate, categories: finalCategories };

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    let parentCat = (monthToUpdate.categories || []).find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return; 

    const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
    let changed = false;
    
    const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    const parentCat = (monthToUpdate.categories || []).find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;
    let changed = false;

    const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated && user) return;

    const parentCat = (monthToUpdate.categories || []).find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;
    let changed = false;

    const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated, user, ensureSystemCategoryFlags]);
  
  const applyAiGeneratedBudget = useCallback(
    (
      targetMonthId: string, 
      suggestedBudgetCategories: PrepareBudgetOutput['suggestedCategories'],
      incomeForTargetMonth: number,
      startingCCDebtForCurrentMonth: number,
      ccPaymentsMadeInCurrentMonth: number
    ) => {
      const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
      const newStartingCCDebtForTarget = Math.max(0, startingCCDebtForCurrentMonth - ccPaymentsMadeInCurrentMonth);

      const newCategories: BudgetCategory[] = (suggestedBudgetCategories || []).map(sCat => {
        const isSavings = sCat.name.toLowerCase() === 'savings';
        const isCC = sCat.name.toLowerCase() === 'credit card payments';
        const isSystem = isSavings || isCC;
        
        let finalBudgetedAmount = sCat.budgetedAmount || 0;
        const subcategories = (sCat.subcategories || []).map(sSub => ({
          id: uuidv4(),
          name: sSub.name,
          budgetedAmount: sSub.budgetedAmount || 0,
          expenses: [],
        }));

        if (!isSystem && subcategories.length > 0) {
          finalBudgetedAmount = subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
        }
        
        return {
          id: uuidv4(),
          name: isSavings ? "Savings" : isCC ? "Credit Card Payments" : sCat.name,
          budgetedAmount: finalBudgetedAmount,
          expenses: [],
          subcategories: isSystem ? [] : subcategories,
          isSystemCategory: isSystem,
        };
      });

      // Ensure system categories exist if AI didn't suggest them explicitly
      if (!newCategories.find(c => c.name === "Savings")) {
        newCategories.push({ id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
      }
      if (!newCategories.find(c => c.name === "Credit Card Payments")) {
        newCategories.push({ id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
      }
      
      const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(newCategories);

      const newMonthBudget: BudgetMonth = {
        id: targetMonthId,
        year: targetYear,
        month: targetMonthNum,
        incomes: [{ id: uuidv4(), description: "Projected Income", amount: incomeForTargetMonth, dateAdded: new Date().toISOString() }],
        categories: finalProcessedCategories,
        isRolledOver: false,
        startingCreditCardDebt: newStartingCCDebtForTarget,
      };

      setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonthBudget }));
    }, [setBudgetMonths, ensureSystemCategoryFlags] 
  );


  return {
    budgetMonths: budgetMonthsState,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoadingDb || authLoading || isSavingDb,
    getBudgetForMonth,
    updateMonthBudget,
    addExpense,
    deleteExpense,
    addIncome,
    deleteIncome,
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
    applyAiGeneratedBudget, 
  };
};

    
