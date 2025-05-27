
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow';
import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';
import { useToast } from "@/hooks/use-toast"; // Import useToast

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
        processedCategories.push({
            id: uuidv4(),
            name: sysName,
            budgetedAmount: 0,
            expenses: [],
            subcategories: [],
            isSystemCategory: true,
        });
        designatedSystemCategoryIndex = processedCategories.length - 1;
        categoryDataModifiedThisPass = true;
    }


    // Pass 4: Standardize the designated system category and ensure all others with the same name are NOT system.
    if (designatedSystemCategoryIndex !== -1) {
      const systemCat = processedCategories[designatedSystemCategoryIndex];
      
      if (systemCat.isSystemCategory !== true) {
          systemCat.isSystemCategory = true;
          categoryDataModifiedThisPass = true;
      }
      if (systemCat.name !== sysName) {
        systemCat.name = sysName;
        categoryDataModifiedThisPass = true;
      }
      if (systemCat.subcategories && systemCat.subcategories.length > 0) {
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

  // Pass 5: Ensure all other categories (not matching system names) are not system and have defaults.
  processedCategories = processedCategories.map(cat => {
    let currentCat = { ...cat };
    let categorySpecificChange = false;
    const isSystemNameMatch = systemCategoryNames.some(sysName => sysName.toLowerCase() === currentCat.name.toLowerCase());

    if ((!isSystemNameMatch || (isSystemNameMatch && !currentCat.isSystemCategory)) && currentCat.isSystemCategory === true) {
        currentCat.isSystemCategory = false;
        categorySpecificChange = true;
    }
    
    if (!currentCat.isSystemCategory) {
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

        const newParentBudget = currentCat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        if (currentCat.budgetedAmount !== newParentBudget || subsChangedOrRecalculated) {
          currentCat.budgetedAmount = newParentBudget;
          categorySpecificChange = true;
        }
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
    if (!aIsSystem && bIsSystem) return 1;
    if (aIsSystem && bIsSystem) {
      if (a.name === "Savings") return -1;
      if (b.name === "Savings") return 1;
      if (a.name === "Credit Card Payments") return -1;
      if (b.name === "Credit Card Payments") return 1;
    }
    return a.name.localeCompare(b.name);
  });
  
  if (JSON.stringify(categoriesInput || []) !== JSON.stringify(sortedCategories)) {
    wasActuallyChangedOverall = true;
  }

  return { updatedCategories: wasActuallyChangedOverall ? sortedCategories : (categoriesInput || []), wasChanged: wasActuallyChangedOverall };
};

export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const { toast } = useToast(); // Moved useToast inside the hook body
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
  }, [isSavingDb, toast]); // ensureSystemCategoryFlags is not a hook, no need to list

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(prevMonths => {
        const newMonthsCandidate = typeof updater === 'function' ? updater(prevMonths) : updater;

        const processedMonths: Record<string, BudgetMonth> = {};
        let wasAnyDataStructurallyModified = false; 

        for (const monthId in newMonthsCandidate) {
            const month = newMonthsCandidate[monthId];
            let currentCategories = month.categories || [];

            const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(currentCategories);
            if (catsStructurallyChanged) wasAnyDataStructurallyModified = true; 

            processedMonths[monthId] = {
                ...month,
                id: monthId, 
                year: month.year || parseYearMonth(monthId).getFullYear(),
                month: month.month || (parseYearMonth(monthId).getMonth() + 1),
                categories: updatedCategories, 
                incomes: Array.isArray(month.incomes) ? month.incomes : [],
                isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver,
                startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt,
            };
        }
        
        const hasActualChange = JSON.stringify(prevMonths) !== JSON.stringify(processedMonths);
        
        if (!hasActualChange && !wasAnyDataStructurallyModified) {
          return prevMonths;
        }

        if (localSaveDebounceTimeoutRef.current) {
            clearTimeout(localSaveDebounceTimeoutRef.current);
        }
        localSaveDebounceTimeoutRef.current = setTimeout(() => {
            if (isUserAuthenticated && user) {
                saveBudgetMonthsToFirestore(user.uid, processedMonths);
            } else if (!isUserAuthenticated && typeof window !== "undefined") {
                localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(processedMonths));
            }
        }, 750); 

        return processedMonths;
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]); // ensureSystemCategoryFlags is not a hook

  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
  }, []);

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];

    let calculatedStartingDebt = 0;
    let carriedOverCategories: BudgetCategory[] = [];

    if (prevMonthBudget) {
        (prevMonthBudget.categories || []).forEach(prevCat => {
            if (prevCat.isSystemCategory && (prevCat.name === "Savings" || prevCat.name === "Credit Card Payments")) {
                carriedOverCategories.push({
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
  }, []); // ensureSystemCategoryFlags is not a hook

  const processAndSetBudgetData = useCallback((rawMonths: Record<string, BudgetMonth> | undefined, source: 'firestore' | 'localstorage' | 'initial') => {
    let processedMonths = rawMonths ? JSON.parse(JSON.stringify(rawMonths)) : {};
    let wasAnyDataStructurallyModifiedDuringProcessing = false;

    if (!processedMonths[currentDisplayMonthId] && (source === 'initial' || (isUserAuthenticated && source === 'firestore') || (!isUserAuthenticated && source === 'localstorage'))) {
        processedMonths[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedMonths);
        wasAnyDataStructurallyModifiedDuringProcessing = true; 
    }

    Object.keys(processedMonths).forEach(monthId => {
      const month = processedMonths[monthId];
      let monthChangedThisIteration = false;

      if (!month.id) { month.id = monthId; monthChangedThisIteration = true; }
      if (!month.year) { month.year = parseYearMonth(monthId).getFullYear(); monthChangedThisIteration = true; }
      if (!month.month) { month.month = parseYearMonth(monthId).getMonth() + 1; monthChangedThisIteration = true; }
      if (!Array.isArray(month.incomes)) { month.incomes = []; monthChangedThisIteration = true; }
      if (month.categories === undefined) { month.categories = []; monthChangedThisIteration = true; }

      const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(month.categories);
      if (catsStructurallyChanged) { 
        month.categories = updatedCategories; 
        monthChangedThisIteration = true;
      }

      if (month.isRolledOver === undefined) { month.isRolledOver = false; monthChangedThisIteration = true; }
      if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; monthChangedThisIteration = true; }
      
      if (monthChangedThisIteration) wasAnyDataStructurallyModifiedDuringProcessing = true;
    });

    if (JSON.stringify(budgetMonthsState) !== JSON.stringify(processedMonths) || wasAnyDataStructurallyModifiedDuringProcessing) {
        setBudgetMonths(processedMonths);
    }
  }, [currentDisplayMonthId, createNewMonthBudget, budgetMonthsState, setBudgetMonths, isUserAuthenticated]); // ensureSystemCategoryFlags is not a hook


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
        try {
            if (isUserAuthenticated && user) {
                const docRef = getFirestoreUserBudgetDocRef(user.uid);
                unsubscribe = onSnapshot(docRef, (docSnap) => {
                    let firestoreMonths: Record<string, BudgetMonth> = {};
                    if (docSnap.exists()) {
                    const data = docSnap.data() as { months: Record<string, BudgetMonth> };
                    firestoreMonths = data.months || {};
                    }
                    processAndSetBudgetData(firestoreMonths, 'firestore');
                    if (isInitialLoadForThisUser) {
                        initialLoadDoneForUserRef.current[user.uid] = true;
                    }
                    setIsLoadingDb(false); 
                }, (error) => {
                    console.error("Error fetching/processing budget from Firestore:", error);
                    processAndSetBudgetData({}, 'initial'); 
                    if (isInitialLoadForThisUser) {
                        initialLoadDoneForUserRef.current[user.uid!] = true;
                    }
                    setIsLoadingDb(false);
                    toast({title: "Firestore Error", description: "Could not load budget data from cloud.", variant: "destructive"});
                });
            } else if (typeof window !== "undefined") { 
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
                processAndSetBudgetData(guestMonths, 'localstorage');
                if (isInitialLoadForThisUser) {
                    initialLoadDoneForUserRef.current['guest'] = true;
                }
                setIsLoadingDb(false);
            } else { 
                processAndSetBudgetData({}, 'initial');
                 if (isInitialLoadForThisUser) {
                    initialLoadDoneForUserRef.current['guest'] = true; 
                }
                setIsLoadingDb(false);
            }
        } catch (e: any) { // Catch any synchronous error in loadData
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
  }, [user, isUserAuthenticated, authLoading, processAndSetBudgetData, currentDisplayMonthId, setBudgetMonths, toast]); // Added toast


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    const existingMonth = budgetMonthsState[yearMonthId];
    if (existingMonth) {
        const monthCopy = JSON.parse(JSON.stringify(existingMonth));
        let changed = false;
        if (!Array.isArray(monthCopy.incomes)) { monthCopy.incomes = []; changed = true; }
        if (monthCopy.categories === undefined) { monthCopy.categories = []; changed = true; }

        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthCopy.categories);
        if (catsChanged) { monthCopy.categories = updatedCategories; changed = true; }

        if (monthCopy.isRolledOver === undefined) { monthCopy.isRolledOver = false; changed = true; }
        if (monthCopy.startingCreditCardDebt === undefined) { monthCopy.startingCreditCardDebt = 0; changed = true; }
        
        if (!monthCopy.id) { monthCopy.id = yearMonthId; changed = true;}
        if (!monthCopy.year) { monthCopy.year = parseYearMonth(yearMonthId).getFullYear(); changed = true;}
        if (!monthCopy.month) { monthCopy.month = parseYearMonth(yearMonthId).getMonth() + 1; changed = true;}


        if(changed && JSON.stringify(existingMonth) !== JSON.stringify(monthCopy)){
            setBudgetMonths(prev => ({...prev, [yearMonthId]: monthCopy}));
            return monthCopy; 
        }
        return existingMonth; 
    }
    const newMonth = createNewMonthBudget(yearMonthId, budgetMonthsState);
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: newMonth }));
    return newMonth;
  }, [budgetMonthsState, createNewMonthBudget, setBudgetMonths]); // ensureSystemCategoryFlags is not a hook


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

          const isSystem = catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : (["savings", "credit card payments"].includes(catPayload.name.toLowerCase())));
          
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

      if (JSON.stringify(originalMonth) !== JSON.stringify(monthToUpdate) || sysFlagsChanged) {
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]); // ensureSystemCategoryFlags is not a hook


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
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              console.warn(`Attempted to add expense to parent category '${cat.name}' which has subcategories. Expense not added.`);
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

      monthToUpdate.categories = [...(monthToUpdate.categories || []), newCategory];
      const { updatedCategories: finalCatsWithNew } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCatsWithNew;


      if (JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)) {
        return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]); // ensureSystemCategoryFlags is not a hook

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
          let newIsSystem = cat.isSystemCategory;

          const isSavingsByName = newName.toLowerCase() === "savings";
          const isCCPaymentsByName = newName.toLowerCase() === "credit card payments";

          if (cat.isSystemCategory) { 
            newName = cat.name; 
          } else { 
            if (isSavingsByName) { newName = "Savings"; newIsSystem = true; }
            else if (isCCPaymentsByName) { newName = "Credit Card Payments"; newIsSystem = true; }
          }
          
          let subcategoriesToKeep = cat.subcategories || [];
          if (newIsSystem) { 
            subcategoriesToKeep = [];
          }

          if (!newIsSystem && subcategoriesToKeep.length > 0) {
              newBudget = subcategoriesToKeep.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
          
          return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem, subcategories: subcategoriesToKeep };
        }
        return cat;
      });

      if (!categoryActuallyModified) return prevMonths; 

      const { updatedCategories: finalCategoriesAfterSysFlags } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalCategoriesAfterSysFlags;

      if (JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)) {
         return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]); // ensureSystemCategoryFlags is not a hook

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
      
      const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories);
      monthToUpdate.categories = finalProcessedCategories;

      if (JSON.stringify(originalMonth) !== JSON.stringify(monthToUpdate)) { 
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [setBudgetMonths, isUserAuthenticated, user, toast]); // ensureSystemCategoryFlags is not a hook


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
        return prevMonths;
      }

      const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
      
      monthToUpdate.categories[parentCatIndex].subcategories = [
          ...(monthToUpdate.categories[parentCatIndex].subcategories || []), 
          newSubCategory
      ];
      monthToUpdate.categories[parentCatIndex].budgetedAmount = monthToUpdate.categories[parentCatIndex].subcategories.reduce((sum:number, sub:SubCategory) => sum + (Number(sub.budgetedAmount) || 0), 0);
      
      const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]); // ensureSystemCategoryFlags is not a hook

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

      const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
      monthToUpdate.categories = updatedCategories;

      if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]); // ensureSystemCategoryFlags is not a hook

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

        const { updatedCategories } = ensureSystemCategoryFlags(monthToUpdate.categories); 
        monthToUpdate.categories = updatedCategories;

        if(JSON.stringify(originalMonth.categories) !== JSON.stringify(monthToUpdate.categories)){
          return { ...prevMonths, [monthId]: monthToUpdate };
        }
        return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths, toast]); // ensureSystemCategoryFlags is not a hook

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
        
        // Ensure system categories are definitely present.
        const systemCategoryNames = ["Savings", "Credit Card Payments"];
        systemCategoryNames.forEach(sysName => {
            const existingSysCatIndex = newCategories.findIndex(c => c.name === sysName && c.isSystemCategory);
            if (existingSysCatIndex === -1) { 
                const byNameIndex = newCategories.findIndex(c => c.name.toLowerCase() === sysName.toLowerCase());
                if (byNameIndex !== -1) { // Found by name, but not flagged as system
                    newCategories[byNameIndex].name = sysName; // Standardize name
                    newCategories[byNameIndex].isSystemCategory = true;
                    newCategories[byNameIndex].subcategories = []; 
                } else { // Not found at all, add it
                     newCategories.push({ id: uuidv4(), name: sysName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
                }
            }
        });
        
        const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(newCategories);

        const newMonthBudget: BudgetMonth = {
          id: targetMonthId,
          year: targetYear,
          month: targetMonthNum,
          incomes: [{ id: uuidv4(), description: "Projected Income", amount: incomeForTargetMonth, dateAdded: new Date().toISOString() }],
          categories: finalProcessedCategories,
          isRolledOver: false,
          startingCreditCardDebt: startingCCDebtForTargetMonth,
        };

        return { ...prevMonths, [targetMonthId]: newMonthBudget };
      });
    }, [setBudgetMonths] // ensureSystemCategoryFlags is not a hook
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

    