
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
// Returns true if any category was actually changed.
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? JSON.parse(JSON.stringify(categories)) : [];
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
      if (!cat.isSystemCategory) { cat.isSystemCategory = true; categoryModified = true; }
      if (cat.name !== matchedSpec.name) { cat.name = matchedSpec.name; categoryModified = true; }
      if (cat.subcategories && cat.subcategories.length > 0) { cat.subcategories = []; categoryModified = true; }
      if (cat.budgetedAmount === undefined) { cat.budgetedAmount = matchedSpec.defaultBudget; categoryModified = true; }
    } else {
      if (cat.isSystemCategory) { cat.isSystemCategory = false; categoryModified = true; }
      if (cat.budgetedAmount === undefined) { cat.budgetedAmount = 0; categoryModified = true; }
    }

    if (!Array.isArray(cat.expenses)) {
        cat.expenses = [];
        categoryModified = true;
    }
    if (!cat.isSystemCategory && !Array.isArray(cat.subcategories)) {
        cat.subcategories = [];
        categoryModified = true;
    }
    if (cat.subcategories) {
        cat.subcategories.forEach((sub, subIndex) => {
            let subCategoryModified = false;
            if (!Array.isArray(sub.expenses)) {
                sub.expenses = [];
                subCategoryModified = true;
            }
            if (sub.budgetedAmount === undefined) {
                sub.budgetedAmount = 0;
                subCategoryModified = true;
            }
            if (subCategoryModified) {
                cat.subcategories![subIndex] = {...sub}; // Ensure new reference for subcategory
                categoryModified = true;
            }
        });
    }
    
    // If any modification happened, update the array element with a new reference
    if (categoryModified && JSON.stringify(cat) !== originalCatJSON) {
        wasActuallyChanged = true;
        newCategories[index] = {...cat}; // Ensure new reference for category
    }
  });
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};


