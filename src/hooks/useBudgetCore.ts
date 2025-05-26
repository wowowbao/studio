
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
// DEFAULT_CATEGORIES is now an empty array, system categories are handled by ensureSystemCategoryFlags
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db, auth } from '@/lib/firebase'; // Ensure auth is imported if used for initial currentUser
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

// Ensures system categories ("Savings", "Credit Card Payments"), if present by name, are correctly flagged and named.
// It does NOT create them if they are absent. It does NOT modify their budgetedAmount.
// It also ensures system categories do not have subcategories.
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? JSON.parse(JSON.stringify(categories)) : [];
  let wasActuallyChanged = false;

  const systemCategorySpecs = [
    { name: "Savings", defaultBudget: 0 }, // Default budget can be used if needed
    { name: "Credit Card Payments", defaultBudget: 0 }
  ];

  newCategories.forEach((cat: BudgetCategory, index: number) => {
    const catNameLower = cat.name.toLowerCase();
    let originalCatJSON = JSON.stringify(cat);

    const matchedSpec = systemCategorySpecs.find(spec => spec.name.toLowerCase() === catNameLower);

    if (matchedSpec) {
      let modified = false;
      if (!cat.isSystemCategory) { cat.isSystemCategory = true; modified = true; }
      if (cat.name !== matchedSpec.name) { cat.name = matchedSpec.name; modified = true; } // Standardize name
      if (cat.subcategories && cat.subcategories.length > 0) { cat.subcategories = []; modified = true; } // System categories cannot have subcategories
      if (cat.budgetedAmount === undefined) { cat.budgetedAmount = matchedSpec.defaultBudget; modified = true; } // Ensure budgetedAmount is defined

      if (modified && JSON.stringify(cat) !== originalCatJSON) {
        wasActuallyChanged = true;
        newCategories[index] = cat;
      }
    } else {
      if (cat.isSystemCategory) { // If it was wrongly flagged as system
        cat.isSystemCategory = false;
        wasActuallyChanged = true;
        newCategories[index] = cat;
      }
      // Ensure non-system categories have budgetedAmount defined
      if (cat.budgetedAmount === undefined) {
        cat.budgetedAmount = 0;
        if (JSON.stringify(cat) !== originalCatJSON) {
            wasActuallyChanged = true;
            newCategories[index] = cat;
        }
      }
    }
     // Ensure expenses and subcategories arrays exist and are initialized for all categories
    if (!Array.isArray(cat.expenses)) {
        cat.expenses = [];
        if (JSON.stringify(cat) !== originalCatJSON && !wasActuallyChanged) { // check if this change itself caused a change
             const tempOriginalCatJSON = JSON.parse(originalCatJSON); // re-parse to compare initial state
             if(!Array.isArray(tempOriginalCatJSON.expenses)) wasActuallyChanged = true;
        }
         newCategories[index] = cat;
    }
    if (!cat.isSystemCategory && !Array.isArray(cat.subcategories)) {
        cat.subcategories = [];
         if (JSON.stringify(cat) !== originalCatJSON && !wasActuallyChanged) {
             const tempOriginalCatJSON = JSON.parse(originalCatJSON);
             if(!Array.isArray(tempOriginalCatJSON.subcategories)) wasActuallyChanged = true;
        }
        newCategories[index] = cat;
    }
    if (cat.subcategories) {
        cat.subcategories.forEach((sub, subIndex) => {
            let originalSubCatJSON = JSON.stringify(sub);
            if (!Array.isArray(sub.expenses)) {
                sub.expenses = [];
                 if (JSON.stringify(sub) !== originalSubCatJSON && !wasActuallyChanged) {
                    // Potentially more complex change detection needed if only sub-properties change
                    wasActuallyChanged = true; 
                }
                cat.subcategories![subIndex] = sub;
                newCategories[index] = cat; 
            }
             if (sub.budgetedAmount === undefined) {
                sub.budgetedAmount = 0;
                 if (JSON.stringify(sub) !== originalSubCatJSON && !wasActuallyChanged) {
                    wasActuallyChanged = true;
                }
                cat.subcategories![subIndex] = sub;
                newCategories[index] = cat;
            }
        });
    }
  });
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();

  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});

  // Initialize currentDisplayMonthId from localStorage or default
  // This runs only on initial component mount
  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      // Try to get initial UID from auth.currentUser if available synchronously
      // This might be null if auth state hasn't been resolved by onAuthStateChanged yet
      const initialAuthUser = auth.currentUser;
      const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(initialAuthUser?.uid));
      if (storedDisplayMonth) {
        return storedDisplayMonth;
      }
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default to June 2025
  });

  const [isLoading, setIsLoading] = useState(true); // For budget data loading specifically
  const [isSaving, setIsSaving] = useState(false); // For Firestore save operations


  // Effect to sync currentDisplayMonthId with localStorage when user/authLoading changes
  useEffect(() => {
    if (authLoading) return; // Wait for auth state to be determined

    const currentUid = user?.uid;
    const key = getDisplayMonthKey(currentUid);
    const storedMonthForCurrentUser = localStorage.getItem(key);

    if (storedMonthForCurrentUser) {
      // If there's a stored month for the current user/guest and it's different from the state, update the state
      if (currentDisplayMonthId !== storedMonthForCurrentUser) {
        setCurrentDisplayMonthIdState(storedMonthForCurrentUser);
      }
    } else {
      // If no month is stored for the current user/guest, set it to default (June 2025) and save to localStorage
      // This also handles the case where currentDisplayMonthId might be from a previous user session
      const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
      setCurrentDisplayMonthIdState(defaultMonth); // Update state
      localStorage.setItem(key, defaultMonth); // Save to localStorage
    }
  }, [user, authLoading]); // Removed currentDisplayMonthId from here to simplify


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
     if (!authLoading) { // Check authLoading to ensure user object is stable for key generation
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return; // Should not happen if called correctly
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      await setDoc(docRef, { months: monthsToSave }, { merge: true });
    } catch (error) {
      console.error("Error saving budget to Firestore:", error);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const getPreviousMonthId = (currentMonthId: string): string => {
    const currentDate = parseYearMonth(currentMonthId);
    currentDate.setMonth(currentDate.getMonth() - 1);
    return getYearMonthFromDate(currentDate);
  };

  const createNewMonthBudget = useCallback((yearMonthId: string, existingMonths: Record<string, BudgetMonth>, currentStartingDebt?: number): BudgetMonth => {
    const [year, monthNum] = yearMonthId.split('-').map(Number);
    const prevMonthId = getPreviousMonthId(yearMonthId);
    const prevMonthBudget = existingMonths[prevMonthId];

    let calculatedStartingDebt = currentStartingDebt !== undefined ? currentStartingDebt : 0;
    let initialCategories: BudgetCategory[] = []; // Start with no user-defined categories

    // Carry over system categories and their budgeted amounts if previous month exists
    if (prevMonthBudget) {
        const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Savings");
        if (prevSavingsCat) {
            initialCategories.push({
                id: uuidv4(),
                name: "Savings",
                budgetedAmount: prevSavingsCat.budgetedAmount,
                expenses: [],
                subcategories: [],
                isSystemCategory: true,
            });
        }

        const prevCCPaymentsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            initialCategories.push({
                id: uuidv4(),
                name: "Credit Card Payments",
                budgetedAmount: prevCCPaymentsCat.budgetedAmount,
                expenses: [],
                subcategories: [],
                isSystemCategory: true,
            });
            // Calculate starting debt for the new month
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
        } else {
            // If no CC payment category in prev month, debt carries over as is from prev month's start
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0;
        }
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);

    // Ensure flags are correct even if carried over categories somehow lost them
    // This ensureSystemCategoryFlags no longer CREATES system categories, only flags existing ones.
    const { updatedCategories } = ensureSystemCategoryFlags(initialCategories);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: updatedCategories, // Use potentially flagged/cleaned categories
      isRolledOver: false,
      startingCreditCardDebt: finalDebt,
    };
  }, []);


 useEffect(() => {
    if (authLoading) {
      setIsLoading(true);
      return;
    }
    setIsLoading(true);

    if (isUserAuthenticated && user) {
      const docRef = getFirestoreUserBudgetDocRef(user.uid);
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        let loadedMonths: Record<string, BudgetMonth> = {};
        let changedDuringLoad = false;

        if (docSnap.exists()) {
          const data = docSnap.data() as { months: Record<string, BudgetMonth> };
          loadedMonths = data.months || {};
          
          Object.keys(loadedMonths).forEach(monthId => {
            const monthData = loadedMonths[monthId];
            monthData.incomes = monthData.incomes || [];
            monthData.categories = monthData.categories || [];
            
            const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
            if(catsChanged) {
                monthData.categories = ensuredCategories;
                changedDuringLoad = true;
            }

            // Ensure other fields have defaults
            monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
            monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;

            // Deep check for subcategories and expenses initialization
            monthData.categories.forEach(cat => {
                cat.expenses = cat.expenses || [];
                cat.budgetedAmount = cat.budgetedAmount === undefined ? 0 : cat.budgetedAmount;
                if (!cat.isSystemCategory) {
                    cat.subcategories = cat.subcategories || [];
                    cat.subcategories.forEach(subCat => {
                        subCat.expenses = subCat.expenses || [];
                        subCat.budgetedAmount = subCat.budgetedAmount === undefined ? 0 : subCat.budgetedAmount;
                    });
                } else {
                    cat.subcategories = [];
                }
            });
          });
        } else { // No document for the user, create initial month
          const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
          loadedMonths = { [currentDisplayMonthId]: initialMonth };
          changedDuringLoad = true; // Needs to be saved
        }
        
        setBudgetMonths(loadedMonths);
        if (changedDuringLoad && user) { 
            saveBudgetMonthsToFirestore(user.uid, loadedMonths);
        }
        setIsLoading(false);
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        setBudgetMonths({}); // Clear budget months on error
        setIsLoading(false);
      });
      return () => unsubscribe();
    } else { 
      // Guest Mode
      const localData = localStorage.getItem(GUEST_BUDGET_MONTHS_KEY);
      let guestMonthsToSet: Record<string, BudgetMonth> = {};
      let changedDuringGuestLoad = false;

      if (localData) {
        try {
          const parsedData = JSON.parse(localData) as Record<string, BudgetMonth>;
          Object.keys(parsedData).forEach(monthId => {
            const monthData = parsedData[monthId];
            monthData.incomes = monthData.incomes || [];
            monthData.categories = monthData.categories || [];
            const { updatedCategories: ensuredCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(monthData.categories);
            if(catsChanged) {
                monthData.categories = ensuredCategories;
                changedDuringGuestLoad = true;
            }
            monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
            monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;
            
            monthData.categories.forEach(cat => {
              cat.expenses = cat.expenses || [];
              cat.budgetedAmount = cat.budgetedAmount === undefined ? 0 : cat.budgetedAmount;
              if (!cat.isSystemCategory) {
                cat.subcategories = cat.subcategories || [];
                cat.subcategories.forEach(subCat => {
                  subCat.expenses = subCat.expenses || [];
                   subCat.budgetedAmount = subCat.budgetedAmount === undefined ? 0 : subCat.budgetedAmount;
                });
              } else {
                cat.subcategories = [];
              }
            });
            guestMonthsToSet[monthId] = monthData;
          });
        } catch (e) {
          console.error("Error parsing guest budget data from localStorage", e);
          const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
          guestMonthsToSet = { [currentDisplayMonthId]: initialMonth };
          changedDuringGuestLoad = true; 
        }
      } else { 
         const initialMonth = createNewMonthBudget(currentDisplayMonthId, {}, 0);
         guestMonthsToSet = { [currentDisplayMonthId]: initialMonth };
         changedDuringGuestLoad = true;
      }
      setBudgetMonths(guestMonthsToSet);
      if (changedDuringGuestLoad) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(guestMonthsToSet));
      }
      setIsLoading(false);
    }
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore]);


  // Effect to persist budgetMonths to Firestore/localStorage when it changes
  useEffect(() => {
    // Only save if initial loading is complete AND auth state is settled
    // Prevents saving empty/default states during initial load sequences
    if (!isLoading && !authLoading && Object.keys(budgetMonths).length > 0) { 
      if (isUserAuthenticated && user && !isSaving) { // Also check !isSaving to prevent race conditions
        saveBudgetMonthsToFirestore(user.uid, budgetMonths);
      } else if (!isUserAuthenticated) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(budgetMonths));
      }
    }
  }, [budgetMonths, isLoading, authLoading, user, isUserAuthenticated, saveBudgetMonthsToFirestore, isSaving]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

 const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId]; 
    let needsStateUpdate = false;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId, budgetMonths); 
      needsStateUpdate = true;
    } else {
      let changed = false;
      const currentCategories = monthData.categories || [];
      
      const { updatedCategories, wasChanged: categoriesWereChanged } = ensureSystemCategoryFlags(currentCategories);
      if (categoriesWereChanged) {
        monthData = { ...monthData, categories: updatedCategories };
        changed = true;
      }

      monthData.incomes = monthData.incomes || [];
      monthData.isRolledOver = monthData.isRolledOver === undefined ? false : monthData.isRolledOver;
      monthData.startingCreditCardDebt = monthData.startingCreditCardDebt === undefined ? 0 : monthData.startingCreditCardDebt;
      
      // Ensure all categories and subcategories have default fields
      monthData.categories.forEach(cat => {
        cat.expenses = cat.expenses || [];
        cat.budgetedAmount = cat.budgetedAmount === undefined ? 0 : cat.budgetedAmount;
        if (!cat.isSystemCategory) {
            cat.subcategories = cat.subcategories || [];
            cat.subcategories.forEach(sub => {
                sub.expenses = sub.expenses || [];
                sub.budgetedAmount = sub.budgetedAmount === undefined ? 0 : sub.budgetedAmount;
            });
        } else {
            cat.subcategories = [];
        }
      });


      if (changed) { 
        needsStateUpdate = true;
      }
    }

    if (needsStateUpdate && monthData) { 
      const finalMonthData = monthData; 
      setBudgetMonths(prev => {
        const newState = { ...prev, [yearMonthId]: finalMonthData };
        // Avoid immediate save if it's just ensuring defaults during a load phase
        // The main useEffect for saving budgetMonths will handle persistence.
        return newState;
      });
    }
    return monthData!; 
  }, [budgetMonths, createNewMonthBudget]);


  const updateMonthBudget = useCallback((yearMonthId: string, payload: BudgetUpdatePayload) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let updatedMonth = { ...monthToUpdate };
    
    if (payload.startingCreditCardDebt !== undefined) {
        updatedMonth.startingCreditCardDebt = payload.startingCreditCardDebt;
    }
      
    if (payload.categories) {
      updatedMonth.categories = payload.categories.map(catPayload => {
        const existingCat = monthToUpdate.categories.find(c => c.id === catPayload.id);
        
        let budgetToSet = catPayload.budgetedAmount;
        if (budgetToSet === undefined) {
            budgetToSet = existingCat ? existingCat.budgetedAmount : 0;
        }

        let subcategoriesToSet = (catPayload.subcategories || existingCat?.subcategories || []).map(subCatPayload => {
            const existingSubCat = existingCat?.subcategories?.find(sc => sc.id === subCatPayload.id);
            return {
              id: subCatPayload.id || uuidv4(),
              name: subCatPayload.name,
              budgetedAmount: subCatPayload.budgetedAmount === undefined ? (existingSubCat ? existingSubCat.budgetedAmount : 0) : subCatPayload.budgetedAmount,
              expenses: existingSubCat?.expenses || [], 
            };
          });

        // If this is a non-system category and has subcategories, its own budget is derived
        if (!catPayload.isSystemCategory && subcategoriesToSet.length > 0) {
            budgetToSet = subcategoriesToSet.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }


        return {
          id: catPayload.id || uuidv4(),
          name: catPayload.name,
          budgetedAmount: budgetToSet,
          expenses: existingCat?.expenses || [], 
          subcategories: subcategoriesToSet,
          isSystemCategory: catPayload.isSystemCategory !== undefined ? catPayload.isSystemCategory : (existingCat ? existingCat.isSystemCategory : false),
        };
      });
    }
    
    // Ensure system categories are correctly flagged and named
    const { updatedCategories, wasChanged: flagsChanged } = ensureSystemCategoryFlags(updatedMonth.categories);
    updatedMonth.categories = updatedCategories;

    // For system categories "Savings" and "Credit Card Payments", their budgets are set directly.
    // For other categories, if they have subcategories, their budget is derived.
    updatedMonth.categories.forEach(cat => {
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            cat.budgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
    });


    updatedMonth.incomes = updatedMonth.incomes || [];

    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 

    const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
        // Cannot add expenses directly to a parent category if it has subcategories
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            console.warn(`Attempted to add expense to parent category '${cat.name}' which has subcategories. Expense not added.`);
            return cat; // Return unchanged category
        }
        return { ...cat, expenses: [...(cat.expenses || []), newExpense] };
      } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map(sub =>
            sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
          ),
        };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
        return { ...cat, expenses: (cat.expenses || []).filter(exp => exp.id !== expenseId) };
      } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map(sub =>
            sub.id === categoryOrSubCategoryId ? { ...sub, expenses: (sub.expenses || []).filter(exp => exp.id !== expenseId) } : sub
          ),
        };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId); 
    if (!sourceBudget) {
      const newMonth = createNewMonthBudget(targetMonthId, budgetMonths);
      setBudgetMonths(prev => ({ ...prev, [targetMonthId]: newMonth }));
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    let systemCategoriesToCarryFromSourceOrPrev: BudgetCategory[] = [];


    // Determine starting debt and system cats based on the *actual* month preceding the targetMonth
    const referenceMonthForDebtAndSystemCats = prevMonthForTargetBudget || (sourceBudget.id === prevMonthForTargetId ? sourceBudget : null);

    if (referenceMonthForDebtAndSystemCats) { 
        const ccPaymentsCatRef = referenceMonthForDebtAndSystemCats.categories.find(
            cat => cat.isSystemCategory && cat.name === "Credit Card Payments"
        );
        const paymentsMadeLastMonthRef = ccPaymentsCatRef
            ? ccPaymentsCatRef.expenses.reduce((sum, exp) => sum + exp.amount, 0)
            : 0;
        calculatedStartingDebtForTarget = (referenceMonthForDebtAndSystemCats.startingCreditCardDebt || 0) - paymentsMadeLastMonthRef;

        const savingsCatRef = referenceMonthForDebtAndSystemCats.categories.find(cat => cat.isSystemCategory && cat.name === "Savings");
        if (savingsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...savingsCatRef, id: uuidv4(), expenses: []});
        if (ccPaymentsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...ccPaymentsCatRef, id: uuidv4(), expenses: []});
    } else {
        // No direct previous month for target, or source is not the direct previous month.
        // Use source month's starting debt as a fallback basis if it makes sense contextually, or default to 0.
        // Here, we'll default to 0 if no relevant previous month is found.
         calculatedStartingDebtForTarget = 0; 
    }
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);

    // Duplicate non-system categories from the sourceBudget
    const duplicatedUserCategories = sourceBudget.categories
        .filter(cat => !cat.isSystemCategory) 
        .map(cat => ({
            id: uuidv4(), 
            name: cat.name,
            budgetedAmount: cat.budgetedAmount, // This will be recalculated if it has subs
            expenses: [], 
            subcategories: (cat.subcategories || []).map(subCat => ({
              id: uuidv4(), 
              name: subCat.name,
              budgetedAmount: subCat.budgetedAmount, 
              expenses: [], 
            })),
            isSystemCategory: false,
      }));

      // Recalculate budget for duplicated parent categories if they have subcategories
      duplicatedUserCategories.forEach(cat => {
          if (cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum,sub) => sum + sub.budgetedAmount, 0);
          }
      });
    
    // Combine carried system categories with duplicated user categories
    // Prioritize system categories from carry-over, then add user categories
    // This also handles potential duplication if AI suggested "Savings"
    let finalCategoriesForNewMonth = [...systemCategoriesToCarryFromSourceOrPrev];
    duplicatedUserCategories.forEach(dupCat => {
        if (!finalCategoriesForNewMonth.find(sc => sc.name === dupCat.name && sc.isSystemCategory)) {
            finalCategoriesForNewMonth.push(dupCat);
        }
    });

    // Ensure system categories are correctly flagged
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
  }, [getBudgetForMonth, budgetMonths, createNewMonthBudget, setCurrentDisplayMonthId]); 

  const navigateToPreviousMonth = useCallback(() => {
    const prevMonthId = getPreviousMonthId(currentDisplayMonthId);
    ensureMonthExists(prevMonthId); 
    setCurrentDisplayMonthId(prevMonthId);
  }, [currentDisplayMonthId, ensureMonthExists, setCurrentDisplayMonthId]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    ensureMonthExists(nextMonthId); 
    setCurrentDisplayMonthId(nextMonthId);
  }, [currentDisplayMonthId, ensureMonthExists, setCurrentDisplayMonthId]);

  const rolloverUnspentBudget = useCallback((yearMonthId: string): { success: boolean; message: string } => {
    const monthBudget = getBudgetForMonth(yearMonthId); 
    if (!monthBudget) {
      return { success: false, message: `Budget for ${yearMonthId} not found.` };
    }
    if (monthBudget.isRolledOver) {
      return { success: false, message: `Budget for ${yearMonthId} has already been finalized.` };
    }

    const updatedMonth = { ...monthBudget, isRolledOver: true };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    
    return { success: true, message: "Month closed. Any unspent operational funds are implicitly saved." };

  }, [getBudgetForMonth]); 

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    // Check if a category with this name already exists (case-insensitive for non-system)
    const existingCat = monthToUpdate.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (existingCat) {
        // If it exists and is a system category, don't add.
        // If it exists and is not system, maybe alert user or just don't add. For now, don't add.
        console.warn(`Category "${categoryName}" already exists.`);
        return;
    }

    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    // Apply system category flags if the name matches
    const { updatedCategories: tempCats } = ensureSystemCategoryFlags([newCategory]);
    const finalNewCategory = tempCats[0]; 

    const updatedCategoriesList = [...monthToUpdate.categories, finalNewCategory];
    // No need to re-run ensureSystemCategoryFlags on the whole list if finalNewCategory is already processed.
    
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]); 

  const updateCategoryInMonth = useCallback((yearMonthId: string, categoryId: string, updatedCategoryData: Partial<Omit<BudgetCategory, 'subcategories' | 'isSystemCategory' | 'id'>>) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    let categoryUpdated = false;
    let newCategories = monthToUpdate.categories.map(cat => {
      if (cat.id === categoryId) {
        categoryUpdated = true;
        let newName = updatedCategoryData.name !== undefined ? updatedCategoryData.name : cat.name;
        let newBudget = updatedCategoryData.budgetedAmount !== undefined ? updatedCategoryData.budgetedAmount : cat.budgetedAmount;
        
        if (cat.isSystemCategory && updatedCategoryData.name !== undefined && updatedCategoryData.name.toLowerCase() !== cat.name.toLowerCase()) {
            newName = cat.name; // System category names cannot be changed
        }

        // If it's a non-system category with subcategories, its budget is derived
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, subcategories: cat.subcategories || [] };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      // Only need to ensure flags if a name potentially changed to a system name, or from one.
      // This is complex to check narrowly, so re-running on the whole list is safer.
      const { updatedCategories, wasChanged: flagsChanged } = ensureSystemCategoryFlags(newCategories);
      const finalCategories = flagsChanged ? updatedCategories : newCategories;

      // Re-derive budget for non-system parent categories after potential flag changes
      finalCategories.forEach(cat => {
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
      });

      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
      setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists]);
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const updatedMonth = { ...monthToUpdate, categories: filteredCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    let parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return; 

    const newSubCategory: SubCategory = { id: uuidv4(), name: subCategoryName, budgetedAmount: subCategoryBudget, expenses: [] };
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        const updatedSubcategories = [...(cat.subcategories || []), newSubCategory];
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        const updatedSubcategories = (cat.subcategories || []).map(sub =>
            sub.id === subCategoryId ? { ...sub, name: newName, budgetedAmount: newBudget } : sub
        );
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
  }, [ensureMonthExists]);

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
    const parentCat = monthToUpdate.categories.find(cat => cat.id === parentCategoryId);
    if (!parentCat || parentCat.isSystemCategory) return;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (cat.id === parentCategoryId) {
        const updatedSubcategories = (cat.subcategories || []).filter(sub => sub.id !== subCategoryId);
        const newParentBudget = updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
      }
      return cat;
    });
    const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
    setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
  }, [ensureMonthExists]);


  return {
    budgetMonths,
    currentDisplayMonthId,
    currentBudgetMonth,
    isLoading: isLoading || authLoading || isSaving,
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
