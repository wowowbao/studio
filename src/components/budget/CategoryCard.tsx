
"use client";
import type { BudgetCategory, SubCategory } from "@/types/budget";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CornerDownRight } from "lucide-react";

interface CategoryCardProps {
  category: BudgetCategory;
}

export function CategoryCard({ category }: CategoryCardProps) {
  const mainCategorySpentAmount = category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const isSavingsCategory = category.name.toLowerCase() === 'savings';

  let mainCategoryProgress = 0;
  if (category.budgetedAmount > 0) {
    mainCategoryProgress = (mainCategorySpentAmount / category.budgetedAmount) * 100;
  } else if (isSavingsCategory && mainCategorySpentAmount > 0) {
    mainCategoryProgress = 100;
  }

  const mainCategoryRemaining = category.budgetedAmount - mainCategorySpentAmount;
  const mainCategoryIsOverBudget = !isSavingsCategory && mainCategoryRemaining < 0;

  const mainProgressIndicatorClassName = cn(
    (mainCategoryIsOverBudget && !isSavingsCategory) ? "bg-destructive" : "bg-primary"
  );
  const mainDescriptionClassName = cn(
    (mainCategoryIsOverBudget && !isSavingsCategory) ? "text-destructive font-semibold" : "text-muted-foreground"
  );

  const calculateSubCategoryInfo = (subCategory: SubCategory) => {
    const spent = subCategory.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    let progress = 0;
    if (subCategory.budgetedAmount > 0) {
      progress = (spent / subCategory.budgetedAmount) * 100;
    }
    const remaining = subCategory.budgetedAmount - spent;
    const isOverBudget = remaining < 0;
    return { spent, progress, remaining, isOverBudget };
  };

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
            {isSavingsCategory ? "Main Goal" : "Main Budgeted"}: <span className="font-semibold">${category.budgetedAmount.toFixed(2)}</span>
          </div>
          <div className="text-sm mb-2">
            {isSavingsCategory ? "Main Saved" : "Main Spent"}: <span className="font-semibold">${mainCategorySpentAmount.toFixed(2)}</span>
          </div>
          {(category.budgetedAmount > 0 || isSavingsCategory) && (
            <Progress
              value={Math.min(mainCategoryProgress, 100)}
              className={cn("h-3 mb-2", (mainCategoryIsOverBudget && !isSavingsCategory) ? "bg-destructive/30" : "")}
              indicatorClassName={mainProgressIndicatorClassName}
            />
          )}
          <CardDescription className={mainDescriptionClassName}>
            {isSavingsCategory ? (
              category.budgetedAmount > 0 ?
                (mainCategorySpentAmount >= category.budgetedAmount ? `Main Goal of $${category.budgetedAmount.toFixed(2)} met! Saved $${mainCategorySpentAmount.toFixed(2)}.` : `$${(category.budgetedAmount - mainCategorySpentAmount).toFixed(2)} to reach main goal`)
                : `Total Saved in Main: $${mainCategorySpentAmount.toFixed(2)}`
            ) : mainCategoryIsOverBudget ? (
              `Main Overspent by $${Math.abs(mainCategoryRemaining).toFixed(2)}`
            ) : (
              `Main Remaining: $${mainCategoryRemaining.toFixed(2)}`
            )}
          </CardDescription>

          {/* Subcategories Info */}
          {category.subcategories && category.subcategories.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Subcategories</h4>
              <ul className="space-y-3">
                {category.subcategories.map(sub => {
                  const { spent, progress, remaining, isOverBudget } = calculateSubCategoryInfo(sub);
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
