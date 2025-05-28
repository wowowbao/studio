
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

const getDisplayMonthKey = (userId?: string | null): string => {
  return userId ? `budgetFlow_displayMonth_${userId}` : 'budgetFlow_displayMonth_guest';
};

// This function is a utility and should NOT use any React hooks.
// It returns an object: { updatedCategories: BudgetCategory[], wasChanged: boolean }
// wasChanged is true ONLY if semantic data changed (flags, names, structure), not just array order from sorting.
const ensureSystemCategoryFlags = (categoriesInput: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categoriesInput) {
    return { updatedCategories: [], wasChanged: false };
  }

  let processedCategories = JSON.parse(JSON.stringify(categoriesInput)) as BudgetCategory[];
  let wasActuallyChangedOverall = false; 

  const systemCategoryDefinitions = [
    { name: "Savings", defaultBudget: 0 },
    { name: "Credit Card Payments", defaultBudget: 0 }
  ];

  systemCategoryDefinitions.forEach(sysDef => {
    let designatedSystemCategoryIndex = -1;
    
    // Pass 1: Find an existing category already correctly flagged as system for this name
    for (let i = 0; i < processedCategories.length; i++) {
      if (processedCategories[i].isSystemCategory === true && processedCategories[i].name === sysDef.name) {
        designatedSystemCategoryIndex = i;
        // Standardize properties for the identified system category
        if (processedCategories[i].subcategories && processedCategories[i].subcategories.length > 0) {
            processedCategories[i].subcategories = []; wasActuallyChangedOverall = true;
        }
        if (processedCategories[i].budgetedAmount === undefined || processedCategories[i].budgetedAmount === null) {
            processedCategories[i].budgetedAmount = sysDef.defaultBudget; wasActuallyChangedOverall = true;
        }
        if (!Array.isArray(processedCategories[i].expenses)) {
            processedCategories[i].expenses = []; wasActuallyChangedOverall = true;
        }
        break;
      }
    }

    // Pass 2: If no explicitly flagged system category was found, find the first category by name and flag it.
    if (designatedSystemCategoryIndex === -1) {
      for (let i = 0; i < processedCategories.length; i++) {
        if (processedCategories[i].name.toLowerCase() === sysDef.name.toLowerCase()) {
          designatedSystemCategoryIndex = i;
          if (processedCategories[i].isSystemCategory !== true) {
            processedCategories[i].isSystemCategory = true; wasActuallyChangedOverall = true;
          }
          if (processedCategories[i].name !== sysDef.name) {
            processedCategories[i].name = sysDef.name; wasActuallyChangedOverall = true;
          }
          if (processedCategories[i].subcategories && processedCategories[i].subcategories.length > 0) {
            processedCategories[i].subcategories = []; wasActuallyChangedOverall = true;
          }
           if (processedCategories[i].budgetedAmount === undefined || processedCategories[i].budgetedAmount === null) {
            processedCategories[i].budgetedAmount = sysDef.defaultBudget; wasActuallyChangedOverall = true;
          }
          if (!Array.isArray(processedCategories[i].expenses)) {
            processedCategories[i].expenses = []; wasActuallyChangedOverall = true;
          }
          break; 
        }
      }
    }
    
    // Pass 3: Ensure no other category with the same system name is also flagged as system
    for (let i = 0; i < processedCategories.length; i++) {
        if (i !== designatedSystemCategoryIndex && processedCategories[i].name.toLowerCase() === sysDef.name.toLowerCase()) {
            if (processedCategories[i].isSystemCategory === true) {
                processedCategories[i].isSystemCategory = false; // Unflag duplicates
                wasActuallyChangedOverall = true;
            }
        }
    }
  });
  
  // Pass 4: Process non-system categories for defaults and structure
  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat }; 
    let categorySpecificSemanticChange = false; 
    const isKnownSystemName = systemCategoryDefinitions.some(sysDef => sysDef.name.toLowerCase() === currentCat.name.toLowerCase());

    if (currentCat.isSystemCategory === true && !isKnownSystemName) {
        currentCat.isSystemCategory = false; categorySpecificSemanticChange = true;
    }
    
    if (!isKnownSystemName && currentCat.isSystemCategory !== false) {
        currentCat.isSystemCategory = false; categorySpecificSemanticChange = true;
    }

    if (currentCat.isSystemCategory === false) {
      if (currentCat.budgetedAmount === undefined || currentCat.budgetedAmount === null) { currentCat.budgetedAmount = 0; categorySpecificSemanticChange = true; }
      if (!Array.isArray(currentCat.expenses)) { currentCat.expenses = []; categorySpecificSemanticChange = true; }
      
      if (currentCat.subcategories === undefined) { currentCat.subcategories = []; categorySpecificSemanticChange = true;
      } else if (!Array.isArray(currentCat.subcategories)) { currentCat.subcategories = []; categorySpecificSemanticChange = true; }

      if (Array.isArray(currentCat.subcategories)) {
        let subsStructurallyChanged = false;
        currentCat.subcategories = currentCat.subcategories.map(sub => {
          let currentSub = { ...sub };
          let subModifiedInternal = false;
          if (currentSub.id === undefined) { currentSub.id = uuidv4(); subModifiedInternal = true; }
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
     if (!currentCat.id) { currentCat.id = uuidv4(); categorySpecificSemanticChange = true;}

    if (categorySpecificSemanticChange) wasActuallyChangedOverall = true;
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
      if (a.name === "Credit Card Payments" && b.name !== "Savings") return -1; 
      if (b.name === "Credit Card Payments" && a.name !== "Savings") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  const finalOutputString = JSON.stringify(sortedCategories);
  const originalInputStringSorted = JSON.stringify([...categoriesInput].sort((a,b) => a.name.localeCompare(b.name))); // Sort original for fair comparison of structure
  
  if (wasActuallyChangedOverall || finalOutputString !== originalInputStringSorted) {
     return { updatedCategories: sortedCategories, wasChanged: true };
  }
  
  return { updatedCategories: categoriesInput, wasChanged: false };
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
  const debounceSaveRef = useRef<any>(null);


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
      monthEndFeedback: undefined, // New month has no feedback yet
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
            monthEndFeedback: month.monthEndFeedback // Persist feedback
        };
        if ((processedCategories && processedCategories.length > 0) || 
            (monthsWithProcessedCategories[monthId].incomes && monthsWithProcessedCategories[monthId].incomes.length > 0) || 
            monthsWithProcessedCategories[monthId].startingCreditCardDebt || 
            monthsWithProcessedCategories[monthId].isRolledOver ||
            monthsWithProcessedCategories[monthId].monthEndFeedback
            ) {
            hasMeaningfulDataToSave = true;
        }
      }
      
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length > 0) { 
          await setDoc(docRef, { months: monthsWithProcessedCategories });
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
      
      let finalProcessedMonths: Record<string, BudgetMonth> = {};
      let wasAnyDataStructurallyModifiedDuringProcessing = false;

      for (const monthId in newCandidateMonths) {
        const monthInput = newCandidateMonths[monthId];
        if (!monthInput) continue;

        let month = JSON.parse(JSON.stringify(monthInput)); 
        let monthSemanticallyChangedThisIteration = false;

        if (!month.id) { month.id = monthId; monthSemanticallyChangedThisIteration = true; }
        if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthSemanticallyChangedThisIteration = true; }
        if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthSemanticallyChangedThisIteration = true; }
        if (!Array.isArray(month.incomes)) { month.incomes = []; monthSemanticallyChangedThisIteration = true; }
        if (month.categories === undefined) { month.categories = []; monthSemanticallyChangedThisIteration = true; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; monthSemanticallyChangedThisIteration = true; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthSemanticallyChangedThisIteration = true; }
        if (month.monthEndFeedback === undefined) { month.monthEndFeedback = undefined; } // Ensure it's present or undefined
        
        const { updatedCategories, wasChanged: catsSemanticallyChanged } = ensureSystemCategoryFlags(month.categories);
        month.categories = updatedCategories; 
        if (catsSemanticallyChanged) {
          monthSemanticallyChangedThisIteration = true;
        }

        if(monthSemanticallyChangedThisIteration) wasAnyDataStructurallyModifiedDuringProcessing = true;
        finalProcessedMonths[monthId] = month;
      }
      
      const currentGlobalStateString = JSON.stringify(currentGlobalBudgetMonthsState);
      const finalProcessedStateString = JSON.stringify(finalProcessedMonths);

      if (currentGlobalStateString === finalProcessedStateString) {
        return currentGlobalBudgetMonthsState; 
      }

      if (isUserAuthenticated && user) {
        if (debounceSaveRef.current) debounceSaveRef.current.cancel();
        debounceSaveRef.current = debounce(() => {
          if (!isSavingDb) {
             saveBudgetMonthsToFirestore(user.uid, finalProcessedMonths);
          }
        }, 1500);
        debounceSaveRef.current();
      } else if (!isUserAuthenticated && typeof window !== "undefined") {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(finalProcessedMonths));
      }
      return finalProcessedMonths; 
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, saveBudgetMonthsToFirestore, isSavingDb]);


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
    
    setIsLoadingDb(true);
    initialLoadDoneForUserRef.current[currentUserKey] = false;

    const loadData = async () => {
        try {
            let rawMonthsFromSource: Record<string, BudgetMonth> = {};

            if (isUserAuthenticated && user) {
                const docRef = getFirestoreUserBudgetDocRef(user.uid);
                firestoreUnsubscribeRef.current = onSnapshot(docRef, (docSnap) => {
                    let loadedRawMonths: Record<string, BudgetMonth> | undefined;
                    if (docSnap.exists()) {
                        const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                        loadedRawMonths = data.months || {};
                    } else {
                        loadedRawMonths = {}; 
                    }
                    
                    let processedSnapshot = loadedRawMonths ? JSON.parse(JSON.stringify(loadedRawMonths)) : {};
                    let anyMonthProcessedChangedSemantically = false;

                    for (const monthId in processedSnapshot) {
                        const month = processedSnapshot[monthId];
                        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories || []);
                        processedSnapshot[monthId].categories = updatedCategories;
                        if(catsChanged) anyMonthProcessedChangedSemantically = true;
                        if (!processedSnapshot[monthId].id) {processedSnapshot[monthId].id = monthId; anyMonthProcessedChangedSemantically=true;}
                        if (!processedSnapshot[monthId].year) {processedSnapshot[monthId].year = parseYearMonth(monthId).getFullYear(); anyMonthProcessedChangedSemantically=true;}
                        if (!processedSnapshot[monthId].month) {processedSnapshot[monthId].month = parseYearMonth(monthId).getMonth() + 1; anyMonthProcessedChangedSemantically=true;}
                        if (!Array.isArray(processedSnapshot[monthId].incomes)) {processedSnapshot[monthId].incomes = []; anyMonthProcessedChangedSemantically=true;}
                        if (processedSnapshot[monthId].isRolledOver === undefined) {processedSnapshot[monthId].isRolledOver = false; anyMonthProcessedChangedSemantically=true;}
                        if (processedSnapshot[monthId].startingCreditCardDebt === undefined) {processedSnapshot[monthId].startingCreditCardDebt = 0; anyMonthProcessedChangedSemantically=true;}
                         if (processedSnapshot[monthId].monthEndFeedback === undefined) { processedSnapshot[monthId].monthEndFeedback = undefined; }

                    }
                    
                    if (!processedSnapshot[currentDisplayMonthId]) {
                        processedSnapshot[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedSnapshot);
                        anyMonthProcessedChangedSemantically = true; 
                    } else {
                        const currentMonthData = processedSnapshot[currentDisplayMonthId];
                        const { updatedCategories, wasChanged: currentCatsChanged } = ensureSystemCategoryFlags(currentMonthData.categories || []);
                        if (JSON.stringify(processedSnapshot[currentDisplayMonthId].categories) !== JSON.stringify(updatedCategories) || currentCatsChanged) {
                           processedSnapshot[currentDisplayMonthId].categories = updatedCategories;
                           anyMonthProcessedChangedSemantically = true;
                        }
                    }
                    
                    setBudgetMonthsState(currentState => {
                        if (JSON.stringify(currentState) !== JSON.stringify(processedSnapshot)) {
                            return processedSnapshot;
                        }
                        return currentState;
                    });

                    if (!initialLoadDoneForUserRef.current[currentUserKey]) {
                        setIsLoadingDb(false); 
                        initialLoadDoneForUserRef.current[currentUserKey] = true;
                    }

                }, (error) => {
                    console.error("Error in Firestore onSnapshot:", error);
                    setBudgetMonthsState({}); 
                    setIsLoadingDb(false);
                    initialLoadDoneForUserRef.current[currentUserKey] = true;
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
            
            let processedData = rawMonthsFromSource ? JSON.parse(JSON.stringify(rawMonthsFromSource)) : {};
            let anyProcessedDataChangedSemantically = false;

            for (const monthId in processedData) {
                const month = processedData[monthId];
                const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories || []);
                processedData[monthId].categories = updatedCategories;
                if(catsChanged) anyProcessedDataChangedSemantically = true;
                if (!processedData[monthId].id) { processedData[monthId].id = monthId; anyProcessedDataChangedSemantically = true;}
                if (!processedData[monthId].year) { processedData[monthId].year = parseYearMonth(monthId).getFullYear(); anyProcessedDataChangedSemantically = true; }
                if (!processedData[monthId].month) { processedData[monthId].month = parseYearMonth(monthId).getMonth() + 1; anyProcessedDataChangedSemantically = true; }
                if (!Array.isArray(processedData[monthId].incomes)) { processedData[monthId].incomes = []; anyProcessedDataChangedSemantically = true; }
                if (processedData[monthId].isRolledOver === undefined) { processedData[monthId].isRolledOver = false; anyProcessedDataChangedSemantically = true; }
                if (processedData[monthId].startingCreditCardDebt === undefined) { processedData[monthId].startingCreditCardDebt = 0; anyProcessedDataChangedSemantically = true; }
                if (processedData[monthId].monthEndFeedback === undefined) { processedData[monthId].monthEndFeedback = undefined; }
            }

            if (!processedData[currentDisplayMonthId]) {
                processedData[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedData);
                anyProcessedDataChangedSemantically = true;
            } else {
                 const currentMonthData = processedData[currentDisplayMonthId];
                 const { updatedCategories, wasChanged: currentCatsChanged } = ensureSystemCategoryFlags(currentMonthData.categories || []);
                 if(JSON.stringify(processedData[currentDisplayMonthId].categories) !== JSON.stringify(updatedCategories) || currentCatsChanged){
                    processedData[currentDisplayMonthId].categories = updatedCategories;
                    anyProcessedDataChangedSemantically = true;
                 }
            }
            
            setBudgetMonthsState(currentState => {
                if (JSON.stringify(currentState) !== JSON.stringify(processedData)) {
                    return processedData;
                }
                return currentState;
            });
            initialLoadDoneForUserRef.current[currentUserKey] = true;

        } catch (e: any) { 
            console.error("Critical error during budget data initialization:", e);
            setBudgetMonthsState({}); 
            toast({ title: "Initialization Error", description: e.message || "Failed to initialize budget data.", variant: "destructive" });
        } finally {
           if(!isUserAuthenticated || !user){ // Only for guest mode, Firestore handles its own loading flag
               setIsLoadingDb(false);
           }
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
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, toast, budgetMonthsState]); 

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
    const existingMonth = budgetMonthsState[yearMonthId];
    if (existingMonth) {
        let monthCopy = JSON.parse(JSON.stringify(existingMonth));
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories || []);
        
        let otherFieldsPotentiallyChanged = false;
        if (monthCopy.id !== yearMonthId) { monthCopy.id = yearMonthId; otherFieldsPotentiallyChanged = true; }
        if (monthCopy.monthEndFeedback === undefined) { monthCopy.monthEndFeedback = undefined; }


        if (JSON.stringify(monthCopy.categories) !== JSON.stringify(updatedCategories)) {
            monthCopy.categories = updatedCategories;
            otherFieldsPotentiallyChanged = true;
        }

        if (catsChanged || otherFieldsPotentiallyChanged || JSON.stringify(existingMonth) !== JSON.stringify(monthCopy) ) {
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

      let hasChanged = false;
      if (payload.startingCreditCardDebt !== undefined && monthToUpdate.startingCreditCardDebt !== payload.startingCreditCardDebt) {
          monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
          hasChanged = true;
      }
      if (payload.monthEndFeedback !== undefined && monthToUpdate.monthEndFeedback !== payload.monthEndFeedback) {
          monthToUpdate.monthEndFeedback = payload.monthEndFeedback;
          hasChanged = true;
      }


      if (payload.categories) {
        const originalCategoriesString = JSON.stringify(monthToUpdate.categories);
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
                            : (["Savings", "Credit Card Payments"].includes(catPayload.name)));
          
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
        if (originalCategoriesString !== JSON.stringify(monthToUpdate.categories)) {
            hasChanged = true;
        }
      }
      if(!hasChanged) return prevMonths;
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
          message = "Month finalized and closed. Any unspent operational funds implicitly contribute to your overall savings.";
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
        if (monthData.monthEndFeedback === feedback) return prevMonths; // No change
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

      const isPotentiallySystem = ["savings", "credit card payments"].includes(categoryName.toLowerCase());
      let finalName = categoryName;
      if (categoryName.toLowerCase() === "savings") finalName = "Savings";
      if (categoryName.toLowerCase() === "credit card payments") finalName = "Credit Card Payments";

      const newCategory: BudgetCategory = {
        id: uuidv4(), name: finalName, budgetedAmount: 0, expenses: [], subcategories: [],
        isSystemCategory: isPotentiallySystem, 
      };

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      
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
      incomeBasisForBudget: number, 
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
          incomes: [{ id: uuidv4(), description: "Projected Income (AI Basis)", amount: incomeBasisForBudget, dateAdded: new Date().toISOString() }],
          categories: newCategories, 
          isRolledOver: false,
          startingCreditCardDebt: Math.max(0, startingCCDebtForTargetMonth), 
          monthEndFeedback: undefined, // New AI-generated month has no feedback yet
        };
        return { ...prevMonths, [targetMonthId]: newMonthBudget };
      });
    }, [setBudgetMonths] 
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