export const useBudgetCore = () => {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();

  const [budgetMonths, setBudgetMonths] = useState<Record<string, BudgetMonth>>({});

  const [currentDisplayMonthId, setCurrentDisplayMonthIdState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const initialAuthUser = auth.currentUser;
      const storedDisplayMonth = localStorage.getItem(getDisplayMonthKey(initialAuthUser?.uid));
      if (storedDisplayMonth) {
        return storedDisplayMonth;
      }
    }
    return getYearMonthFromDate(new Date(2025, 5, 1)); // Default to June 2025
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);


  useEffect(() => {
    if (authLoading) return;

    const currentUid = user?.uid;
    const key = getDisplayMonthKey(currentUid);
    const storedMonthForCurrentUser = localStorage.getItem(key);

    if (storedMonthForCurrentUser) {
      if (currentDisplayMonthId !== storedMonthForCurrentUser) {
        setCurrentDisplayMonthIdState(storedMonthForCurrentUser);
      }
    } else {
      const defaultMonth = getYearMonthFromDate(new Date(2025, 5, 1)); // Default to June 2025
      setCurrentDisplayMonthIdState(defaultMonth);
      localStorage.setItem(key, defaultMonth);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, currentDisplayMonthId]); // Reverted: currentDisplayMonthId is back in dependencies


  const setCurrentDisplayMonthId = useCallback((monthId: string) => {
    setCurrentDisplayMonthIdState(monthId);
     if (!authLoading) {
        localStorage.setItem(getDisplayMonthKey(user?.uid), monthId);
    }
  }, [user, authLoading]);


  const saveBudgetMonthsToFirestore = useCallback(async (userId: string, monthsToSave: Record<string, BudgetMonth>) => {
    if (!userId) return;
    const docRef = getFirestoreUserBudgetDocRef(userId);
    setIsSaving(true);
    try {
      // Before saving, ensure all system categories are correctly flagged and structured
      const monthsWithEnsuredCategories: Record<string, BudgetMonth> = {};
      for (const monthId in monthsToSave) {
        const month = monthsToSave[monthId];
        const { updatedCategories } = ensureSystemCategoryFlags(month.categories);
        monthsWithEnsuredCategories[monthId] = { ...month, categories: updatedCategories };
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
    let initialCategories: BudgetCategory[] = [];

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
            const paymentsMadeLastMonth = prevCCPaymentsCat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
            calculatedStartingDebt = (prevMonthBudget.startingCreditCardDebt || 0) - paymentsMadeLastMonth;
        } else {
            calculatedStartingDebt = prevMonthBudget.startingCreditCardDebt || 0;
        }
    } else {
        // No previous month, or previous month didn't have system categories.
        // Create them if they don't exist (ensureSystemCategoryFlags might do this based on its logic)
        // For a completely new budget, they will start blank unless added by user/AI and then flagged.
        // Let's explicitly add them here if no prevMonthBudget to ensure they exist from the start
        // or if prevMonthBudget didn't have them.
         initialCategories.push({
            id: uuidv4(),
            name: "Savings",
            budgetedAmount: 0, // Default for a new month without history
            expenses: [],
            subcategories: [],
            isSystemCategory: true,
        });
        initialCategories.push({
            id: uuidv4(),
            name: "Credit Card Payments",
            budgetedAmount: 0, // Default for a new month without history
            expenses: [],
            subcategories: [],
            isSystemCategory: true,
        });
    }
    
    const finalDebt = Math.max(0, calculatedStartingDebt);
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
            loadedMonths[monthId] = {...monthData}; // Ensure new reference for month
          });
        }
        
        // Ensure currentDisplayMonthId exists
        if (!loadedMonths[currentDisplayMonthId]) {
            const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, loadedMonths);
            loadedMonths[currentDisplayMonthId] = newCurrentMonthData;
            changedDuringLoad = true;
        } else {
            // If current month exists, still run ensureSystemCategoryFlags on it
            const currentMonth = loadedMonths[currentDisplayMonthId];
            const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
            if (currentMonthCatsChanged) {
                loadedMonths[currentDisplayMonthId] = { ...currentMonth, categories: ensuredCurrentMonthCategories };
                changedDuringLoad = true;
            }
        }
        
        setBudgetMonths(loadedMonths);
        if (changedDuringLoad && user && Object.keys(loadedMonths).length > 0) { 
            saveBudgetMonthsToFirestore(user.uid, loadedMonths);
        }
        setIsLoading(false);
      }, (error) => {
        console.error("Error fetching budget from Firestore:", error);
        setBudgetMonths({}); 
        setIsLoading(false);
      });
      return () => unsubscribe();
    } else { 
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
            guestMonthsToSet[monthId] = {...monthData}; // Ensure new reference
          });
        } catch (e) {
          console.error("Error parsing guest budget data from localStorage", e);
        }
      }
      
      if (!guestMonthsToSet[currentDisplayMonthId]) {
          const newCurrentMonthData = createNewMonthBudget(currentDisplayMonthId, guestMonthsToSet);
          guestMonthsToSet[currentDisplayMonthId] = newCurrentMonthData;
          changedDuringGuestLoad = true;
      } else {
          const currentMonth = guestMonthsToSet[currentDisplayMonthId];
          const { updatedCategories: ensuredCurrentMonthCategories, wasChanged: currentMonthCatsChanged } = ensureSystemCategoryFlags(currentMonth.categories);
          if (currentMonthCatsChanged) {
              guestMonthsToSet[currentDisplayMonthId] = { ...currentMonth, categories: ensuredCurrentMonthCategories };
              changedDuringGuestLoad = true;
          }
      }

      setBudgetMonths(guestMonthsToSet);
      if (changedDuringGuestLoad && Object.keys(guestMonthsToSet).length > 0) {
        localStorage.setItem(GUEST_BUDGET_MONTHS_KEY, JSON.stringify(guestMonthsToSet));
      }
      setIsLoading(false);
    }
  }, [user, isUserAuthenticated, authLoading, currentDisplayMonthId, createNewMonthBudget, saveBudgetMonthsToFirestore]);


  useEffect(() => {
    if (!isLoading && !authLoading && Object.keys(budgetMonths).length > 0) { 
      if (isUserAuthenticated && user && !isSaving) {
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
    let needsUpdateToState = false;
    let newBudgetDataForState: Record<string, BudgetMonth> | null = null;

    if (!monthData) {
      monthData = createNewMonthBudget(yearMonthId, budgetMonths);
      newBudgetDataForState = { ...budgetMonths, [yearMonthId]: monthData };
      needsUpdateToState = true;
    } else {
      let categoriesChanged = false;
      const { updatedCategories, wasChanged } = ensureSystemCategoryFlags(monthData.categories || []);
      if (wasChanged) {
        monthData = { ...monthData, categories: updatedCategories };
        categoriesChanged = true;
      }

      // Ensure other fields have defaults
      let otherFieldsChanged = false;
      if (monthData.incomes === undefined) { monthData.incomes = []; otherFieldsChanged = true; }
      if (monthData.isRolledOver === undefined) { monthData.isRolledOver = false; otherFieldsChanged = true; }
      if (monthData.startingCreditCardDebt === undefined) { monthData.startingCreditCardDebt = 0; otherFieldsChanged = true; }
      
      monthData.categories.forEach(cat => {
        if (cat.expenses === undefined) { cat.expenses = []; otherFieldsChanged = true; }
        if (cat.budgetedAmount === undefined) { cat.budgetedAmount = 0; otherFieldsChanged = true;}
        if (!cat.isSystemCategory) {
            if (cat.subcategories === undefined) { cat.subcategories = []; otherFieldsChanged = true; }
            cat.subcategories.forEach(sub => {
                if (sub.expenses === undefined) { sub.expenses = []; otherFieldsChanged = true; }
                if (sub.budgetedAmount === undefined) { sub.budgetedAmount = 0; otherFieldsChanged = true; }
            });
        } else {
            if (cat.subcategories === undefined || cat.subcategories.length > 0) { cat.subcategories = []; otherFieldsChanged = true; }
        }
      });


      if (categoriesChanged || otherFieldsChanged) {
        newBudgetDataForState = { ...budgetMonths, [yearMonthId]: monthData };
        needsUpdateToState = true;
      }
    }

    if (needsUpdateToState && newBudgetDataForState) {
      setBudgetMonths(newBudgetDataForState);
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
    
    const { updatedCategories } = ensureSystemCategoryFlags(updatedMonth.categories);
    updatedMonth.categories = updatedCategories;

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
        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            console.warn(`Attempted to add expense to parent category '${cat.name}' which has subcategories. Expense not added.`);
            return cat;
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
        if (savingsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...savingsCatRef, id: uuidv4(), expenses: []}); // Ensure new ID and reset expenses
        
        if (ccPaymentsCatRef) systemCategoriesToCarryFromSourceOrPrev.push({...ccPaymentsCatRef, id: uuidv4(), expenses: []}); // Ensure new ID and reset expenses

    } else {
         calculatedStartingDebtForTarget = 0; 
         // If no reference month, create default system categories for the new month
         systemCategoriesToCarryFromSourceOrPrev.push({ id: uuidv4(), name: "Savings", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
         systemCategoriesToCarryFromSourceOrPrev.push({ id: uuidv4(), name: "Credit Card Payments", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: true });
    }
    
    const targetStartingDebt = Math.max(0, calculatedStartingDebtForTarget);
    const duplicatedUserCategories = sourceBudget.categories
        .filter(cat => !cat.isSystemCategory) 
        .map(cat => ({
            id: uuidv4(), 
            name: cat.name,
            budgetedAmount: cat.budgetedAmount,
            expenses: [], 
            subcategories: (cat.subcategories || []).map(subCat => ({
              id: uuidv4(), 
              name: subCat.name,
              budgetedAmount: subCat.budgetedAmount, 
              expenses: [], 
            })),
            isSystemCategory: false,
      }));

      duplicatedUserCategories.forEach(cat => {
          if (cat.subcategories && cat.subcategories.length > 0) {
              cat.budgetedAmount = cat.subcategories.reduce((sum,sub) => sum + sub.budgetedAmount, 0);
          }
      });
    
    let finalCategoriesForNewMonth: BudgetCategory[] = [];
    const systemCategoryNames = new Set(systemCategoriesToCarryFromSourceOrPrev.map(sc => sc.name));
    
    finalCategoriesForNewMonth.push(...systemCategoriesToCarryFromSourceOrPrev);
    duplicatedUserCategories.forEach(dupCat => {
        if (!systemCategoryNames.has(dupCat.name)) { // Avoid duplicating user categories if a system cat with same name exists (shouldn't happen with current system names)
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
            newName = cat.name;
        }

        if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
            newBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
        }
        
        return { ...cat, name: newName, budgetedAmount: newBudget, subcategories: cat.subcategories || [] };
      }
      return cat;
    });
    
    if (categoryUpdated) {
      const { updatedCategories: finalCategories } = ensureSystemCategoryFlags(newCategories);

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

    