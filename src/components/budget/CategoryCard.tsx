
"use client";
import type { BudgetCategory } from "@/types/budget";
import * as LucideIcons from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  category: BudgetCategory;
  onEdit?: (category: BudgetCategory) => void; // Optional: for editing category details
}

export function CategoryCard({ category }: CategoryCardProps) {
  const IconComponent = (LucideIcons as any)[category.icon] || LucideIcons.HelpCircle;
  const progress = category.budgetedAmount > 0 ? (category.spentAmount / category.budgetedAmount) * 100 : 0;
  const remaining = category.budgetedAmount - category.spentAmount;
  const isOverBudget = remaining < 0;

  return (
    <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center space-x-2">
          <IconComponent className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base font-medium">{category.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-sm mb-1">
          Budgeted: <span className="font-semibold">${category.budgetedAmount.toFixed(2)}</span>
        </div>
        <div className="text-sm mb-2">
          Spent: <span className="font-semibold">${category.spentAmount.toFixed(2)}</span>
        </div>
        <Progress value={Math.min(progress, 100)} className={cn("h-3 mb-2", isOverBudget ? "bg-destructive" : "")} indicatorClassName={isOverBudget ? "bg-destructive" : ""} />
        <CardDescription className={cn(isOverBudget ? "text-destructive font-semibold" : "text-muted-foreground")}>
          {isOverBudget
            ? `Overspent by $${Math.abs(remaining).toFixed(2)}`
            : `Remaining: $${remaining.toFixed(2)}`}
        </CardDescription>
      </CardContent>
    </Card>
  );
}
