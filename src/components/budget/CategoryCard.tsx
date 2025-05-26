
"use client";
import type { BudgetCategory, SubCategory, Expense } from "@/types/budget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBudget } from "@/hooks/useBudget";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CornerDownRight, Trash2, CheckCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface CategoryCardProps {
  category: BudgetCategory;
}

export function CategoryCard({ category }: CategoryCardProps) {
  const { deleteExpense } = useBudget();
  const { toast } = useToast();

  const mainCategorySpentAmount = category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const isSavingsCategory = category.name.toLowerCase() === 'savings' && category.isSystemCategory;
  const isCCPaymentsCategory = category.name.toLowerCase() === 'credit card payments' && category.isSystemCategory;

  let mainCategoryProgress = 0;
  if (category.budgetedAmount > 0) {
    mainCategoryProgress = (mainCategorySpentAmount / category.budgetedAmount) * 100;
  } else if ((isSavingsCategory || isCCPaymentsCategory) && mainCategorySpentAmount > 0) {
    // If it's a savings/CC goal and something is saved/paid, show 100% if no budget (goal) is set.
    // Or, if goal is 0 and saved > 0, it means goal achieved.
    mainCategoryProgress = 100;
  }

  const mainCategoryRemaining = category.budgetedAmount - mainCategorySpentAmount;
  const mainCategoryIsOverBudget = !isSavingsCategory && !isCCPaymentsCategory && mainCategoryRemaining < 0;

  const mainProgressIndicatorClassName = cn(
    (mainCategoryIsOverBudget) ? "bg-destructive" : "bg-primary"
  );
  const mainDescriptionClassName = cn(
    (mainCategoryIsOverBudget) ? "text-destructive font-semibold" : "text-muted-foreground"
  );

  const handleDeleteExpense = (expenseId: string, targetId: string, isSub: boolean, expenseDescription: string) => {
    const currentMonthId = category.id.substring(0, category.id.lastIndexOf('-') > 0 ? category.id.lastIndexOf('-') : category.id.length);
     // This is a bit of a hack to get monthId, assuming category.id is not the monthId
     // A better way would be to pass monthId down to CategoryCard or have it available in category object
     // For now, let's try to infer it or assume useBudget's currentDisplayMonthId is the context
     const monthIdFromHook = useBudget().currentDisplayMonthId;


    deleteExpense(monthIdFromHook, targetId, expenseId, isSub);
    toast({
      title: "Expense Deleted",
      description: `Expense "${expenseDescription}" has been removed.`,
      action: <Trash2 className="text-destructive" />,
    });
  };

  const calculateSubCategoryInfo = (subCategory: SubCategory) => {
    const spent = subCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    let progress = 0;
    if (subCategory.budgetedAmount > 0) {
      progress = (spent / subCategory.budgetedAmount) * 100;
    }
    const remaining = subCategory.budgetedAmount - spent;
    const isOverBudget = remaining < 0;
    return { spent, progress, remaining, isOverBudget, expenses: subCategory.expenses };
  };

  const renderExpenseItem = (expense: Expense, targetId: string, isSub: boolean) => (
    <li key={expense.id} className="flex justify-between items-center text-xs py-1 border-b border-dashed border-border last:border-b-0">
      <div className="flex-grow">
        <span className="font-medium">{expense.description}</span>: ${expense.amount.toFixed(2)}
        <span className="text-muted-foreground/80 ml-2">({format(new Date(expense.dateAdded), "MMM d")})</span>
      </div>
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-6 w-6 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
        onClick={() => handleDeleteExpense(expense.id, targetId, isSub, expense.description)}
        aria-label="Delete expense"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </li>
  );

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center space-x-2">
          <CardTitle className="text-base font-medium">{category.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-between">
        <div>
          {/* Main Category Info */}
          <div className="text-sm mb-1">
            {isSavingsCategory ? "Main Goal" : isCCPaymentsCategory ? "Payment Goal" : "Main Budgeted"}: <span className="font-semibold">${category.budgetedAmount.toFixed(2)}</span>
          </div>
          <div className="text-sm mb-2">
            {isSavingsCategory ? "Main Saved" : isCCPaymentsCategory ? "Paid This Month" : "Main Spent"}: <span className="font-semibold">${mainCategorySpentAmount.toFixed(2)}</span>
          </div>
          {(category.budgetedAmount > 0 || isSavingsCategory || isCCPaymentsCategory) && (
            <Progress
              value={Math.min(mainCategoryProgress, 100)}
              className={cn("h-3 mb-2", (mainCategoryIsOverBudget) ? "bg-destructive/30" : "")}
              indicatorClassName={mainProgressIndicatorClassName}
            />
          )}
          <CardDescription className={mainDescriptionClassName}>
            {isSavingsCategory ? (
              category.budgetedAmount > 0 ?
                (mainCategorySpentAmount >= category.budgetedAmount ? `Main Goal of $${category.budgetedAmount.toFixed(2)} met! Saved $${mainCategorySpentAmount.toFixed(2)}.` : `$${(category.budgetedAmount - mainCategorySpentAmount).toFixed(2)} to reach main goal`)
                : `Total Saved in Main: $${mainCategorySpentAmount.toFixed(2)}`
            ) : isCCPaymentsCategory ? (
                 category.budgetedAmount > 0 ?
                (mainCategorySpentAmount >= category.budgetedAmount ? `Payment Goal of $${category.budgetedAmount.toFixed(2)} met! Paid $${mainCategorySpentAmount.toFixed(2)}.` : `$${(category.budgetedAmount - mainCategorySpentAmount).toFixed(2)} remaining for payment goal.`)
                : `Total Paid This Month: $${mainCategorySpentAmount.toFixed(2)}`
            ) : mainCategoryIsOverBudget ? (
              `Main Overspent by $${Math.abs(mainCategoryRemaining).toFixed(2)}`
            ) : (
              `Main Remaining: $${mainCategoryRemaining.toFixed(2)}`
            )}
          </CardDescription>

          {/* Main Category Expenses List */}
          {(!category.subcategories || category.subcategories.length === 0) && category.expenses && category.expenses.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border/50">
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Transactions</h5>
              <ul className="space-y-0.5 max-h-24 overflow-y-auto pr-1">
                {category.expenses.map(exp => renderExpenseItem(exp, category.id, false))}
              </ul>
            </div>
          )}


          {/* Subcategories Info */}
          {category.subcategories && category.subcategories.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Subcategories</h4>
              <ul className="space-y-3">
                {category.subcategories.map(sub => {
                  const { spent, progress, remaining, isOverBudget, expenses: subExpenses } = calculateSubCategoryInfo(sub);
                  const subProgressIndicatorClassName = cn(isOverBudget ? "bg-destructive" : "bg-primary/80");
                  const subDescriptionClassName = cn(isOverBudget ? "text-destructive" : "text-muted-foreground/90", "text-xs");
                  return (
                    <li key={sub.id} className="pl-2 border-l-2 border-border">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center">
                           <CornerDownRight className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                           {sub.name}
                        </span>
                        <span className="font-semibold">${sub.budgetedAmount.toFixed(2)}</span>
                      </div>
                      <div className="text-xs">
                        Spent: <span className="font-medium">${spent.toFixed(2)}</span>
                      </div>
                      {sub.budgetedAmount > 0 && (
                         <Progress
                            value={Math.min(progress, 100)}
                            className={cn("h-2 my-1", isOverBudget ? "bg-destructive/30" : "bg-secondary")}
                            indicatorClassName={subProgressIndicatorClassName}
                          />
                      )}
                      <p className={subDescriptionClassName}>
                        {isOverBudget ? `Overspent by $${Math.abs(remaining).toFixed(2)}` : `Remaining: $${remaining.toFixed(2)}`}
                      </p>
                      {/* Subcategory Expenses List */}
                      {subExpenses && subExpenses.length > 0 && (
                        <div className="mt-2 pt-1 border-t border-border/30">
                          <h6 className="text-2xs font-semibold uppercase text-muted-foreground/70 mb-0.5">Transactions</h6>
                          <ul className="space-y-0.5 max-h-20 overflow-y-auto pr-1">
                            {subExpenses.map(exp => renderExpenseItem(exp, sub.id, true))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
