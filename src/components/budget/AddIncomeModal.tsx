
"use client";
import { useState, useEffect } from "react";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Calendar as CalendarIcon, Trash2, CircleDollarSign } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { IncomeEntry } from "@/types/budget";
import { Separator } from "@/components/ui/separator"; // Added Separator import

interface AddIncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

export function AddIncomeModal({ isOpen, onClose, monthId }: AddIncomeModalProps) {
  const { addIncome, deleteIncome, getBudgetForMonth, isLoading } = useBudget();
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [currentMonthIncomes, setCurrentMonthIncomes] = useState<IncomeEntry[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && monthId) {
      const budgetData = getBudgetForMonth(monthId);
      setCurrentMonthIncomes(budgetData?.incomes || []);
      // Reset form fields only when modal opens, not when income list changes
      setAmount("");
      setDescription("");
      setDate(new Date());
    }
  }, [isOpen, monthId, getBudgetForMonth]);
  
  // Effect to update list if underlying budget data changes while modal is open
  useEffect(() => {
    if (isOpen && monthId) {
        const budgetData = getBudgetForMonth(monthId);
        if (JSON.stringify(budgetData?.incomes || []) !== JSON.stringify(currentMonthIncomes)) {
            setCurrentMonthIncomes(budgetData?.incomes || []);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, monthId, getBudgetForMonth, getBudgetForMonth(monthId)?.incomes]);


  const handleSubmit = () => {
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast({ title: "Error", description: "Please enter a valid positive amount.", variant: "destructive" });
      return;
    }
    if (description.trim() === "") {
      toast({ title: "Error", description: "Please enter a description for the income.", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Error", description: "Please select a date for the income.", variant: "destructive" });
      return;
    }

    addIncome(monthId, description, numericAmount, date.toISOString());
    toast({
      title: "Income Added",
      description: `${description}: $${numericAmount.toFixed(2)} added on ${format(date, "PPP")}.`,
      action: <CheckCircle className="text-green-500" />,
    });
    // Clear form fields after successful submission
    setAmount("");
    setDescription("");
    setDate(new Date());
    // No onClose() here, user might want to add more or delete existing ones.
  };

  const handleDeleteIncome = (incomeId: string, incomeDescription: string) => {
    deleteIncome(monthId, incomeId);
    toast({
      title: "Income Deleted",
      description: `Income "${incomeDescription}" has been removed.`,
      action: <Trash2 className="text-destructive" />,
    });
  };

  if (!isOpen) return null;

  const sortedIncomes = [...currentMonthIncomes].sort((a, b) => {
    const dateA = new Date(a.dateAdded);
    const dateB = new Date(b.dateAdded);
    if (!isValid(dateA) && !isValid(dateB)) return 0;
    if (!isValid(dateA)) return 1;
    if (!isValid(dateB)) return -1;
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Manage Income for {monthId}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="space-y-6 py-4">
            {/* Section to list existing incomes - MOVED TO TOP */}
            <div>
              <h3 className="text-lg font-medium mb-3">Existing Income Entries</h3>
              {sortedIncomes.length > 0 ? (
                <ul className="space-y-2">
                  {sortedIncomes.map((income) => {
                    const incomeDate = new Date(income.dateAdded);
                    const formattedDate = isValid(incomeDate) ? format(incomeDate, "MMM d, yyyy") : "Invalid Date";
                    return (
                      <li key={income.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="flex-grow">
                          <p className="font-medium text-sm">{income.description}</p>
                          <p className="text-xs text-muted-foreground">
                            ${income.amount.toFixed(2)} on {formattedDate}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 ml-2"
                          onClick={() => handleDeleteIncome(income.id, income.description)}
                          aria-label="Delete income"
                          disabled={isLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                !isLoading && <p className="text-sm text-muted-foreground text-center py-2">No income entries recorded for this month yet.</p>
              )}
            </div>

            {/* Separator if there are existing incomes */}
            {sortedIncomes.length > 0 && <Separator className="my-4" />}

            {/* Section to add new income */}
            <div>
              <h3 className="text-lg font-medium mb-3">Add New Income Entry</h3>
              <div className="grid gap-4">
                <div className="space-y-1">
                  <Label htmlFor="income-amount">Amount</Label>
                  <Input
                    id="income-amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="income-description">Description</Label>
                  <Textarea
                    id="income-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Monthly Salary, Freelance Project"
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="income-date">Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button onClick={handleSubmit} disabled={isLoading} className="w-full sm:w-auto self-end">
                  <CircleDollarSign className="mr-2 h-4 w-4" /> Add This Income
                </Button>
              </div>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="pt-4 border-t">
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              <XCircle className="mr-2 h-4 w-4" /> Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
