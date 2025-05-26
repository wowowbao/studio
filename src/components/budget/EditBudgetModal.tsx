
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

// Filtered list of Lucide icons that are actual components
const ALL_ICONS = Object.keys(LucideIcons)
  .filter(key => {
    const ExportedItem = (LucideIcons as any)[key];
    // Check if it's a function (React components are functions) and not 'createLucideIcon' or other helpers
    return typeof ExportedItem === 'function' && 
           ExportedItem.displayName && // Most Lucide icons will have a displayName
           key !== 'createLucideIcon' && // Exclude the helper
           key !== 'IconNode' && // Exclude type
           key !== 'LucideIcon' && // Exclude type
           key !== 'LucideProps'; // Exclude type
  })
  .sort(); // Sort alphabetically for easier browsing


export function EditBudgetModal({ isOpen, onClose, monthId }: EditBudgetModalProps) {
  const { getBudgetForMonth, updateMonthBudget, isLoading } = useBudget(); // Removed setSavingsGoalForMonth as it's part of updateMonthBudget
  const [editableCategories, setEditableCategories] = useState<Array<Omit<BudgetCategory, 'spentAmount'>>>([].map(c => ({...c, expenses: c.expenses || [] })));
  const [monthSavingsGoal, setMonthSavingsGoal] = useState<number>(0);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const { toast } = useToast();

  const loadBudgetData = useCallback(() => {
    if (!isLoading && monthId) {
      const budgetData = getBudgetForMonth(monthId);
      if (budgetData) {
        // Map to ensure 'expenses' array exists and is part of the editable state
        setEditableCategories([...budgetData.categories.map(c => ({
            id: c.id,
            name: c.name,
            icon: c.icon,
            budgetedAmount: c.budgetedAmount,
            expenses: c.expenses || [] 
        }))]);
        setMonthSavingsGoal(budgetData.savingsGoal || 0);
      } else {
        const defaultCatsForModal = DEFAULT_CATEGORIES.map(cat => ({
            ...cat,
            id: uuidv4(),
            budgetedAmount: 0,
            expenses: [], // Ensure expenses is initialized
        }));
        setEditableCategories(defaultCatsForModal);
        setMonthSavingsGoal(0);
      }
      setIsDataLoaded(true);
    }
  }, [monthId, getBudgetForMonth, isLoading]);

  useEffect(() => {
    if (isOpen) {
      setIsDataLoaded(false); 
      loadBudgetData();
    }
  }, [isOpen, loadBudgetData]);


  const handleCategoryChange = (id: string, field: keyof (Omit<BudgetCategory, 'spentAmount'>) , value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => (cat.id === id ? { ...cat, [field]: typeof value === 'string' && field !== 'name' && field !== 'icon' ? parseFloat(value) || 0 : value } : cat))
    );
  };

  const handleAddCategory = () => {
    setEditableCategories(prev => [
      ...prev,
      { id: uuidv4(), name: "New Category", icon: "Package", budgetedAmount: 0, expenses: [] },
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
    const validCategories = editableCategories
        .filter(cat => cat.name.trim() !== "")
        .map(cat => ({ // Ensure structure matches BudgetCategory for saving
            id: cat.id,
            name: cat.name,
            icon: cat.icon,
            budgetedAmount: cat.budgetedAmount,
            expenses: cat.expenses || [] // Ensure expenses array is present
        }));

    updateMonthBudget(monthId, { categories: validCategories, savingsGoal: monthSavingsGoal });
    toast({
      title: "Budget Updated",
      description: `Budget for ${monthId} has been saved.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onClose();
  };

  if (!isOpen || !isDataLoaded) {
    return null; 
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
                      <SelectContent> {/* This component applies text-popover-foreground */}
                        <ScrollArea className="h-[25rem]"> 
                          {ALL_ICONS.map(iconName => {
                            const CurrentIcon = (LucideIcons as any)[iconName];
                            if (!CurrentIcon || typeof CurrentIcon !== 'function') return null; 
                            return (
                              <SelectItem key={iconName} value={iconName}>
                                {/* This div inherits text-popover-foreground from SelectContent and applies it to children */}
                                <div className="flex items-center text-popover-foreground"> 
                                  {/* Icon should inherit color via currentColor from the parent div */}
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
