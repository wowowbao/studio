
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
const ensureSystemCategoryFlags = (categoriesInput: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categoriesInput) {
    return { updatedCategories: [], wasChanged: false };
  }

  let processedCategories = JSON.parse(JSON.stringify(categoriesInput)) as BudgetCategory[];
  let wasActuallyChangedOverall = false;

  const systemCategoryNames = ["Savings", "Credit Card Payments"];

  systemCategoryNames.forEach(sysName => {
    let designatedSystemCategoryIndex = -1;
    let categoryDataModifiedThisPass = false;

    // Pass 1: Find an *already explicitly flagged* system category for this name.
    for (let i = 0; i < processedCategories.length; i++) {
      if (processedCategories[i].name.toLowerCase() === sysName.toLowerCase() && processedCategories[i].isSystemCategory === true) {
        designatedSystemCategoryIndex = i;
        break;
      }
    }

    // Pass 2: If no explicitly flagged one, find the first category matching the name and designate it.
    if (designatedSystemCategoryIndex === -1) {
      for (let i = 0; i < processedCategories.length; i++) {
        if (processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
          designatedSystemCategoryIndex = i;
          if (processedCategories[i].isSystemCategory !== true) {
            processedCategories[i].isSystemCategory = true;
            categoryDataModifiedThisPass = true;
          }
          break;
        }
      }
    }
    
    // Pass 3: If no category found by name at all, create it.
    if (designatedSystemCategoryIndex === -1) {
        // Do not create system categories if they don't exist. They must be added by user or AI.
        // If the AI adds a category named "Savings" or "Credit Card Payments",
        // this function will later flag it as system.
    }


    // Pass 4: Standardize the designated system category (if found) and ensure all others with the same name are NOT system.
    if (designatedSystemCategoryIndex !== -1) {
      const systemCat = processedCategories[designatedSystemCategoryIndex];
      
      if (systemCat.isSystemCategory !== true) { // Should be caught by Pass 2, but good for safety
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
      
      // Ensure any other category with the same name is NOT system.
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

  // Pass 5: Ensure all other categories (not matching system names) are not system and have defaults.
  // Also recalculate parent budget if subcategories exist.
  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat }; // Work on a copy
    let categorySpecificChange = false;
    const isSystemNameMatch = systemCategoryNames.some(sysName => sysName.toLowerCase() === currentCat.name.toLowerCase());

    // If it's named like a system category but NOT the designated system one, ensure isSystemCategory is false.
    if (isSystemNameMatch && !currentCat.isSystemCategory) {
        // This case is handled by Pass 4 already. If it IS a system name match AND isSystemCategory is true,
        // it was already handled as THE designated one.
    } else if (!isSystemNameMatch && currentCat.isSystemCategory === true) {
        // If it's NOT a system name, but is flagged as system, unflag it.
        currentCat.isSystemCategory = false;
        categorySpecificChange = true;
    }
    
    if (!currentCat.isSystemCategory) {
      // Default values for non-system categories
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
         currentCat.subcategories = []; // Ensure it's an array
         categorySpecificChange = true;
      }

      // Ensure subcategories have defaults and recalculate parent budget
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

        // If it has subcategories, its budget is the sum of subcategory budgets
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

  // Sort categories: System categories first (Savings, then CC Payments), then others alphabetically
  const sortedCategories = [...processedCategories].sort((a, b) => {
    const aIsSystem = a.isSystemCategory || false;
    const bIsSystem = b.isSystemCategory || false;
    if (aIsSystem && !bIsSystem) return -1;
    if (!bIsSystem && bIsSystem) return 1;
    if (aIsSystem && bIsSystem) {
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1; // Should already be sorted after Savings
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  // Only consider it changed if the JSON stringified version is different, to account for order changes or actual data changes.
  if (JSON.stringify(categoriesInput || []) !== JSON.stringify(sortedCategories)) {
    wasActuallyChangedOverall = true;
  }

  return { updatedCategories: wasActuallyChangedOverall ? sortedCategories : (categoriesInput || []), wasChanged: wasActuallyChangedOverall };
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
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default to June 2025
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSavingDb, setIsSavingDb] = useState(false);

  const localSaveDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneForUserRef = useRef<Record<string, boolean>>({});


  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { // Save currentDisplayMonthId to localStorage
      const key = getDisplayMonthKey(user?.uid);
      localStorage.setItem(key, currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, user, authLoading]);

  useEffect(() => { // Reset initial load flag if auth state changes
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
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories); // System flags ensured here
        monthsWithEnsuredCategories[monthId] = {
            ...month,
            categories: updatedCategories,
            incomes: Array.isArray(month.incomes) ? month.incomes : [], // Ensure incomes is an array
            startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt, // Default
            isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver, // Default
        };
        // Check if there's meaningful data to save for this month
        if ((updatedCategories && updatedCategories.length > 0) || 
            (month.incomes && month.incomes.length > 0) || 
            month.startingCreditCardDebt || 
            month.isRolledOver) {
            hasMeaningfulDataToSave = true;
        }
      }
      
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length > 0) { // Save if any month has data or if explicit save triggered
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
    setBudgetMonthsState(prevMonths => {
        const newMonthsCandidate = typeof updater === 'function' ? updater(prevMonths) : updater;

        // Deep clone and process each month
        const processedMonths: Record<string, BudgetMonth> = {};
        let wasAnyDataStructurallyModified = false; // Flag if ensureSystemCategoryFlags modified anything

        for (const monthId in newMonthsCandidate) {
            const month = newMonthsCandidate[monthId];
            let currentCategories = month.categories || [];

            const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(currentCategories);
            if (catsStructurallyChanged) wasAnyDataStructurallyModified = true; 

            processedMonths[monthId] = {
                ...month,
                id: monthId, // Ensure ID is set
                year: month.year || parseYearMonth(monthId).getFullYear(),
                month: month.month || (parseYearMonth(monthId).getMonth() + 1),
                categories: updatedCategories, // Use processed categories
                incomes: Array.isArray(month.incomes) ? month.incomes : [],
                isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver,
                startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt,
            };
        }
        
        // Only update state if there's an actual change in data or structure
        const hasActualChange = JSON.stringify(prevMonths) !== JSON.stringify(processedMonths);
        
        if (!hasActualChange && !wasAnyDataStructurallyModified) {
          return prevMonths; // No meaningful change, return previous state to avoid re-render loops
        }

        // Debounce saving to Firestore or localStorage
        if (localSaveDebounceTimeoutRef.current) {
            clearTimeout(localSaveDebounceTimeoutRef.current);
        }
        localSaveDebounceTimeoutRef.current = setTimeout(() => {
            if (isUserAuthenticated && user) {
                saveBudgetMonthsToFirestore(user.uid, processedMonths);
            } else if (!isUserAuthenticated && typeof window !== "undefined") { // Guest mode
                localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(processedMonths));
            }
        }, 750); // Adjust debounce time as needed

        return processedMonths;
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]);

  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
  }, []);

  // Utility to create a new, empty month budget
  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];

    let calculatedStartingDebt = 0;
    let carriedOverCategories: BudgetCategory[] = [];

    if (prevMonthBudget) {
        // Carry over system categories with their budgeted amounts
        (prevMonthBudget.categories || []).forEach(prevCat => {
            if (prevCat.isSystemCategory && (prevCat.name === "Savings" || prevCat.name === "Credit Card Payments")) {
                carriedOverCategories.push({
                    id: uuidv4(), // New ID for the new month's category instance
                    name: prevCat.name,
                    budgetedAmount: prevCat.budgetedAmount, // Carry over planned budget
                    expenses: [], // Reset expenses
                    subcategories: [], // System categories don't have subs
                    isSystemCategory: true,
                });
            }
        });

        // Calculate starting debt for the new month based on previous month's debt and payments
        const prevCCPaymentsCat = (prevMonthBudget.categories || []).find(cat => cat.isSystemCategory && cat.name.toLowerCase() === "credit card payments");
        const paymentsMadeLastMonth = prevCCPaymentsCat ? (prevCCPaymentsCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt); // Debt cannot be negative
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(carriedOverCategories);

    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: finalCategories,
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []); // ensureSystemCategoryFlags is a utility, no hook deps

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
                    if (docSnap.exists()) {
                        const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                        rawMonths = data.months || {};
                    } else {
                        rawMonths = {}; // No data for this user yet
                    }
                    processAndSetBudgetData(rawMonths, source);
                    if (isInitialLoadForThisUser) {
                        initialLoadDoneForUserRef.current[user.uid] = true;
                    }
                    setIsLoadingDb(false); // Moved here
                }, (error) => {
                    console.error("Error fetching/processing budget from Firestore:", error);
                    processAndSetBudgetData({}, 'initial'); // Fallback to empty if error
                    if (isInitialLoadForThisUser) {
                        initialLoadDoneForUserRef.current[user.uid!] = true;
                    }
                    setIsLoadingDb(false);
                    toast({title: "Firestore Error", description: "Could not load budget data from cloud.", variant: "destructive"});
                });
            } else if (typeof window !== "undefined") { // Guest mode
                source = 'localstorage';
                const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
                if (localData) {
                    try {
                    rawMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
                    } catch (e) {
                    console.error("Error parsing guest budget data:", e);
                    localStorage.removeItem(GUEST_BUDGET_MONTHS_KEY); // Clear corrupted data
                    rawMonths = {};
                    }
                } else {
                    rawMonths = {};
                }
                processAndSetBudgetData(rawMonths, source);
                if (isInitialLoadForThisUser) {
                    initialLoadDoneForUserRef.current['guest'] = true;
                }
                setIsLoadingDb(false);
            } else { // Fallback for non-browser environments during SSR or if window is not available
                processAndSetBudgetData({}, 'initial');
                 if (isInitialLoadForThisUser) {
                    initialLoadDoneForUserRef.current['guest'] = true; // Or a default key
                }
                setIsLoadingDb(false);
            }
        } catch (e: any) { // Catch any synchronous error in loadData
            console.error("Critical error during budget data initialization:", e);
            setBudgetMonths({}); // Reset to a safe state
            setIsLoadingDb(false); // Ensure loading stops
            toast({ title: "Initialization Error", description: e.message || "Failed to initialize budget data.", variant: "destructive" });
        }
    };
    
    loadData();

    return () => {
      unsubscribe(); // Cleanup Firestore listener
      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current); // Clear any pending save
      }
    };
  // Dependencies for main data loading effect
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, setBudgetMonths, toast]); // Removed processAndSetBudgetData if it's stable


  // Helper to process raw data and update state, ensuring current month exists
  const processAndSetBudgetData = useCallback((rawMonths: Record<string, BudgetMonth> | undefined, source: 'firestore' | 'localstorage' | 'initial') => {
    let processedMonths = rawMonths ? JSON.parse(JSON.stringify(rawMonths)) : {};
    let wasAnyDataStructurallyModifiedDuringProcessing = false; 

    // Ensure the currentDisplayMonthId exists in the processed data
    if (!processedMonths[currentDisplayMonthId] && (source === 'initial' || (isUserAuthenticated && source === 'firestore') || (!isUserAuthenticated && source === 'localstorage'))) {
        processedMonths[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedMonths);
        wasAnyDataStructurallyModifiedDuringProcessing = true; 
    }

    // Standardize each month's structure (IDs, defaults, system categories)
    Object.keys(processedMonths).forEach(monthId => {
      const month = processedMonths[monthId];
      let monthChangedThisIteration = false;

      // Basic structure checks
      if (!month.id) { month.id = monthId; monthChangedThisIteration = true; }
      if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthChangedThisIteration = true; }
      if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthChangedThisIteration = true; }
      if (!Array.isArray(month.incomes)) { month.incomes = []; monthChangedThisIteration = true; }
      if (month.categories === undefined) { month.categories = []; monthChangedThisIteration = true; } // Ensure categories array exists

      // Ensure system category flags and structure
      const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(month.categories);
      if (catsStructurallyChanged) { 
        month.categories = updatedCategories; 
        monthChangedThisIteration = true;
      }

      // Default flags if undefined
      if (month.isRolledOver === undefined) { month.isRolledOver = false; monthChangedThisIteration = true; }
      if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthChangedThisIteration = true; }
      
      if (monthChangedThisIteration) wasAnyDataStructurallyModifiedDuringProcessing = true;
    });

    // Only call setBudgetMonths if there's a difference or if structure was modified
    if (JSON.stringify(budgetMonthsState) !== JSON.stringify(processedMonths) || wasAnyDataStructurallyModifiedDuringProcessing) {
        setBudgetMonths(processedMonths);
    }
  }, [currentDisplayMonthId, createNewMonthBudget, budgetMonthsState, setBudgetMonths, isUserAuthenticated]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    const existingMonth = budgetMonthsState[yearMonthId];
    if (existingMonth) {
        // Even if it exists, ensure its structure is correct (e.g., system categories)
        const monthCopy = JSON.parse(JSON.stringify(existingMonth)); // Deep clone
        let changed = false;
        // Ensure basic structure (incomes, categories array)
        if (!Array.isArray(monthCopy.incomes)) { monthCopy.incomes = []; changed = true; }
        if (monthCopy.categories === undefined) { monthCopy.categories = []; changed = true; } // Check if categories array exists

        // Process categories to ensure system flags and defaults
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories);
        if (catsChanged) { monthCopy.categories = updatedCategories; changed = true; }

        // Default other properties if undefined
        if (monthCopy.isRolledOver === undefined) { monthCopy.isRolledOver = false; changed = true; }
        if (monthCopy.startingCreditCardDebt === undefined) { monthCopy.startingCreditCardDebt = 0; changed = true; }
        
        // Ensure month/year/id are set if somehow missing (should be rare)
        if (!monthCopy.id) { monthCopy.id = yearMonthId; changed = true;}
        if (!monthCopy.year) { monthCopy.year = parseYearMonth(yearMonthId).getFullYear(); changed = true;}
        if (!monthCopy.month) { monthCopy.month = parseYearMonth(yearMonthId).getMonth() + 1; changed = true;}


        if(changed && JSON.stringify(existingMonth) !== JSON.stringify(monthCopy)){ // Only update if actual change
            setBudgetMonths(prev => ({...prev, [yearMonthId]: monthCopy}));
            return monthCopy; // Return the updated, correct copy
        }
        return existingMonth; // Return original if no structural changes needed
    }
    // If month doesn't exist, create it
    const newMonth = createNewMonthBudget(yearMonthId, budgetMonthsState);
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: newMonth }));
    return newMonth;
  }, [budgetMonthsState, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth)); // Deep clone

      // Prevent updates to rolled-over months if user is authenticated (cloud save)
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
          // toast({ title: "Month Closed", description: "Cannot update a finalized month.", variant: "default" });
          return prevMonths; // No change
      }

      if (payload.startingCreditCardDebt !== undefined) {
          monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
      }

      if (payload.categories) {
        // Map payload categories, preserving existing expenses and sub-category expenses
        const newCategoriesFromPayload: BudgetCategory[] = payload.categories.map(catPayload => {
          const existingCat = monthToUpdate.categories?.find((c: BudgetCategory) => c.id === catPayload.id);
          const id = catPayload.id || existingCat?.id || uuidv4();
          
          let budgetToSet = catPayload.budgetedAmount;
           // If budget is not in payload, use existing or default to 0
           if (budgetToSet === undefined) { 
              budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
          }

          // Map subcategories from payload, preserving existing sub-expenses
          const subcategoriesToSet = (catPayload.subcategories || []).map(subCatPayload => {
              const existingSubCat = existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id);
              return {
                id: subCatPayload.id || existingSubCat?.id || uuidv4(),
                name: subCatPayload.name,
                budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
                expenses: existingSubCat?.expenses || [], // Preserve existing sub-expenses
              };
            });

          // Determine if it's a system category
          const isSystem = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory 
                            : (existingCat ? existingCat.isSystemCategory 
                            : (["savings", "credit card payments"].includes(catPayload.name.toLowerCase())));
          
          // If it's not a system category and has subcategories, parent budget is sum of subs
          if (!isSystem && subcategoriesToSet.length > 0) {
               budgetToSet = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }

          return {
            id: id,
            name: catPayload.name,
            budgetedAmount: budgetToSet,
            expenses: existingCat?.expenses || [], // Preserve existing parent expenses
            subcategories: subcategoriesToSet,
            isSystemCategory: isSystem,
          };
        });
        monthToUpdate.categories = newCategoriesFromPayload;
      }
      
      // Ensure system category flags are correct after potential changes
      const { updatedCategories, wasChanged: sysFlagsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = updatedCategories;

      // Only update state if there's an actual change
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
        // toast({ title: "Month Closed", description: "Cannot add expense to a finalized month.", variant: "default" });
        return prevMonths;
      }

      const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
      let expenseAdded = false;

      monthToUpdate.categories = (monthToUpdate.categories || []).map((cat: BudgetCategory) => {
        if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
          // Prevent adding expense to parent category if it has subcategories (unless it's a system category)
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              console.warn(`Attempted to add expense to parent category '${cat.name}' which has subcategories. Expense not added.`);
              // toast({ title: "Action Denied", description: `Expenses for '${cat.name}' should be added to its subcategories.`, variant: "destructive" });
              return cat;
          }
          cat.expenses = [...(cat.expenses || []), newExpense];
          expenseAdded = true;
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
      return prevMonths; // No change
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        // toast({ title: "Month Closed", description: "Cannot delete expense from a finalized month.", variant: "default" });
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
      return prevMonths; // No change
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        // toast({ title: "Month Closed", description: "Cannot add income to a finalized month.", variant: "default" });
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
        // toast({ title: "Month Closed", description: "Cannot delete income from a finalized month.", variant: "default" });
        return prevMonths;
      }
      const initialLength = (monthToUpdate.incomes || []).length;
      monthToUpdate.incomes = (monthToUpdate.incomes || []).filter((inc: IncomeEntry) => inc.id !== incomeId);

      if (monthToUpdate.incomes.length !== initialLength) {
        return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths; // No change
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
          message = "Month finalized and closed.";
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

      // Determine if the new category should be a system category by name
      const isSavingsByName = categoryName.toLowerCase() === "savings";
      const isCCPaymentsByName = categoryName.toLowerCase() === "credit card payments";
      let isSysCat = isSavingsByName || isCCPaymentsByName;
      let finalName = categoryName;
      if (isSavingsByName) finalName = "Savings"; // Standardize name
      if (isCCPaymentsByName) finalName = "Credit Card Payments"; // Standardize name

      const newCategory: BudgetCategory = {
        id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [],
        isSystemCategory: isSysCat, // Set system flag based on name
      };

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      // Ensure all system flags are correctly set after adding
      const { updatedCategories: finalCatsWithNew } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCatsWithNew;


      if (JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)) {
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
          categoryActuallyModified = true; // Mark that we found and are attempting to modify
          let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
          let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
          let newIsSystem = cat.isSystemCategory; // Preserve original system status by default

          // Handle potential name changes affecting system status
          const isSavingsByName = newName.toLowerCase() === "savings";
          const isCCPaymentsByName = newName.toLowerCase() === "credit card payments";

          if (cat.isSystemCategory) { // If it was already a system category, its name cannot change
            newName = cat.name; 
          } else { // If it was NOT a system category, check if the new name makes it one
            if (isSavingsByName) { newName = "Savings"; newIsSystem = true; }
            else if (isCCPaymentsByName) { newName = "Credit Card Payments"; newIsSystem = true; }
          }
          
          // Subcategories are cleared if it becomes a system category
          let subcategoriesToKeep = cat.subcategories || [];
          if (newIsSystem) { 
            subcategoriesToKeep = [];
          }

          // If it's not a system category and has subcategories, parent budget is sum of subs
          if (!newIsSystem && subcategoriesToKeep.length > 0) {
              newBudget = subcategoriesToKeep.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
          
          return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem, subcategories: subcategoriesToKeep };
        }
        return cat;
      });

      if (!categoryActuallyModified) return prevMonths; // Category to update not found

      // After potential modifications, re-ensure all system category flags are correct across the entire list
      const { updatedCategories: finalCategoriesAfterSysFlags } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCategoriesAfterSysFlags;

      if (JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)) {
         return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]);

  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId];
      if (!originalMonth) return prevMonths; // Month not found

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

      // If no category was actually removed (e.g., ID not found), don't update state
      if (filteredCategories.length === initialCategoriesCount) {
        return prevMonths;
      }
      
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));
      monthToUpdate.categories = filteredCategories;
      
      // Re-ensure system flags are correct after deletion
      const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalProcessedCategories;

      // Only update if there's an actual change
      if (JSON.stringify(originalMonth) !== JSON.stringify(monthToUpdate)) { 
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
         toast({ title: "Action Denied", description: "Parent category not found or is a system category (cannot have subcategories).", variant: "destructive" });
        return prevMonths; // Parent category not found or is system category
      }

      const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
      
      // Add the new subcategory
      monthToUpdate.categories[parentCatIndex].subcategories = [
          ...(monthToUpdate.categories[parentCatIndex].subcategories || []), 
          newSubCategory
      ];
      // Recalculate parent category's budget
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
      
      // Ensure system flags remain correct globally (though less likely to change here)
      const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
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
        return prevMonths; // Parent category not found or is system
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

      if (!subCategoryActuallyModified) return prevMonths; // Subcategory to update not found

      // Recalculate parent category's budget
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);

      const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
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
            return prevMonths; // Parent category not found or is system
        }

        const initialSubCount = monthToUpdate.categories[parentCatIndex].subcategories?.length || 0;
        monthToUpdate.categories[parentCatIndex].subcategories = (monthToUpdate.categories[parentCatIndex].subcategories || []).filter((sub: SubCategory) => sub.id !== subCategoryId);
        const finalSubCount = monthToUpdate.categories[parentCatIndex].subcategories?.length || 0;

        if (initialSubCount === finalSubCount) return prevMonths; // Subcategory not found, no change

        // Recalculate parent category's budget
        monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);

        const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
        monthToUpdate.categories = updatedCategories;

        if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
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
      // aiSuggestedCCPayment: number // Not directly used to set budget, but for context or future use
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

          if (!isSystem && subcategories.length > 0) { // Parent budget is sum of subs if not system
            finalBudgetedAmount = subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
          }
          
          let finalName = sCat.name;
          if (isSavingsByName) finalName = "Savings"; // Standardize system names
          if (isCCByName) finalName = "Credit Card Payments";

          return {
            id: uuidv4(),
            name: finalName,
            budgetedAmount: finalBudgetedAmount,
            expenses: [],
            subcategories: isSystem ? [] : subcategories, // System cats don't have subs
            isSystemCategory: isSystem,
          };
        });
        
        // Ensure system categories ("Savings", "Credit Card Payments") are definitely present.
        // This will flag AI-suggested ones or add them if missing.
        const systemCategoryNames = ["Savings", "Credit Card Payments"];
        systemCategoryNames.forEach(sysName => {
            const existingSysCatIndex = newCategories.findIndex(c => c.name === sysName && c.isSystemCategory);
            if (existingSysCatIndex === -1) { // If not found as a system category
                const byNameIndex = newCategories.findIndex(c => c.name.toLowerCase() === sysName.toLowerCase());
                if (byNameIndex !== -1) { // Found by name, but not flagged as system
                    newCategories[byNameIndex].name = sysName; // Standardize name
                    newCategories[byNameIndex].isSystemCategory = true;
                    newCategories[byNameIndex].subcategories = []; // Ensure no subcategories
                    // Budget amount for system categories is taken directly from AI if specified
                } else { // Not found at all, add it with a default budget (AI can override this if it suggests one)
                     newCategories.push({ id: uuidv4(), name: sysName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
                }
            }
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

    
