
"use client";
import type { BudgetCategory, SubCategory, Expense } from "@/types/budget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBudget } from "@/hooks/useBudget";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CornerDownRight, Trash2, ChevronDown, ChevronUp } from "lucide-react"; // Added ChevronDown, ChevronUp
import { format } from "date-fns";
import { useState } from "react"; // Added useState

interface CategoryCardProps {
  category: BudgetCategory;
}

const MAX_TRANSACTIONS_VISIBLE_DEFAULT = 5;

export function CategoryCard({ category }: CategoryCardProps) {
  const { deleteExpense, currentDisplayMonthId } = useBudget();
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleExpand = (sectionId: string) => {
    setExpandedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const mainCategorySpentAmount = category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const isSavingsCategory = category.isSystemCategory && category.name.toLowerCase() === 'savings';
  const isCCPaymentsCategory = category.isSystemCategory && category.name.toLowerCase() === 'credit card payments';

  let mainCategoryProgress = 0;
  if (category.budgetedAmount > 0) {
    mainCategoryProgress = (mainCategorySpentAmount / category.budgetedAmount) * 100;
  } else if ((isSavingsCategory || isCCPaymentsCategory) && mainCategorySpentAmount > 0) {
    mainCategoryProgress = 100; 
  }

  const mainCategoryRemaining = category.budgetedAmount - mainCategorySpentAmount;
  const mainCategoryIsOverBudget = !isSavingsCategory && !isCCPaymentsCategory && mainCategoryRemaining < 0;
  const mainGoalMet = (isSavingsCategory || isCCPaymentsCategory) && category.budgetedAmount > 0 && mainCategorySpentAmount >= category.budgetedAmount;

  const spentAmountSpanClassName = cn(
    "font-semibold",
    {
      "text-green-600 dark:text-green-500": 
        (isCCPaymentsCategory && mainCategorySpentAmount > 0) ||
        (isSavingsCategory && mainCategorySpentAmount > 0)
    }
  );

  let mainProgressIndicatorClassName = "bg-primary"; 
  if (isCCPaymentsCategory && mainCategorySpentAmount > 0) {
    mainProgressIndicatorClassName = "bg-green-500";
  } else if (isSavingsCategory && mainCategorySpentAmount > 0) {
    mainProgressIndicatorClassName = "bg-green-500";
  } else if (mainCategoryIsOverBudget) {
    mainProgressIndicatorClassName = "bg-destructive";
  }
  
  if (mainGoalMet) {
    mainProgressIndicatorClassName = "bg-green-500";
  }

  let mainRemainingTextClass = "text-muted-foreground";
  let mainRemainingIsBold = false;

  if (isSavingsCategory || isCCPaymentsCategory) {
    if (mainGoalMet) {
        mainRemainingTextClass = "text-green-600 dark:text-green-500";
        mainRemainingIsBold = true;
    }
  } else if (mainCategoryIsOverBudget) {
    mainRemainingTextClass = "text-destructive";
    mainRemainingIsBold = true;
  } else { 
    if (category.budgetedAmount > 0) {
        const spentRatio = mainCategorySpentAmount / category.budgetedAmount;
        if (spentRatio < 0.8) { 
            mainRemainingTextClass = "text-green-600 dark:text-green-500";
        } else if (spentRatio <= 1) { 
            mainRemainingTextClass = "text-amber-600 dark:text-amber-500";
        }
    }
  }


  const handleDeleteExpense = (expenseId: string, targetId: string, isSub: boolean, expenseDescription: string) => {
    deleteExpense(currentDisplayMonthId, targetId, expenseId, isSub);
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
    const sortedExpenses = [...subCategory.expenses].sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
    return { spent, progress, remaining, isOverBudget, expenses: sortedExpenses, subCategory };
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

  const sortedMainCategoryExpenses = [...category.expenses].sort((a,b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
  const isMainSectionExpanded = expandedSections[category.id] || false;
  const mainCategoryExpensesToDisplay = isMainSectionExpanded ? sortedMainCategoryExpenses : sortedMainCategoryExpenses.slice(0, MAX_TRANSACTIONS_VISIBLE_DEFAULT);


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
            {isSavingsCategory ? "Main Saved" : isCCPaymentsCategory ? "Paid This Month" : "Main Spent"}: <span className={spentAmountSpanClassName}>${mainCategorySpentAmount.toFixed(2)}</span>
          </div>
          {(category.budgetedAmount > 0 || ((isSavingsCategory || isCCPaymentsCategory) && mainCategorySpentAmount > 0)) && (
            <Progress
              value={Math.min(mainCategoryProgress, 100)}
              className={cn("h-3 mb-2", (mainCategoryIsOverBudget && !(isSavingsCategory || isCCPaymentsCategory)) ? "bg-destructive/30" : "")}
              indicatorClassName={mainProgressIndicatorClassName}
            />
          )}
          <CardDescription className={cn(mainRemainingTextClass, { "font-semibold": mainRemainingIsBold })}>
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
              <div className="flex justify-between items-center mb-1">
                <h5 className="text-xs font-semibold uppercase text-muted-foreground">Transactions</h5>
                {sortedMainCategoryExpenses.length > MAX_TRANSACTIONS_VISIBLE_DEFAULT && (
                  <Button variant="link" size="xs" onClick={() => toggleExpand(category.id)} className="text-xs p-0 h-auto">
                    {isMainSectionExpanded ? "Show Less" : `View All (${sortedMainCategoryExpenses.length})`}
                    {isMainSectionExpanded ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
                  </Button>
                )}
              </div>
              <ul className="space-y-0.5 max-h-60 overflow-y-auto pr-1"> {/* Increased max-h for when expanded */}
                {mainCategoryExpensesToDisplay.map(exp => renderExpenseItem(exp, category.id, false))}
              </ul>
            </div>
          )}


          {/* Subcategories Info */}
          {category.subcategories && category.subcategories.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Subcategories</h4>
              <ul className="space-y-3">
                {category.subcategories.map(sub => {
                  const subInfo = calculateSubCategoryInfo(sub); // subInfo.expenses is already sorted
                  const isSubSectionExpanded = expandedSections[sub.id] || false;
                  const subCategoryExpensesToDisplay = isSubSectionExpanded ? subInfo.expenses : subInfo.expenses.slice(0, MAX_TRANSACTIONS_VISIBLE_DEFAULT);

                  const subProgressIndicatorClassName = cn(subInfo.isOverBudget ? "bg-destructive" : "bg-primary/80");
                  
                  let subRemainingTextClass = "text-muted-foreground/90";
                  let subRemainingIsBold = false;

                  if (subInfo.isOverBudget) {
                      subRemainingTextClass = "text-destructive";
                      subRemainingIsBold = true;
                  } else { 
                      if (subInfo.subCategory.budgetedAmount > 0) {
                          const subSpentRatio = subInfo.spent / subInfo.subCategory.budgetedAmount;
                          if (subSpentRatio < 0.8) { 
                              subRemainingTextClass = "text-green-600 dark:text-green-500";
                          } else if (subSpentRatio <= 1) { 
                              subRemainingTextClass = "text-amber-600 dark:text-amber-500";
                          }
                      }
                  }

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
                        Spent: <span className="font-medium">${subInfo.spent.toFixed(2)}</span>
                      </div>
                      {sub.budgetedAmount > 0 && (
                         <Progress
                            value={Math.min(subInfo.progress, 100)}
                            className={cn("h-2 my-1", subInfo.isOverBudget ? "bg-destructive/30" : "bg-secondary")}
                            indicatorClassName={subProgressIndicatorClassName}
                          />
                      )}
                      <p className={cn("text-xs", subRemainingTextClass, { "font-semibold": subRemainingIsBold })}>
                        {subInfo.isOverBudget ? `Overspent by $${Math.abs(subInfo.remaining).toFixed(2)}` : `Remaining: $${subInfo.remaining.toFixed(2)}`}
                      </p>
                      
                      {/* Subcategory Expenses List */}
                      {subInfo.expenses && subInfo.expenses.length > 0 && (
                        <div className="mt-2 pt-1 border-t border-border/30">
                           <div className="flex justify-between items-center mb-0.5">
                            <h6 className="text-2xs font-semibold uppercase text-muted-foreground/70">Transactions</h6>
                            {subInfo.expenses.length > MAX_TRANSACTIONS_VISIBLE_DEFAULT && (
                              <Button variant="link" size="xs" onClick={() => toggleExpand(sub.id)} className="text-2xs p-0 h-auto">
                                {isSubSectionExpanded ? "Show Less" : `View All (${subInfo.expenses.length})`}
                                {isSubSectionExpanded ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
                              </Button>
                            )}
                          </div>
                          <ul className="space-y-0.5 max-h-48 overflow-y-auto pr-1"> {/* Increased max-h */}
                            {subCategoryExpensesToDisplay.map(exp => renderExpenseItem(exp, sub.id, true))}
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


    