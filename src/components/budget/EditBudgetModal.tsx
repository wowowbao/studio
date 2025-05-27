
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type { BudgetCategory, BudgetMonth, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, PlusCircle, CheckCircle, XCircle, MinusCircle, CornerDownRight, ShieldAlert, Wand2, Loader2, FileText, UploadCloud } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { v4 as uuidv4 } from 'uuid';
import { setupBudgetFromImage, type SetupBudgetInput, type SetupBudgetOutput } from '@/ai/flows/setup-budget-flow';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import Image from "next/image";
import { parseYearMonth } from "@/hooks/useBudgetCore";


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
    currentBudgetMonth: budgetContextCurrentMonth, // Renamed to avoid conflict with local currentBudgetMonth if needed
  } = useBudget();

  const [editableCategories, setEditableCategories] = useState<EditableCategory[]>([]);
  const [startingDebt, setStartingDebt] = useState<number>(0);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const { toast } = useToast();

  const [aiSetupFile, setAiSetupFile] = useState<File | null>(null);
  const [aiSetupFilePreviewUrl, setAiSetupFilePreviewUrl] = useState<string | null>(null); 
  const [aiSetupFileDataUri, setAiSetupFileDataUri] = useState<string | null>(null); 
  const [isAiBudgetProcessing, setIsAiBudgetProcessing] = useState<boolean>(false);
  const [aiBudgetError, setAiBudgetError] = useState<string | null>(null);
  const aiSetupFileInputRef = useRef<HTMLInputElement>(null);


  const resetModalState = useCallback(() => {
    setEditableCategories([]);
    setStartingDebt(0);
    setIsDataLoaded(false); // Will be set to true after data is loaded
    setAiSetupFile(null);
    setAiSetupFilePreviewUrl(null);
    setAiSetupFileDataUri(null);
    setIsAiBudgetProcessing(false);
    setAiBudgetError(null);
    if (aiSetupFileInputRef.current) {
      aiSetupFileInputRef.current.value = "";
    }
  }, []);

  const loadBudgetData = useCallback(() => {
    if (!isLoading && monthId) { // isLoading is from useBudget() context
      const budgetData = getBudgetForMonth(monthId);

      if (budgetData) {
        const currentStartingDebt = budgetData.startingCreditCardDebt || 0;
        // Deep clone categories to prevent direct mutation of context state
        const clonedCategories = JSON.parse(JSON.stringify(budgetData.categories || []));
        
        setEditableCategories(clonedCategories.map((c: BudgetCategory) => ({
            ...c,
            id: c.id || uuidv4(), // Ensure ID exists
            budgetedAmount: c.budgetedAmount,
            subcategories: (c.subcategories || []).map(sc => ({ ...sc, id: sc.id || uuidv4(), expenses: sc.expenses || [] })),
            expenses: c.expenses || [],
            isSystemCategory: c.isSystemCategory || false,
        })));
        setStartingDebt(currentStartingDebt);
      } else {
        // If no budget data for the month, initialize with empty/default state
        setEditableCategories([]);
        setStartingDebt(0);
      }
      setIsDataLoaded(true);
    } else if (isLoading) {
      setIsDataLoaded(false); // Still loading from context
    }
  }, [monthId, getBudgetForMonth, isLoading]);

  useEffect(() => {
    if (isOpen) {
      resetModalState(); // Reset first
      loadBudgetData();   // Then load data
    }
  }, [isOpen, monthId, loadBudgetData, resetModalState]); // Added monthId to ensure reload if monthId prop changes while open (though unlikely)


  const handleCategoryChange = (id: string, field: keyof EditableCategory , value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => {
        if (cat.id === id) {
          if (cat.isSystemCategory && field === 'name') {
            return cat; // Prevent renaming system categories
          }
          // For non-system categories with subcategories, the parent budget is derived, so don't allow direct edit here.
          // System categories or non-system categories without subcategories can have their budget directly edited.
          const isNonSystemWithSubs = !cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0;
          if (field === 'budgetedAmount' && isNonSystemWithSubs) {
            return cat; // Parent budget is sum of subs, don't edit directly
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
      { id: uuidv4(), name: "New Category", budgetedAmount: 0, subcategories: [], isSystemCategory: false, expenses: [] },
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
          expenses: [],
        };
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
        .filter(cat => cat.name.trim() !== "")
        .map(cat => {
            let catBudget = cat.budgetedAmount;
            // If it's a non-system category and has subcategories, derive its budget from them
            if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
                catBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            }

            return {
                id: cat.id,
                name: cat.name,
                budgetedAmount: catBudget, // Use the derived or directly set budget
                expenses: cat.expenses || [],
                isSystemCategory: cat.isSystemCategory || false,
                subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || [])
                    .filter(sub => sub.name.trim() !== "")
                    .map(sub => ({
                        id: sub.id,
                        name: sub.name,
                        budgetedAmount: parseFloat(String(sub.budgetedAmount)) || 0,
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
      description: `Budget for ${getFormattedMonthTitle()} has been saved.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onCloseModal();
  };

  const onCloseModal = () => {
    resetModalState(); // Ensure full reset on close
    onClose();
  };

  const handleAiSetupFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAiSetupFile(file);
      setAiBudgetError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAiSetupFileDataUri(reader.result as string);
        if (file.type.startsWith('image/')) {
          setAiSetupFilePreviewUrl(reader.result as string);
        } else {
          setAiSetupFilePreviewUrl(null); 
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearAiSetupFile = () => {
    setAiSetupFile(null);
    setAiSetupFilePreviewUrl(null);
    setAiSetupFileDataUri(null);
    setAiBudgetError(null);
    if (aiSetupFileInputRef.current) {
      aiSetupFileInputRef.current.value = "";
    }
  };

  const handleAiBudgetSetup = async () => {
    if (!aiSetupFileDataUri) {
      setAiBudgetError("Please select an image or PDF file first.");
      return;
    }
    setIsAiBudgetProcessing(true);
    setAiBudgetError(null);

    try {
      const result: SetupBudgetOutput = await setupBudgetFromImage({ imageDataUri: aiSetupFileDataUri });
      if (result.aiError) {
        setAiBudgetError(result.aiError);
        toast({ title: "AI Budget Setup Error", description: result.aiError, variant: "destructive" });
      } else if (result.categories && result.categories.length > 0) {

        const newAiCategories = result.categories.map(suggestedCat => {
            // Determine if this AI category is a system category by name
            const isSavingsByName = suggestedCat.name.toLowerCase() === "savings";
            const isCCPaymentsByName = suggestedCat.name.toLowerCase() === "credit card payments";
            const isSystemByName = isSavingsByName || isCCPaymentsByName;

            const subcategories = (suggestedCat.subcategories || []).map(suggestedSub => ({
                id: uuidv4(),
                name: suggestedSub.name,
                budgetedAmount: suggestedSub.budgetedAmount || 0,
                expenses: [],
            }));

            let finalBudgetedAmount = suggestedCat.budgetedAmount || 0;
            if (!isSystemByName && subcategories.length > 0) {
                finalBudgetedAmount = subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
            }
            
            return {
              id: uuidv4(),
              name: isSavingsByName ? "Savings" : isCCPaymentsByName ? "Credit Card Payments" : suggestedCat.name,
              budgetedAmount: finalBudgetedAmount,
              subcategories: isSystemByName ? [] : subcategories,
              isSystemCategory: isSystemByName,
              expenses: [],
            };
        });

        // Preserve existing system categories' IDs and expenses if AI suggests them by name, update their budgets
        let currentSystemCategories = editableCategories.filter(c => c.isSystemCategory).map(c => ({...c, expenses: c.expenses || []}));
        let userDefinedNonSystemCategories = newAiCategories.filter(aiCat => !aiCat.isSystemCategory);


        // Update or add system categories based on AI suggestions
        ["Savings", "Credit Card Payments"].forEach(sysName => {
            const aiSuggestedSysCat = newAiCategories.find(c => c.name === sysName);
            const existingSysCatIndex = currentSystemCategories.findIndex(c => c.name === sysName);

            if (aiSuggestedSysCat) { // AI suggested this system category
                if (existingSysCatIndex !== -1) { // System category already exists
                    currentSystemCategories[existingSysCatIndex].budgetedAmount = aiSuggestedSysCat.budgetedAmount;
                } else { // System category doesn't exist, add AI's version
                    currentSystemCategories.push(aiSuggestedSysCat);
                }
            } else if (existingSysCatIndex === -1) { // AI didn't suggest it, and it doesn't exist, create it with 0 budget
                 currentSystemCategories.push({ 
                    id: uuidv4(), 
                    name: sysName, 
                    budgetedAmount: 0, 
                    subcategories: [], 
                    isSystemCategory: true, 
                    expenses: []
                });
            }
            // If AI didn't suggest it but it exists, its budget is kept as is.
        });


        setEditableCategories([...currentSystemCategories, ...userDefinedNonSystemCategories]);
        toast({ title: "AI Budget Applied", description: "Review the suggested budget structure and amounts.", action: <CheckCircle className="text-green-500"/> });
        handleClearAiSetupFile();
      } else {
        setAiBudgetError("AI did not return any budget suggestions from the file.");
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

  const getFormattedMonthTitle = () => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  if (!isOpen) {
    return null;
  }
  if (!isDataLoaded && isOpen) { // Ensure we show loader if isOpen but data isn't loaded
     return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
            <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-semibold">Manage Budget for {getFormattedMonthTitle()}</DialogTitle>
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
          <DialogTitle className="text-2xl font-semibold">Manage Budget for {getFormattedMonthTitle()}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
          <div className="space-y-6 pr-4">
            {/* AI Budget Setup Section */}
            <div className="p-4 border rounded-lg shadow-sm bg-card/30 space-y-3">
              <h3 className="text-md font-medium flex items-center"><Wand2 className="mr-2 h-5 w-5 text-primary/80" /> AI Budget Setup from File</h3>
              <p className="text-xs text-muted-foreground">Upload an image or PDF of your current budget. AI will suggest categories and amounts, replacing existing non-system categories. System categories ("Savings", "Credit Card Payments") will be preserved or updated if suggested by AI.</p>

              <Input
                  id="ai-budget-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  ref={aiSetupFileInputRef}
                  onChange={handleAiSetupFileChange}
                  className="hidden" 
                  disabled={isAiBudgetProcessing}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => aiSetupFileInputRef.current?.click()}
                disabled={isAiBudgetProcessing}
                className="w-full"
              >
                <UploadCloud className="mr-2 h-4 w-4" /> Select Budget File (Image or PDF)
              </Button>

              {aiSetupFile && (
                  <div className="mt-3 space-y-2 p-3 border rounded-md bg-muted/50">
                      <div className="flex items-center space-x-2">
                        {aiSetupFile.type.startsWith('image/') && aiSetupFilePreviewUrl ? (
                            <div className="relative w-20 h-20 border rounded-md overflow-hidden bg-muted shrink-0">
                                <Image src={aiSetupFilePreviewUrl} alt="Budget preview" layout="fill" objectFit="contain" data-ai-hint="financial document"/>
                            </div>
                        ) : aiSetupFile.type === 'application/pdf' ? (
                            <FileText className="h-10 w-10 text-destructive shrink-0" />
                        ) : null}
                        <div className="flex-grow overflow-hidden">
                            <p className="text-sm font-medium truncate" title={aiSetupFile.name}>{aiSetupFile.name}</p>
                            <p className="text-xs text-muted-foreground">{(aiSetupFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleClearAiSetupFile} disabled={isAiBudgetProcessing} className="w-full mt-2">
                          <Trash2 className="mr-2 h-3 w-3" /> Clear Selection
                      </Button>
                  </div>
              )}

               <AlertDialog>
                  <AlertDialogTrigger asChild>
                       <Button
                          type="button"
                          disabled={!aiSetupFile || isAiBudgetProcessing}
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
                        {isSystem && cat.name === "Savings" ? "Planned Contribution to Savings" :
                         isSystem && cat.name === "Credit Card Payments" ? "Planned Payment" :
                         hasSubcategories ? "Total Subcategory Budget (Read-only)" :
                         "Category Budgeted Amount"}
                      </Label>
                      <Input
                        id={`categoryBudget-${cat.id}`}
                        type="number"
                        value={parentDisplayBudget.toFixed(2)}
                        onChange={(e) => {
                          if (!(hasSubcategories && !isSystem)) { // Editable if system or no subcategories
                            handleCategoryChange(cat.id, "budgetedAmount", e.target.value);
                          }
                        }}
                        readOnly={hasSubcategories && !isSystem}
                        placeholder="0.00"
                        className={`mt-1 text-sm ${(hasSubcategories && !isSystem) ? "bg-muted/50 cursor-default" : ""}`}
                      />
                       {hasSubcategories && !isSystem && <p className="text-xs text-muted-foreground mt-1">Parent budget is sum of subcategories.</p>}
                       {cat.budgetedAmount === 0 && (!hasSubcategories || isSystem) && <p className="text-xs text-muted-foreground mt-1">Enter 0 if no budget for this category.</p>}
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
                                    value={sub.budgetedAmount.toFixed(2)}
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
                       <span>
                        This is a system category ({cat.name}). Its name is fixed, it cannot be deleted, and it cannot have subcategories.
                        {cat.name === "Savings" && " Set your planned savings contribution above."}
                        {cat.name === "Credit Card Payments" && " Set your planned payment amount above."}
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
