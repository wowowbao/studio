
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
        {[...Array(5)].map((_, i) => ( 
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
  
  const savingsCategory = budgetMonth.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
  const plannedSavings = savingsCategory ? getEffectiveCategoryBudget(savingsCategory) : 0;
  const actualSavings = savingsCategory ? getCategorySpentAmount(savingsCategory) : 0;

  const ccPaymentsCategory = budgetMonth.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
  const plannedCCPayments = ccPaymentsCategory ? getEffectiveCategoryBudget(ccPaymentsCategory) : 0;
  // const actualCCPayments = ccPaymentsCategory ? getCategorySpentAmount(ccPaymentsCategory) : 0; // Not directly used in these cards, but in CC Debt Summary

  let operationalCategoriesBudget = 0;
  let totalOperationalSpending = 0;

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
  
  const fundsAfterPrimaryAllocations = totalIncomeReceived - plannedSavings - plannedCCPayments;
  const operationalAllocationDifference = fundsAfterPrimaryAllocations - operationalCategoriesBudget;
  
  const overallOperationalSpendingRemaining = operationalCategoriesBudget - totalOperationalSpending;
  const isOverSpentOnOperational = overallOperationalSpendingRemaining < 0;
  
  let savingsStatusText = "No specific savings goal set this month.";
  let savingsStatusColor = "text-muted-foreground";
  if (plannedSavings > 0) {
    if (actualSavings >= plannedSavings) {
      savingsStatusText = "Goal Met!";
      savingsStatusColor = "text-green-600 dark:text-green-500 font-medium";
    } else if (actualSavings > 0) {
      savingsStatusText = "Progress made. Keep going!";
      savingsStatusColor = "text-amber-600 dark:text-amber-500";
    } else {
      savingsStatusText = "Goal set, start saving!";
      savingsStatusColor = "text-muted-foreground";
    }
  } else if (actualSavings > 0) {
      savingsStatusText = `Saved $${actualSavings.toFixed(2)} without a specific goal.`;
      savingsStatusColor = "text-green-600 dark:text-green-500";
  }


  let operationalSpendingStatusColor = "text-muted-foreground";
  if (operationalCategoriesBudget > 0) {
    const spentRatio = totalOperationalSpending / operationalCategoriesBudget;
    if (isOverSpentOnOperational) {
      operationalSpendingStatusColor = "text-destructive font-medium";
    } else if (spentRatio < 0.8) {
      operationalSpendingStatusColor = "text-green-600 dark:text-green-500";
    } else {
      operationalSpendingStatusColor = "text-amber-600 dark:text-amber-500";
    }
  } else if (totalOperationalSpending > 0) {
     operationalSpendingStatusColor = "text-destructive font-medium"; // Spending with no budget
  }


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
          <CardTitle className="text-sm font-medium">Savings Performance</CardTitle>
          <PiggyBank className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${actualSavings.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Planned: ${plannedSavings.toFixed(2)}</p>
          <p className={cn("text-xs mt-1", savingsStatusColor)}>{savingsStatusText}</p>
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
           <p className="text-xs text-muted-foreground">
            Available for ops (after savings & CC pay): ${fundsAfterPrimaryAllocations.toFixed(2)}.
          </p>
          {operationalAllocationDifference >= 0 ? (
            <p className="text-xs text-green-600 dark:text-green-500 mt-1">
              Unbudgeted for operations: ${operationalAllocationDifference.toFixed(2)}.
            </p>
          ) : (
            <p className="text-xs text-destructive mt-1 font-medium">
              Operational budget shortfall: ${Math.abs(operationalAllocationDifference).toFixed(2)}.
            </p>
          )}
        </CardContent>
      </Card>
      
      <Card className="md:col-span-2 lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Spent</CardTitle>
          { isOverSpentOnOperational ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-muted-foreground" /> }
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isOverSpentOnOperational && "text-destructive")}>
            ${totalOperationalSpending.toFixed(2)} 
          </div>
          <p className={cn("text-xs", operationalSpendingStatusColor)}>
            {isOverSpentOnOperational ? 
              `Overspent by $${Math.abs(overallOperationalSpendingRemaining).toFixed(2)}` : 
              (operationalCategoriesBudget > 0 || totalOperationalSpending > 0 ? `$${overallOperationalSpendingRemaining.toFixed(2)} remaining` : "No operational spending or budget.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
    
