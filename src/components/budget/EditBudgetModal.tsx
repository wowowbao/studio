
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { BudgetCategory, BudgetMonth, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, PlusCircle, CheckCircle, XCircle, MinusCircle, CornerDownRight, ShieldAlert, Wand2, Loader2, FileImage } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';
import { setupBudgetFromImage, type SetupBudgetInput, type SetupBudgetOutput } from '@/ai/flows/setup-budget-flow';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import Image from "next/image";


interface EditBudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

type EditableCategory = Omit<BudgetCategory, 'id' | 'expenses' | 'subcategories'> & { 
  id: string; 
  subcategories: Array<Omit<SubCategory, 'id' | 'expenses'> & { id: string; expenses?: SubCategory['expenses'] }>;
  expenses?: BudgetCategory['expenses'];
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

  const [aiSetupImageFile, setAiSetupImageFile] = useState<File | null>(null);
  const [aiSetupImagePreviewUrl, setAiSetupImagePreviewUrl] = useState<string | null>(null);
  const [isAiBudgetProcessing, setIsAiBudgetProcessing] = useState<boolean>(false);
  const [aiBudgetError, setAiBudgetError] = useState<string | null>(null);
  const aiSetupFileInputRef = useRef<HTMLInputElement>(null);


  const resetModalState = useCallback(() => {
    setEditableCategories([]);
    setStartingDebt(0);
    setIsDataLoaded(false);
    setAiSetupImageFile(null);
    setAiSetupImagePreviewUrl(null);
    setIsAiBudgetProcessing(false);
    setAiBudgetError(null);
    if (aiSetupFileInputRef.current) {
      aiSetupFileInputRef.current.value = "";
    }
  }, []);

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
        // This case should ideally be handled by ensureMonthExists creating a new budget
        // If it still happens, initialize with empty/default structure.
        setEditableCategories([]); // Start with no user-defined categories
        setStartingDebt(0);
      }
      setIsDataLoaded(true);
    }
  }, [monthId, getBudgetForMonth, isLoading, currentBudgetMonth]);

  useEffect(() => {
    if (isOpen) {
      resetModalState();
      loadBudgetData();
    }
  }, [isOpen, loadBudgetData, resetModalState]);


  const handleCategoryChange = (id: string, field: keyof EditableCategory , value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => {
        if (cat.id === id) {
          if (cat.isSystemCategory && field === 'name') { // System category names cannot be changed
            return cat; 
          }
           // Do not update budgetedAmount for parent if it has subcategories and not a system category
          if (field === 'budgetedAmount' && !cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
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
      { id: uuidv4(), name: "New Category", budgetedAmount: 0, subcategories: [], isSystemCategory: false },
    ]);
  };

  const handleDeleteCategory = (id: string) => {
    const catToDelete = editableCategories.find(cat => cat.id === id);
    if (catToDelete?.isSystemCategory) {
      toast({ title: "Action Denied", description: `The '${catToDelete.name}' category is a system category and cannot be deleted.`, variant: "destructive" });
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
        };
        // Ensure parent's budgetedAmount is not directly editable now
        return { ...cat, subcategories: [...(cat.subcategories || []), newSub] };
      }
      return cat;
    }));
  };

  const handleSubCategoryChange = (parentCategoryId: string, subId: string, field: keyof Omit<SubCategory, 'id' | 'expenses'>, value: string | number) => {
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
    
    const finalCategoriesToSave: BudgetCategory[] = editableCategories
        .filter(cat => cat.name.trim() !== "") // Filter out categories with empty names
        .map(cat => {
            // For system categories, or categories without subcategories, use their direct budgetedAmount.
            // For non-system categories with subcategories, their effective budget is the sum of subcategories,
            // but we still store the parent's own 'budgetedAmount' field (which might be 0 or an old value if subs were added).
            // The display logic in CategoryCard handles showing the derived sum.
            
            let catBudget = cat.budgetedAmount;
            // System categories manage their own budget; don't derive from subs even if somehow present
            // Non-system categories with subcategories: their parent budgetedAmount is for display/reference, not direct input here.
            // The actual budgeting happens at the subcategory level.

            return {
                id: cat.id,
                name: cat.name,
                budgetedAmount: catBudget,
                expenses: cat.expenses || [], // Preserve existing expenses
                isSystemCategory: cat.isSystemCategory || false,
                subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || [])
                    .filter(sub => sub.name.trim() !== "") // Filter out subcategories with empty names
                    .map(sub => ({
                        id: sub.id,
                        name: sub.name,
                        budgetedAmount: parseFloat(String(sub.budgetedAmount)) || 0,
                        expenses: sub.expenses || [], // Preserve existing sub-category expenses
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
    onCloseModal();
  };

  const onCloseModal = () => {
    resetModalState();
    onClose();
  };

  const handleAiSetupImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAiSetupImageFile(file);
      setAiBudgetError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAiSetupImagePreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    // event.target.value = ''; // Don't clear here, allow retry if needed
  };

  const handleClearAiSetupImage = () => {
    setAiSetupImageFile(null);
    setAiSetupImagePreviewUrl(null);
    setAiBudgetError(null);
    if (aiSetupFileInputRef.current) {
      aiSetupFileInputRef.current.value = "";
    }
  };

  const handleAiBudgetSetup = async () => {
    if (!aiSetupImageFile) {
      setAiBudgetError("Please select an image file first.");
      return;
    }
    setIsAiBudgetProcessing(true);
    setAiBudgetError(null);

    const reader = new FileReader();
    reader.readAsDataURL(aiSetupImageFile);
    reader.onloadend = async () => {
      const imageDataUri = reader.result as string;
      try {
        const result: SetupBudgetOutput = await setupBudgetFromImage({ imageDataUri });
        if (result.aiError) {
          setAiBudgetError(result.aiError);
          toast({ title: "AI Budget Setup Error", description: result.aiError, variant: "destructive" });
        } else if (result.categories && result.categories.length > 0) {
          const newEditableCategories = result.categories.map(suggestedCat => {
            const newCat: EditableCategory = {
              id: uuidv4(),
              name: suggestedCat.name,
              // If AI provides parent budget and there are no subs, use it. Else default to 0. Parent budget derived if subs exist.
              budgetedAmount: (suggestedCat.subcategories && suggestedCat.subcategories.length > 0) ? 0 : (suggestedCat.budgetedAmount || 0),
              subcategories: (suggestedCat.subcategories || []).map(suggestedSub => ({
                id: uuidv4(),
                name: suggestedSub.name,
                budgetedAmount: suggestedSub.budgetedAmount || 0,
              })),
              isSystemCategory: false, // AI won't define system categories initially; ensureSystemCategoryFlags will handle if names match
            };
            return newCat;
          });
          
          // Preserve existing system categories, replace others
          const existingSystemCategories = editableCategories.filter(cat => cat.isSystemCategory);
          const allCategories = [...existingSystemCategories, ...newEditableCategories];
          
          // Ensure system category flags are correctly applied after AI setup
          const { updatedCategories } = ensureSystemCategoryFlags(allCategories.map(c => ({...c, expenses: c.expenses || [], subcategories: (c.subcategories || []).map(sc => ({...sc, expenses: sc.expenses || []})) } as BudgetCategory)));

          setEditableCategories(updatedCategories.map(c => ({
            id: c.id,
            name: c.name,
            budgetedAmount: c.budgetedAmount,
            subcategories: (c.subcategories || []).map(sc => ({ id: sc.id, name: sc.name, budgetedAmount: sc.budgetedAmount})),
            isSystemCategory: c.isSystemCategory,
            expenses: c.expenses, // Keep original expenses if any
          })));

          toast({ title: "AI Budget Applied", description: "Review the suggested budget structure and amounts.", action: <CheckCircle className="text-green-500"/> });
          handleClearAiSetupImage(); // Clear image after successful processing
        } else {
          setAiBudgetError("AI did not return any budget suggestions from the image.");
        }
      } catch (error: any) {
        console.error("Error calling AI budget setup flow:", error);
        const message = error.message || "An unexpected error occurred with AI Budget Setup.";
        setAiBudgetError(message);
        toast({ title: "AI Error", description: message, variant: "destructive" });
      } finally {
        setIsAiBudgetProcessing(false);
      }
    };
    reader.onerror = () => {
        setAiBudgetError("Failed to read the image file.");
        setIsAiBudgetProcessing(false);
    };
  };


  if (!isOpen) { // Don't render anything if not open, or if data not loaded yet and it's open
    return null; 
  }
  if (!isDataLoaded && isOpen) {
     return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
            <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-semibold">Edit Budget for {monthId}</DialogTitle>
                </DialogHeader>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <p className="ml-4 text-muted-foreground">Loading budget data...</p>
                </div>
            </DialogContent>
        </Dialog>
     );
  }


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
      <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Edit Budget for {monthId}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
          <div className="space-y-6 pr-4">
            {/* AI Budget Setup Section */}
            <div className="p-4 border rounded-lg shadow-sm bg-card/30 space-y-3">
              <h3 className="text-md font-medium flex items-center"><Wand2 className="mr-2 h-5 w-5 text-primary/80" /> AI Budget Setup from Image</h3>
              <p className="text-xs text-muted-foreground">Upload an image of your current budget (e.g., notes, spreadsheet screenshot) and let AI suggest categories and amounts. This will replace existing non-system categories.</p>
              <div className="grid grid-cols-1 gap-2">
                <Input
                    id="ai-budget-upload"
                    type="file"
                    accept="image/*"
                    ref={aiSetupFileInputRef}
                    onChange={handleAiSetupImageChange}
                    className="text-sm"
                    disabled={isAiBudgetProcessing}
                />
                {aiSetupImagePreviewUrl && (
                    <div className="mt-2 space-y-2">
                        <div className="relative w-full aspect-video border rounded-md overflow-hidden bg-muted">
                            <Image src={aiSetupImagePreviewUrl} alt="Budget preview for AI" layout="fill" objectFit="contain" />
                        </div>
                        <Button variant="outline" size="sm" onClick={handleClearAiSetupImage} disabled={isAiBudgetProcessing} className="w-full">
                            <Trash2 className="mr-2 h-3 w-3" /> Clear Image
                        </Button>
                    </div>
                )}
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                         <Button 
                            type="button" 
                            disabled={!aiSetupImageFile || isAiBudgetProcessing}
                            className="w-full mt-1"
                        >
                            {isAiBudgetProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                            {isAiBudgetProcessing ? "Processing..." : "Apply AI Suggestions"}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Confirm AI Budget Setup</AlertDialogTitle>
                        <AlertDialogDescription>
                            Applying AI suggestions will replace your current user-defined categories and their budgets for this month. System categories like "Savings" or "Credit Card Payments" will be preserved or updated if suggested by AI. Are you sure you want to proceed?
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel disabled={isAiBudgetProcessing}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleAiBudgetSetup} disabled={isAiBudgetProcessing}>
                            {isAiBudgetProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Yes, Apply AI Budget
                        </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {aiBudgetError && (
                    <p className="text-xs text-destructive mt-1 flex items-center">
                        <ShieldAlert className="h-3 w-3 mr-1 shrink-0" /> {aiBudgetError}
                    </p>
                )}
              </div>
            </div>

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
            {editableCategories.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No categories defined yet. Add some below or use the AI setup.</p>
            )}
            {editableCategories.map(cat => {
              const isSystem = cat.isSystemCategory || false;
              const catNameLower = cat.name.toLowerCase();
              const isSavings = isSystem && catNameLower === 'savings';
              const isCCPayments = isSystem && catNameLower === 'credit card payments';
              const hasSubcategories = !isSystem && cat.subcategories && cat.subcategories.length > 0;
              
              let parentDisplayBudget = cat.budgetedAmount;
              if (hasSubcategories) {
                parentDisplayBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
              }

              return (
                <div key={cat.id} className="p-4 border rounded-lg shadow-sm space-y-3 bg-card/50">
                  <div className="grid grid-cols-1 gap-3 items-end">
                    <div>
                      <Label htmlFor={`categoryName-${cat.id}`}>Category Name</Label>
                       {isSystem ? (
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
                          if (!hasSubcategories || isSystem) { 
                            handleCategoryChange(cat.id, "budgetedAmount", e.target.value);
                          }
                        }}
                        readOnly={hasSubcategories && !isSystem} 
                        placeholder={String(parentDisplayBudget)}
                        className={`mt-1 text-sm ${(hasSubcategories && !isSystem) ? "bg-muted/50 cursor-default" : ""}`}
                      />
                       {hasSubcategories && !isSystem && <p className="text-xs text-muted-foreground mt-1">Parent budget is sum of subcategories.</p>}
                    </div>
                  </div>
                  
                  {!isSystem && ( 
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

                  {!isSystem && (
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteCategory(cat.id)} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 w-full sm:w-auto mt-3">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Category
                    </Button>
                  )}
                   {isSystem && (
                     <div className="flex items-center text-xs text-muted-foreground mt-2 p-2 bg-muted/30 rounded-md">
                       <ShieldAlert className="h-3 w-3 mr-1 shrink-0" /> 
                       <span>This is a system category. Its name is fixed, and it cannot be deleted or have subcategories.
                       {isSavings && " Set your planned savings contribution above."}
                       {isCCPayments && " Set your planned payment amount above."}
                       </span>
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
            <Button variant="outline" onClick={onCloseModal}>
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
