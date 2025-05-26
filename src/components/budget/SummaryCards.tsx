
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Coins, PiggyBank, Landmark } from "lucide-react";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

const getCategorySpentAmount = (category: BudgetCategory | SubCategory): number => {
  return (category.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
};

const getEffectiveCategoryBudget = (category: BudgetCategory): number => {
  if (category.subcategories && category.subcategories.length > 0 && !category.isSystemCategory) {
    return category.subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
  }
  return category.budgetedAmount;
};


export function SummaryCards({ budgetMonth }: SummaryCardsProps) {
  if (!budgetMonth) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-3"> {/* Adjusted for potential new card */}
        {[...Array(3)].map((_, i) => ( // Render 3 skeletons for now
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
  
  let plannedSavings = 0;
  let plannedCCPayments = 0;
  let operationalCategoriesBudget = 0;
  let totalOperationalSpending = 0;

  budgetMonth.categories.forEach(cat => {
    const catNameLower = cat.name.toLowerCase();
    const effectiveBudget = getEffectiveCategoryBudget(cat);

    if (cat.isSystemCategory && catNameLower === 'savings') {
      plannedSavings += effectiveBudget;
      // Actual saved amount for "Savings" category is tracked by its expenses
    } else if (cat.isSystemCategory && catNameLower === 'credit card payments') {
      plannedCCPayments += effectiveBudget;
      // Actual CC payments are tracked by its expenses, not part of operational spending
    } else { // Operational categories
      operationalCategoriesBudget += effectiveBudget;
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalOperationalSpending += getCategorySpentAmount(sub);
        });
      } else { 
        totalOperationalSpending += getCategorySpentAmount(cat);
      }
    }
  });
  
  const fundsRemainingForSpending = totalIncomeReceived - plannedSavings - plannedCCPayments;
  const operationalBudgetDifference = fundsRemainingForSpending - operationalCategoriesBudget;
  
  const overallOperationalSpendingRemaining = operationalCategoriesBudget - totalOperationalSpending;
  const isOverSpentOverallOnOperational = overallOperationalSpendingRemaining < 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
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
          <CardTitle className="text-sm font-medium">Planned Savings</CardTitle>
          <PiggyBank className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${plannedSavings.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Amount allocated to "Savings" category.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Planned CC Payments</CardTitle>
          <Landmark className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${plannedCCPayments.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Allocated to "Credit Card Payments".</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Funds for Spending</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${fundsRemainingForSpending.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Income after planned savings & CC payments.</p>
        </CardContent>
      </Card>

       <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Budget</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${operationalCategoriesBudget.toFixed(2)}</div>
           <p className={cn("text-xs", operationalBudgetDifference < 0 ? "text-destructive/80" : "text-muted-foreground")}>
            {operationalBudgetDifference < 0 
              ? `Budgeted $${Math.abs(operationalBudgetDifference).toFixed(2)} over available funds` 
              : `$${operationalBudgetDifference.toFixed(2)} of available funds not budgeted`}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Spent</CardTitle>
          { isOverSpentOverallOnOperational ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverSpentOverallOnOperational && "text-destructive")}>
            ${totalOperationalSpending.toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverSpentOverallOnOperational ? "text-destructive/80" : "text-muted-foreground")}>
            {isOverSpentOverallOnOperational ? 
              `Overspent by $${Math.abs(overallOperationalSpendingRemaining).toFixed(2)}` : 
              `$${overallOperationalSpendingRemaining.toFixed(2)} remaining in operational budget`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
