
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow';
import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './useAuth';
import { useToast } from "@/hooks/use-toast"; // Added useToast import


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

  const systemCategoryNames = ["Savings", "Credit Card Payments"];
  let processedCategories = [...categories]; 

  systemCategoryNames.forEach(sysName => {
    const existingIndex = processedCategories.findIndex(cat => cat.name.toLowerCase() === sysName.toLowerCase());
    if (existingIndex !== -1) { 
      const cat = processedCategories[existingIndex];
      let modifiedCat = { ...cat };
      if (!modifiedCat.isSystemCategory) { modifiedCat.isSystemCategory = true; wasActuallyChanged = true; }
      if (modifiedCat.name !== sysName) { modifiedCat.name = sysName; wasActuallyChanged = true; } 
      if (modifiedCat.subcategories && modifiedCat.subcategories.length > 0) { modifiedCat.subcategories = []; wasActuallyChanged = true;}
      if (modifiedCat.budgetedAmount === undefined || modifiedCat.budgetedAmount === null) { modifiedCat.budgetedAmount = 0; wasActuallyChanged = true; }
      if (!Array.isArray(modifiedCat.expenses)) { modifiedCat.expenses = []; wasActuallyChanged = true; }
      if (JSON.stringify(cat) !== JSON.stringify(modifiedCat)) {
        processedCategories[existingIndex] = modifiedCat;
      }
    }
  });

  processedCategories = processedCategories.map(cat => {
    const isSystemByName = systemCategoryNames.some(sysName => sysName.toLowerCase() === cat.name.toLowerCase());
    if (!isSystemByName) { 
      let modifiedCat = { ...cat };
      if (modifiedCat.isSystemCategory) { modifiedCat.isSystemCategory = false; wasActuallyChanged = true; }
      if (modifiedCat.budgetedAmount === undefined || modifiedCat.budgetedAmount === null) { modifiedCat.budgetedAmount = 0; wasActuallyChanged = true; }
      if (!Array.isArray(modifiedCat.expenses)) { modifiedCat.expenses = []; wasActuallyChanged = true; }
      
      modifiedCat.subcategories = (modifiedCat.subcategories || []).map(sub => {
        let subModified = false;
        let newSub = {...sub};
        if(newSub.budgetedAmount === undefined || newSub.budgetedAmount === null) { newSub.budgetedAmount = 0; subModified = true; }
        if(!Array.isArray(newSub.expenses)) { newSub.expenses = []; subModified = true; }
        if(subModified && !wasActuallyChanged) wasActuallyChanged = true; 
        return newSub;
      });
       // If it has subcategories, parent budget is derived
      if (modifiedCat.subcategories && modifiedCat.subcategories.length > 0) {
        const newParentBudget = modifiedCat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        if (modifiedCat.budgetedAmount !== newParentBudget) {
            modifiedCat.budgetedAmount = newParentBudget;
            wasActuallyChanged = true;
        }
      }

      if (JSON.stringify(cat) !== JSON.stringify(modifiedCat)) {
          return modifiedCat;
      }
    }
    return cat;
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
  const { toast } = useToast(); // Initialize useToast
  const [budgetMonthsState, setBudgetMonthsState] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
     if (typeof window !== "undefined") {
      const key = getDisplayMonthKey(user?.uid); 
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) return storedMonthId;
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
    if (typeof window !== "undefined" && !authLoading) {
      const key = getDisplayMonthKey(user?.uid);
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId && storedMonthId !== currentDisplayMonthId) {
         setCurrentDisplayMonthIdState(storedMonthId);
      } else if (!storedMonthId) {
        const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
        if (defaultMonth !== currentDisplayMonthId) {
            setCurrentDisplayMonthIdState(defaultMonth);
        }
        localStorage.setItem(key, defaultMonth);
      }
    }
  }, [user, authLoading, currentDisplayMonthId]);


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
            incomes: month.incomes || [],
            startingCreditCardDebt: month.startingCreditCardDebt || 0,
            isRolledOver: month.isRolledOver || false,
        };
        if ((month.categories && month.categories.length > 0) || (month.incomes && month.incomes.length > 0) || month.startingCreditCardDebt || month.isRolledOver) {
            hasMeaningfulDataToSave = true;
        }
      }
      if (hasMeaningfulDataToSave || Object.keys(monthsToSave).length > 0) { 
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
        const newMonthsCandidate = typeof updater === 'function' ? updater(prevMonths) : updater;
        
        // Process newMonthsCandidate to ensure consistent structure before final state update and saving
        const processedMonths: Record<string, BudgetMonth> = {};
        let wasAnyDataStructurallyModified = false;

        for (const monthId in newMonthsCandidate) {
            const month = newMonthsCandidate[monthId];
            let monthChangedDuringProcessing = false;
            let currentCategories = month.categories || [];
            
            const { updatedCategories, wasChanged: catsStructurallyChanged } = ensureSystemCategoryFlags(currentCategories);
            if (catsStructurallyChanged) {
                currentCategories = updatedCategories;
                monthChangedDuringProcessing = true;
            }
            
            processedMonths[monthId] = {
                ...month,
                categories: currentCategories,
                incomes: Array.isArray(month.incomes) ? month.incomes : [],
                isRolledOver: month.isRolledOver === undefined ? false : month.isRolledOver,
                startingCreditCardDebt: month.startingCreditCardDebt === undefined ? 0 : month.startingCreditCardDebt,
            };
            if (monthChangedDuringProcessing) wasAnyDataStructurallyModified = true;
        }

        const prevProcessedJSON = JSON.stringify(prevMonths); // Compare against fully processed prev state if possible
        const newProcessedJSON = JSON.stringify(processedMonths);

        if (prevProcessedJSON === newProcessedJSON && !wasAnyDataStructurallyModified) {
          return prevMonths; // No logical change, prevent update
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
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
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
        
        const prevCCPaymentsCat = (prevMonthBudget.categories || []).find(cat => cat.isSystemCategory && cat.name.toLowerCase() === "credit card payments");
        const paymentsMadeLastMonth = prevCCPaymentsCat ? (prevCCPaymentsCat.expenses || []).reduce((sum, exp) => sum + exp.amount, 0) : 0;
        calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;

    } else {
        // If no previous month, we don't auto-create system categories anymore.
        // They'll be flagged if user adds them with the specific names.
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const { updatedCategories: finalSystemCats } = ensureSystemCategoryFlags(systemCategoriesToCarry);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: finalSystemCats, 
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []); 


  const processAndUpdateState = useCallback((rawMonths: Record<string, BudgetMonth>, source: 'firestore' | 'localstorage' | 'initial') => {
    setIsLoadingDb(true);
    try {
      let processedMonths = JSON.parse(JSON.stringify(rawMonths)); 
      let wasAnyDataStructurallyModified = false;

      if (!processedMonths[currentDisplayMonthId]) {
          processedMonths[currentDisplayMonthId] = createNewMonthBudget(currentDisplayMonthId, processedMonths);
          wasAnyDataStructurallyModified = true;
      }

      Object.keys(processedMonths).forEach(monthId => {
        const month = processedMonths[monthId]; 
        let monthChangedDuringProcessing = false;
        
        if (!Array.isArray(month.incomes)) {
          month.incomes = [];
          monthChangedDuringProcessing = true;
        }
        if (month.categories === undefined) { // Check for undefined explicitly
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
          wasAnyDataStructurallyModified = true; 
        }
      });
      
      const currentMonthsJSON = JSON.stringify(budgetMonthsState);
      const newProcessedMonthsJSON = JSON.stringify(processedMonths);

      if (currentMonthsJSON !== newProcessedMonthsJSON || wasAnyDataStructurallyModified) {
          // Use setBudgetMonths to ensure debounced saving logic is also triggered
          setBudgetMonths(processedMonths);
      }
    } catch (error) {
        console.error("Error processing budget data:", error);
        setBudgetMonths({}); // Reset to a safe state
        wasAnyDataStructurallyModified = true; // Indicate change to force update
    } finally {
        setIsLoadingDb(false);
    }
  }, [currentDisplayMonthId, createNewMonthBudget, budgetMonthsState, setBudgetMonths]);


 useEffect(() => {
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
        processAndUpdateState(firestoreMonths, 'firestore');
        
        if (isInitialLoadForThisKey) {
          initialLoadDoneForUserRef.current[user.uid] = true;
        }
         // setIsLoadingDb(false) is called in processAndUpdateState's finally block
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        processAndUpdateState({}, 'initial'); // Reset or use empty on error
        if (isInitialLoadForThisKey) {
          initialLoadDoneForUserRef.current[user.uid!] = true; 
        }
        // setIsLoadingDb(false) is called in processAndUpdateState's finally block
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
      processAndUpdateState(guestMonths, 'localstorage');
      
      if (isInitialLoadForThisKey) {
        initialLoadDoneForUserRef.current['guest'] = true;
      }
       // setIsLoadingDb(false) is called in processAndUpdateState's finally block
    } else {
      processAndUpdateState({}, 'initial');
      if (isInitialLoadForThisKey) {
        initialLoadDoneForUserRef.current['guest'] = true;
      }
      // setIsLoadingDb(false) is called in processAndUpdateState's finally block
    }

    return () => {
      unsubscribe();
      if (localSaveDebounceTimeoutRef.current) {
        clearTimeout(localSaveDebounceTimeoutRef.current);
      }
    };
  }, [user, isUserAuthenticated, authLoading, processAndUpdateState]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonthsState[yearMonthId];
  }, [budgetMonthsState]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    if (budgetMonthsState[yearMonthId]) {
        const month = { ...budgetMonthsState[yearMonthId] }; // shallow copy for potential modification
        let changed = false;
        if (!Array.isArray(month.incomes)) { month.incomes = []; changed = true; }
        if (month.categories === undefined) { month.categories = []; changed = true; } // Handle undefined categories
        const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(month.categories);
        if (catsChanged) { month.categories = updatedCategories; changed = true; }
        if (month.isRolledOver === undefined) { month.isRolledOver = false; changed = true; }
        if (month.startingCreditCardDebt === undefined) { month.startingCreditCardDebt = 0; changed = true; }
        
        if(changed && JSON.stringify(budgetMonthsState[yearMonthId]) !== JSON.stringify(month)){
            // If structure had to be corrected, reflect this by triggering a state update via setBudgetMonths
            // This ensures consistency and that save operations get the corrected structure.
            setBudgetMonths(prev => ({...prev, [yearMonthId]: month}));
            return month; // return the corrected structure immediately
        }
        return budgetMonthsState[yearMonthId];
    }
    const newMonth = createNewMonthBudget(yearMonthId, budgetMonthsState);
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: newMonth }));
    return newMonth;
  }, [budgetMonthsState, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? { ...prevMonths[yearMonthId] } : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
          return prevMonths;
      }

      let changed = false;
      
      if (payload.startingCreditCardDebt !== undefined && monthToUpdate.startingCreditCardDebt !== payload.startingCreditCardDebt) {
          monthToUpdate.startingCreditCardDebt = payload.startingCreditCardDebt;
          changed = true;
      }
        
      if (payload.categories) {
        const existingCategoriesMap = new Map((monthToUpdate.categories || []).map(c => [c.id, c]));
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
        monthToUpdate.categories = newCategoriesFromPayload;
        changed = true; 
      }
      
      const { updatedCategories, wasChanged: sysFlagsChanged } = ensureSystemCategoryFlags(monthToUpdate.categories);
      if (sysFlagsChanged) { 
          monthToUpdate.categories = updatedCategories;
          changed = true;
      }

      (monthToUpdate.categories || []).forEach(cat => { 
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              const newParentBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
              if (cat.budgetedAmount !== newParentBudget) {
                  cat.budgetedAmount = newParentBudget;
                  changed = true;
              }
          }
      });

      if (changed || JSON.stringify(prevMonths[yearMonthId]) !== JSON.stringify(monthToUpdate)) {
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
      let expenseAdded = false;
      
      const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
        let currentCat = JSON.parse(JSON.stringify(cat)); 
        if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
          if (!currentCat.isSystemCategory && currentCat.subcategories && currentCat.subcategories.length > 0) {
              console.warn(`Attempted to add expense to parent category '${currentCat.name}' which has subcategories. Expense not added.`);
              return currentCat;
          }
          currentCat.expenses = [...(currentCat.expenses || []), newExpense];
          expenseAdded = true;
          return currentCat;
        } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          currentCat.subcategories = (currentCat.subcategories || []).map(sub =>
              sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
          );
          expenseAdded = true;
          return currentCat;
        }
        return currentCat;
      });

      if (expenseAdded) {
          monthToUpdate.categories = updatedCategoriesList;
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }
      let expenseDeleted = false;

      const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
        let currentCat = JSON.parse(JSON.stringify(cat));
        if (!isSubCategory && currentCat.id === categoryOrSubCategoryId) {
          const initialLength = (currentCat.expenses || []).length;
          currentCat.expenses = (currentCat.expenses || []).filter(exp => exp.id !== expenseId);
          if (currentCat.expenses.length !== initialLength) expenseDeleted = true;
          return currentCat;
        } else if (isSubCategory && !currentCat.isSystemCategory && currentCat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
          currentCat.subcategories = (currentCat.subcategories || []).map(sub => {
              if (sub.id === categoryOrSubCategoryId) {
                const initialLength = (sub.expenses || []).length;
                const newExpenses = (sub.expenses || []).filter(exp => exp.id !== expenseId);
                if (newExpenses.length !== initialLength) expenseDeleted = true;
                return { ...sub, expenses: newExpenses };
              }
              return sub;
            });
          return currentCat;
        }
        return currentCat;
      });

      if (expenseDeleted) {
          monthToUpdate.categories = updatedCategoriesList;
          return { ...prevMonths, [yearMonthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
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
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }
      const initialLength = (monthToUpdate.incomes || []).length;
      monthToUpdate.incomes = (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId);
      
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
      return { ...prevMonths, [yearMonthId]: updatedMonth };
    });
    return { success, message }; // This message might not be immediately up-to-date due to async nature of setState
  }, [setBudgetMonths]);

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      const existingCat = (monthToUpdate.categories || []).find(c => c.name.toLowerCase() === categoryName.toLowerCase());
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
      
      const tempCatsWithNew = [...(monthToUpdate.categories || []), newCategory];
      const { updatedCategories: finalCatsWithNew } = ensureSystemCategoryFlags(tempCatsWithNew);
          
      monthToUpdate.categories = finalCatsWithNew;
      return { ...prevMonths, [yearMonthId]: monthToUpdate };
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id' | 'expenses'>>) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId] ? {...prevMonths[yearMonthId]} : createNewMonthBudget(yearMonthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

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
               newName = cat.name; 
          }

          if (newIsSystem) { 
            // For system categories, name is fixed, budget is editable, no subcategories.
            if (newName !== cat.name && (cat.name === "Savings" || cat.name === "Credit Card Payments")) {
                newName = cat.name; // Prevent renaming system categories
            }
          } else if (cat.subcategories && cat.subcategories.length > 0) { 
              newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
          
          return { ...cat, name: newName, budgetedAmount: newBudget, isSystemCategory: newIsSystem };
        }
        return cat;
      });
      
      if (categoryUpdated) {
        const { updatedCategories: finalCategories, wasChanged: flagsChanged } = ensureSystemCategoryFlags(newCategories);
         if (JSON.stringify(monthToUpdate.categories) !== JSON.stringify(finalCategories) || flagsChanged) {
            monthToUpdate.categories = finalCategories;
            return { ...prevMonths, [yearMonthId]: monthToUpdate };
         }
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[yearMonthId];
      if (!monthToUpdate || (monthToUpdate.isRolledOver && isUserAuthenticated && user)) {
        return prevMonths;
      }

      const categoryToDelete = (monthToUpdate.categories || []).find(cat => cat.id === categoryId);
      if (categoryToDelete?.isSystemCategory) {
        toast({ title: "Action Denied", description: `Cannot delete system category: ${categoryToDelete.name}`, variant: "destructive" });
        return prevMonths;
      }
      
      const originalCategories = monthToUpdate.categories || [];
      const filteredCategories = originalCategories.filter(cat => cat.id !== categoryId);

      if (originalCategories.length === filteredCategories.length) {
        return prevMonths;
      }
      
      const updatedMonth = { ...monthToUpdate, categories: filteredCategories }; 
      return { ...prevMonths, [yearMonthId]: updatedMonth };
    });
  }, [isUserAuthenticated, user, toast, setBudgetMonths]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[monthId] ? {...prevMonths[monthId]} : createNewMonthBudget(monthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      let parentCat = (monthToUpdate.categories || []).find(cat => cat.id === parentCategoryId);
      if (!parentCat || parentCat.isSystemCategory) {
         toast({ title: "Action Denied", description: "System categories cannot have subcategories.", variant: "destructive" });
        return prevMonths;
      }

      const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
      let categoryModified = false;
      
      const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
        if (cat.id === parentCategoryId) {
          categoryModified = true;
          const updatedSubcategories = [...(cat.subcategories || []), newSubCategory];
          const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
        }
        return cat;
      });

      if(categoryModified){
          monthToUpdate.categories = updatedCategoriesList;
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, toast, setBudgetMonths]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    setBudgetMonths(prevMonths => {
      const monthToUpdate = prevMonths[monthId] ? {...prevMonths[monthId]} : createNewMonthBudget(monthId, prevMonths);
      if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
        return prevMonths;
      }

      const parentCat = (monthToUpdate.categories || []).find(cat => cat.id === parentCategoryId);
      if (!parentCat || parentCat.isSystemCategory) {
        return prevMonths;
      }
      let categoryModified = false;

      const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
        if (cat.id === parentCategoryId) {
          const originalSubcategories = cat.subcategories || [];
          let subcategoryFoundAndChanged = false;
          const updatedSubcategories = originalSubcategories.map(sub => {
              if (sub.id === subCategoryId) {
                subcategoryFoundAndChanged = true;
                return { ...sub, name: newName, budgetedAmount: newBudget };
              }
              return sub;
            }
          );
          if (subcategoryFoundAndChanged) {
            categoryModified = true;
            const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
          }
        }
        return cat;
      });
      if(categoryModified){
          monthToUpdate.categories = updatedCategoriesList;
          return { ...prevMonths, [monthId]: monthToUpdate };
      }
      return prevMonths;
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    setBudgetMonths(prevMonths => {
        const monthToUpdate = prevMonths[monthId] ? {...prevMonths[monthId]} : createNewMonthBudget(monthId, prevMonths);
        if (monthToUpdate.isRolledOver && isUserAuthenticated && user) {
            return prevMonths;
        }

        let wasSubCategoryActuallyDeleted = false;
        const updatedCategoriesList = (monthToUpdate.categories || []).map(cat => {
            if (cat.id === parentCategoryId && !cat.isSystemCategory) {
                const originalSubcategories = cat.subcategories || [];
                const updatedSubcategories = originalSubcategories.filter(sub => sub.id !== subCategoryId);

                if (originalSubcategories.length !== updatedSubcategories.length) {
                    wasSubCategoryActuallyDeleted = true;
                    const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
                    return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
                }
            }
            return cat;
        });

        if (!wasSubCategoryActuallyDeleted) {
            return prevMonths;
        }

        monthToUpdate.categories = updatedCategoriesList;
        return { ...prevMonths, [monthId]: monthToUpdate };
    });
  }, [isUserAuthenticated, user, createNewMonthBudget, setBudgetMonths]);
  
  const applyAiGeneratedBudget = useCallback(
    (
      targetMonthId: string, 
      suggestedBudgetCategories: PrepareBudgetOutput['suggestedCategories'],
      incomeForTargetMonth: number,
      startingCCDebtForCurrentMonth: number,
      ccPaymentsMadeInCurrentMonth: number
    ) => {
      setBudgetMonths(prevMonths => {
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
