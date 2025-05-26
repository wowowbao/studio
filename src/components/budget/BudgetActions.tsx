
"use client";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/useBudget";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Edit3, PlusCircle, Copy, AlertTriangle, CheckCircle, ArchiveRestore, Coins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BudgetActionsProps {
  onEditBudget: () => void;
  onAddExpense: () => void;
  onAddIncome: () => void;
}

export function BudgetActions({ onEditBudget, onAddExpense, onAddIncome }: BudgetActionsProps) {
  const { currentDisplayMonthId, currentBudgetMonth, duplicateMonthBudget, rolloverUnspentBudget } = useBudget();
  const { toast } = useToast();

  const handleDuplicateMonth = () => {
    const currentDate = parseYearMonth(currentDisplayMonthId);
    currentDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentDate);
    
    duplicateMonthBudget(currentDisplayMonthId, nextMonthId);
    toast({
      title: "Budget Duplicated",
      description: `Budget from ${currentDisplayMonthId} duplicated to ${nextMonthId}.`,
      action: <CheckCircle className="text-green-500" />
    });
  };

  const handleRolloverUnspent = () => {
    const result = rolloverUnspentBudget(currentDisplayMonthId);
    toast({
      title: result.success ? "Month Closed" : "Month Close Info",
      description: result.message,
      variant: result.success ? "default" : "default", 
      action: result.success ? <CheckCircle className="text-green-500" /> : <AlertTriangle className="text-yellow-500" />,
    });
  };
  
  const isRolledOver = currentBudgetMonth?.isRolledOver;
  const disablePrimaryActions = isRolledOver;


  return (
    <div className="my-6 p-4 bg-card border rounded-lg shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Button onClick={onEditBudget} variant="outline" className="w-full" disabled={disablePrimaryActions}>
          <Edit3 className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Manage Budget"}
        </Button>
        <Button onClick={onAddIncome} variant="outline" className="w-full" disabled={disablePrimaryActions}>
            <Coins className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Add Income"}
        </Button>
        <Button onClick={onAddExpense} className="w-full" disabled={disablePrimaryActions}>
          <PlusCircle className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Add Expense"}
        </Button>
        <Button onClick={handleDuplicateMonth} variant="secondary" className="w-full sm:col-span-1">
          <Copy className="mr-2 h-4 w-4" /> Duplicate Month
        </Button>
         <Button 
          onClick={handleRolloverUnspent} 
          variant="secondary" 
          className="w-full sm:col-span-2"
          disabled={isRolledOver} 
        >
          <ArchiveRestore className="mr-2 h-4 w-4" /> 
          {isRolledOver ? "Month Closed" : "Finalize & Close Month"}
        </Button>
      </div>
       {isRolledOver && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          This month's budget has been closed. Editing, adding expenses/income, and rollover are disabled.
        </p>
      )}
    </div>
  );
}
