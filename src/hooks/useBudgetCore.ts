
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import type { PrepareBudgetOutput } from '@/ai/flows/prepare-next-month-budget-flow'; // New
import { useState, useEffect, useCallback } from 'react';
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

// Ensures system categories ("Savings", "Credit Card Payments") are correctly flagged and named if they exist.
// It does NOT create them if they are absent from the input array.
// Returns { updatedCategories: BudgetCategory[], wasChanged: boolean }
const ensureSystemCategoryFlags = (categories: BudgetCategory[] | undefined): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  if (!categories) {
    return { updatedCategories: [], wasChanged: false };
  }

  let wasActuallyChanged = false;
  const originalCategoriesJSON = JSON.stringify(categories); // For deep comparison

  let processedCategories = categories.map(cat => {
    let modifiedCat = { ...cat }; // Create a shallow copy

    // Ensure basic structure is initialized if missing
    modifiedCat.budgetedAmount = modifiedCat.budgetedAmount ?? 0;
    modifiedCat.expenses = Array.isArray(modifiedCat.expenses) ? modifiedCat.expenses : [];
    
    const nameLower = modifiedCat.name.toLowerCase();
    const isSavings = nameLower === "savings";
    const isCCPayments = nameLower === "credit card payments";

    if (isSavings || isCCPayments) {
      if (!modifiedCat.isSystemCategory) {
        modifiedCat.isSystemCategory = true;
      }
      if (isSavings && modifiedCat.name !== "Savings") {
        modifiedCat.name = "Savings";
      }
      if (isCCPayments && modifiedCat.name !== "Credit Card Payments") {
        modifiedCat.name = "Credit Card Payments";
      }
      // System categories cannot have subcategories
      if (modifiedCat.subcategories && modifiedCat.subcategories.length > 0) {
        modifiedCat.subcategories = [];
      }
    } else { // Non-system category
      if (modifiedCat.isSystemCategory) { // Was incorrectly flagged as system
        modifiedCat.isSystemCategory = false;
      }
      modifiedCat.subcategories = Array.isArray(modifiedCat.subcategories) ? modifiedCat.subcategories.map(sub => ({
        ...sub,
        budgetedAmount: sub.budgetedAmount ?? 0,
        expenses: Array.isArray(sub.expenses) ? sub.expenses : [],
      })) : [];
    }
    return modifiedCat;
  });
  
  // Check if any logical change occurred that would necessitate a new array reference
  if (JSON.stringify(processedCategories) !== originalCategoriesJSON) {
    wasActuallyChanged = true;
  }


  // Sort: System categories first, then others alphabetically
  // This sort can also change the array reference, so do it after the change check if needed.
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

  if (JSON.stringify(sortedCategories) !== JSON.stringify(processedCategories) && !wasActuallyChanged) {
    // Sorting itself changed the order, which is a meaningful change
    wasActuallyChanged = true;
  }
  
  return { updatedCategories: wasActuallyChanged ? sortedCategories : categories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  const [budgetMonths, setBudgetMonthsState] = useState<Record<string, BudgetMonth>>({});
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
     if (typeof window !== "undefined") {
      const key = getDisplayMonthKey(user?.uid); // Use user?.uid here too for initial load consistency
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) return storedMonthId;
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // June 2025
  });
  const [isLoadingDb, setIsLoadingDb] = useState(true);
  const [isSaving, setIsSaving] = useState(false); 

  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading) { 
      const key = getDisplayMonthKey(user?.uid);
      const storedMonthId = localStorage.getItem(key);
      if (storedMonthId) {
         if (storedMonthId !== currentDisplayMonthId) { // Only update if it's different
            setCurrentDisplayMonthIdState(storedMonthId);
         }
      } else {
        const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
        if (defaultMonth !== currentDisplayMonthId) { // Only update if it's different
            setCurrentDisplayMonthIdState(defaultMonth);
        }
        localStorage.setItem(key, defaultMonth);
      }
    }
  }, [user, authLoading, currentDisplayMonthId]);


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId || isSaving) return; 
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      let hasMeaningfulData = false;
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
        if (month.categories.length > 0 || month.incomes.length > 0 || month.startingCreditCardDebt || month.isRolledOver) {
            hasMeaningfulData = true;
        }
      }
      if (hasMeaningfulData || Object.keys(budgetMonths).length > 0) { 
          await setDoc(docRef, { months: monthsWithEnsuredCategories }); 
      }
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, budgetMonths]); 

  const setBudgetMonths = useCallback((updater: React.SetStateAction<Record<string, BudgetMonth>>) => {
    setBudgetMonthsState(prevMonths => {
        const newMonths = typeof updater === 'function' ? updater(prevMonths) : updater;
        
        // Debounce Firestore/localStorage saving
        const handler = setTimeout(() => {
            if (isUserAuthenticated && user) {
                saveBudgetMonthsToFirestore(user.uid, newMonths);
            } else if (!isUserAuthenticated && typeof window !== "undefined") {
                localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(newMonths));
            }
        }, 500); 

        const existingTimeoutId = (window as any)._budgetSaveTimeoutId;
        if (existingTimeoutId) {
            clearTimeout(existingTimeoutId);
        }
        (window as any)._budgetSaveTimeoutId = handler;
        
        return newMonths;
    });
  }, [isUserAuthenticated, user, saveBudgetMonthsToFirestore]);


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    if (!authLoading && typeof window !== "undefined") {
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user?.uid, authLoading]); 

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
                    budgetedAmount: prevCat.budgetedAmount, 
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
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(systemCategoriesToCarry);
    
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

                if (!Array.isArray(monthData.incomes)) {
                  monthData.incomes = [];
                  monthModified = true;
                }
                
                const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
                if (catsChanged) {
                    monthData.categories = ensuredCategories; 
                    monthModified = true;
                } else if (monthData.categories !== ensuredCategories) { 
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
                const currentMonthCopy = { ...processedMonths[currentDisplayMonthId] };
                const { updatedCategories: ensuredCurrentCategories, wasChanged: currentCatsChanged } = ensureSystemCategoryFlags(currentMonthCopy.categories);
                if (currentCatsChanged) {
                    currentMonthCopy.categories = ensuredCurrentCategories;
                    processedMonths[currentDisplayMonthId] = currentMonthCopy;
                    wasAnyDataStructurallyModified = true;
                }
            }
            
            const finalProcessedMonths = processedMonths;

            setBudgetMonthsState(prevMonths => {
                if (JSON.stringify(prevMonths) !== JSON.stringify(finalProcessedMonths)) {
                     // Removed automatic save-back to Firestore here to avoid loops with onSnapshot
                     // Guest mode saving to localStorage is handled by the setBudgetMonths wrapper.
                    return finalProcessedMonths; 
                }
                return prevMonths; 
            });
            
            setIsLoadingDb(false);
        }, 100); // Slightly reduced debounce for faster perceived load, but still groups rapid changes
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
        processAndUpdateState({}, 'firestore'); 
      });
    } else if (typeof window !== "undefined") { 
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let guestMonths: Record<string, BudgetMonth> = {};
      if (localData) {
        try {
          guestMonths = JSON.parse(localData) as Record<string, BudgetMonth>;
        } catch (e) { console.error("Error parsing guest budget data", e); }
      }
      processAndUpdateState(guestMonths, localData ? 'guest_storage' : 'guest_init');
    } else { 
        processAndUpdateState({}, 'guest_init');
    }
    return () => {
        unsubscribe();
        if (localProcessingTimeout) clearTimeout(localProcessingTimeout);
    };
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, setBudgetMonths]); // Removed isSaving, added setBudgetMonths


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
      
      let structureChanged = false;
      if (catsChanged) { tempMonthData.categories = updatedCategories; structureChanged = true; }
      if (!Array.isArray(tempMonthData.incomes)) { tempMonthData.incomes = []; structureChanged = true;}
      if (tempMonthData.isRolledOver === undefined) { tempMonthData.isRolledOver = false; structureChanged = true;}
      if (tempMonthData.startingCreditCardDebt === undefined) { tempMonthData.startingCreditCardDebt = 0; structureChanged = true;}
      
      finalMonthData = tempMonthData;
      if (structureChanged || JSON.stringify(monthData) !== JSON.stringify(finalMonthData)) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setBudgetMonths(prev => {
        const newState = { ...prev, [yearMonthId]: finalMonthData };
        if (JSON.stringify(prev) !== JSON.stringify(newState)) { // Check entire prev object
          return newState; 
        }
        return prev;
      });
    }
    return finalMonthData;
  }, [budgetMonths, createNewMonthBudget, setBudgetMonths]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return; // Allow guest mode edits even if "rolled over" (local state)

    let updatedMonth = JSON.parse(JSON.stringify(monthToUpdate));
    let changed = false;
    
    if (payload.startingCreditCardDebt !== undefined && updatedMonth.startingCreditCardDebt !== payload.startingCreditCardDebt) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
        changed = true;
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
      changed = true; 
    }
    
    const { updatedCategories, wasChanged: sysFlagsChanged } = ensureSystemCategoryFlags(updatedMonth.categories);
    updatedMonth.categories = updatedCategories;
    if (sysFlagsChanged) changed = true;

    updatedMonth.categories.forEach((cat: BudgetCategory) => { 
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            const newParentBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            if (cat.budgetedAmount !== newParentBudget) {
                cat.budgetedAmount = newParentBudget;
                changed = true;
            }
        }
    });

    if (changed || JSON.stringify(budgetMonths[yearMonthId]) !== JSON.stringify(updatedMonth)) {
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths, isUserAuthenticated]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return; 

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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;
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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

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
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id' | 'expenses'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
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
       if (JSON.stringify(budgetMonths[yearMonthId]?.categories) !== JSON.stringify(updatedMonth.categories)) {
            setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
       }
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths, isUserAuthenticated]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(filteredCategories);
    const updatedMonth = { ...monthToUpdate, categories: finalCategories };

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    if (monthToUpdate.isRolledOver && isUserAuthenticated) return;

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
  }, [ensureMonthExists, setBudgetMonths, isUserAuthenticated]);
  
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

      // Ensure Savings and CC Payments categories exist if not suggested, or are correctly flagged if they were.
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
    }, [setBudgetMonths] 
  );


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

    
