
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Target } from "lucide-react";
import type { BudgetMonth, BudgetCategory } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

// Helper function to calculate spent amount for a category
const getCategorySpentAmount = (category: BudgetCategory): number => {
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

  const totalBudgeted = budgetMonth.categories.reduce((sum, cat) => sum + cat.budgetedAmount, 0);
  const totalSpent = budgetMonth.categories.reduce((sum, cat) => {
    // Exclude "Savings" category from total "spent" for this card if it's treated differently.
    // Or, if savings "spending" is positive (actual saving), include it.
    // For simplicity, we'll sum all category "spent" amounts (which includes saved amounts for Savings category)
    return sum + getCategorySpentAmount(cat);
  }, 0);

  const totalRemainingOverall = budgetMonth.categories.reduce((sum, cat) => {
    if (cat.name.toLowerCase() === 'savings') return sum; // Don't count savings "remaining" in this context
    return sum + (cat.budgetedAmount - getCategorySpentAmount(cat));
  },0);
  
  const isOverBudgetOverall = totalRemainingOverall < 0;


  const savingsGoal = budgetMonth.savingsGoal || 0; // Default to 0 if undefined
  const savingsCategory = budgetMonth.categories.find(cat => cat.name.toLowerCase() === 'savings');
  const amountSaved = savingsCategory ? getCategorySpentAmount(savingsCategory) : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Budgeted</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalBudgeted.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Across all categories (excluding savings goal itself)</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Spent (Excl. Savings)</CardTitle>
          { isOverBudgetOverall ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverBudgetOverall && "text-destructive")}>
            ${(totalSpent - amountSaved).toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverBudgetOverall ? "text-destructive/80" : "text-muted-foreground")}>
            {totalRemainingOverall >= 0 ? `$${totalRemainingOverall.toFixed(2)} remaining (non-savings)` : `Overspent by $${Math.abs(totalRemainingOverall).toFixed(2)} (non-savings)`}
          </p>
        </CardContent>
      </Card>
      { (savingsGoal > 0 || amountSaved > 0) && ( // Show if there's a goal or if any amount is saved
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
                {`${((amountSaved / savingsGoal) * 100).toFixed(0)}% towards your goal`}
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
