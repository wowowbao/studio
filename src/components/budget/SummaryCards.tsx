
"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Coins, PiggyBank, Landmark, AlertTriangle, CreditCard, Banknote, Target } from "lucide-react";
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => ( 
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
  // const actualCCPayments = ccPaymentsCategory ? getCategorySpentAmount(ccPaymentsCategory) : 0; // Not used in main summary directly

  const startingCreditCardDebtForMonth = budgetMonth.startingCreditCardDebt || 0;

  let totalOperationalBudget = 0;
  let totalOperationalSpending = 0;

  budgetMonth.categories.forEach(cat => {
    if (!cat.isSystemCategory) { 
      totalOperationalBudget += getEffectiveCategoryBudget(cat);
      if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
          totalOperationalSpending += getCategorySpentAmount(sub);
        });
      } else { 
        totalOperationalSpending += getCategorySpentAmount(cat);
      }
    }
  });
  
  const overallOperationalSpendingRemaining = totalOperationalBudget - totalOperationalSpending;
  const isOverSpentOnOperational = overallOperationalSpendingRemaining < 0;
  
  let savingsStatusText = "No specific savings goal set this month.";
  let savingsStatusColor = "text-muted-foreground";
  if (plannedSavings > 0) {
    if (actualSavings >= plannedSavings) {
      savingsStatusText = "Goal Met!";
      savingsStatusColor = "text-green-600 dark:text-green-500 font-medium";
    } else if (actualSavings > 0) {
      savingsStatusText = `Saved $${actualSavings.toFixed(2)} of $${plannedSavings.toFixed(2)}. Keep going!`;
      savingsStatusColor = "text-amber-600 dark:text-amber-500";
    } else {
      savingsStatusText = `Planned $${plannedSavings.toFixed(2)}. Start saving!`;
      savingsStatusColor = "text-muted-foreground";
    }
  } else if (actualSavings > 0) {
      savingsStatusText = `Saved $${actualSavings.toFixed(2)} without a specific plan.`;
      savingsStatusColor = "text-green-600 dark:text-green-500";
  }

  let operationalSpendingStatusText = `$${overallOperationalSpendingRemaining.toFixed(2)} remaining`;
  let operationalSpendingStatusColor = "text-muted-foreground";
  if (totalOperationalBudget > 0 || totalOperationalSpending > 0) { // Only apply colors if there's activity or budget
    if (isOverSpentOnOperational) {
      operationalSpendingStatusText = `Overspent by $${Math.abs(overallOperationalSpendingRemaining).toFixed(2)}`;
      operationalSpendingStatusColor = "text-destructive font-medium";
    } else {
      const spentRatio = totalOperationalBudget > 0 ? totalOperationalSpending / totalOperationalBudget : 0;
      if (spentRatio < 0.8 && totalOperationalSpending > 0) { // Well under and some spending
        operationalSpendingStatusColor = "text-green-600 dark:text-green-500";
      } else if (spentRatio <= 1 && totalOperationalSpending > 0) { // Close to budget or on budget
        operationalSpendingStatusColor = "text-amber-600 dark:text-amber-500";
      } else if (totalOperationalSpending === 0 && totalOperationalBudget > 0){ // Budgeted but not spent
         operationalSpendingStatusColor = "text-green-600 dark:text-green-500";
      } else if (totalOperationalBudget === 0 && totalOperationalSpending === 0) {
         operationalSpendingStatusText = "No operational budget or spending.";
      }
    }
  } else {
     operationalSpendingStatusText = "No operational budget or spending.";
  }

  const monthlyBudgetBalance = totalIncomeReceived - plannedSavings - plannedCCPayments - totalOperationalBudget;
  let balanceStatusText = "";
  let balanceStatusColor = "text-muted-foreground";
  if (monthlyBudgetBalance > 0) {
    balanceStatusText = `Unallocated funds: $${monthlyBudgetBalance.toFixed(2)}`;
    balanceStatusColor = "text-green-600 dark:text-green-500 font-medium";
  } else if (monthlyBudgetBalance < 0) {
    balanceStatusText = `Budget shortfall: $${Math.abs(monthlyBudgetBalance).toFixed(2)}`;
    balanceStatusColor = "text-destructive font-medium";
  } else {
    balanceStatusText = "Budget is perfectly allocated!";
    balanceStatusColor = "text-green-600 dark:text-green-500 font-medium";
  }


  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Income Received</CardTitle>
          <Banknote className="h-4 w-4 text-muted-foreground" />
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
          <p className={cn("text-xs mt-1", savingsStatusColor)}>{savingsStatusText}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Starting CC Debt</CardTitle>
          <CreditCard className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${startingCreditCardDebtForMonth.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Debt at the start of the month.</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Planned CC Repayment</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${plannedCCPayments.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">Your planned debt repayment this month.</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Operational Budget & Spending</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-xl font-bold mb-1">Budgeted: ${totalOperationalBudget.toFixed(2)}</div>
          <div className={cn("text-xl font-bold", totalOperationalSpending > totalOperationalBudget && totalOperationalBudget > 0 ? "text-destructive" : "")}>
            Spent: ${totalOperationalSpending.toFixed(2)}
          </div>
          <p className={cn("text-xs mt-1", operationalSpendingStatusColor)}>
            {operationalSpendingStatusText}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Monthly Budget Balance</CardTitle>
          {monthlyBudgetBalance >= 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", balanceStatusColor.includes('green') ? 'text-green-600 dark:text-green-500' : balanceStatusColor.includes('destructive') ? 'text-destructive' : '')}>
            ${monthlyBudgetBalance.toFixed(2)}
            </div>
          <p className={cn("text-xs mt-1", balanceStatusColor)}>{balanceStatusText}</p>
        </CardContent>
      </Card>
    </div>
  );
}
    
