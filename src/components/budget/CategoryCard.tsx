
"use client";
import type { BudgetCategory } from "@/types/budget";
// import * as LucideIcons from "lucide-react"; // No longer needed for category icon
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react"; // Default/fallback if needed, or remove if not

interface CategoryCardProps {
  category: BudgetCategory;
  onEdit?: (category: BudgetCategory) => void; // Optional: for editing category details
}

export function CategoryCard({ category }: CategoryCardProps) {
  // const IconComponent = (LucideIcons as any)[category.icon] || LucideIcons.HelpCircle; // Icon removed

  const spentAmount = category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const isSavingsCategory = category.name.toLowerCase() === 'savings';

  let progress = 0;
  if (category.budgetedAmount > 0) {
    progress = (spentAmount / category.budgetedAmount) * 100;
  } else if (isSavingsCategory && spentAmount > 0) {
    // If savings category has no budget but has savings, show 100% (or some other visual indication)
    progress = 100;
  }

  const remaining = category.budgetedAmount - spentAmount;
  const isOverBudget = !isSavingsCategory && remaining < 0;

  const progressIndicatorClassName = cn(
    (isOverBudget && !isSavingsCategory) ? "bg-destructive" : "bg-primary"
  );
   const descriptionClassName = cn(
    (isOverBudget && !isSavingsCategory) ? "text-destructive font-semibold" : "text-muted-foreground"
  );


  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200 flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center space-x-2">
          {/* <IconComponent className="h-5 w-5 text-muted-foreground" /> // Icon removed */}
          <CardTitle className="text-base font-medium">{category.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-between">
        <div>
          <div className="text-sm mb-1">
            {isSavingsCategory ? "Goal" : "Budgeted"}: <span className="font-semibold">${category.budgetedAmount.toFixed(2)}</span>
          </div>
          <div className="text-sm mb-2">
            {isSavingsCategory ? "Saved" : "Spent"}: <span className="font-semibold">${spentAmount.toFixed(2)}</span>
          </div>
          {(category.budgetedAmount > 0 || isSavingsCategory) && (
            <Progress
              value={Math.min(progress, 100)}
              className={cn("h-3 mb-2", (isOverBudget && !isSavingsCategory) ? "bg-destructive/30" : "")}
              indicatorClassName={progressIndicatorClassName}
            />
          )}
          <CardDescription className={descriptionClassName}>
            {isSavingsCategory ? (
              category.budgetedAmount > 0 ?
                (spentAmount >= category.budgetedAmount ? `Goal of $${category.budgetedAmount.toFixed(2)} met! Saved $${spentAmount.toFixed(2)}.` : `$${(category.budgetedAmount - spentAmount).toFixed(2)} to reach goal`)
                : `Total Saved: $${spentAmount.toFixed(2)}`
            ) : isOverBudget ? (
              `Overspent by $${Math.abs(remaining).toFixed(2)}`
            ) : (
              `Remaining: $${remaining.toFixed(2)}`
            )}
          </CardDescription>
        </div>
      </CardContent>
    </Card>
  );
}
