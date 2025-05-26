
"use client";
import type { BudgetMonth } from "@/types/budget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Landmark } from "lucide-react";
import { parseYearMonth } from "@/hooks/useBudgetCore"; // Helper to parse "YYYY-MM"

interface CreditCardDebtSummaryProps {
  budgetMonth: BudgetMonth | undefined;
}

export function CreditCardDebtSummary({ budgetMonth }: CreditCardDebtSummaryProps) {
  if (!budgetMonth) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Credit Card Debt</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading debt information...</p>
        </CardContent>
      </Card>
    );
  }

  const { startingCreditCardDebt = 0, categories, id: monthId } = budgetMonth;

  const creditCardPaymentsCategory = categories.find(
    cat => cat.name.toLowerCase() === "credit card payments"
  );

  const paymentsMadeThisMonth = creditCardPaymentsCategory
    ? creditCardPaymentsCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0)
    : 0;

  const estimatedDebtAtEndOfMonth = startingCreditCardDebt - paymentsMadeThisMonth;

  const displayDate = parseYearMonth(monthId);
  const formattedMonthYear = displayDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <Card className="mt-6 shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center">
          <Landmark className="mr-2 h-5 w-5 text-primary" />
          Credit Card Debt
        </CardTitle>
        <CardDescription>Status for {formattedMonthYear}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-muted-foreground">Debt at Start of Month:</span>
          <span className="font-semibold text-base">${startingCreditCardDebt.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center py-2 border-t">
          <span className="text-sm text-muted-foreground">Payments Made This Month:</span>
          <span className="font-semibold text-base text-green-600 dark:text-green-500">
            -${paymentsMadeThisMonth.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between items-center pt-2 pb-1 border-t bg-muted/30 -mx-6 px-6 rounded-b-lg">
          <span className="text-sm font-medium">Estimated Debt at End of Month:</span>
          <span className="font-bold text-lg text-destructive">
            ${Math.max(0, estimatedDebtAtEndOfMonth).toFixed(2)}
          </span>
        </div>
        {(!creditCardPaymentsCategory && startingCreditCardDebt > 0) && (
          <p className="text-xs text-amber-600 dark:text-amber-500 pt-2">
            Tip: Create a "Credit Card Payments" category and log payments there for accurate tracking.
          </p>
        )}
         {(creditCardPaymentsCategory && paymentsMadeThisMonth === 0 && startingCreditCardDebt > 0) && (
          <p className="text-xs text-muted-foreground pt-2">
            Log expenses under "Credit Card Payments" category to see payments reflected here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
