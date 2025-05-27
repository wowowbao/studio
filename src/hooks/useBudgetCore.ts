
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow';
import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';
import { useToast } from "@/hooks/use-toast";
import { debounce } from 'lodash';


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
// It returns an object: { updatedCategories: BudgetCategory[], wasChanged: boolean }
// If wasChanged is false, updatedCategories is the SAME REFERENCE as categoriesInput.
const ensureSystemCategoryFlags = (categoriesInput: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categoriesInput) {
    return { updatedCategories: [], wasChanged: false };
  }

  let processedCategories = JSON.parse(JSON.stringify(categoriesInput)) as BudgetCategory[];
  let wasActuallyChangedOverall = false;

  const systemCategoryNames = ["Savings", "Credit Card Payments"];

  systemCategoryNames.forEach(sysName => {
    let designatedSystemCategoryIndex = -1;
    let systemCategoryFoundAndFlagged = false;

    // First pass: Find an existing category already flagged as system for this name
    for (let i = 0; i < processedCategories.length; i++) {
      if (processedCategories[i].isSystemCategory === true && processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
        designatedSystemCategoryIndex = i;
        systemCategoryFoundAndFlagged = true;
        break;
      }
    }

    // Second pass: If not found, find the first category by name and flag it
    if (!systemCategoryFoundAndFlagged) {
      for (let i = 0; i < processedCategories.length; i++) {
        if (processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
          designatedSystemCategoryIndex = i;
          if (processedCategories[i].isSystemCategory !== true) {
            processedCategories[i].isSystemCategory = true; // Flag it
            wasActuallyChangedOverall = true;
          }
          break;
        }
      }
    }
    
    // Standardize properties if a system category (newly flagged or existing) was found
    if (designatedSystemCategoryIndex !== -1) {
      const systemCat = processedCategories[designatedSystemCategoryIndex];
      if (systemCat.name !== sysName) { systemCat.name = sysName; wasActuallyChangedOverall = true; }
      if (systemCat.subcategories && systemCat.subcategories.length > 0) { systemCat.subcategories = []; wasActuallyChangedOverall = true; }
      // BudgetedAmount for system categories is user-set, so we don't default it to 0 here unless it's undefined.
      if (systemCat.budgetedAmount === undefined || systemCat.budgetedAmount === null) { systemCat.budgetedAmount = 0; wasActuallyChangedOverall = true; }
      if (!Array.isArray(systemCat.expenses)) { systemCat.expenses = []; wasActuallyChangedOverall = true; }
      
      // Ensure no other category with the same system name is also flagged as system
      for (let i = 0; i < processedCategories.length; i++) {
        if (i !== designatedSystemCategoryIndex && processedCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
          if (processedCategories[i].isSystemCategory === true) {
            processedCategories[i].isSystemCategory = false; // Unflag duplicates
            wasActuallyChangedOverall = true;
          }
        }
      }
    }
  });

  // Process non-system categories for defaults and structure
  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat }; 
    let categorySpecificChange = false;
    const isKnownSystemName = systemCategoryNames.some(sysName => sysName.toLowerCase() === currentCat.name.toLowerCase());

    // If a category is flagged as system but its name doesn't match a known system name, unflag it.
    if (currentCat.isSystemCategory === true && !isKnownSystemName) {
        currentCat.isSystemCategory = false;
        categorySpecificChange = true;
    }
    
    // Ensure non-system categories are not flagged as system
    if (!isKnownSystemName && currentCat.isSystemCategory === true) {
        currentCat.isSystemCategory = false;
        categorySpecificChange = true;
    } else if (isKnownSystemName && currentCat.isSystemCategory === undefined) {
        // This case should ideally be handled by the passes above, but as a fallback:
        // If it's a system name and not yet flagged, this function isn't creating it,
        // but rather correcting flags if they were missing.
        // However, the main logic above should correctly identify and flag THE system category.
    }


    if (currentCat.isSystemCategory === false || currentCat.isSystemCategory === undefined) {
      if (currentCat.budgetedAmount === undefined || currentCat.budgetedAmount === null) { currentCat.budgetedAmount = 0; categorySpecificChange = true; }
      if (!Array.isArray(currentCat.expenses)) { currentCat.expenses = []; categorySpecificChange = true; }
      
      if (currentCat.subcategories === undefined) { currentCat.subcategories = []; categorySpecificChange = true;
      } else if (!Array.isArray(currentCat.subcategories)) { currentCat.subcategories = []; categorySpecificChange = true; }

      if (Array.isArray(currentCat.subcategories)) {
        let subsChangedOrRecalculated = false;
        currentCat.subcategories = currentCat.subcategories.map(sub => {
          let currentSub = { ...sub };
          let subModifiedInternal = false;
          if (currentSub.id === undefined) { currentSub.id = uuidv4(); subModifiedInternal = true; }
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
     if (!currentCat.id) { currentCat.id = uuidv4(); categorySpecificChange = true;}

    if (categorySpecificChange) wasActuallyChangedOverall = true;
    return currentCat;
  });

  const sortedCategories = [...processedCategories].sort((a, b) => {
    const aIsSystem = a.isSystemCategory || false;
    const bIsSystem = b.isSystemCategory || false;
    if (aIsSystem && !bIsSystem) return -1;
    if (!bIsSystem && aIsSystem) return 1;
    if (aIsSystem && bIsSystem) { 
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1; 
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  const finalOutputIsDifferentFromInput = wasActuallyChangedOverall || (JSON.stringify(categoriesInput) !== JSON.stringify(sortedCategories));

  return { 
    updatedCategories: finalOutputIsDifferentFromInput ? sortedCategories : categoriesInput, 
    wasChanged: finalOutputIsDifferentFromInput 
  };
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
  const isProcessingSnapshot = useRef(false);


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
  }, [budgetMonthsState]); // Added budgetMonthsState as createNewMonthBudget uses it

  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return; 
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSavingDb(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      let hasMeaningfulDataToSave = false;

      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        monthsWithEnsuredCategories[monthId] = {
            ...month,
            incomes: Array.isArray(month.incomes) ? month.incomes : [], 
            startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt, 
            isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver, 
            categories: month.categories || [], 
        };
        if ((month.categories && month.categories.length > 0) || 
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
  }, [toast]); // Removed isSavingDb from dependency array

  const debouncedSave = useCallback(
    debounce((dataToSave: Record<string, BudgetMonth>) => {
      if (isUserAuthenticated && user) {
        if (!isSavingDb) { 
            saveBudgetMonthsToFirestore(user.uid, dataToSave);
        }
      } else if (!isUserAuthenticated && typeof window !== "undefined") {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(dataToSave));
      }
    }, 1000),
    [isUserAuthenticated, user, saveBudgetMonthsToFirestore, isSavingDb] // isSavingDb is needed here to check before calling
  );

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(currentGlobalBudgetMonthsState => {
      const newCandidateMonths = typeof updater === 'function' ? updater(currentGlobalBudgetMonthsState) : updater;
      
      let finalProcessedMonths: Record<string, BudgetMonth> = {};
      let wasAnyDataStructurallyModifiedDuringProcessing = false;

      for (const monthId in newCandidateMonths) {
        const monthInput = newCandidateMonths[monthId];
        if (!monthInput) continue;

        let month = JSON.parse(JSON.stringify(monthInput)); 
        let monthChangedThisIteration = false;

        if (!month.id) { month.id = monthId; monthChangedThisIteration = true; }
        if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthChangedThisIteration = true; }
        if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthChangedThisIteration = true; }
        if (!Array.isArray(month.incomes)) { month.incomes = []; monthChangedThisIteration = true; }
        if (month.categories === undefined) { month.categories = []; monthChangedThisIteration = true; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; monthChangedThisIteration = true; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthChangedThisIteration = true; }
        
        const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(month.categories);
        month.categories = updatedCategories; 
        if (catsStructurallyChanged) {
          monthChangedThisIteration = true;
        }

        if(monthChangedThisIteration) wasAnyDataStructurallyModifiedDuringProcessing = true;
        finalProcessedMonths[monthId] = month;
      }
      
      if (JSON.stringify(currentGlobalBudgetMonthsState) === JSON.stringify(finalProcessedMonths) && !wasAnyDataStructurallyModifiedDuringProcessing) {
        return currentGlobalBudgetMonthsState; 
      }
      
      debouncedSave(finalProcessedMonths);
      return finalProcessedMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, debouncedSave]);


  // Main effect for loading data from Firestore or localStorage
  useEffect(() => {
    if (authLoading) {
      if (!initialLoadDoneForUserRef.current[user?.uid || 'guest']) {
          setIsLoadingDb(true);
      }
      return;
    }

    const currentUserKey = user?.uid || 'guest';
    const isInitialLoadForThisUser = !initialLoadDoneForUserRef.current[currentUserKey];

    if (isInitialLoadForThisUser) {
      setIsLoadingDb(true); 
    }

    let unsubscribe = () => {};

    const loadData = async () => {
        if (isProcessingSnapshot.current && initialLoadDoneForUserRef.current[currentUserKey]) {
             // If a snapshot is already being processed AND initial load is done, prevent re-entry
             // This helps avoid issues if onSnapshot fires rapidly for the same logical data.
            return;
        }
        isProcessingSnapshot.current = true;

        try {
            if (isUserAuthenticated && user) {
                const docRef = getFirestoreUserBudgetDocRef(user.uid);
                unsubscribe = onSnapshot(docRef, (docSnap) => {
                    let loadedRawMonths: Record<string, BudgetMonth> | undefined;
                    if (docSnap.exists()) {
                        const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                        loadedRawMonths = data.months || {};
                    } else {
                        loadedRawMonths = {}; 
                    }
                    
                    let clonedSnapshot = loadedRawMonths ? JSON.parse(JSON.stringify(loadedRawMonths)) : {};
                    
                    if (!clonedSnapshot[currentDisplayMonthId]) {
                        clonedSnapshot[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, clonedSnapshot);
                    }
                    
                    setBudgetMonths(clonedSnapshot); 

                    if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                        initialLoadDoneForUserRef.current[currentUserKey] = true;
                    }
                    setIsLoadingDb(false); 
                    isProcessingSnapshot.current = false;
                }, (error) => {
                    console.error("Error in Firestore onSnapshot:", error);
                    setBudgetMonths({}); 
                    setIsLoadingDb(false);
                    isProcessingSnapshot.current = false;
                    toast({title: "Firestore Error", description: "Could not load budget data from cloud.", variant: "destructive"});
                });
            } else if (typeof window !== "undefined") { 
                const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
                let rawMonthsFromSource: Record<string, BudgetMonth> | undefined;
                if (localData) {
                    try {
                        rawMonthsFromSource = JSON.parse(localData) as Record<string, BudgetMonth>;
                    } catch (e) {
                        console.error("Error parsing guest budget data:", e);
                        localStorage.removeItem(GUEST_BUDGET_MONTHS_KEY); 
                        rawMonthsFromSource = {};
                    }
                } else {
                    rawMonthsFromSource = {};
                }

                let processedLocal = rawMonthsFromSource ? JSON.parse(JSON.stringify(rawMonthsFromSource)) : {};

                if (!processedLocal[currentDisplayMonthId]) {
                    processedLocal[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedLocal);
                }
                
                setBudgetMonths(processedLocal);

                if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                    initialLoadDoneForUserRef.current[currentUserKey] = true;
                }
                setIsLoadingDb(false);
                isProcessingSnapshot.current = false;
            } else { 
                const initialEmpty = { [currentDisplayMonthId]: createNewMonthBudget(currentDisplayMonthId, {}) };
                setBudgetMonths(initialEmpty);
                if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                     initialLoadDoneForUserRef.current[currentUserKey] = true;
                }
                setIsLoadingDb(false);
                isProcessingSnapshot.current = false;
            }
        } catch (e: any) { 
            console.error("Critical error during budget data initialization:", e);
            setBudgetMonths({}); 
            setIsLoadingDb(false); 
            isProcessingSnapshot.current = false;
            toast({ title: "Initialization Error", description: e.message || "Failed to initialize budget data.", variant: "destructive" });
        }
    };
    
    loadData();

    return () => {
      unsubscribe(); 
      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current); 
      }
      // Do not reset isProcessingSnapshot.current here, as snapshot might still be processing on unmount
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, toast, setBudgetMonths ]);


  // Effect to sync currentDisplayMonthId to localStorage when it changes or user changes
  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { 
        const key = getDisplayMonthKey(user?.uid);
        const storedMonthId = localStorage.getItem(key);
        if (storedMonthId !== currentDisplayMonthId) {
             localStorage.setItem(key, currentDisplayMonthId);
        }
    }
  }, [currentDisplayMonthId, user, authLoading]);

  // Effect to reset initialLoadDone flag when authentication state changes
  useEffect(() => { 
    initialLoadDoneForUserRef.current = {};
    setIsLoadingDb(true);
  }, [isUserAuthenticated, user]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    const existingMonth = budgetMonthsState[yearMonthId];
    if (existingMonth) {
        let monthCopy = JSON.parse(JSON.stringify(existingMonth));
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories || []);
        monthCopy.categories = updatedCategories;
        // Check if other default fields need setting
        let otherFieldsChanged = false;
        if (!monthCopy.id) { monthCopy.id = yearMonthId; otherFieldsChanged = true; }
        if (!monthCopy.year) { monthCopy.year = parseYearMonth(yearMonthId).getFullYear(); otherFieldsChanged = true; }
        if (!monthCopy.month) { monthCopy.month = parseYearMonth(yearMonthId).getMonth() + 1; otherFieldsChanged = true; }
        if (!Array.isArray(monthCopy.incomes)) { monthCopy.incomes = []; otherFieldsChanged = true; }
        if (monthCopy.isRolledOver === undefined) { monthCopy.isRolledOver = false; otherFieldsChanged = true; }
        if (monthCopy.startingCreditCardDebt === undefined) { monthCopy.startingCreditCardDebt = 0; otherFieldsChanged = true; }


        if (catsChanged || otherFieldsChanged || JSON.stringify(existingMonth) !== JSON.stringify(monthCopy) ) {
             setBudgetMonths(prev => ({...prev, [yearMonthId]: monthCopy}));
        }
        return budgetMonthsState[yearMonthId] || monthCopy;
    } else {
        const newMonth = createNewMonthBudget(yearMonthId, budgetMonthsState);
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: newMonth }));
        return newMonth; 
    }
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
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
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
  }, []);

  const navigateToNextMonth = useCallback(() => {
    setCurrentDisplayMonthIdState(prevId => {
      const currentDate = parseYearMonth(prevId);
      currentDate.setMonth(currentDate.getMonth() + 1);
      return getYearMonthFromDate(currentDate);
    });
  }, []);

  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
  }, []);

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

      const isPotentiallySystem = ["savings", "credit card payments"].includes(categoryName.toLowerCase());
      let finalName = categoryName;
      if (categoryName.toLowerCase() === "savings") finalName = "Savings";
      if (categoryName.toLowerCase() === "credit card payments") finalName = "Credit Card Payments";


      const newCategory: BudgetCategory = {
        id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [],
        isSystemCategory: isPotentiallySystem, 
      };

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
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
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
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

        let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));
        const initialCategoriesCount = monthToUpdate.categories?.length || 0;
        monthToUpdate.categories = (monthToUpdate.categories || []).filter((cat: BudgetCategory) => cat.id !== categoryId);
        const finalCategoriesCount = monthToUpdate.categories?.length || 0;


        if (initialCategoriesCount === finalCategoriesCount && initialCategoriesCount > 0) { // check initialCategoriesCount > 0 to ensure we don't skip if list was empty
            return prevMonths; 
        }
        
        return { ...prevMonths, [yearMonthId]: monthToUpdate };
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
      
      return { ...prevMonths, [monthId]: monthToUpdate };
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
      
      return { ...prevMonths, [monthId]: monthToUpdate };
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

        if (initialSubCount === finalSubCount && initialSubCount > 0) return prevMonths; 
        
        return { ...prevMonths, [monthId]: monthToUpdate };
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

          let finalBudgetedAmount = sCat.budgetedAmount === undefined || sCat.budgetedAmount === null ? 0 : sCat.budgetedAmount;
          const subcategories = (sCat.subcategories || []).map(sSub => ({
            id: uuidv4(),
            name: sSub.name,
            budgetedAmount: sSub.budgetedAmount === undefined || sSub.budgetedAmount === null ? 0 : sSub.budgetedAmount,
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
        
        const newMonthBudget: BudgetMonth = {
          id: targetMonthId,
          year: targetYear,
          month: targetMonthNum,
          incomes: [{ id: uuidv4(), description: "Projected Income (AI Basis)", amount: incomeForTargetMonth, dateAdded: new Date().toISOString() }],
          categories: newCategories,
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

    