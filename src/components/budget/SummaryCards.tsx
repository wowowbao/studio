
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Target, Wallet, AlertCircle, Coins } from "lucide-react";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

const getCategorySpentAmount = (category: BudgetCategory | SubCategory): number => {
  return (category.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
};

export function SummaryCards({ budgetMonth }: SummaryCardsProps) {
  if (!budgetMonth) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-muted rounded w-1/2"></div>
              <div className="h-6 w-6 bg-muted rounded-full"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted rounded w-3/4 mb-1"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const totalIncomeReceived = (budgetMonth.incomes || []).reduce((sum, income) => sum + income.amount, 0);
  
  let totalBudgetedForAllCategories = 0; 
  let totalOperationalSpending = 0; // Renamed from totalSpentExcludingSavingsCategory
  let amountActuallySaved = 0; 
  let savingsCategoryBudgetedAmount = 0; 
  let creditCardPaymentsCategoryBudgetedAmount = 0; // New variable

  budgetMonth.categories.forEach(cat => {
    const catNameLower = cat.name.toLowerCase();
    const isSavingsCat = cat.isSystemCategory && catNameLower === 'savings';
    const isCCPaymentsCat = cat.isSystemCategory && catNameLower === 'credit card payments';
    
    // Calculate effective budget for this category (parent if no subs, sum of subs if subs)
    let effectiveCategoryBudget = 0;
    if (cat.subcategories && cat.subcategories.length > 0 && !cat.isSystemCategory) {
      cat.subcategories.forEach(sub => effectiveCategoryBudget += sub.budgetedAmount);
    } else {
      effectiveCategoryBudget = cat.budgetedAmount;
    }
    totalBudgetedForAllCategories += effectiveCategoryBudget;

    if (isSavingsCat) {
      amountActuallySaved += getCategorySpentAmount(cat);
      savingsCategoryBudgetedAmount += effectiveCategoryBudget; // Use effective budget
    } else if (isCCPaymentsCat) {
      creditCardPaymentsCategoryBudgetedAmount += effectiveCategoryBudget; // Use effective budget
      // Spending for CC Payments is not part of totalOperationalSpending
    } else { // Operational categories
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalOperationalSpending += getCategorySpentAmount(sub);
        });
        // Add parent's direct expenses if any. CategoryCard displays these separately.
        // For summary, we assume expenses are logged in subs if subs exist.
        // If parent can also have direct expenses, this part might need adjustment based on exact spending model.
        // However, AddExpenseModal directs to subs if they exist.
      } else { 
        totalOperationalSpending += getCategorySpentAmount(cat);
      }
    }
  });
  
  const fundsToAllocate = totalIncomeReceived - totalBudgetedForAllCategories;
  const isOverAllocated = fundsToAllocate < 0;

  // Budget for operational categories = Total Budget - Savings Budget - CC Payments Budget
  const operationalCategoriesBudget = totalBudgetedForAllCategories - savingsCategoryBudgetedAmount - creditCardPaymentsCategoryBudgetedAmount;
  const overallOperationalSpendingRemaining = operationalCategoriesBudget - totalOperationalSpending;
  const isOverSpentOverallOnOperational = overallOperationalSpendingRemaining < 0;


  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Income Received</CardTitle>
          <Coins className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalIncomeReceived.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Total income recorded for this month.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Budgeted</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalBudgetedForAllCategories.toFixed(2)}</div>
           <p className={cn("text-xs", isOverAllocated ? "text-destructive/80" : "text-muted-foreground")}>
            {isOverAllocated 
              ? `Over allocated by $${Math.abs(fundsToAllocate).toFixed(2)}` 
              : `$${fundsToAllocate.toFixed(2)} of income not yet allocated`}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Spent (Non-Savings/Debt)</CardTitle>
          { isOverSpentOverallOnOperational ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverSpentOverallOnOperational && "text-destructive")}>
            ${totalOperationalSpending.toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverSpentOverallOnOperational ? "text-destructive/80" : "text-muted-foreground")}>
            {isOverSpentOverallOnOperational ? 
              `Overspent by $${Math.abs(overallOperationalSpendingRemaining).toFixed(2)}` : 
              `$${overallOperationalSpendingRemaining.toFixed(2)} remaining in spending categories`}
          </p>
        </CardContent>
      </Card>

       <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Savings Progress</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            ${amountActuallySaved.toFixed(2)}
            {budgetMonth.savingsGoal > 0 && <span className="text-lg text-muted-foreground"> / ${budgetMonth.savingsGoal.toFixed(2)} goal</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Actual amount saved this month.
            {budgetMonth.savingsGoal > 0 ? ` Target: $${budgetMonth.savingsGoal.toFixed(2)}.` : ' No overall goal set.'}
          </p>
           <p className="text-xs text-muted-foreground mt-1">
             Planned transfer to savings: ${savingsCategoryBudgetedAmount.toFixed(2)}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
