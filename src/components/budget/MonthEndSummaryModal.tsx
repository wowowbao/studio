
"use client";
import type { BudgetMonth, BudgetCategory } from "@/types/budget";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrendingUp, TrendingDown, CheckCircle, AlertCircle, DollarSign, PiggyBank, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

interface MonthEndSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgetMonth: BudgetMonth | undefined;
}

export function MonthEndSummaryModal({ isOpen, onClose, budgetMonth }: MonthEndSummaryModalProps) {
  if (!isOpen || !budgetMonth) {
    return null;
  }

  const totalIncome = budgetMonth.incomes.reduce((sum, income) => sum + income.amount, 0);

  const savingsCategory = budgetMonth.categories.find(cat => cat.isSystemCategory && cat.name.toLowerCase() === 'savings');
  const plannedSavings = savingsCategory?.budgetedAmount || 0;
  const actualSavings = savingsCategory?.expenses.reduce((sum, exp) => sum + exp.amount, 0) || 0;

  const ccPaymentsCategory = budgetMonth.categories.find(cat => cat.isSystemCategory && cat.name.toLowerCase() === 'credit card payments');
  const plannedCCPayments = ccPaymentsCategory?.budgetedAmount || 0;
  const actualCCPayments = ccPaymentsCategory?.expenses.reduce((sum, exp) => sum + exp.amount, 0) || 0;

  let totalOperationalBudget = 0;
  let totalOperationalSpending = 0;

  budgetMonth.categories.forEach(cat => {
    if (!cat.isSystemCategory) {
      if (cat.subcategories && cat.subcategories.length > 0) {
        totalOperationalBudget += cat.subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
        totalOperationalSpending += cat.subcategories.reduce((sum, sub) => sum + sub.expenses.reduce((expSum, exp) => expSum + exp.amount, 0), 0);
      } else {
        totalOperationalBudget += cat.budgetedAmount;
        totalOperationalSpending += cat.expenses.reduce((sum, exp) => sum + exp.amount, 0);
      }
    }
  });

  const netCashFlow = totalIncome - actualSavings - actualCCPayments - totalOperationalSpending;
  const netCashFlowIsPositive = netCashFlow >= 0;

  const SummaryItem = ({ label, value, planned, icon: Icon, highlight }: { label: string; value: number; planned?: number; icon?: React.ElementType; highlight?: 'positive' | 'negative' | 'neutral' }) => (
    <div className="py-2 px-3 mb-2 border-b last:border-b-0 last:mb-0">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          {Icon && <Icon className={cn("mr-2 h-4 w-4", highlight === 'positive' ? 'text-green-500' : highlight === 'negative' ? 'text-destructive' : 'text-muted-foreground')} />}
          <span className="text-sm text-muted-foreground">{label}:</span>
        </div>
        <span className={cn("font-semibold text-sm", highlight === 'positive' ? 'text-green-600 dark:text-green-400' : highlight === 'negative' ? 'text-destructive' : 'text-foreground')}>
          ${value.toFixed(2)}
        </span>
      </div>
      {planned !== undefined && (
        <p className="text-xs text-right text-muted-foreground/80 italic">(Planned: ${planned.toFixed(2)})</p>
      )}
    </div>
  );


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-center">
            Month-End Summary: {budgetMonth.id}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] p-1 pr-3">
          <div className="space-y-3 mt-4 text-sm">
            
            <div className="p-3 rounded-lg bg-muted/30">
                <h3 className="font-medium text-base mb-2 flex items-center"><Coins className="mr-2 h-5 w-5 text-primary"/>Income</h3>
                <SummaryItem label="Total Received" value={totalIncome} icon={DollarSign} highlight="positive" />
            </div>
            
            <div className="p-3 rounded-lg bg-muted/30">
                <h3 className="font-medium text-base mb-2 flex items-center"><PiggyBank className="mr-2 h-5 w-5 text-green-600"/>Savings</h3>
                <SummaryItem label="Actual Saved" value={actualSavings} planned={plannedSavings} icon={TrendingUp} highlight={actualSavings >= plannedSavings && plannedSavings > 0 ? "positive" : "neutral"} />
            </div>

            <div className="p-3 rounded-lg bg-muted/30">
                <h3 className="font-medium text-base mb-2 flex items-center"><Landmark className="mr-2 h-5 w-5 text-amber-600"/>Credit Card Payments</h3>
                <SummaryItem label="Actual Payments Made" value={actualCCPayments} planned={plannedCCPayments} icon={TrendingUp} highlight={actualCCPayments >= plannedCCPayments && plannedCCPayments > 0 ? "positive" : "neutral"} />
            </div>
            
            <div className="p-3 rounded-lg bg-muted/30">
                <h3 className="font-medium text-base mb-2 flex items-center"><DollarSign className="mr-2 h-5 w-5 text-blue-600"/>Operational Spending</h3>
                <SummaryItem 
                    label="Actual Spending" 
                    value={totalOperationalSpending} 
                    planned={totalOperationalBudget} 
                    icon={totalOperationalSpending <= totalOperationalBudget ? TrendingUp : TrendingDown}
                    highlight={totalOperationalSpending > totalOperationalBudget ? "negative" : (totalOperationalSpending > 0 ? "neutral" : "neutral")}
                />
            </div>

            <div className={cn("p-4 rounded-lg text-center mt-4 border", netCashFlowIsPositive ? "bg-green-50 dark:bg-green-900/30 border-green-500/50" : "bg-red-50 dark:bg-red-900/30 border-red-500/50")}>
              <h3 className="text-base font-semibold mb-1">
                Net Monthly Cash Flow
              </h3>
              <p className={cn("text-2xl font-bold mb-1", netCashFlowIsPositive ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                ${netCashFlow.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">
                {netCashFlowIsPositive ? 
                  "Great job! You ended the month with a surplus." :
                  "You ended the month with a deficit. Review your spending and budget for next month."
                }
              </p>
            </div>
            
            <p className="text-xs text-muted-foreground text-center mt-4 pt-2 border-t">
              This month is now closed. Further edits to budget, income, or expenses are disabled.
            </p>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-6">
          <DialogClose asChild>
            <Button variant="default" onClick={onClose}>
              <CheckCircle className="mr-2 h-4 w-4" /> Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
