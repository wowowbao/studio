
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow';
import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';
import { useToast } from "@/hooks/use-toast";

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

const GUEST_BUDGET_MONTHS_KEY = 'budgetFlow_guestBudgetMonths';
const getFirestoreUserBudgetDocRef = (userId: string) => doc(db, 'userBudgets', userId);

const getDisplayMonthKey = (userId?: string | null) => {
  return userId ? `budgetFlow_displayMonth_${userId}` : 'budgetFlow_displayMonth_guest';
};

// This function is a utility and should NOT use any React hooks.
// It returns the original categories array reference if no logical change was made.
const ensureSystemCategoryFlags = (categoriesInput: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categoriesInput) {
    return { updatedCategories: [], wasChanged: false };
  }

  let processedCategories = JSON.parse(JSON.stringify(categoriesInput)) as BudgetCategory[];
  let wasActuallyChangedOverall = false; // This flag tracks if any *logical* change was made

  const systemCategoryNames = ["Savings", "Credit Card Payments"];

  systemCategoryNames.forEach(sysName => {
    let designatedSystemCategoryIndex = -1;
    let categoryDataModifiedThisPass = false;

    // Pass 1: Find an *already explicitly flagged* system category for this name.
    for (let i = 0; i < processedCategories.length; i++) {
      if (processedCategories[i].isSystemCategory === true && processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
        designatedSystemCategoryIndex = i;
        break;
      }
    }

    // Pass 2: If no explicitly flagged one, find the first category matching the name and designate it.
    if (designatedSystemCategoryIndex === -1) {
      for (let i = 0; i < processedCategories.length; i++) {
        if (processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
          designatedSystemCategoryIndex = i;
          // Only mark as changed if the flag was actually different
          if (processedCategories[i].isSystemCategory !== true) {
            processedCategories[i].isSystemCategory = true;
            categoryDataModifiedThisPass = true;
          }
          break;
        }
      }
    }
    
    // Pass 3: Standardize the designated system category (if found) and ensure all others with the same name are NOT system.
    if (designatedSystemCategoryIndex !== -1) {
      const systemCat = processedCategories[designatedSystemCategoryIndex];
      
      if (systemCat.isSystemCategory !== true) {
          systemCat.isSystemCategory = true;
          categoryDataModifiedThisPass = true;
      }
      if (systemCat.name !== sysName) { // Standardize name
        systemCat.name = sysName;
        categoryDataModifiedThisPass = true;
      }
      if (systemCat.subcategories && systemCat.subcategories.length > 0) { // System cats don't have subs
        systemCat.subcategories = [];
        categoryDataModifiedThisPass = true;
      }
      if (systemCat.budgetedAmount === undefined || systemCat.budgetedAmount === null) {
        systemCat.budgetedAmount = 0; 
        categoryDataModifiedThisPass = true;
      }
      if (!Array.isArray(systemCat.expenses)) {
        systemCat.expenses = [];
        categoryDataModifiedThisPass = true;
      }
      
      for (let i = 0; i < processedCategories.length; i++) {
        if (i !== designatedSystemCategoryIndex && processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
          if (processedCategories[i].isSystemCategory !== false) {
            processedCategories[i].isSystemCategory = false;
            categoryDataModifiedThisPass = true;
          }
        }
      }
    }
    if (categoryDataModifiedThisPass) wasActuallyChangedOverall = true;
  });

  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat }; 
    let categorySpecificChange = false;
    const isSystemNameMatch = systemCategoryNames.some(sysName => sysName.toLowerCase() === currentCat.name.toLowerCase());

    if (!isSystemNameMatch && currentCat.isSystemCategory === true) {
        currentCat.isSystemCategory = false;
        categorySpecificChange = true;
    }
    
    if (currentCat.isSystemCategory === false || currentCat.isSystemCategory === undefined) {
      if (currentCat.budgetedAmount === undefined || currentCat.budgetedAmount === null) {
        currentCat.budgetedAmount = 0;
        categorySpecificChange = true;
      }
      if (!Array.isArray(currentCat.expenses)) {
        currentCat.expenses = [];
        categorySpecificChange = true;
      }
      
      if (currentCat.subcategories === undefined) { 
        currentCat.subcategories = [];
        categorySpecificChange = true;
      } else if (!Array.isArray(currentCat.subcategories)) {
         currentCat.subcategories = [];
         categorySpecificChange = true;
      }

      if (Array.isArray(currentCat.subcategories)) {
        let subsChangedOrRecalculated = false;
        currentCat.subcategories = currentCat.subcategories.map(sub => {
          let currentSub = { ...sub };
          let subModifiedInternal = false;
          if (currentSub.budgetedAmount === undefined || currentSub.budgetedAmount === null) { currentSub.budgetedAmount = 0; subModifiedInternal = true; }
          if (!Array.isArray(currentSub.expenses)) { currentSub.expenses = []; subModifiedInternal = true; }
          if (subModifiedInternal) subsChangedOrRecalculated = true;
          return currentSub;
        });

        if (currentCat.subcategories.length > 0) {
            const newParentBudget = currentCat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            if (currentCat.budgetedAmount !== newParentBudget) {
                currentCat.budgetedAmount = newParentBudget;
                categorySpecificChange = true;
            }
        }
        if (subsChangedOrRecalculated) categorySpecificChange = true;
      }
    }

    if (categorySpecificChange) {
      wasActuallyChangedOverall = true;
    }
    return currentCat;
  });

  const sortedCategories = [...processedCategories].sort((a, b) => {
    const aIsSystem = a.isSystemCategory || false;
    const bIsSystem = b.isSystemCategory || false;
    if (aIsSystem && !bIsSystem) return -1;
    if (!bIsSystem && bIsSystem) return 1;
    if (aIsSystem && bIsSystem) { 
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1; 
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  // `wasActuallyChangedOverall` is now determined by actual data modifications, not by comparing to the original input string.
  // The sorting step ensures a canonical form. If the sorted form is different from the processed form (before sort),
  // and no logical changes occurred, it means the input was just unsorted.
  // We only consider it a "change" for React state if a logical modification occurred.
  // However, to ensure consistent state for comparison, always return the sorted version.
  // The `wasChanged` flag is true if any logical field was modified or if the initial structure was incomplete.

  // If the content of sortedCategories is different from categoriesInput even after sorting categoriesInput
  // it means a logical change happened (or initial structure was incomplete).
  // A more robust check would be to sort a deep clone of categoriesInput and compare.
  // For now, rely on the internally tracked `wasActuallyChangedOverall`.
  // If `wasActuallyChangedOverall` is true, or if the structure of `sortedCategories` differs from `categoriesInput`
  // in a way that stringify would show (even if just order of items), then `wasChanged` should reflect that.
  // The key is that `wasActuallyChangedOverall` is the primary driver for logical changes.
  // We also need to consider if the input was already sorted. If not, sorting itself is a "change" in representation.

  const initialCategoriesString = JSON.stringify((categoriesInput || []).sort((a, b) => {
    const aIsSystem = a.isSystemCategory || false;
    const bIsSystem = b.isSystemCategory || false;
    if (aIsSystem && !bIsSystem) return -1;
    if (!bIsSystem && bIsSystem) return 1;
    if (aIsSystem && bIsSystem) { 
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1; 
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  }));

  const finalCategoriesString = JSON.stringify(sortedCategories);

  const didSortingItselfChangeRepresentation = initialCategoriesString !== finalCategoriesString;
  const finalWasChanged = wasActuallyChangedOverall || didSortingItselfChangeRepresentation;

  return { updatedCategories: sortedCategories, wasChanged: finalWasChanged };
};

export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const { toast } = useToast(); 
  const [budgetMonthsState, setBudgetMonthsState] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
     if (typeof window !== "undefined") {
      const key = getDisplayMonthKey(user?.uid); 
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) return storedMonthId;
      
      const guestKey = getDisplayMonthKey('guest'); 
      const guestStoredMonthId = localStorage.getItem(guestKey);
      if (guestStoredMonthId) return guestStoredMonthId;
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); 
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSavingDb, setIsSavingDb] = useState(false);

  const localSaveDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneForUserRef = useRef<Record<string, boolean>>({});


  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { 
      const key = getDisplayMonthKey(user?.uid);
      localStorage.setItem(key, currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, user, authLoading]);

  useEffect(() => { 
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
            incomes: Array.isArray(month.incomes) ? month.incomes : [], 
            startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt, 
            isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver, 
        };
        if ((updatedCategories && updatedCategories.length > 0) || 
            (month.incomes && month.incomes.length > 0) || 
            month.startingCreditCardDebt || 
            month.isRolledOver) {
            hasMeaningfulDataToSave = true;
        }
      }
      
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length > 0) { 
          await setDoc(docRef, { months: monthsWithEnsuredCategories });
      }
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
      toast({ title: "Save Error", description: "Failed to save budget to cloud.", variant: "destructive" });
    } finally {
      setIsSavingDb(false);
    }
  }, [isSavingDb, toast]);

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(currentGlobalBudgetMonthsState => {
      const newCandidateMonths = typeof updater === 'function' ? updater(currentGlobalBudgetMonthsState) : updater;
      
      const finalProcessedMonths: Record<string, BudgetMonth> = {};
      let wasAnyDataStructurallyModifiedDuringProcessing = false;

      for (const monthId in newCandidateMonths) {
        const monthInput = newCandidateMonths[monthId];
        if (!monthInput) continue; // Skip if month data is missing for some reason

        const month = { ...monthInput }; 

        if (!month.id) { month.id = monthId; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (!Array.isArray(month.incomes)) { month.incomes = []; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (month.categories === undefined) { month.categories = []; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; wasAnyDataStructurallyModifiedDuringProcessing = true; }
        
        const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(month.categories);
        month.categories = updatedCategories; 
        if (catsStructurallyChanged) {
          wasAnyDataStructurallyModifiedDuringProcessing = true;
        }
        finalProcessedMonths[monthId] = month;
      }
      
      // Compare the stringified version of the fully processed new state with the current state
      const currentGlobalBudgetMonthsStateString = JSON.stringify(currentGlobalBudgetMonthsState);
      const finalProcessedMonthsString = JSON.stringify(finalProcessedMonths);

      if (currentGlobalBudgetMonthsStateString === finalProcessedMonthsString && !wasAnyDataStructurallyModifiedDuringProcessing) {
        return currentGlobalBudgetMonthsState; 
      }

      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current);
      }
      localSaveDebounceTimeoutRef.current = setTimeout(() => {
        if (isUserAuthenticated && user) {
          saveBudgetMonthsToFirestore(user.uid, finalProcessedMonths);
        } else if (!isUserAuthenticated && typeof window !== "undefined") {
          localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(finalProcessedMonths));
        }
      }, 750);

      return finalProcessedMonths;
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
  }, []);

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];

    let calculatedStartingDebt = 0;
    let carriedOverSystemCategories: BudgetCategory[] = [];

    if (prevMonthBudget) {
        (prevMonthBudget.categories || []).forEach(prevCat => {
            if (prevCat.isSystemCategory && (prevCat.name === "Savings" || prevCat.name === "Credit Card Payments")) {
                carriedOverSystemCategories.push({
                    id: uuidv4(), 
                    name: prevCat.name, 
                    budgetedAmount: prevCat.budgetedAmount, 
                    expenses: [], 
                    subcategories: [], 
                    isSystemCategory: true,
                });
            }
        });

        const prevCCPaymentsCat = (prevMonthBudget.categories || []).find(cat => cat.isSystemCategory && cat.name.toLowerCase() === "credit card payments");
        const paymentsMadeLastMonth = prevCCPaymentsCat ? (prevCCPaymentsCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt); 
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(carriedOverSystemCategories);

    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: finalCategories,
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []); 

  // Main effect for loading data from Firestore or localStorage
  useEffect(() => {
    if (authLoading) {
      setIsLoadingDb(true);
      return;
    }

    const currentUserKey = user?.uid || 'guest';
    const isInitialLoadForThisUser = !initialLoadDoneForUserRef.current[currentUserKey];

    if (isInitialLoadForThisUser) {
      setIsLoadingDb(true); 
    }

    let unsubscribe = () => {};

    const loadData = async () => {
        let rawMonths: Record<string, BudgetMonth> | undefined;
        let source: 'firestore' | 'localstorage' | 'initial' = 'initial';

        try {
            if (isUserAuthenticated && user) {
                source = 'firestore';
                const docRef = getFirestoreUserBudgetDocRef(user.uid);
                unsubscribe = onSnapshot(docRef, (docSnap) => {
                    let loadedRawMonths: Record<string, BudgetMonth> | undefined;
                    if (docSnap.exists()) {
                        const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                        loadedRawMonths = data.months || {};
                    } else {
                        loadedRawMonths = {}; 
                    }
                    
                    // Process and set state
                    const processedSnapshot: Record<string, BudgetMonth> = {};
                    let wasModifiedInSnapshot = false;
                    const monthsToProcess = loadedRawMonths || {};

                    for (const monthId in monthsToProcess) {
                        const month = { ...monthsToProcess[monthId] };
                         let monthChangedThisIteration = false;
                        if (!month.id) { month.id = monthId; monthChangedThisIteration = true; }
                        if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthChangedThisIteration = true; }
                        if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthChangedThisIteration = true; }
                        if (!Array.isArray(month.incomes)) { month.incomes = []; monthChangedThisIteration = true; }
                        if (month.categories === undefined) { month.categories = []; monthChangedThisIteration = true; }
                        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories);
                        if (catsChanged) { month.categories = updatedCategories; monthChangedThisIteration = true; }
                        if (month.isRolledOver === undefined) { month.isRolledOver = false; monthChangedThisIteration = true; }
                        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthChangedThisIteration = true; }
                        if(monthChangedThisIteration) wasModifiedInSnapshot = true;
                        processedSnapshot[monthId] = month;
                    }
                     if (!processedSnapshot[currentDisplayMonthId]) {
                        processedSnapshot[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedSnapshot);
                        wasModifiedInSnapshot = true; // Indicate that a new month was created
                    }
                    setBudgetMonths(processedSnapshot);

                    if (isInitialLoadForThisUser && !initialLoadDoneForUserRef.current[currentUserKey]) { // Check again before setting
                        initialLoadDoneForUserRef.current[currentUserKey] = true;
                    }
                     setIsLoadingDb(false); 
                }, (error) => {
                    console.error("Error in Firestore onSnapshot:", error);
                    setBudgetMonths({}); 
                    setIsLoadingDb(false);
                    toast({title: "Firestore Error", description: "Could not load budget data from cloud.", variant: "destructive"});
                });
            } else if (typeof window !== "undefined") { 
                source = 'localstorage';
                const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
                if (localData) {
                    try {
                        rawMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
                    } catch (e) {
                        console.error("Error parsing guest budget data:", e);
                        localStorage.removeItem(GUEST_BUDGET_MONTHS_KEY); 
                        rawMonths = {};
                    }
                } else {
                    rawMonths = {};
                }

                const processedLocal: Record<string, BudgetMonth> = {};
                let wasModifiedLocal = false;
                const monthsToProcessLocal = rawMonths || {};
                for (const monthId in monthsToProcessLocal) {
                    const month = { ...monthsToProcessLocal[monthId] };
                    let monthChangedThisIteration = false;
                    if (!month.id) { month.id = monthId; monthChangedThisIteration = true; }
                    if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthChangedThisIteration = true; }
                    if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthChangedThisIteration = true; }
                    if (!Array.isArray(month.incomes)) { month.incomes = []; monthChangedThisIteration = true; }
                    if (month.categories === undefined) { month.categories = []; monthChangedThisIteration = true; }
                    const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories);
                    if (catsChanged) { month.categories = updatedCategories; monthChangedThisIteration = true; }
                    if (month.isRolledOver === undefined) { month.isRolledOver = false; monthChangedThisIteration = true; }
                    if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthChangedThisIteration = true; }
                    if(monthChangedThisIteration) wasModifiedLocal = true;
                    processedLocal[monthId] = month;
                }
                if (!processedLocal[currentDisplayMonthId]) {
                    processedLocal[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedLocal);
                    wasModifiedLocal = true;
                }
                setBudgetMonths(processedLocal);
                if (isInitialLoadForThisUser && !initialLoadDoneForUserRef.current[currentUserKey]) {
                    initialLoadDoneForUserRef.current[currentUserKey] = true;
                }
                setIsLoadingDb(false);
            } else { 
                const initialEmpty = { [currentDisplayMonthId]: createNewMonthBudget(currentDisplayMonthId, {}) };
                setBudgetMonths(initialEmpty);
                if (isInitialLoadForThisUser && !initialLoadDoneForUserRef.current[currentUserKey]) {
                     initialLoadDoneForUserRef.current[currentUserKey] = true;
                }
                setIsLoadingDb(false);
            }
        } catch (e: any) { 
            console.error("Critical error during budget data initialization:", e);
            setBudgetMonths({}); 
            setIsLoadingDb(false); 
            toast({ title: "Initialization Error", description: e.message || "Failed to initialize budget data.", variant: "destructive" });
        }
    };
    
    loadData();

    return () => {
      unsubscribe(); 
      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current); 
      }
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, setBudgetMonths, createNewMonthBudget, toast]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let targetMonth = budgetMonthsState[yearMonthId];
    let monthWasCreatedOrModified = false;

    if (!targetMonth) {
        targetMonth = createNewMonthBudget(yearMonthId, budgetMonthsState);
        monthWasCreatedOrModified = true;
    } else {
        let monthCopy = JSON.parse(JSON.stringify(targetMonth));
        let changedInternally = false;
        if (!monthCopy.id) { monthCopy.id = yearMonthId; changedInternally = true;}
        if (!monthCopy.year) { monthCopy.year = parseYearMonth(yearMonthId).getFullYear(); changedInternally = true;}
        if (!monthCopy.month) { monthCopy.month = parseYearMonth(yearMonthId).getMonth() + 1; changedInternally = true;}
        if (!Array.isArray(monthCopy.incomes)) { monthCopy.incomes = []; changedInternally = true; }
        if (monthCopy.categories === undefined) { monthCopy.categories = []; changedInternally = true; } 
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories);
        if (catsChanged) { monthCopy.categories = updatedCategories; changedInternally = true; }
        if (monthCopy.isRolledOver === undefined) { monthCopy.isRolledOver = false; changedInternally = true; }
        if (monthCopy.startingCreditCardDebt === undefined) { monthCopy.startingCreditCardDebt = 0; changedInternally = true; }
        
        if(changedInternally){
            targetMonth = monthCopy;
            monthWasCreatedOrModified = true;
        }
    }
    
    if(monthWasCreatedOrModified){
        setBudgetMonths(prev => ({...prev, [yearMonthId]: targetMonth}));
    }
    return targetMonth;
  }, [budgetMonthsState, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth)); 

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
          return prevMonths; 
      }

      if (payload.startingCreditCardDebt !== undefined) {
          monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
      }

      if (payload.categories) {
        const newCategoriesFromPayload: BudgetCategory[] = payload.categories.map(catPayload => {
          const existingCat = monthToUpdate.categories?.find((c: BudgetCategory) => c.id === catPayload.id);
          const id = catPayload.id || existingCat?.id || uuidv4();
          
          let budgetToSet = catPayload.budgetedAmount;
           if (budgetToSet === undefined) { 
              budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
          }

          const subcategoriesToSet = (catPayload.subcategories || []).map(subCatPayload => {
              const existingSubCat = existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id);
              return {
                id: subCatPayload.id || existingSubCat?.id || uuidv4(),
                name: subCatPayload.name,
                budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
                expenses: existingSubCat?.expenses || [], 
              };
            });

          const isSystem = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory 
                            : (existingCat ? existingCat.isSystemCategory 
                            : (["savings", "credit card payments"].includes(catPayload.name.toLowerCase())));
          
          if (!isSystem && subcategoriesToSet.length > 0) {
               budgetToSet = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }

          return {
            id: id,
            name: catPayload.name,
            budgetedAmount: budgetToSet,
            expenses: existingCat?.expenses || [], 
            subcategories: subcategoriesToSet,
            isSystemCategory: isSystem,
          };
        });
        monthToUpdate.categories = newCategoriesFromPayload;
      }
      
      const { updatedCategories, wasChanged: sysFlagsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = updatedCategories;

      // Compare stringified versions for actual logical change detection
      if (JSON.stringify(originalMonth) !== JSON.stringify(monthToUpdate) || sysFlagsChanged) {
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
      let expenseAdded = false;

      monthToUpdate.categories = (monthToUpdate.categories || []).map((cat: BudgetCategory) => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          if (cat.isSystemCategory || !cat.subcategories || cat.subcategories.length === 0) {
            cat.expenses = [...(cat.expenses || []), newExpense];
            expenseAdded = true;
          } else {
            console.warn("Attempted to add expense to parent category with subcategories:", cat.name);
          }
          return cat;
        } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          cat.subcategories = (cat.subcategories || []).map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
          );
          expenseAdded = true;
          return cat;
        }
        return cat;
      });

      if (expenseAdded) {
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths; 
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }
      let expenseDeleted = false;

      monthToUpdate.categories = (monthToUpdate.categories || []).map((cat: BudgetCategory) => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          const initialLength = (cat.expenses || []).length;
          cat.expenses = (cat.expenses || []).filter(exp => exp.id !== expenseId);
          if (cat.expenses.length !== initialLength) expenseDeleted = true;
          return cat;
        } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          cat.subcategories = (cat.subcategories || []).map(sub => {
              if (sub.id === categoryOrSubCategoryId) {
                const initialLength = (sub.expenses || []).length;
                const newExpenses = (sub.expenses || []).filter(exp => exp.id !== expenseId);
                if (newExpenses.length !== initialLength) expenseDeleted = true;
                return { ...sub, expenses: newExpenses };
              }
              return sub;
            });
          return cat;
        }
        return cat;
      });

      if (expenseDeleted) {
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths; 
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
      monthToUpdate.incomes = [...(monthToUpdate.incomes || []), newIncomeEntry];
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }
      const initialLength = (monthToUpdate.incomes || []).length;
      monthToUpdate.incomes = (monthToUpdate.incomes || []).filter((inc: IncomeEntry) => inc.id !== incomeId);

      if (monthToUpdate.incomes.length !== initialLength) {
        return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths; 
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const navigateToPreviousMonth = useCallback(() => {
    setCurrentDisplayMonthIdState(prevId => getPreviousMonthId(prevId));
  }, [setCurrentDisplayMonthIdState]);

  const navigateToNextMonth = useCallback(() => {
    setCurrentDisplayMonthIdState(prevId => {
      const currentDate = parseYearMonth(prevId);
      currentDate.setMonth(currentDate.getMonth() + 1);
      return getYearMonthFromDate(currentDate);
    });
  }, [setCurrentDisplayMonthIdState]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    let message = "";
    let success = false;

    setBudgetMonths(prevMonths => {
      const monthBudget = prevMonths[yearMonthId];
      if (!monthBudget) {
        message = `Budget for ${yearMonthId} not found.`;
        success = false;
        return prevMonths;
      }

      const newRolloverState = !monthBudget.isRolledOver;
      const updatedMonth = { ...monthBudget, isRolledOver: newRolloverState };

      if (newRolloverState) {
          message = "Month finalized and closed. Any unspent operational funds contribute to your overall savings.";
      } else {
          message = "Month reopened for editing.";
      }
      success = true;
      
      if(JSON.stringify(monthBudget) !== JSON.stringify(updatedMonth)){
        return { ...prevMonths, [yearMonthId]: updatedMonth };
      }
      return prevMonths;
    });
    return { success, message };
  }, [setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        toast({ title: "Action Denied", description: "Cannot add category to a closed month.", variant: "destructive" });
        return prevMonths;
      }

      const existingCat = (monthToUpdate.categories || []).find((c:BudgetCategory) => c.name.toLowerCase() === categoryName.toLowerCase());
      if (existingCat) {
          toast({ title: "Category Exists", description: `Category "${categoryName}" already exists.`, variant: "default" });
          return prevMonths;
      }

      const isPotentiallySystem = ["savings", "credit card payments"].includes(categoryName.toLowerCase());
      let finalName = categoryName;
      if (categoryName.toLowerCase() === "savings") finalName = "Savings";
      if (categoryName.toLowerCase() === "credit card payments") finalName = "Credit Card Payments";


      const newCategory: BudgetCategory = {
        id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [],
        isSystemCategory: isPotentiallySystem, 
      };

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      const { updatedCategories: finalCatsWithNew, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCatsWithNew;

      if (JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged) {
        return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id' | 'expenses'>>) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        toast({ title: "Action Denied", description: "Cannot update category in a closed month.", variant: "destructive" });
        return prevMonths;
      }

      let categoryActuallyModified = false;
      monthToUpdate.categories = (monthToUpdate.categories || []).map((cat: BudgetCategory) => {
        if (cat.id === categoryId) {
          categoryActuallyModified = true; 
          let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
          let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
          
          if (cat.isSystemCategory) { 
            newName = cat.name; 
          }
          
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
          
          return { ...cat, name: newName, budgetedAmount: newBudget }; 
        }
        return cat;
      });

      if (!categoryActuallyModified) return prevMonths; 

      const { updatedCategories: finalCategoriesAfterSysFlags, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCategoriesAfterSysFlags;

      if (JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged) {
         return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]);

  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId];
      if (!originalMonth) return prevMonths; 

      if (originalMonth.isRolledOver && isUserAuthenticated && user) {
        toast({ title: "Action Denied", description: "Cannot modify a closed month.", variant: "destructive" });
        return prevMonths;
      }

      const categoryToDelete = originalMonth.categories?.find(cat => cat.id === categoryId);
      if (categoryToDelete?.isSystemCategory) {
        toast({ title: "Action Denied", description: `Cannot delete system category: ${categoryToDelete.name}`, variant: "destructive" });
        return prevMonths;
      }

      const initialCategoriesCount = originalMonth.categories?.length || 0;
      const filteredCategories = originalMonth.categories?.filter(cat => cat.id !== categoryId) || [];

      if (filteredCategories.length === initialCategoriesCount) {
        return prevMonths;
      }
      
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));
      monthToUpdate.categories = filteredCategories;
      
      const { updatedCategories: finalProcessedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalProcessedCategories;

      if (JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged) { 
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [setBudgetMonths, isUserAuthenticated, user, toast]);


  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[monthId] ? prevMonths[monthId] : createNewMonthBudget(monthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        toast({ title: "Action Denied", description: "Cannot add subcategory to a closed month.", variant: "destructive" });
        return prevMonths;
      }

      const parentCatIndex = (monthToUpdate.categories || []).findIndex((cat: BudgetCategory) => cat.id === parentCategoryId);
      if (parentCatIndex === -1 || monthToUpdate.categories[parentCatIndex].isSystemCategory) {
         toast({ title: "Action Denied", description: "Parent category not found or is a system category.", variant: "destructive" });
        return prevMonths; 
      }

      const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
      
      monthToUpdate.categories[parentCatIndex].subcategories = [
          ...(monthToUpdate.categories[parentCatIndex].subcategories || []), 
          newSubCategory
      ];
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
      
      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged){
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[monthId] ? prevMonths[monthId] : createNewMonthBudget(monthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        toast({ title: "Action Denied", description: "Cannot update subcategory in a closed month.", variant: "destructive" });
        return prevMonths;
      }

      const parentCatIndex = (monthToUpdate.categories || []).findIndex((cat: BudgetCategory) => cat.id === parentCategoryId);
      if (parentCatIndex === -1 || monthToUpdate.categories[parentCatIndex].isSystemCategory) {
        return prevMonths; 
      }
      
      let subCategoryActuallyModified = false;
      monthToUpdate.categories[parentCatIndex].subcategories = (monthToUpdate.categories[parentCatIndex].subcategories || []).map((sub: SubCategory) => {
          if (sub.id === subCategoryId) {
            subCategoryActuallyModified = true;
            return { ...sub, name: newName, budgetedAmount: newBudget };
          }
          return sub;
        }
      );

      if (!subCategoryActuallyModified) return prevMonths; 

      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);

      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged){
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    setBudgetMonths(prevMonths => {
        const originalMonth = prevMonths[monthId] ? prevMonths[monthId] : createNewMonthBudget(monthId, prevMonths);
        let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

        if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
            toast({ title: "Action Denied", description: "Cannot delete subcategory from a closed month.", variant: "destructive" });
            return prevMonths;
        }
        
        const parentCatIndex = (monthToUpdate.categories || []).findIndex((cat: BudgetCategory) => cat.id === parentCategoryId);
        if (parentCatIndex === -1 || monthToUpdate.categories[parentCatIndex].isSystemCategory) {
            return prevMonths; 
        }

        const initialSubCount = monthToUpdate.categories[parentCatIndex].subcategories?.length || 0;
        monthToUpdate.categories[parentCatIndex].subcategories = (monthToUpdate.categories[parentCatIndex].subcategories || []).filter((sub: SubCategory) => sub.id !== subCategoryId);
        const finalSubCount = monthToUpdate.categories[parentCatIndex].subcategories?.length || 0;

        if (initialSubCount === finalSubCount) return prevMonths; 

        monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);

        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories); 
        monthToUpdate.categories = updatedCategories;

        if(JSON.stringify(originalMonth.categories || []) !== JSON.stringify(monthToUpdate.categories || []) || catsChanged){
          return { ...prevMonths, [monthId]: monthToUpdate };
        }
        return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]);

  const applyAiGeneratedBudget = useCallback(
    (
      targetMonthId: string,
      suggestedBudgetCategoriesFromAI: PrepareBudgetOutput['suggestedCategories'],
      incomeForTargetMonth: number, 
      startingCCDebtForTargetMonth: number,
    ) => {
      setBudgetMonths(prevMonths => {
        const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
        
        let newCategories: BudgetCategory[] = (suggestedBudgetCategoriesFromAI || []).map(sCat => {
          const isSavingsByName = sCat.name.toLowerCase() === 'savings';
          const isCCByName = sCat.name.toLowerCase() === 'credit card payments';
          const isSystem = isSavingsByName || isCCByName;

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
          
          let finalName = sCat.name;
          if (isSavingsByName) finalName = "Savings"; 
          if (isCCByName) finalName = "Credit Card Payments";

          return {
            id: uuidv4(),
            name: finalName,
            budgetedAmount: finalBudgetedAmount,
            expenses: [],
            subcategories: isSystem ? [] : subcategories, 
            isSystemCategory: isSystem,
          };
        });
        
        const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(newCategories);

        const newMonthBudget: BudgetMonth = {
          id: targetMonthId,
          year: targetYear,
          month: targetMonthNum,
          incomes: [{ id: uuidv4(), description: "Projected Income (AI Basis)", amount: incomeForTargetMonth, dateAdded: new Date().toISOString() }],
          categories: finalProcessedCategories,
          isRolledOver: false,
          startingCreditCardDebt: startingCCDebtForTargetMonth,
        };

        return { ...prevMonths, [targetMonthId]: newMonthBudget };
      });
    }, [setBudgetMonths] 
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

    