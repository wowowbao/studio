
"use client";
import { useState, useEffect, useCallback } from "react";
import type { BudgetCategory, BudgetMonth } from "@/types/budget";
import { DEFAULT_CATEGORIES } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, PlusCircle, Edit3, CheckCircle, XCircle } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';

interface EditBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

const ALL_ICONS = Object.keys(LucideIcons).filter(key => /^[A-Z]/.test(key) && key !== 'createReactComponent' && key !== 'icons');


export function EditBudgetModal({ isOpen, onClose, monthId }: EditBudgetModalProps) {
  const { getBudgetForMonth, updateMonthBudget, setSavingsGoalForMonth, isLoading } = useBudget();
  const [editableCategories, setEditableCategories] = useState<BudgetCategory[]>([]);
  const [monthSavingsGoal, setMonthSavingsGoal] = useState<number>(0);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const { toast } = useToast();

  const loadBudgetData = useCallback(() => {
    if (!isLoading && monthId) {
      const budgetData = getBudgetForMonth(monthId);
      if (budgetData) {
        setEditableCategories([...budgetData.categories.map(c => ({...c}))]); // Deep copy
        setMonthSavingsGoal(budgetData.savingsGoal || 0);
      } else {
         // If no budget data, initialize with defaults
        const defaultCatsForModal = DEFAULT_CATEGORIES.map(cat => ({
            ...cat,
            id: uuidv4(),
            budgetedAmount: 0,
            spentAmount: 0,
        }));
        setEditableCategories(defaultCatsForModal);
        setMonthSavingsGoal(0);
      }
      setIsDataLoaded(true);
    }
  }, [monthId, getBudgetForMonth, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setIsDataLoaded(false); // Reset loading state on open
      loadBudgetData();
    }
  }, [isOpen, loadBudgetData]);


  const handleCategoryChange = (id: string, field: keyof BudgetCategory, value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => (cat.id === id ? { ...cat, [field]: typeof value === 'string' && field !== 'name' && field !== 'icon' ? parseFloat(value) || 0 : value } : cat))
    );
  };

  const handleAddCategory = () => {
    setEditableCategories(prev => [
      ...prev,
      { id: uuidv4(), name: "New Category", icon: "Package", budgetedAmount: 0, spentAmount: 0 },
    ]);
  };

  const handleDeleteCategory = (id: string) => {
    setEditableCategories(prev => prev.filter(cat => cat.id !== id));
  };

  const handleSaveChanges = () => {
    if (!monthId) {
        toast({ title: "Error", description: "Month ID is missing.", variant: "destructive" });
        return;
    }
    // Filter out categories with empty names before saving
    const validCategories = editableCategories.filter(cat => cat.name.trim() !== "");
    updateMonthBudget(monthId, { categories: validCategories, savingsGoal: monthSavingsGoal });
    toast({
      title: "Budget Updated",
      description: `Budget for ${monthId} has been saved.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onClose();
  };

  if (!isOpen || !isDataLoaded) {
    return null; // Or a loading spinner inside the dialog if preferred
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Edit Budget for {monthId}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] p-1">
          <div className="space-y-6 pr-4">
            <div>
              <Label htmlFor="savingsGoal" className="text-lg font-medium">Monthly Savings Goal</Label>
              <Input
                id="savingsGoal"
                type="number"
                value={monthSavingsGoal}
                onChange={(e) => setMonthSavingsGoal(parseFloat(e.target.value) || 0)}
                className="mt-2 text-base"
                placeholder="e.g., 500"
              />
            </div>
            
            <h3 className="text-lg font-medium border-b pb-2">Categories</h3>
            {editableCategories.map(cat => (
              <div key={cat.id} className="p-4 border rounded-lg shadow-sm space-y-3 bg-card/50">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div>
                    <Label htmlFor={`categoryName-${cat.id}`}>Name</Label>
                    <Input
                      id={`categoryName-${cat.id}`}
                      value={cat.name}
                      onChange={(e) => handleCategoryChange(cat.id, "name", e.target.value)}
                      placeholder="Category Name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`categoryIcon-${cat.id}`}>Icon</Label>
                    <Select
                      value={cat.icon}
                      onValueChange={(value) => handleCategoryChange(cat.id, "icon", value)}
                    >
                      <SelectTrigger id={`categoryIcon-${cat.id}`} className="mt-1">
                        <SelectValue placeholder="Select icon" />
                      </SelectTrigger>
                      <SelectContent>
                        <ScrollArea className="h-48">
                          {ALL_ICONS.map(iconName => {
                            const CurrentIcon = (LucideIcons as any)[iconName];
                            return (
                              <SelectItem key={iconName} value={iconName}>
                                <div className="flex items-center">
                                  <CurrentIcon className="mr-2 h-4 w-4" />
                                  {iconName}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </ScrollArea>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor={`categoryBudget-${cat.id}`}>Budgeted Amount</Label>
                  <Input
                    id={`categoryBudget-${cat.id}`}
                    type="number"
                    value={cat.budgetedAmount}
                    onChange={(e) => handleCategoryChange(cat.id, "budgetedAmount", e.target.value)}
                    placeholder="0.00"
                    className="mt-1"
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat.id)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 w-full sm:w-auto">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Category
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={handleAddCategory} className="w-full mt-4 py-3">
              <PlusCircle className="mr-2 h-5 w-5" /> Add New Category
            </Button>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-6 gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSaveChanges}>
            <CheckCircle className="mr-2 h-4 w-4" /> Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
