
"use client";
import { useState, useEffect } from "react";
import type { BudgetCategory, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Calendar as CalendarIcon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

interface CategoryOption {
  value: string;
  label: string;
  isSubcategory: boolean;
  parentCategoryId?: string;
}

export function AddExpenseModal({ isOpen, onClose, monthId }: AddExpenseModalProps) {
  const { getBudgetForMonth, addExpense, isLoading } = useBudget();
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [isTargetSubcategory, setIsTargetSubcategory] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && monthId && !isLoading) {
      const budgetData = getBudgetForMonth(monthId);
      const options: CategoryOption[] = [];
      if (budgetData) {
        budgetData.categories.forEach(cat => {
          if (!cat.subcategories || cat.subcategories.length === 0) {
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          }
          (cat.subcategories || []).forEach(sub => {
            options.push({ value: sub.id, label: `${cat.name} > ${sub.name}`, isSubcategory: true, parentCategoryId: cat.id });
          });
        });
      }
      setCategoryOptions(options);

      if (options.length > 0) {
        const currentSelectionStillValid = options.some(opt => opt.value === selectedTargetId);
        if (!selectedTargetId || !currentSelectionStillValid) {
          setSelectedTargetId(options[0].value);
          setIsTargetSubcategory(options[0].isSubcategory);
        } else {
          const currentOpt = options.find(opt => opt.value === selectedTargetId);
          if (currentOpt) setIsTargetSubcategory(currentOpt.isSubcategory);
        }
      } else {
        setSelectedTargetId("");
        setIsTargetSubcategory(false);
      }
      setAmount("");
      setDescription("");
      setDate(new Date()); // Reset date on open
    }
  }, [isOpen, monthId, getBudgetForMonth, isLoading, selectedTargetId]);

  const handleSubmit = () => {
    const numericAmount = parseFloat(amount);
    if (!selectedTargetId) {
      toast({ title: "Error", description: "Please select a category or subcategory.", variant: "destructive" });
      return;
    }
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast({ title: "Error", description: "Please enter a valid positive amount.", variant: "destructive" });
      return;
    }
    if (description.trim() === "") {
      toast({ title: "Error", description: "Please enter a description for the expense.", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Error", description: "Please select a date for the expense.", variant: "destructive" });
      return;
    }

    addExpense(monthId, selectedTargetId, numericAmount, description, date.toISOString(), isTargetSubcategory);
    toast({
      title: "Expense Added",
      description: `${description}: $${numericAmount.toFixed(2)} added on ${format(date, "PPP")}.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onClose();
  };
  
  const handleSelectionChange = (value: string) => {
    const selectedOption = categoryOptions.find(opt => opt.value === value);
    if (selectedOption) {
      setSelectedTargetId(selectedOption.value);
      setIsTargetSubcategory(selectedOption.isSubcategory);
    }
  };


  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Add Expense for {monthId}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p>Loading categories...</p>
        ) : categoryOptions.length === 0 ? (
          <p className="text-muted-foreground py-4">No categories or subcategories available for this month. Please add them first in 'Edit Budget'.</p>
        ) : (
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right col-span-1">
                Category
              </Label>
              <Select value={selectedTargetId} onValueChange={handleSelectionChange}>
                <SelectTrigger id="category" className="col-span-3">
                  <SelectValue placeholder="Select target" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="amount" className="text-right col-span-1">
                Amount
              </Label>
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right col-span-1">
                Description
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Weekly groceries"
                className="col-span-3"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="date" className="text-right col-span-1">
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
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isLoading || categoryOptions.length === 0}>
            <CheckCircle className="mr-2 h-4 w-4" /> Add Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
