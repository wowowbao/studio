
"use client";
import { useState, useEffect } from "react";
import type { BudgetCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// import * as LucideIcons from "lucide-react"; // No longer needed for category icons
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";


interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

export function AddExpenseModal({ isOpen, onClose, monthId }: AddExpenseModalProps) {
  const { getBudgetForMonth, addExpense, isLoading } = useBudget();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [availableCategories, setAvailableCategories] = useState<BudgetCategory[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && monthId && !isLoading) {
      const budgetData = getBudgetForMonth(monthId);
      if (budgetData && budgetData.categories.length > 0) {
        setAvailableCategories(budgetData.categories);
        if (budgetData.categories.length > 0 && (!selectedCategoryId || !budgetData.categories.find(c => c.id === selectedCategoryId))) {
          setSelectedCategoryId(budgetData.categories[0].id); // Default to first category if current selection is invalid or empty
        }
      } else {
        setAvailableCategories([]);
        setSelectedCategoryId("");
      }
      setAmount("");
      setDescription("");
    }
  }, [isOpen, monthId, getBudgetForMonth, isLoading, selectedCategoryId]);

  const handleSubmit = () => {
    const numericAmount = parseFloat(amount);
    if (!selectedCategoryId) {
      toast({ title: "Error", description: "Please select a category.", variant: "destructive" });
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

    addExpense(monthId, selectedCategoryId, numericAmount, description);
    toast({
      title: "Expense Added",
      description: `${description}: $${numericAmount.toFixed(2)} added.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onClose();
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
        ) : availableCategories.length === 0 ? (
          <p className="text-muted-foreground py-4">No categories available for this month. Please add categories first in 'Edit Budget'.</p>
        ) : (
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right col-span-1">
                Category
              </Label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger id="category" className="col-span-3">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map(cat => {
                    // const IconComponent = (LucideIcons as any)[cat.icon] || LucideIcons.HelpCircle; // Icon removed
                    return (
                      <SelectItem key={cat.id} value={cat.id}>
                        <div className="flex items-center">
                          {/* <IconComponent className="mr-2 h-4 w-4 text-current" /> // Icon removed */}
                          {cat.name}
                        </div>
                      </SelectItem>
                    );
                  })}
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
          <Button onClick={handleSubmit} disabled={isLoading || availableCategories.length === 0}>
            <CheckCircle className="mr-2 h-4 w-4" /> Add Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
