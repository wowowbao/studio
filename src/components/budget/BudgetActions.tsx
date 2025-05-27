
"use client";
import Link from 'next/link';
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/useBudget";
import { Edit3, PlusCircle, ArchiveRestore, Coins, ArchiveX, Wand2, AlertTriangle } from "lucide-react"; // Added AlertTriangle
import { useToast } from "@/hooks/use-toast";

interface BudgetActionsProps {
  onEditBudget: () => void;
  onAddExpense: () => void;
  onAddIncome: () => void;
  onFinalizeMonth: () => void;
}

export function BudgetActions({ 
  onEditBudget, 
  onAddExpense, 
  onAddIncome, 
  onFinalizeMonth,
}: BudgetActionsProps) {
  const { currentDisplayMonthId, currentBudgetMonth, rolloverUnspentBudget } = useBudget();
  const { toast } = useToast();

  const handleFinalizeOrReopenMonth = () => {
    if (!currentBudgetMonth) return;

    const result = rolloverUnspentBudget(currentDisplayMonthId); 

    if (result.success) {
      if (currentBudgetMonth.isRolledOver) { 
        toast({
          title: "Month Reopened",
          description: result.message,
          action: <ArchiveX className="text-blue-500" />
        });
      } else {
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
        <Link href="/prep-budget" passHref legacyBehavior>
          <Button asChild variant="secondary" className="w-full">
            <a><Wand2 className="mr-2 h-4 w-4" /> AI Budget Prep</a>
          </Button>
        </Link>

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

