
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Target, Wallet, AlertCircle } from "lucide-react";
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

  const monthlyIncome = budgetMonth.monthlyIncome || 0;
  let totalBudgetedForAllCategories = 0; // Includes amounts budgeted for savings category
  let totalSpentExcludingSavingsCategory = 0; // Spending from non-savings categories
  let amountActuallySaved = 0; // Actual expenses logged under "Savings" category
  let savingsCategoryBudgetedAmount = 0; // Amount budgeted for the "Savings" category

  budgetMonth.categories.forEach(cat => {
    const isSavingsCat = cat.isSystemCategory && cat.name.toLowerCase() === 'savings';
    
    if (isSavingsCat) {
      amountActuallySaved += getCategorySpentAmount(cat);
      savingsCategoryBudgetedAmount += cat.budgetedAmount; // How much is planned to be moved to savings
      totalBudgetedForAllCategories += cat.budgetedAmount; // Savings budget is part of total budget
    } else {
      // If category has subcategories, sum their budgets and spending
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalBudgetedForAllCategories += sub.budgetedAmount;
          const spentInSub = getCategorySpentAmount(sub);
          totalSpentExcludingSavingsCategory += spentInSub;
        });
      } else { // Otherwise, use the parent category's budget and spending
        totalBudgetedForAllCategories += cat.budgetedAmount;
        const spentInCat = getCategorySpentAmount(cat);
        totalSpentExcludingSavingsCategory += spentInCat;
      }
    }
  });
  
  const fundsToAllocate = monthlyIncome - totalBudgetedForAllCategories;
  const isOverAllocated = fundsToAllocate < 0;

  const overallSpendingRemaining = totalBudgetedForAllCategories - savingsCategoryBudgetedAmount - totalSpentExcludingSavingsCategory;
  const isOverSpentOverallOnNonSavings = overallSpendingRemaining < 0;


  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Monthly Income</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${monthlyIncome.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Your total earnings for the month.</p>
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
          <CardTitle className="text-sm font-medium">Total Spent (Non-Savings)</CardTitle>
          { isOverSpentOverallOnNonSavings ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverSpentOverallOnNonSavings && "text-destructive")}>
            ${totalSpentExcludingSavingsCategory.toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverSpentOverallOnNonSavings ? "text-destructive/80" : "text-muted-foreground")}>
            {isOverSpentOverallOnNonSavings ? 
              `Overspent by $${Math.abs(overallSpendingRemaining).toFixed(2)}` : 
              `$${overallSpendingRemaining.toFixed(2)} remaining in spending categories`}
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
