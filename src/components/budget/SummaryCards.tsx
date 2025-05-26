
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Target } from "lucide-react";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

const getCategorySpentAmount = (category: BudgetCategory | SubCategory): number => {
  return category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
};

export function SummaryCards({ budgetMonth }: SummaryCardsProps) {
  if (!budgetMonth) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => (
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

  let totalBudgeted = 0;
  let totalSpentExcludingSavings = 0;
  let totalRemainingNonSavings = 0;
  let amountSaved = 0;

  budgetMonth.categories.forEach(cat => {
    if (cat.name.toLowerCase() === 'savings') {
      amountSaved += getCategorySpentAmount(cat);
      // Savings goal itself is not part of "total budgeted" for spending categories
    } else {
      // If category has subcategories, sum their budgets and spending
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalBudgeted += sub.budgetedAmount;
          const spentInSub = getCategorySpentAmount(sub);
          totalSpentExcludingSavings += spentInSub;
          totalRemainingNonSavings += (sub.budgetedAmount - spentInSub);
        });
      } else { // Otherwise, use the parent category's budget and spending
        totalBudgeted += cat.budgetedAmount;
        const spentInCat = getCategorySpentAmount(cat);
        totalSpentExcludingSavings += spentInCat;
        totalRemainingNonSavings += (cat.budgetedAmount - spentInCat);
      }
    }
  });
  
  const isOverBudgetOverall = totalRemainingNonSavings < 0;
  const savingsGoal = budgetMonth.savingsGoal || 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Budgeted (Non-Savings)</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalBudgeted.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Across all spending categories & subcategories.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Spent (Non-Savings)</CardTitle>
          { isOverBudgetOverall ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverBudgetOverall && "text-destructive")}>
            ${totalSpentExcludingSavings.toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverBudgetOverall ? "text-destructive/80" : "text-muted-foreground")}>
            {totalRemainingNonSavings >= 0 ? `$${totalRemainingNonSavings.toFixed(2)} remaining` : `Overspent by $${Math.abs(totalRemainingNonSavings).toFixed(2)}`}
          </p>
        </CardContent>
      </Card>
      { (savingsGoal > 0 || amountSaved > 0) && (
         <Card className="md:col-span-2 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Savings Progress</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${amountSaved.toFixed(2)}
              {savingsGoal > 0 && <span className="text-lg text-muted-foreground"> / ${savingsGoal.toFixed(2)} goal</span>}
            </div>
            {savingsGoal > 0 && (
              <p className="text-xs text-muted-foreground">
                {savingsGoal > 0 ? `${((amountSaved / savingsGoal) * 100).toFixed(0)}% towards your goal` : ''}
              </p>
            )}
            {savingsGoal === 0 && amountSaved > 0 && (
                <p className="text-xs text-muted-foreground">Total amount saved.</p>
            )}
             {savingsGoal === 0 && amountSaved === 0 && (
                <p className="text-xs text-muted-foreground">No savings goal set and no amount saved yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
