
"use client";
import type { BudgetMonth, BudgetCategory, BudgetUpdatePayload, Expense, SubCategory, IncomeEntry } from '@/types/budget';
import { DEFAULT_CATEGORIES } from '@/types/budget';
import { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/lib/firebase';
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
// It does NOT create them if they are absent from the input `categories` array.
// It does NOT modify their budgetedAmount.
// It also ensures system categories do not have subcategories.
// Returns true if any category was actually changed.
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? JSON.parse(JSON.stringify(categories)) : []; // Deep clone for mutation safety
  let wasActuallyChanged = false;

  const systemCategorySpecs = [
    { name: "Savings", defaultBudget: 0 },
    { name: "Credit Card Payments", defaultBudget: 0 }
  ];

  newCategories.forEach((cat: BudgetCategory, index: number) => {
    const catNameLower = cat.name.toLowerCase();
    const originalCatJSON = JSON.stringify(cat); // Store original for comparison
    let categoryModified = false;

    const matchedSpec = systemCategorySpecs.find(spec => spec.name.toLowerCase() === catNameLower);

    if (matchedSpec) {
      // If a category matches a system category name, ensure its flags are correct
      if (!cat.isSystemCategory) { cat.isSystemCategory = true; categoryModified = true; }
      if (cat.name !== matchedSpec.name) { cat.name = matchedSpec.name; categoryModified = true; } // Standardize name
      if (cat.subcategories && cat.subcategories.length > 0) { cat.subcategories = []; categoryModified = true; } // System cats don't have subs
      if (cat.budgetedAmount === undefined) { cat.budgetedAmount = matchedSpec.defaultBudget; categoryModified = true; } // Ensure budget is defined
    } else {
      // If not a system category by name, ensure isSystemCategory flag is false
      if (cat.isSystemCategory) { cat.isSystemCategory = false; categoryModified = true; }
      if (cat.budgetedAmount === undefined) { cat.budgetedAmount = 0; categoryModified = true; }
    }

    // Ensure expenses array exists
    if (!Array.isArray(cat.expenses)) {
        cat.expenses = [];
        categoryModified = true;
    }
    // Ensure subcategories array exists for non-system categories
    if (!cat.isSystemCategory && !Array.isArray(cat.subcategories)) {
        cat.subcategories = [];
        categoryModified = true;
    }
    // Ensure subcategories have necessary fields
    if (cat.subcategories) {
        cat.subcategories.forEach((sub, subIndex) => {
            let subCategoryModified = false;
            if (!Array.isArray(sub.expenses)) {
                sub.expenses = []; // Ensure subcategory expenses array exists
                subCategoryModified = true;
            }
            if (sub.budgetedAmount === undefined) {
                sub.budgetedAmount = 0; // Ensure subcategory budget is defined
                subCategoryModified = true;
            }
            if (subCategoryModified) {
                cat.subcategories![subIndex] = {...sub}; // Update subcategory with new reference if modified
                categoryModified = true; // Mark parent category as modified
            }
        });
    }
    
    // If any modification happened, update the array element with a new reference
    if (categoryModified && JSON.stringify(cat) !== originalCatJSON) {
        wasActuallyChanged = true;
        newCategories[index] = {...cat}; // Create a new reference for the category object itself
    }
  });
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();

  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});

  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
    // This runs once on initial mount to determine the starting month
    if (typeof window !== "undefined") {
      // Attempt to get user ID early for localStorage key, fallback to guest
      const initialAuthUser = authLoading ? undefined : (user || undefined); // Avoid using `auth.currentUser` directly here
      const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(initialAuthUser?.uid));
      if (storedDisplayMonth) {
        return storedDisplayMonth;
      }
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default to June 2025
  });

  const [isLoadingDb, setIsLoadingDb] = useState(true); // Separate loading state for DB/localStorage operations
  const [isSaving, setIsSaving] = useState(false);


  // Effect for initializing currentDisplayMonthId from localStorage or setting default
  // Runs when auth state changes to ensure correct user's preference is loaded
  useEffect(() => {
    if (authLoading) return; // Wait for auth to settle

    const currentUid = user?.uid;
    const key = getDisplayMonthKey(currentUid);
    const storedMonthId = localStorage.getItem(key);

    if (storedMonthId) {
      if (currentDisplayMonthId !== storedMonthId) { // Only update if different
        setCurrentDisplayMonthIdState(storedMonthId);
      }
    } else {
      const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1));
      setCurrentDisplayMonthIdState(defaultMonth);
      localStorage.setItem(key, defaultMonth);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]); // currentDisplayMonthId removed to prevent loop, init based on auth state


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
    if (!authLoading) { // Ensure auth is settled before trying to get UID
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return;
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories); // Ensure flags on save
        monthsWithEnsuredCategories[monthId] = { ...month, categories: updatedCategories, incomes: month.incomes || [] };
      }
      await setDoc(docRef, { months: monthsWithEnsuredCategories }, { merge: true });
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
    let initialCategories: BudgetCategory[] = DEFAULT_CATEGORIES.map(cat => ({
      ...cat,
      id: uuidv4(),
      budgetedAmount: 0,
      expenses: [],
      subcategories: [],
    }));

    if (prevMonthBudget) {
        const prevSavingsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Savings");
        if (prevSavingsCat) {
            const existingSavingsIndex = initialCategories.findIndex(c => c.name === "Savings");
            if (existingSavingsIndex !== -1) {
                initialCategories[existingSavingsIndex] = { ...prevSavingsCat, id: initialCategories[existingSavingsIndex].id, expenses: [] }; // Keep ID, carry budget, reset expenses
            } else {
                 initialCategories.push({
                    id: uuidv4(),
                    name: "Savings",
                    budgetedAmount: prevSavingsCat.budgetedAmount,
                    expenses: [],
                    subcategories: [],
                    isSystemCategory: true,
                });
            }
        }

        const prevCCPaymentsCat = prevMonthBudget.categories.find(cat => cat.isSystemCategory && cat.name === "Credit Card Payments");
        if (prevCCPaymentsCat) {
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;

            const existingCCIndex = initialCategories.findIndex(c => c.name === "Credit Card Payments");
             if (existingCCIndex !== -1) {
                initialCategories[existingCCIndex] = { ...prevCCPaymentsCat, id: initialCategories[existingCCIndex].id, expenses: [] }; // Keep ID, carry budget, reset expenses
            } else {
                initialCategories.push({
                    id: uuidv4(),
                    name: "Credit Card Payments",
                    budgetedAmount: prevCCPaymentsCat.budgetedAmount, // Carry over planned payment
                    expenses: [],
                    subcategories: [],
                    isSystemCategory: true,
                });
            }
        } else {
             calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0; // No CC category, just carry debt
        }


    } else {
        // No previous month, means this is likely the first month ever or a disconnected month.
        // Default system categories will be handled by ensureSystemCategoryFlags if they are part of DEFAULT_CATEGORIES
        // or if they get added by user/AI. For now, we start with DEFAULT_CATEGORIES.
        // If DEFAULT_CATEGORIES is empty, it will truly be blank for user cats.
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
    // Ensure system flags for the initial categories (e.g., if "Savings" was added by DEFAULT_CATEGORIES)
    const { updatedCategories } = ensureSystemCategoryFlags(initialCategories);
    
    return {
      id: yearMonthId,
      year,
      month: monthNum,
      incomes: [],
      categories: updatedCategories,
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
    setIsLoadingDb(true);
    let unsubscribe = () => {};

    if (isUserAuthenticated && user) {
      const docRef = getFirestoreUserBudgetDocRef(user.uid);
      unsubscribe = onSnapshot(docRef, (docSnap) => {
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
                    cat.subcategories = []; // System cats don't have subs
                }
            });
            if (catsChanged) { // Only create new reference if truly changed by ensureSystemCategoryFlags
              loadedMonths[monthId] = {...monthData};
            }
          });
        }
        
        if (!loadedMonths[currentDisplayMonthId]) {
            const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, loadedMonths);
            loadedMonths = {...loadedMonths, [currentDisplayMonthId]: newCurrentMonthData }; // Ensure new ref for loadedMonths
            changedDuringLoad = true;
        } else {
            const currentMonth = loadedMonths[currentDisplayMonthId];
            const originalCurrentMonthJSON = JSON.stringify(currentMonth);
            const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
            if (currentMonthCatsChanged) {
                loadedMonths[currentDisplayMonthId] = { ...currentMonth, categories: ensuredCurrentMonthCategories };
                 if (JSON.stringify(loadedMonths[currentDisplayMonthId]) !== originalCurrentMonthJSON) {
                    changedDuringLoad = true;
                }
            }
        }
        
        setBudgetMonths(prevMonths => {
          // Only update if the new loadedMonths is actually different
          if (JSON.stringify(prevMonths) !== JSON.stringify(loadedMonths)) {
            return loadedMonths;
          }
          return prevMonths;
        });

        if (changedDuringLoad && user && Object.keys(loadedMonths).length > 0) { 
            saveBudgetMonthsToFirestore(user.uid, loadedMonths);
        }
        setIsLoadingDb(false);
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        setBudgetMonths({}); 
        setIsLoadingDb(false);
      });
      return () => unsubscribe();
    } else { 
      // Guest mode - load from localStorage
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
            if (catsChanged) { // Only create new reference if truly changed
                guestMonthsToSet[monthId] = {...monthData};
            } else {
                guestMonthsToSet[monthId] = monthData; // Keep original reference if no logical change
            }
          });
        } catch (e) {
          console.error("Error parsing guest budget data from localStorage", e);
        }
      }
      
      if (!guestMonthsToSet[currentDisplayMonthId]) {
          const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, guestMonthsToSet);
          guestMonthsToSet = {...guestMonthsToSet, [currentDisplayMonthId]: newCurrentMonthData};
          changedDuringGuestLoad = true;
      } else {
          const currentMonth = guestMonthsToSet[currentDisplayMonthId];
          const originalCurrentMonthJSON = JSON.stringify(currentMonth);
          const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
          if (currentMonthCatsChanged) {
              guestMonthsToSet[currentDisplayMonthId] = { ...currentMonth, categories: ensuredCurrentMonthCategories };
               if (JSON.stringify(guestMonthsToSet[currentDisplayMonthId]) !== originalCurrentMonthJSON) {
                  changedDuringGuestLoad = true;
              }
          }
      }

      setBudgetMonths(prevMonths => {
        if (JSON.stringify(prevMonths) !== JSON.stringify(guestMonthsToSet)) {
          return guestMonthsToSet;
        }
        return prevMonths;
      });
      if (changedDuringGuestLoad && Object.keys(guestMonthsToSet).length > 0) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(guestMonthsToSet));
      }
      setIsLoadingDb(false);
    }
    // Key dependencies for reloading data when user, auth state, or viewed month changes.
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore]);


  // Effect for saving to localStorage for guest users, or to Firestore for authenticated users
  // This runs whenever budgetMonths changes and the app is not in an initial loading state.
  useEffect(() => {
    if (!isLoadingDb && !authLoading && Object.keys(budgetMonths).length > 0) { 
      if (isUserAuthenticated && user && !isSaving) {
        saveBudgetMonthsToFirestore(user.uid, budgetMonths);
      } else if (!isUserAuthenticated) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(budgetMonths));
      }
    }
  }, [budgetMonths, isLoadingDb, authLoading, user, isUserAuthenticated, saveBudgetMonthsToFirestore, isSaving]);


  const getBudgetForMonth = useCallback((yearMonthId: string): BudgetMonth | undefined => {
    return budgetMonths[yearMonthId];
  }, [budgetMonths]);

  const currentBudgetMonth = getBudgetForMonth(currentDisplayMonthId);

  const ensureMonthExists = useCallback((yearMonthId: string): BudgetMonth => {
    let monthData = budgetMonths[yearMonthId];
    let needsUpdateToState = false;
    let newBudgetDataForState: Record<string, BudgetMonth> | null = null; 

    if (!monthData) {
      const createdMonth = createNewMonthBudget(yearMonthId, budgetMonths);
      newBudgetDataForState = { ...budgetMonths, [yearMonthId]: createdMonth };
      monthData = createdMonth;
      needsUpdateToState = true;
    } else {
      const originalMonthJSON = JSON.stringify(monthData);
      let tempMonthData = { ...monthData }; 

      const { updatedCategories, wasChanged: catsChanged } = ensureSystemCategoryFlags(tempMonthData.categories || []);
      if (catsChanged) {
        tempMonthData.categories = updatedCategories;
      }

      let otherFieldsChanged = false;
      if (tempMonthData.incomes === undefined) { tempMonthData.incomes = []; otherFieldsChanged = true; }
      if (tempMonthData.isRolledOver === undefined) { tempMonthData.isRolledOver = false; otherFieldsChanged = true; }
      if (tempMonthData.startingCreditCardDebt === undefined) { tempMonthData.startingCreditCardDebt = 0; otherFieldsChanged = true; }
      
      (tempMonthData.categories || []).forEach(cat => {
        if (cat.expenses === undefined) { cat.expenses = []; otherFieldsChanged = true; }
        if (cat.budgetedAmount === undefined) { cat.budgetedAmount = 0; otherFieldsChanged = true;}
        if (!cat.isSystemCategory) {
            if (cat.subcategories === undefined) { cat.subcategories = []; otherFieldsChanged = true; }
            (cat.subcategories || []).forEach(sub => { 
                if (sub.expenses === undefined) { sub.expenses = []; otherFieldsChanged = true; }
                if (sub.budgetedAmount === undefined) { sub.budgetedAmount = 0; otherFieldsChanged = true; }
            });
        } else {
            if (cat.subcategories === undefined || (Array.isArray(cat.subcategories) && cat.subcategories.length > 0)) {
                 cat.subcategories = []; otherFieldsChanged = true;
            }
        }
      });

      if (catsChanged || otherFieldsChanged || JSON.stringify(tempMonthData) !== originalMonthJSON) {
        newBudgetDataForState = { ...budgetMonths, [yearMonthId]: tempMonthData };
        monthData = tempMonthData; 
        needsUpdateToState = true;
      }
    }

    if (needsUpdateToState && newBudgetDataForState) {
      // Check against current state to prevent loop if newBudgetDataForState is same as current budgetMonths
      if (JSON.stringify(budgetMonths) !== JSON.stringify(newBudgetDataForState)) {
        setBudgetMonths(newBudgetDataForState);
      }
    }
    return monthData!;
  }, [budgetMonths, createNewMonthBudget, setBudgetMonths]);


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

        // For non-system categories, parent budget is sum of subs if subs exist
        if (catPayload.isSystemCategory === false && subcategoriesToSet.length > 0) {
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
    
    const { updatedCategories, wasChanged: systemFlagsChanged } = ensureSystemCategoryFlags(updatedMonth.categories);
    updatedMonth.categories = updatedCategories;

    // Recalculate parent budget for non-system categories if subcategories changed or flags changed structure
     updatedMonth.categories.forEach(cat => {
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            cat.budgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
    });


    // Only update if there's a meaningful change
    if (JSON.stringify(budgetMonths[yearMonthId]) !== JSON.stringify(updatedMonth)) {
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths]); // Added budgetMonths and setBudgetMonths


  const addExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, amount: number, description: string, dateAdded: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 

    const newExpense: Expense = { id: uuidv4(), description, amount, dateAdded };
    let changed = false;
    
    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            console.warn(`Attempted to add expense to parent category '${cat.name}' which has subcategories. Expense not added.`);
            return cat;
        }
        changed = true;
        return { ...cat, expenses: [...(cat.expenses || []), newExpense] };
      } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        changed = true;
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map(sub =>
            sub.id === categoryOrSubCategoryId ? { ...sub, expenses: [...(sub.expenses || []), newExpense] } : sub
          ),
        };
      }
      return cat;
    });

    if (changed) {
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths
  
  const deleteExpense = useCallback((yearMonthId: string, categoryOrSubCategoryId: string, expenseId: string, isSubCategory: boolean = false) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return;
    let changed = false;

    const updatedCategoriesList = monthToUpdate.categories.map(cat => {
      if (!isSubCategory && cat.id === categoryOrSubCategoryId) {
        const initialLength = (cat.expenses || []).length;
        const newExpenses = (cat.expenses || []).filter(exp => exp.id !== expenseId);
        if (newExpenses.length !== initialLength) changed = true;
        return { ...cat, expenses: newExpenses };
      } else if (isSubCategory && !cat.isSystemCategory && cat.subcategories?.find(sub => sub.id === categoryOrSubCategoryId)) {
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map(sub => {
            if (sub.id === categoryOrSubCategoryId) {
              const initialLength = (sub.expenses || []).length;
              const newExpenses = (sub.expenses || []).filter(exp => exp.id !== expenseId);
              if (newExpenses.length !== initialLength) changed = true;
              return { ...sub, expenses: newExpenses };
            }
            return sub;
          }),
        };
      }
      return cat;
    });

    if (changed) {
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const addIncome = useCallback((yearMonthId: string, description: string, amount: number, dateAdded: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    if (monthToUpdate.isRolledOver) return; 
    
    const newIncomeEntry: IncomeEntry = { id: uuidv4(), description, amount, dateAdded };
    const updatedMonth = { ...monthToUpdate, incomes: [...(monthToUpdate.incomes || []), newIncomeEntry] };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const deleteIncome = useCallback((yearMonthId: string, incomeId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
     if (monthToUpdate.isRolledOver) return;

    const updatedMonth = { ...monthToUpdate, incomes: (monthToUpdate.incomes || []).filter(inc => inc.id !== incomeId) };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths


  const duplicateMonthBudget = useCallback((sourceMonthId: string, targetMonthId: string) => {
    const sourceBudget = getBudgetForMonth(sourceMonthId); 
    if (!sourceBudget) {
      // If source doesn't exist, just ensure target month is created (will be default/new)
      const newMonth = ensureMonthExists(targetMonthId); // ensureMonthExists will call setBudgetMonths if new
      setCurrentDisplayMonthId(targetMonthId);
      return;
    }

    const [targetYear, targetMonthNum] = targetMonthId.split('-').map(Number);
    const prevMonthForTargetId = getPreviousMonthId(targetMonthId);
    const prevMonthForTargetBudget = budgetMonths[prevMonthForTargetId]; 
    let calculatedStartingDebtForTarget = 0;
    let systemCategoriesToCarry: BudgetCategory[] = [];


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
        if (savingsCatRef) systemCategoriesToCarry.push({...savingsCatRef, id: uuidv4(), expenses: []});
        
        if (ccPaymentsCatRef) systemCategoriesToCarry.push({...ccPaymentsCatRef, id: uuidv4(), expenses: []});

    } else {
         calculatedStartingDebtForTarget = 0; 
         // Default system categories will be handled by ensureSystemCategoryFlags if present in DEFAULT_CATEGORIES
         // or if added by AI/user. For duplication, we primarily care about carrying over budgeted amounts.
         const sourceSavings = sourceBudget.categories.find(c => c.isSystemCategory && c.name === "Savings");
         if(sourceSavings) systemCategoriesToCarry.push({...sourceSavings, id: uuidv4(), expenses: []});
         else systemCategoriesToCarry.push({ id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });

         const sourceCC = sourceBudget.categories.find(c => c.isSystemCategory && c.name === "Credit Card Payments");
         if(sourceCC) systemCategoriesToCarry.push({...sourceCC, id: uuidv4(), expenses: []});
         else systemCategoriesToCarry.push({ id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
    }
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);
    const duplicatedUserCategories = sourceBudget.categories
        .filter(cat => !cat.isSystemCategory) 
        .map(cat => ({
            id: uuidv4(), 
            name: cat.name,
            budgetedAmount: cat.budgetedAmount, // This will be sum of subs if subs exist
            expenses: [], 
            subcategories: (cat.subcategories || []).map(subCat => ({
              id: uuidv4(), 
              name: subCat.name,
              budgetedAmount: subCat.budgetedAmount, 
              expenses: [], 
            })),
            isSystemCategory: false,
      }));

      // Recalculate parent budget for duplicated user categories
      duplicatedUserCategories.forEach(cat => {
          if (cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum,sub) => sum + sub.budgetedAmount, 0);
          }
      });
    
    let finalCategoriesForNewMonth: BudgetCategory[] = [];
    const systemCategoryNames = new Set(systemCategoriesToCarry.map(sc => sc.name));
    
    finalCategoriesForNewMonth.push(...systemCategoriesToCarry);
    duplicatedUserCategories.forEach(dupCat => {
        if (!systemCategoryNames.has(dupCat.name)) { 
            finalCategoriesForNewMonth.push(dupCat);
        }
    });
    
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
  }, [getBudgetForMonth, budgetMonths, setCurrentDisplayMonthId, ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const navigateToPreviousMonth = useCallback(() => {
    const prevMonthId = getPreviousMonthId(currentDisplayMonthId);
    setCurrentDisplayMonthId(prevMonthId); // This will trigger main data loading effect which ensures month exists
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

  const navigateToNextMonth = useCallback(() => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    setCurrentDisplayMonthId(nextMonthId); // This will trigger main data loading effect
  }, [currentDisplayMonthId, setCurrentDisplayMonthId]);

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
    
    return { success: true, message: "Month finalized and closed. Any unspent operational funds are implicitly saved." };

  }, [getBudgetForMonth, setBudgetMonths]); // Added setBudgetMonths

  const addCategoryToMonth = useCallback((yearMonthId: string, categoryName: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId); 
    const existingCat = monthToUpdate.categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (existingCat) {
        console.warn(`Category "${categoryName}" already exists.`);
        return;
    }

    const newCategory: BudgetCategory = {
      id: uuidv4(), name: categoryName, budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false, 
    };
    
    const { updatedCategories: tempCatsWithNew } = ensureSystemCategoryFlags([...monthToUpdate.categories, newCategory]);
    
    const updatedMonth = { ...monthToUpdate, categories: tempCatsWithNew };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

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

        // If it's a non-system category and has subcategories, its budget is derived
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, subcategories: cat.subcategories || [] };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(newCategories);

      // Re-derive budget for parent categories after potential flag changes or if budget was directly set
      finalCategories.forEach(cat => {
          if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
          }
      });

      const updatedMonth = { ...monthToUpdate, categories: finalCategories };
       if (JSON.stringify(budgetMonths[yearMonthId]?.categories) !== JSON.stringify(updatedMonth.categories)) {
            setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
       }
    }
  }, [ensureMonthExists, budgetMonths, setBudgetMonths]); // Added budgetMonths and setBudgetMonths
  
  const deleteCategoryFromMonth = useCallback((yearMonthId: string, categoryId: string) => {
    const monthToUpdate = ensureMonthExists(yearMonthId);
    const categoryToDelete = monthToUpdate.categories.find(cat => cat.id === categoryId);
      
    if (categoryToDelete?.isSystemCategory) return; 
    
    const filteredCategories = monthToUpdate.categories.filter(cat => cat.id !== categoryId);
    const updatedMonth = { ...monthToUpdate, categories: filteredCategories };
    setBudgetMonths(prev => ({ ...prev, [yearMonthId]: updatedMonth }));
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const addSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryName: string, subCategoryBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const updateSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string, newName: string, newBudget: number) => {
    const monthToUpdate = ensureMonthExists(monthId);
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths

  const deleteSubCategory = useCallback((monthId: string, parentCategoryId: string, subCategoryId: string) => {
    const monthToUpdate = ensureMonthExists(monthId);
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
        const updatedMonth = { ...monthToUpdate, categories: updatedCategoriesList };
        setBudgetMonths(prev => ({ ...prev, [monthId]: updatedMonth }));
    }
  }, [ensureMonthExists, setBudgetMonths]); // Added setBudgetMonths


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
