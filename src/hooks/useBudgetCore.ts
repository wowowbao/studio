
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

export const getDisplayMonthKey = (userId?: string | null): string => {
  return userId ? `budgetFlow_displayMonth_${userId}` : 'budgetFlow_displayMonth_guest';
};

// This utility ensures categories are well-formed and system categories are correctly flagged.
// It returns an object: { updatedCategories: BudgetCategory[], wasChanged: boolean }
// `wasChanged` is true if any semantic data changed (flags, names, structure, default values), NOT just array order.
const ensureSystemCategoryFlags = (categoriesInput: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categoriesInput) {
    return { updatedCategories: [], wasChanged: false };
  }

  let processedCategories = JSON.parse(JSON.stringify(categoriesInput)) as BudgetCategory[];
  let wasActuallyChangedOverall = false;

  const systemCategoryDefinitions = [
    { name: "Savings", defaultBudget: 0 },
    { name: "Credit Card Payments", defaultBudget: 0 },
    { name: "Car Loan", defaultBudget: 0 }
  ];

  systemCategoryDefinitions.forEach(sysDef => {
    let designatedSystemCategoryIndex = -1;
    
    // Pass 1: Find an existing category ALREADY flagged as system for this name
    for (let i = 0; i < processedCategories.length; i++) {
      if (processedCategories[i].isSystemCategory === true && processedCategories[i].name === sysDef.name) {
        designatedSystemCategoryIndex = i;
        break;
      }
    }

    // Pass 2: If no explicitly flagged one, find the first category by name (case-insensitive) to designate
    if (designatedSystemCategoryIndex === -1) {
      for (let i = 0; i < processedCategories.length; i++) {
        if (processedCategories[i].name.toLowerCase() === sysDef.name.toLowerCase()) {
          designatedSystemCategoryIndex = i;
          break;
        }
      }
    }
    
    if (designatedSystemCategoryIndex !== -1) {
      const catToUpdate = processedCategories[designatedSystemCategoryIndex];
      if (catToUpdate.isSystemCategory !== true) { catToUpdate.isSystemCategory = true; wasActuallyChangedOverall = true; }
      if (catToUpdate.name !== sysDef.name) { catToUpdate.name = sysDef.name; wasActuallyChangedOverall = true; }
      if (catToUpdate.subcategories && catToUpdate.subcategories.length > 0) { catToUpdate.subcategories = []; wasActuallyChangedOverall = true; }
      // Preserve AI/user-set budget for system category if it exists, otherwise use defaultBudget (which is 0)
      if (catToUpdate.budgetedAmount === undefined || catToUpdate.budgetedAmount === null) {
           catToUpdate.budgetedAmount = sysDef.defaultBudget; // Default if not set
           // No wasActuallyChangedOverall here as it might be an initial setup from AI where budget is implicitly 0
      }
      if (!Array.isArray(catToUpdate.expenses)) { catToUpdate.expenses = []; wasActuallyChangedOverall = true; }
    } else {
      // System category definition not found by name in current categories. Add it.
      // This ensures system categories are always present if this function is called.
      processedCategories.push({
          id: uuidv4(),
          name: sysDef.name,
          budgetedAmount: sysDef.defaultBudget,
          expenses: [],
          subcategories: [],
          isSystemCategory: true,
      });
      wasActuallyChangedOverall = true;
    }
  });
  
  // Pass 3: Ensure no OTHER category with the same system name is also flagged as system (or shares the name if one was just promoted)
  systemCategoryDefinitions.forEach(sysDef => {
    const actualSystemCat = processedCategories.find(c => c.isSystemCategory && c.name === sysDef.name);
    if (actualSystemCat) {
        processedCategories.forEach(cat => {
            if (cat.id !== actualSystemCat.id && cat.name === sysDef.name && cat.isSystemCategory) {
                cat.isSystemCategory = false; // Unflag duplicates
                wasActuallyChangedOverall = true;
            }
        });
    }
  });


  // Pass 4: Process non-system categories for defaults and structure
  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat }; // Work on a copy
    let categorySpecificSemanticChange = false;

    // Ensure ID
    if (!currentCat.id) { currentCat.id = uuidv4(); categorySpecificSemanticChange = true; }

    const isKnownSystemName = systemCategoryDefinitions.some(sysDef => sysDef.name.toLowerCase() === currentCat.name.toLowerCase());

    if (currentCat.isSystemCategory) { // If it's currently flagged as system
      if (!isKnownSystemName || // it's not a defined system name
          (processedCategories.find(c => c.isSystemCategory && c.name === currentCat.name && c.id !== currentCat.id)) // or it's a duplicate system cat
      ) {
        currentCat.isSystemCategory = false; categorySpecificSemanticChange = true;
      }
    } else { // If it's not currently flagged as system
      if (currentCat.isSystemCategory !== false) { // And the flag isn't explicitly false
          currentCat.isSystemCategory = false; categorySpecificSemanticChange = true;
      }
    }
    
    // Defaults for non-system categories
    if (!currentCat.isSystemCategory) {
      if (currentCat.budgetedAmount === undefined || currentCat.budgetedAmount === null) { currentCat.budgetedAmount = 0; categorySpecificSemanticChange = true; }
      if (!Array.isArray(currentCat.expenses)) { currentCat.expenses = []; categorySpecificSemanticChange = true; }
      
      if (currentCat.subcategories === undefined) { currentCat.subcategories = []; categorySpecificSemanticChange = true;
      } else if (!Array.isArray(currentCat.subcategories)) { currentCat.subcategories = []; categorySpecificSemanticChange = true; }

      if (Array.isArray(currentCat.subcategories)) {
        let subsStructurallyChanged = false;
        currentCat.subcategories = currentCat.subcategories.map(sub => {
          let currentSub = { ...sub };
          let subModifiedInternal = false;
          if (!currentSub.id) { currentSub.id = uuidv4(); subModifiedInternal = true; }
          if (currentSub.budgetedAmount === undefined || currentSub.budgetedAmount === null) { currentSub.budgetedAmount = 0; subModifiedInternal = true; }
          if (!Array.isArray(currentSub.expenses)) { currentSub.expenses = []; subModifiedInternal = true; }
          if (subModifiedInternal) subsStructurallyChanged = true;
          return currentSub;
        });

        if (currentCat.subcategories.length > 0) {
            const newParentBudget = currentCat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            if (currentCat.budgetedAmount !== newParentBudget) {
                currentCat.budgetedAmount = newParentBudget;
                categorySpecificSemanticChange = true;
            }
        }
        if (subsStructurallyChanged) categorySpecificSemanticChange = true;
      }
    }
    if (categorySpecificSemanticChange) wasActuallyChangedOverall = true;
    return currentCat;
  });

  const sortedCategories = [...processedCategories].sort((a, b) => {
    const aIsSystem = a.isSystemCategory || false;
    const bIsSystem = b.isSystemCategory || false;
    if (aIsSystem && !bIsSystem) return -1;
    if (!bIsSystem && aIsSystem) return 1;
    if (aIsSystem && bIsSystem) {
        const order = ["Savings", "Credit Card Payments", "Car Loan"];
        const aIndex = order.indexOf(a.name);
        const bIndex = order.indexOf(b.name);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1; 
        if (bIndex !== -1) return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  // If wasActuallyChangedOverall is true OR if sorting changed the array order
  if (wasActuallyChangedOverall || JSON.stringify(processedCategories) !== JSON.stringify(sortedCategories)) {
     return { updatedCategories: sortedCategories, wasChanged: true };
  }
  
  // If no semantic changes and sorting didn't change order, return original reference IF possible
  // This check is tricky. Simplest is to always return sorted if any processing happened.
  // The stringify check at the setBudgetMonths level will be the ultimate decider.
  // For now, if wasActuallyChangedOverall, it implies a new structure even if stringify is same post-sort.
  if(wasActuallyChangedOverall) {
    return { updatedCategories: sortedCategories, wasChanged: true };
  }

  // If absolutely no semantic changes and input was already sorted, return original.
  // This is hard to guarantee without stringifying input before processing.
  // It's safer to return the processed (and potentially sorted) list and let the caller compare.
  // So, if we reached here, it means no semantic change. Check if sorting changed order.
  // The most robust is to let the caller (setBudgetMonths) do the final diff.
  // We return `wasActuallyChangedOverall` based on actual data mods.
  return { updatedCategories: sortedCategories, wasChanged: wasActuallyChangedOverall };
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

  const initialLoadDoneForUserRef = useRef<Record<string, boolean>>({});
  const firestoreUnsubscribeRef = useRef<(() => void) | null>(null);
  const debounceSaveRef = useRef<ReturnType<typeof debounce> | null>(null);


  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];

    let calculatedStartingDebt = 0;
    let carriedOverSystemCategories: BudgetCategory[] = [];

    if (prevMonthBudget) {
        (prevMonthBudget.categories || []).forEach(prevCat => {
            if (prevCat.isSystemCategory && ["Savings", "Credit Card Payments", "Car Loan"].includes(prevCat.name)) {
                carriedOverSystemCategories.push({
                    ...prevCat, 
                    id: uuidv4(), 
                    expenses: [], 
                    subcategories: [], 
                });
            }
        });

        const prevCCPaymentsCat = (prevMonthBudget.categories || []).find(cat => cat.isSystemCategory && cat.name.toLowerCase() === "credit card payments");
        const paymentsMadeLastMonth = prevCCPaymentsCat ? (prevCCPaymentsCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    
    const { updatedCategories: initialCategories } = ensureSystemCategoryFlags(carriedOverSystemCategories);

    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: initialCategories,
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
      monthEndFeedback: undefined,
    };
  }, []);

  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId || isSavingDb) return; 
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSavingDb(true);
    try {
      const monthsWithProcessedCategories: Record<string, BudgetMonth> = {};
      let hasMeaningfulDataToSave = false;

      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        const { updatedCategories: processedCategories } = ensureSystemCategoryFlags(month.categories || []);
        
        monthsWithProcessedCategories[monthId] = {
            ...month,
            categories: processedCategories,
            incomes: Array.isArray(month.incomes) ? month.incomes : [],
            startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt,
            isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver,
            monthEndFeedback: month.monthEndFeedback
        };
        if ((processedCategories && processedCategories.length > 0 && processedCategories.some(c => c.budgetedAmount > 0 || c.expenses.length > 0)) ||
            (monthsWithProcessedCategories[monthId].incomes && monthsWithProcessedCategories[monthId].incomes.length > 0) ||
            monthsWithProcessedCategories[monthId].startingCreditCardDebt ||
            monthsWithProcessedCategories[monthId].isRolledOver ||
            monthsWithProcessedCategories[monthId].monthEndFeedback
            ) {
            hasMeaningfulDataToSave = true;
        }
      }
      
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length !== Object.keys(budgetMonthsState).length) {
          await setDoc(docRef, { months: monthsWithProcessedCategories });
      }
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
      toast({ title: "Save Error", description: "Failed to save budget to cloud.", variant: "destructive" });
    } finally {
      setIsSavingDb(false); 
    }
  }, [isSavingDb, toast, budgetMonthsState]);


  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(currentGlobalBudgetMonthsState => {
      const newCandidateMonths = typeof updater === 'function' ? updater(currentGlobalBudgetMonthsState) : updater;
      
      // Process all months in the candidate state to ensure integrity
      const fullyProcessedNewCandidateMonths: Record<string, BudgetMonth> = {};
      for (const monthId in newCandidateMonths) {
        const monthInput = newCandidateMonths[monthId];
        if (!monthInput) continue;

        let month = JSON.parse(JSON.stringify(monthInput)); 
        if (!month.id) { month.id = monthId; }
        if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); }
        if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; }
        if (!Array.isArray(month.incomes)) { month.incomes = []; }
        if (month.categories === undefined) { month.categories = []; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; }
        
        const { updatedCategories: processedCategories } = ensureSystemCategoryFlags(month.categories);
        month.categories = processedCategories; 
        fullyProcessedNewCandidateMonths[monthId] = month;
      }
      
      const currentGlobalStateString = JSON.stringify(currentGlobalBudgetMonthsState);
      const finalProcessedStateString = JSON.stringify(fullyProcessedNewCandidateMonths);

      if (currentGlobalStateString === finalProcessedStateString) {
        return currentGlobalBudgetMonthsState; 
      }
      
      if (isUserAuthenticated && user) {
        if (debounceSaveRef.current) debounceSaveRef.current.cancel();
        debounceSaveRef.current = debounce(() => {
             saveBudgetMonthsToFirestore(user.uid, fullyProcessedNewCandidateMonths);
        }, 1500);
        debounceSaveRef.current();
      } else if (!isUserAuthenticated && typeof window !== "undefined") {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(fullyProcessedNewCandidateMonths));
      }
      return fullyProcessedNewCandidateMonths; 
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore, toast]); 


  useEffect(() => {
    if (authLoading) {
        setIsLoadingDb(true); 
        return;
    }

    const currentUserKey = user?.uid || 'guest';

    if (firestoreUnsubscribeRef.current) {
        firestoreUnsubscribeRef.current();
        firestoreUnsubscribeRef.current = null;
    }
    
    if (!initialLoadDoneForUserRef.current[currentUserKey]) {
        setIsLoadingDb(true);
    }

    const loadData = async () => {
        let rawMonthsFromSource: Record<string, BudgetMonth> = {};
        let dataOriginIsFirestore = false;

        if (isUserAuthenticated && user) {
            dataOriginIsFirestore = true;
            const docRef = getFirestoreUserBudgetDocRef(user.uid);
            firestoreUnsubscribeRef.current = onSnapshot(docRef, (docSnap) => {
                let loadedRawMonths: Record<string, BudgetMonth> | undefined;
                if (docSnap.exists()) {
                    const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                    loadedRawMonths = data.months || {};
                } else {
                    loadedRawMonths = {}; 
                }
                
                // Process the snapshot to ensure integrity BEFORE comparing with current state
                let processedSnapshot: Record<string, BudgetMonth> = loadedRawMonths ? JSON.parse(JSON.stringify(loadedRawMonths)) : {};
                for (const monthId in processedSnapshot) {
                    const month = processedSnapshot[monthId];
                    const { updatedCategories } = ensureSystemCategoryFlags(month.categories || []);
                    processedSnapshot[monthId].categories = updatedCategories;
                    if (!processedSnapshot[monthId].id) processedSnapshot[monthId].id = monthId;
                    if (!processedSnapshot[monthId].year) processedSnapshot[monthId].year = parseYearMonth(monthId).getFullYear();
                    if (!processedSnapshot[monthId].month) processedSnapshot[monthId].month = parseYearMonth(monthId).getMonth() + 1;
                    if (!Array.isArray(processedSnapshot[monthId].incomes)) processedSnapshot[monthId].incomes = [];
                    if (processedSnapshot[monthId].isRolledOver === undefined) processedSnapshot[monthId].isRolledOver = false;
                    if (processedSnapshot[monthId].startingCreditCardDebt === undefined) processedSnapshot[monthId].startingCreditCardDebt = 0;
                }
                
                if (!processedSnapshot[currentDisplayMonthId]) {
                    processedSnapshot[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedSnapshot);
                } else {
                    const currentMonthData = processedSnapshot[currentDisplayMonthId];
                    const { updatedCategories } = ensureSystemCategoryFlags(currentMonthData.categories || []);
                    if (JSON.stringify(processedSnapshot[currentDisplayMonthId].categories) !== JSON.stringify(updatedCategories)) {
                       processedSnapshot[currentDisplayMonthId].categories = updatedCategories;
                    }
                }
                
                // Call setBudgetMonths, which itself contains the logic to compare and save if needed
                setBudgetMonths(processedSnapshot);

                if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                    setIsLoadingDb(false); 
                    initialLoadDoneForUserRef.current[currentUserKey] = true;
                }

            }, (error) => {
                console.error("Error in Firestore onSnapshot:", error);
                setBudgetMonths({}); 
                if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                    setIsLoadingDb(false);
                    initialLoadDoneForUserRef.current[currentUserKey] = true;
                }
                toast({title: "Firestore Error", description: "Could not load budget data from cloud.", variant: "destructive"});
            });
            return; 
        } else if (typeof window !== "undefined") { 
            const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
            if (localData) {
                try { rawMonthsFromSource = JSON.parse(localData) as Record<string, BudgetMonth>; } 
                catch (e) { rawMonthsFromSource = {}; localStorage.removeItem(GUEST_BUDGET_MONTHS_KEY); }
            }
        }
        
        let processedData: Record<string, BudgetMonth> = rawMonthsFromSource ? JSON.parse(JSON.stringify(rawMonthsFromSource)) : {};
        for (const monthId in processedData) {
            const month = processedData[monthId];
            const { updatedCategories } = ensureSystemCategoryFlags(month.categories || []);
            processedData[monthId].categories = updatedCategories;
            if (!processedData[monthId].id) processedData[monthId].id = monthId;
            if (!processedData[monthId].year) processedData[monthId].year = parseYearMonth(monthId).getFullYear();
            if (!processedData[monthId].month) processedData[monthId].month = parseYearMonth(monthId).getMonth() + 1;
            if (!Array.isArray(processedData[monthId].incomes)) processedData[monthId].incomes = [];
            if (processedData[monthId].isRolledOver === undefined) processedData[monthId].isRolledOver = false;
            if (processedData[monthId].startingCreditCardDebt === undefined) processedData[monthId].startingCreditCardDebt = 0;
        }

        if (!processedData[currentDisplayMonthId]) {
            processedData[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedData);
        } else {
             const currentMonthData = processedData[currentDisplayMonthId];
             const { updatedCategories } = ensureSystemCategoryFlags(currentMonthData.categories || []);
             if(JSON.stringify(processedData[currentDisplayMonthId].categories) !== JSON.stringify(updatedCategories)){
                processedData[currentDisplayMonthId].categories = updatedCategories;
             }
        }
        
        setBudgetMonths(processedData);
        
        if (!initialLoadDoneForUserRef.current[currentUserKey]) {
            initialLoadDoneForUserRef.current[currentUserKey] = true;
            setIsLoadingDb(false); 
        }
    };
    
    loadData();

    return () => {
      if (firestoreUnsubscribeRef.current) {
        firestoreUnsubscribeRef.current();
      }
      if (debounceSaveRef.current) {
        debounceSaveRef.current.cancel();
      }
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, toast, setBudgetMonths, saveBudgetMonthsToFirestore]); 

  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { 
        const key = getDisplayMonthKey(user?.uid);
        const storedMonthId = localStorage.getItem(key);
        if (storedMonthId !== currentDisplayMonthId) {
             localStorage.setItem(key, currentDisplayMonthId);
        }
    }
  }, [currentDisplayMonthId, user, authLoading]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthToReturn: BudgetMonth;
    setBudgetMonths(prevMonths => {
        const existingMonth = prevMonths[yearMonthId];
        if (existingMonth) {
            let monthCopy = JSON.parse(JSON.stringify(existingMonth));
            const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories || []);
            monthCopy.categories = updatedCategories;
            
            // Ensure other fields are present
            if (!monthCopy.id) monthCopy.id = yearMonthId;
            if (!monthCopy.year) monthCopy.year = parseYearMonth(yearMonthId).getFullYear();
            if (!monthCopy.month) monthCopy.month = parseYearMonth(yearMonthId).getMonth() + 1;
            if (!Array.isArray(monthCopy.incomes)) monthCopy.incomes = [];
            if (monthCopy.isRolledOver === undefined) monthCopy.isRolledOver = false;
            if (monthCopy.startingCreditCardDebt === undefined) monthCopy.startingCreditCardDebt = 0;

            monthToReturn = monthCopy; // Assign to outer scope variable
            if (catsChanged || JSON.stringify(existingMonth) !== JSON.stringify(monthCopy)) {
                 return {...prevMonths, [yearMonthId]: monthCopy};
            }
            return prevMonths; // No change
        } else {
            const newMonth = createNewMonthBudget(yearMonthId, prevMonths);
            monthToReturn = newMonth; // Assign to outer scope variable
            return { ...prevMonths, [yearMonthId]: newMonth };
        }
    });
    // @ts-ignore monthToReturn will be assigned
    return monthToReturn || budgetMonthsState[yearMonthId] || createNewMonthBudget(yearMonthId, budgetMonthsState); // Fallback
  }, [setBudgetMonths, createNewMonthBudget, budgetMonthsState]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prevMonths => {
      const originalMonth = prevMonths[yearMonthId] ? prevMonths[yearMonthId] : createNewMonthBudget(yearMonthId, prevMonths);
      let monthToUpdate = JSON.parse(JSON.stringify(originalMonth)); 

      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
          return prevMonths; 
      }

      if (payload.startingCreditCardDebt !== undefined && monthToUpdate.startingCreditCardDebt !== payload.startingCreditCardDebt) {
          monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
      }
      if (payload.monthEndFeedback !== undefined && monthToUpdate.monthEndFeedback !== payload.monthEndFeedback) {
          monthToUpdate.monthEndFeedback = payload.monthEndFeedback;
      }

      if (payload.categories) {
        const newCategoriesFromPayload: BudgetCategory[] = payload.categories.map(catPayload => {
          const existingCatInOriginalMonth = originalMonth.categories?.find((c: BudgetCategory) => c.id === catPayload.id);
          
          const subcategoriesToSet = (catPayload.subcategories || []).map(subCatPayload => {
              const existingSubCat = existingCatInOriginalMonth?.subcategories?.find(sc => sc.id === subCatPayload.id);
              return {
                id: subCatPayload.id || uuidv4(), 
                name: subCatPayload.name,
                budgetedAmount: subCatPayload.budgetedAmount === undefined ? 0 : subCatPayload.budgetedAmount,
                expenses: existingSubCat?.expenses || [], 
              };
            });

          let finalBudgetedAmount = catPayload.budgetedAmount === undefined ? 0 : catPayload.budgetedAmount;
          if (!catPayload.isSystemCategory && subcategoriesToSet.length > 0) {
               finalBudgetedAmount = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }

          return {
            id: catPayload.id || uuidv4(), 
            name: catPayload.name,
            budgetedAmount: finalBudgetedAmount,
            expenses: existingCatInOriginalMonth?.expenses || [], 
            subcategories: catPayload.isSystemCategory ? [] : subcategoriesToSet,
            isSystemCategory: catPayload.isSystemCategory || false,
          };
        });
        monthToUpdate.categories = newCategoriesFromPayload;
      }
      
      const { updatedCategories: finalProcessedCategoriesAfterSystemCheck } = ensureSystemCategoryFlags(monthToUpdate.categories || []);
      monthToUpdate.categories = finalProcessedCategoriesAfterSystemCheck;
      
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
    });
  }, [createNewMonthBudget, setBudgetMonths, isUserAuthenticated, user]);


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
          const originalLength = (cat.expenses || []).length;
          cat.expenses = (cat.expenses || []).filter(exp => exp.id !== expenseId);
          if (cat.expenses.length < originalLength) expenseDeleted = true;
          return cat;
        } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          cat.subcategories = (cat.subcategories || []).map(sub => {
              if (sub.id === categoryOrSubCategoryId) {
                const originalLength = (sub.expenses || []).length;
                const newExpenses = (sub.expenses || []).filter(exp => exp.id !== expenseId);
                if (newExpenses.length < originalLength) expenseDeleted = true;
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

      if (monthToUpdate.incomes.length < initialLength) {
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
          message = "Month finalized and closed. This helps prepare for the next budget cycle.";
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

 const saveMonthEndFeedback = useCallback((yearMonthId: string, feedback: string) => {
    setBudgetMonths(prevMonths => {
      const monthData = prevMonths[yearMonthId];
      if (monthData) {
        if (monthData.monthEndFeedback === feedback) return prevMonths; 
        const updatedMonth = { ...monthData, monthEndFeedback: feedback as BudgetMonth['monthEndFeedback'] };
        return { ...prevMonths, [yearMonthId]: updatedMonth };
      }
      return prevMonths;
    });
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

      const systemCategoryNames = ["Savings", "Credit Card Payments", "Car Loan"];
      const isPotentiallySystem = systemCategoryNames.some(sysName => sysName.toLowerCase() === categoryName.toLowerCase());
      let finalName = categoryName;
      if (categoryName.toLowerCase() === "savings") finalName = "Savings";
      if (categoryName.toLowerCase() === "credit card payments") finalName = "Credit Card Payments";
      if (categoryName.toLowerCase() === "car loan") finalName = "Car Loan";


      const newCategory: BudgetCategory = {
        id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [],
        isSystemCategory: isPotentiallySystem, 
      };

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      
      // Ensure system flags are correctly applied after adding
      const { updatedCategories: processedAfterAdd } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = processedAfterAdd;
      
      if(JSON.stringify(originalMonth) === JSON.stringify(monthToUpdate)) return prevMonths;
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
          let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
          let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
          
          if (cat.name !== newName || cat.budgetedAmount !== newBudget) {
            categoryActuallyModified = true; 
          }
          
          if (cat.isSystemCategory) { 
            newName = cat.name; 
            if(updatedCategoryData.name !== undefined && updatedCategoryData.name !== cat.name) {
                categoryActuallyModified = categoryActuallyModified || (cat.budgetedAmount !== newBudget);
            }
          }
          
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              const subBudgetSum = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
              if (newBudget !== subBudgetSum) {
                newBudget = subBudgetSum; 
                categoryActuallyModified = true;
              }
          }
          
          return { ...cat, name: newName, budgetedAmount: newBudget }; 
        }
        return cat;
      });
      
      const { updatedCategories: processedAfterUpdate, wasChanged: systemFlagsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = processedAfterUpdate;

      if (!categoryActuallyModified && !systemFlagsChanged) return prevMonths; 
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

        const categoryToDelete = (originalMonth.categories || []).find(cat => cat.id === categoryId);
        if (categoryToDelete?.isSystemCategory) {
            toast({ title: "Action Denied", description: `Cannot delete system category: ${categoryToDelete.name}.`, variant: "destructive" });
            return prevMonths;
        }

        let monthToUpdate = JSON.parse(JSON.stringify(originalMonth));
        const initialCategoriesCount = (monthToUpdate.categories || []).length;
        monthToUpdate.categories = (monthToUpdate.categories || []).filter((cat: BudgetCategory) => cat.id !== categoryId);
        
        if (initialCategoriesCount === (monthToUpdate.categories || []).length) {
            return prevMonths; 
        }
        
        // Ensure system flags are correctly applied after deleting
        const { updatedCategories: processedAfterDelete } = ensureSystemCategoryFlags(monthToUpdate.categories);
        monthToUpdate.categories = processedAfterDelete;

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
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
      
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
            if (sub.name !== newName || sub.budgetedAmount !== newBudget) {
                subCategoryActuallyModified = true;
            }
            return { ...sub, name: newName, budgetedAmount: newBudget };
          }
          return sub;
        }
      );

      if (!subCategoryActuallyModified) return prevMonths; 
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
      
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
        
        if (initialSubCount === (monthToUpdate.categories[parentCatIndex].subcategories?.length || 0)) {
            return prevMonths; 
        }
        
        monthToUpdate.categories[parentCatIndex].budgetedAmount = (monthToUpdate.categories[parentCatIndex].subcategories || []).reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
        
        return { ...prevMonths, [monthId]: monthToUpdate };
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]);

  const applyAiGeneratedBudget = useCallback(
    (
      targetMonthId: string,
      suggestedBudgetCategoriesFromAI: PrepareBudgetOutput['suggestedCategories'],
      incomeForTargetMonth: number, // This is incomeBasisForBudget from AI
      startingCCDebtForTargetMonth: number, // This is initialInputs.currentEstimatedDebt
    ) => {
      setBudgetMonths(prevMonths => {
        const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
        
        const systemCategoryNames = ["Savings", "Credit Card Payments", "Car Loan"];
        let newCategories: BudgetCategory[] = (suggestedBudgetCategoriesFromAI || []).map(sCat => {
          let finalName = sCat.name;
          let isSystemByName = false;
          systemCategoryNames.forEach(sysName => {
              if (sCat.name.toLowerCase().includes(sysName.toLowerCase().replace(" payments", ""))) { // More lenient matching
                  finalName = sysName;
                  isSystemByName = true;
              }
          });
          
          let finalBudgetedAmount = sCat.budgetedAmount === undefined || sCat.budgetedAmount === null ? 0 : sCat.budgetedAmount;
          const subcategories = (sCat.subcategories || []).map(sSub => ({
            id: uuidv4(),
            name: sSub.name,
            budgetedAmount: sSub.budgetedAmount === undefined || sSub.budgetedAmount === null ? 0 : sSub.budgetedAmount,
            expenses: [],
          }));

          if (!isSystemByName && subcategories.length > 0) { 
            finalBudgetedAmount = subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
          }
          
          return {
            id: uuidv4(),
            name: finalName,
            budgetedAmount: finalBudgetedAmount,
            expenses: [],
            subcategories: isSystemByName ? [] : subcategories, 
            isSystemCategory: isSystemByName,
          };
        });
        
        systemCategoryNames.forEach(sysName => {
            if (!newCategories.some(cat => cat.name === sysName && cat.isSystemCategory)) {
                newCategories.push({
                    id: uuidv4(), name: sysName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true,
                });
            }
        });

        const { updatedCategories: finalProcessedAIBudget } = ensureSystemCategoryFlags(newCategories);

        const newMonthBudget: BudgetMonth = {
          id: targetMonthId,
          year: targetYear,
          month: targetMonthNum,
          incomes: incomeForTargetMonth > 0 ? [{ id: uuidv4(), description: "Projected Income (AI Basis)", amount: incomeForTargetMonth, dateAdded: new Date().toISOString() }] : [],
          categories: finalProcessedAIBudget, 
          isRolledOver: false,
          startingCreditCardDebt: Math.max(0, startingCCDebtForTargetMonth), 
          monthEndFeedback: undefined, 
        };
        return { ...prevMonths, [targetMonthId]: newMonthBudget };
      });
    }, [setBudgetMonths, createNewMonthBudget] 
  );

  return {
    budgetMonths: budgetMonthsState,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoadingDb || authLoading, 
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
    saveMonthEndFeedback,
    addSubCategory,
    updateSubCategory,
    deleteSubCategory,
    applyAiGeneratedBudget,
  };
};

