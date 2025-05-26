
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, PiggyBank, Target } from "lucide-react";
import type { BudgetMonth } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

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
  const totalSpent = budgetMonth.categories.reduce((sum, cat) => sum + cat.spentAmount, 0);
  const totalRemaining = totalBudgeted - totalSpent;
  const savingsGoal = budgetMonth.savingsGoal;
  const savingsCategory = budgetMonth.categories.find(cat => cat.name.toLowerCase() === 'savings');
  const amountSaved = savingsCategory ? savingsCategory.spentAmount : 0; // 'Spent' in savings category is 'saved'

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Budgeted</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalBudgeted.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Across all categories</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
          {totalSpent <= totalBudgeted ? <TrendingUp className="h-4 w-4 text-muted-foreground" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", totalSpent > totalBudgeted && "text-destructive")}>
            ${totalSpent.toFixed(2)}
          </div>
          <p className={cn("text-xs", totalSpent > totalBudgeted ? "text-destructive/80" : "text-muted-foreground")}>
            {totalRemaining >= 0 ? `$${totalRemaining.toFixed(2)} remaining` : `Overspent by $${Math.abs(totalRemaining).toFixed(2)}`}
          </p>
        </CardContent>
      </Card>
      {savingsGoal > 0 && (
         <Card className="md:col-span-2 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Savings Goal Progress</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${amountSaved.toFixed(2)} / <span className="text-lg">${savingsGoal.toFixed(2)}</span></div>
            <p className="text-xs text-muted-foreground">
              {savingsGoal > 0 ? `${((amountSaved / savingsGoal) * 100).toFixed(0)}% towards your goal` : "No savings goal set."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
