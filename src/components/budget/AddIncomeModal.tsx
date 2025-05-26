
"use client";
import { useState, useEffect } from "react";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AddIncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

export function AddIncomeModal({ isOpen, onClose, monthId }: AddIncomeModalProps) {
  const { addIncome, isLoading } = useBudget();
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setDescription("");
      setDate(new Date()); // Reset date on open
    }
  }, [isOpen]);

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
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Add Income for {monthId}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="income-amount" className="text-right col-span-1">
              Amount
            </Label>
            <Input
              id="income-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="income-description" className="text-right col-span-1">
              Description
            </Label>
            <Textarea
              id="income-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Monthly Salary, Freelance Project"
              className="col-span-3"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="income-date" className="text-right col-span-1">
              Date
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "col-span-3 justify-start text-left font-normal",
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
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isLoading}>
            <CheckCircle className="mr-2 h-4 w-4" /> Add Income
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
