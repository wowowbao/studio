
"use client";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/useBudget";
import { Edit3, PlusCircle, ArchiveRestore, Coins, ArchiveX, Wand2, CheckCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BudgetActionsProps {
  onEditBudget: () => void;
  onAddExpense: () => void;
  onAddIncome: () => void;
  onFinalizeMonth: () => void;
  onPrepNextMonth: () => void;
}

export function BudgetActions({ 
  onEditBudget, 
  onAddExpense, 
  onAddIncome, 
  onFinalizeMonth,
  onPrepNextMonth
}: BudgetActionsProps) {
  const { currentDisplayMonthId, currentBudgetMonth, rolloverUnspentBudget } = useBudget();
  const { toast } = useToast();

  const handleFinalizeOrReopenMonth = () => {
    if (!currentBudgetMonth) return;

    const result = rolloverUnspentBudget(currentDisplayMonthId); 

    if (result.success) {
      if (currentBudgetMonth.isRolledOver) { 
        // This case means the month was just reopened
        toast({
          title: "Month Reopened",
          description: result.message,
          action: <ArchiveX className="text-blue-500" />
        });
      } else {
        // This case means the month was just closed
        // Toast for successful month close is now handled by the summary modal trigger in page.tsx
        onFinalizeMonth(); 
      }
    } else {
      toast({
        title: "Action Info",
        description: result.message,
        variant: "default", 
        action: <AlertTriangle className="text-yellow-500" />,
      });
    }
  };
  
  const isMonthClosed = currentBudgetMonth?.isRolledOver;
  const disablePrimaryActions = isMonthClosed;


  return (
    <div className="my-6 p-4 bg-card border rounded-lg shadow-sm space-y-3">
      <Button onClick={onAddExpense} className="w-full" disabled={disablePrimaryActions}>
        <PlusCircle className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Add Expense"}
      </Button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button onClick={onEditBudget} variant="outline" className="w-full" disabled={disablePrimaryActions}>
          <Edit3 className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Manage Budget"}
        </Button>
        <Button onClick={onAddIncome} variant="outline" className="w-full" disabled={disablePrimaryActions}>
            <Coins className="mr-2 h-4 w-4" /> {disablePrimaryActions ? "Month Closed" : "Manage Income"}
        </Button>
      </div>
        
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <Button onClick={onPrepNextMonth} variant="secondary" className="w-full">
          <Wand2 className="mr-2 h-4 w-4" /> AI Budget Prep
        </Button>

         <Button 
          onClick={handleFinalizeOrReopenMonth} 
          variant={isMonthClosed ? "destructive" : "secondary"}
          className="w-full"
        >
          {isMonthClosed ? <ArchiveX className="mr-2 h-4 w-4" /> : <ArchiveRestore className="mr-2 h-4 w-4" />}
          {isMonthClosed ? "Reopen Month" : "Finalize & Close Month"}
        </Button>
      </div>
       {isMonthClosed && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          This month's budget has been closed. Editing, adding expenses/income are disabled. You can reopen the month to make changes.
        </p>
      )}
    </div>
  );
}
