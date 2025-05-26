
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
import { CheckCircle, XCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

interface CategoryOption {
  value: string;
  label: string;
  isSubcategory: boolean;
  parentCategoryId?: string; // Only for subcategories
}

export function AddExpenseModal({ isOpen, onClose, monthId }: AddExpenseModalProps) {
  const { getBudgetForMonth, addExpense, isLoading } = useBudget();
  const [selectedTargetId, setSelectedTargetId] = useState<string>(""); // Can be categoryId or subCategoryId
  const [isTargetSubcategory, setIsTargetSubcategory] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && monthId && !isLoading) {
      const budgetData = getBudgetForMonth(monthId);
      const options: CategoryOption[] = [];
      if (budgetData) {
        budgetData.categories.forEach(cat => {
          // Only add parent category as an option if it has NO subcategories
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
          // refresh isTargetSubcategory based on current selection
          const currentOpt = options.find(opt => opt.value === selectedTargetId);
          if (currentOpt) setIsTargetSubcategory(currentOpt.isSubcategory);
        }
      } else {
        setSelectedTargetId("");
        setIsTargetSubcategory(false);
      }
      setAmount("");
      setDescription("");
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

    addExpense(monthId, selectedTargetId, numericAmount, description, isTargetSubcategory);
    toast({
      title: "Expense Added",
      description: `${description}: $${numericAmount.toFixed(2)} added.`,
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
