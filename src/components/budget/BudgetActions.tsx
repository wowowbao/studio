
"use client";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/useBudget";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Edit3, PlusCircle, Copy, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BudgetActionsProps {
  onEditBudget: () => void;
  onAddExpense: () => void;
}

export function BudgetActions({ onEditBudget, onAddExpense }: BudgetActionsProps) {
  const { currentDisplayMonthId, duplicateMonthBudget } = useBudget();
  const { toast } = useToast();

  const handleDuplicateMonth = () => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    
    duplicateMonthBudget(currentDisplayMonthId, nextMonthId);
    toast({
      title: "Budget Duplicated",
      description: `Budget from ${currentDisplayMonthId} duplicated to ${nextMonthId}.`,
    });
  };

  return (
    <div className="my-6 p-4 bg-card border rounded-lg shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Button onClick={onEditBudget} variant="outline" className="w-full">
          <Edit3 className="mr-2 h-4 w-4" /> Edit Budget
        </Button>
        <Button onClick={onAddExpense} className="w-full">
          <PlusCircle className="mr-2 h-4 w-4" /> Add Expense
        </Button>
        <Button onClick={handleDuplicateMonth} variant="secondary" className="w-full">
          <Copy className="mr-2 h-4 w-4" /> Duplicate Month
        </Button>
      </div>
    </div>
  );
}
