
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Coins, PiggyBank, Landmark, AlertTriangle } from "lucide-react";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget";
import { cn } from "@/lib/utils";

interface SummaryCardsProps {
  budgetMonth: BudgetMonth | undefined;
}

const getCategorySpentAmount = (category: BudgetCategory | SubCategory): number => {
  return (category.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
};

const getEffectiveCategoryBudget = (category: BudgetCategory): number => {
  if (!category.isSystemCategory && category.subcategories && category.subcategories.length > 0) {
    return category.subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
  }
  return category.budgetedAmount;
};


export function SummaryCards({ budgetMonth }: SummaryCardsProps) {
  if (!budgetMonth) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
        {[...Array(5)].map((_, i) => ( // Changed to 5 to match number of cards
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

  const savingsCategory = budgetMonth.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
  if (savingsCategory) {
    plannedSavings = getEffectiveCategoryBudget(savingsCategory);
  }

  const ccPaymentsCategory = budgetMonth.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
  if (ccPaymentsCategory) {
    plannedCCPayments = getEffectiveCategoryBudget(ccPaymentsCategory);
  }
  
  budgetMonth.categories.forEach(cat => {
    if (!cat.isSystemCategory) { 
      operationalCategoriesBudget += getEffectiveCategoryBudget(cat);
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalOperationalSpending += getCategorySpentAmount(sub);
        });
      } else { 
        totalOperationalSpending += getCategorySpentAmount(cat);
      }
    }
  });
  
  const fundsAvailableAfterCCPayments = totalIncomeReceived - plannedCCPayments;
  const totalPlannedOperationalAndSavings = operationalCategoriesBudget + plannedSavings;
  const allocationDifference = fundsAvailableAfterCCPayments - totalPlannedOperationalAndSavings;
  
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
          <p className="text-xs text-muted-foreground">Your planned contribution to savings.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Planned CC Payments</CardTitle>
          <Landmark className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${plannedCCPayments.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Your planned debt repayment.</p>
        </CardContent>
      </Card>

       <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Budget</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${operationalCategoriesBudget.toFixed(2)}</div>
           <p className={cn("text-xs", allocationDifference < 0 ? "text-destructive/90" : "text-muted-foreground")}>
            Funds available (after CC payments): ${fundsAvailableAfterCCPayments.toFixed(2)}.
            {allocationDifference < 0 
              ? <span className="font-medium"> Over-allocated by ${Math.abs(allocationDifference).toFixed(2)} (Savings + Ops Budget).</span>
              : <span className="font-medium"> ${allocationDifference.toFixed(2)} unallocated.</span>
            }
          </p>
        </CardContent>
      </Card>
      
      <Card className="md:col-span-2 lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Spent</CardTitle>
          { isOverSpentOverallOnOperational ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverSpentOverallOnOperational && "text-destructive")}>
            ${totalOperationalSpending.toFixed(2)} 
          </div>
          <p className={cn("text-xs", isOverSpentOverallOnOperational ? "text-destructive/90" : "text-muted-foreground")}>
            {isOverSpentOverallOnOperational ? 
              <span className="font-medium">Overspent by ${Math.abs(overallOperationalSpendingRemaining).toFixed(2)}</span> : 
              `$${overallOperationalSpendingRemaining.toFixed(2)} remaining in operational budget`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

    