
"use client";
import { useState, useEffect, useCallback } from "react";
import type { BudgetCategory, BudgetMonth, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, PlusCircle, CheckCircle, XCircle, MinusCircle, CornerDownRight, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';

interface EditBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

type EditableCategory = Omit<BudgetCategory, 'id'> & { 
  id: string; 
  subcategories: Array<Omit<SubCategory, 'id'> & { id: string; expenses: SubCategory['expenses'] }>;
  expenses: BudgetCategory['expenses'];
  isSystemCategory?: boolean;
};


export function EditBudgetModal({ isOpen, onClose, monthId }: EditBudgetModalProps) {
  const { 
    getBudgetForMonth, 
    updateMonthBudget, 
    isLoading,
    currentBudgetMonth, 
  } = useBudget();
  
  const [editableCategories, setEditableCategories] = useState<EditableCategory[]>([]);
  const [startingDebt, setStartingDebt] = useState<number>(0);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const { toast } = useToast();

  const loadBudgetData = useCallback(() => {
    if (!isLoading && monthId) {
      const budgetData = (currentBudgetMonth && currentBudgetMonth.id === monthId) ? currentBudgetMonth : getBudgetForMonth(monthId);
      
      if (budgetData) {
        const currentStartingDebt = budgetData.startingCreditCardDebt || 0;
        setEditableCategories(budgetData.categories.map(c => ({
            ...c,
            id: c.id, 
            budgetedAmount: c.budgetedAmount,
            subcategories: (c.subcategories || []).map(sc => ({ ...sc, id: sc.id, expenses: sc.expenses || [] })),
            expenses: c.expenses || [],
            isSystemCategory: c.isSystemCategory || false,
        })));
        setStartingDebt(currentStartingDebt);
      } else {
        setEditableCategories([]);
        setStartingDebt(0);
         toast({ title: "Loading Error", description: "Could not load budget data. Please try again.", variant: "destructive" });
      }
      setIsDataLoaded(true);
    }
  }, [monthId, getBudgetForMonth, isLoading, currentBudgetMonth, toast]);

  useEffect(() => {
    if (isOpen) {
      setIsDataLoaded(false);
      loadBudgetData();
    }
  }, [isOpen, loadBudgetData]);


  const handleCategoryChange = (id: string, field: keyof EditableCategory , value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => {
        if (cat.id === id) {
          if (cat.isSystemCategory && field === 'name') {
            return cat; 
          }
          // Do not update budgetedAmount for parent if it has subcategories, it's derived
          if (field === 'budgetedAmount' && cat.subcategories && cat.subcategories.length > 0 && !cat.isSystemCategory) {
            return cat;
          }
          return { ...cat, [field]: typeof value === 'string' && field !== 'name' ? parseFloat(value) || 0 : value };
        }
        return cat;
      })
    );
  };

  const handleAddCategory = () => {
    setEditableCategories(prev => [
      ...prev,
      { id: uuidv4(), name: "New Category", budgetedAmount: 0, expenses: [], subcategories: [], isSystemCategory: false },
    ]);
  };

  const handleDeleteCategory = (id: string) => {
    const catToDelete = editableCategories.find(cat => cat.id === id);
    if (catToDelete?.isSystemCategory) {
      toast({ title: "Action Denied", description: `The '${catToDelete.name}' category cannot be deleted.`, variant: "destructive" });
      return;
    }
    setEditableCategories(prev => prev.filter(cat => cat.id !== id));
  };

  const handleAddSubCategory = (parentCategoryId: string) => {
     const parentCat = editableCategories.find(cat => cat.id === parentCategoryId);
    if (parentCat?.isSystemCategory) {
      toast({ title: "Action Denied", description: "System categories cannot have subcategories.", variant: "destructive" });
      return;
    }
    setEditableCategories(prev => prev.map(cat => {
      if (cat.id === parentCategoryId) {
        const newSub: EditableCategory['subcategories'][0] = {
          id: uuidv4(),
          name: "New Subcategory",
          budgetedAmount: 0,
          expenses: []
        };
        return { ...cat, subcategories: [...(cat.subcategories || []), newSub] };
      }
      return cat;
    }));
  };

  const handleSubCategoryChange = (parentCategoryId: string, subId: string, field: keyof SubCategory, value: string | number) => {
    setEditableCategories(prev => prev.map(cat => {
      if (cat.id === parentCategoryId) {
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map(sub => 
            sub.id === subId ? { ...sub, [field]: typeof value === 'string' && field !== 'name' ? parseFloat(value) || 0 : value } : sub
          )
        };
      }
      return cat;
    }));
  };

  const handleDeleteSubCategory = (parentCategoryId: string, subId: string) => {
    setEditableCategories(prev => prev.map(cat => {
      if (cat.id === parentCategoryId) {
        return { ...cat, subcategories: (cat.subcategories || []).filter(sub => sub.id !== subId) };
      }
      return cat;
    }));
  };


  const handleSaveChanges = () => {
    if (!monthId) {
        toast({ title: "Error", description: "Month ID is missing.", variant: "destructive" });
        return;
    }
    
    const finalCategoriesToSave = editableCategories
        .filter(cat => cat.name.trim() !== "")
        .map(cat => {
            let parentBudgetedAmount = cat.budgetedAmount;
            // If it's not a system category and has subcategories, its budget is the sum of subcategories
            // We still save the original parentBudgetedAmount if it was editable (no subs),
            // or it's derived if it had subs (though we don't strictly need to save the derived sum in the parent if it's always calculated on load).
            // For simplicity of data storage, we can just store what was input or what parent had. 
            // The display/calculation logic will handle the derivation.
            if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
                 // parentBudgetedAmount = cat.subcategories.reduce((sum, sub) => sum + (parseFloat(String(sub.budgetedAmount)) || 0), 0);
                 // No, we don't store the sum in the parent. The parent.budgetedAmount is its own distinct value if it has no subs.
                 // If it has subs, its "effective" budget is the sum of subs, but its own stored 'budgetedAmount' might be 0 or an old value.
            }

            return {
                id: cat.id,
                name: cat.name,
                budgetedAmount: parentBudgetedAmount, // Store the parent's direct budgeted amount
                expenses: cat.expenses || [],
                isSystemCategory: cat.isSystemCategory || false,
                subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || [])
                    .filter(sub => sub.name.trim() !== "")
                    .map(sub => ({
                        id: sub.id,
                        name: sub.name,
                        budgetedAmount: sub.budgetedAmount,
                        expenses: sub.expenses || [],
                    })),
            };
        });

    updateMonthBudget(monthId, { 
      categories: finalCategoriesToSave, 
      startingCreditCardDebt: startingDebt,
    });
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
        <ScrollArea className="max-h-[65vh] p-1">
          <div className="space-y-6 pr-4">
            <div>
              <Label htmlFor="startingDebt" className="text-base font-medium">Credit Card Debt at Start of Month</Label>
              <Input
                id="startingDebt"
                type="number"
                value={startingDebt}
                onChange={(e) => setStartingDebt(parseFloat(e.target.value) || 0)}
                className="mt-1 text-sm"
                placeholder="e.g., 1000"
              />
            </div>
            
            <h3 className="text-lg font-medium border-b pb-2">Categories</h3>
            {editableCategories.map(cat => {
              const isSavings = cat.isSystemCategory && cat.name.toLowerCase() === 'savings';
              const isCCPayments = cat.isSystemCategory && cat.name.toLowerCase() === 'credit card payments';
              const hasSubcategories = !cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0;
              
              let parentDisplayBudget = cat.budgetedAmount;
              if (hasSubcategories) {
                parentDisplayBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
              }

              return (
                <div key={cat.id} className="p-4 border rounded-lg shadow-sm space-y-3 bg-card/50">
                  <div className="grid grid-cols-1 gap-3 items-end">
                    <div>
                      <Label htmlFor={`categoryName-${cat.id}`}>Category Name</Label>
                       {(isSavings || isCCPayments) ? (
                        <Input
                          id={`categoryName-${cat.id}`}
                          value={cat.name}
                          readOnly 
                          className="mt-1 bg-muted/50 cursor-not-allowed text-sm"
                        />
                      ) : (
                        <Input
                          id={`categoryName-${cat.id}`}
                          value={cat.name}
                          onChange={(e) => handleCategoryChange(cat.id, "name", e.target.value)}
                          placeholder="Category Name"
                          className="mt-1 text-sm"
                        />
                      )}
                    </div>
                    <div>
                      <Label htmlFor={`categoryBudget-${cat.id}`}>
                        {isSavings ? "Planned Contribution to Savings" : 
                         isCCPayments ? "Planned Payment" : 
                         hasSubcategories ? "Total Subcategory Budget (Read-only)" :
                         "Category Budgeted Amount"}
                      </Label>
                      <Input
                        id={`categoryBudget-${cat.id}`}
                        type="number"
                        value={parentDisplayBudget}
                        onChange={(e) => {
                          if (!hasSubcategories) { // Only allow direct edit if no subcategories
                            handleCategoryChange(cat.id, "budgetedAmount", e.target.value);
                          }
                        }}
                        readOnly={hasSubcategories && !cat.isSystemCategory} // Parent budget is read-only if it has subs (and not system)
                        placeholder={parentDisplayBudget === 0 ? "0.00" : String(parentDisplayBudget)}
                        className={`mt-1 text-sm ${hasSubcategories && !cat.isSystemCategory ? "bg-muted/50 cursor-default" : ""}`}
                      />
                       {hasSubcategories && <p className="text-xs text-muted-foreground mt-1">Parent budget is sum of subcategories.</p>}
                    </div>
                  </div>
                  
                  {!(isSavings || isCCPayments) && ( 
                    <div className="ml-4 mt-3 space-y-3 border-l pl-4 pt-2">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-medium text-muted-foreground">Subcategories</h4>
                            <Button variant="outline" size="sm" onClick={() => handleAddSubCategory(cat.id)}>
                                <PlusCircle className="mr-2 h-3 w-3" /> Add Sub
                            </Button>
                        </div>
                        {(cat.subcategories || []).map(sub => (
                            <div key={sub.id} className="p-3 border rounded-md bg-background space-y-2">
                                <div className="flex items-center">
                                    <CornerDownRight className="h-3 w-3 mr-2 text-muted-foreground" />
                                    <Input
                                        value={sub.name}
                                        onChange={(e) => handleSubCategoryChange(cat.id, sub.id, "name", e.target.value)}
                                        placeholder="Subcategory Name"
                                        className="flex-grow h-8 text-xs"
                                    />
                                </div>
                                 <Input
                                    type="number"
                                    value={sub.budgetedAmount}
                                    onChange={(e) => handleSubCategoryChange(cat.id, sub.id, "budgetedAmount", e.target.value)}
                                    placeholder="0.00"
                                    className="mt-1 h-8 text-xs"
                                />
                                <Button variant="ghost" size="xs" onClick={() => handleDeleteSubCategory(cat.id, sub.id)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 w-full text-xs h-7">
                                    <MinusCircle className="mr-1 h-3 w-3" /> Del Sub
                                </Button>
                            </div>
                        ))}
                         {(!cat.subcategories || cat.subcategories.length === 0) && (
                            <p className="text-xs text-muted-foreground italic">No subcategories for this category.</p>
                        )}
                    </div>
                  )}

                  {!(isSavings || isCCPayments) && (
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat.id)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 w-full sm:w-auto mt-3">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Category
                    </Button>
                  )}
                   {(isSavings || isCCPayments) && (
                     <div className="flex items-center text-xs text-muted-foreground mt-2">
                       <ShieldAlert className="h-3 w-3 mr-1" /> 
                       This is a system category. Its name is fixed. It cannot be deleted or have subcategories.
                       {isSavings ? " Set your planned savings contribution above." : " Set your planned payment amount above."}
                     </div>
                   )}
                </div>
              );
            })}
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

    