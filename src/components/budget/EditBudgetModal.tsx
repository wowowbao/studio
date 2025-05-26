
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

  const [aiSetupFile, setAiSetupFile] = useState<File | null>(null);
  const [aiSetupFilePreviewUrl, setAiSetupFilePreviewUrl] = useState<string | null>(null); // For image previews
  const [aiSetupFileDataUri, setAiSetupFileDataUri] = useState<string | null>(null); // For sending to AI
  const [isAiBudgetProcessing, setIsAiBudgetProcessing] = useState<boolean>(false);
  const [aiBudgetError, setAiBudgetError] = useState<string | null>(null);
  const aiSetupFileInputRef = useRef<HTMLInputElement>(null);


  const resetModalState = useCallback(() => {
    setEditableCategories([]);
    setStartingDebt(0);
    setIsDataLoaded(false);
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
    if (!isLoading && monthId) {
      const budgetData = (currentBudgetMonth && currentBudgetMonth.id === monthId) ? currentBudgetMonth : getBudgetForMonth(monthId);
      
      if (budgetData) {
        const currentStartingDebt = budgetData.startingCreditCardDebt || 0;
        const { updatedCategories } = ensureSystemCategoryFlags(budgetData.categories);
        setEditableCategories(updatedCategories.map(c => ({
            ...c,
            id: c.id, 
            budgetedAmount: c.budgetedAmount,
            subcategories: (c.subcategories || []).map(sc => ({ ...sc, id: sc.id, expenses: sc.expenses || [] })),
            expenses: c.expenses || [],
            isSystemCategory: c.isSystemCategory || false,
        })));
        setStartingDebt(currentStartingDebt);
      } else {
        const { updatedCategories } = ensureSystemCategoryFlags([]);
        setEditableCategories(updatedCategories); 
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
          if (cat.isSystemCategory && field === 'name') { 
            return cat; 
          }
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
            if (!cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0) {
                catBudget = cat.subcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0);
            }

            return {
                id: cat.id,
                name: cat.name,
                budgetedAmount: catBudget,
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
    
    const { updatedCategories } = ensureSystemCategoryFlags(finalCategoriesToSave);

    updateMonthBudget(monthId, { 
      categories: updatedCategories, 
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
          setAiSetupFilePreviewUrl(null); // No visual preview for PDF, just filename
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
            const newCat: EditableCategory = {
              id: uuidv4(),
              name: suggestedCat.name,
              budgetedAmount: (suggestedCat.subcategories && suggestedCat.subcategories.length > 0) ? 0 : (suggestedCat.budgetedAmount || 0),
              subcategories: (suggestedCat.subcategories || []).map(suggestedSub => ({
                id: uuidv4(),
                name: suggestedSub.name,
                budgetedAmount: suggestedSub.budgetedAmount || 0,
              })),
              isSystemCategory: false, // Will be overridden by ensureSystemCategoryFlags if name matches
            };
            return newCat;
        });
        
        // Preserve existing system categories, merge/replace others
        let currentSystemCategories = editableCategories.filter(c => c.isSystemCategory);
        let finalCategories = [...currentSystemCategories];

        newAiCategories.forEach(aiCat => {
            // Check if this AI category should be a system category by name
            const isAiSystemCatName = ["savings", "credit card payments"].includes(aiCat.name.toLowerCase());
            
            if (isAiSystemCatName) {
                const existingSystemCatIndex = finalCategories.findIndex(fc => fc.name.toLowerCase() === aiCat.name.toLowerCase());
                if (existingSystemCatIndex !== -1) {
                    // Update existing system category's budget
                    finalCategories[existingSystemCatIndex].budgetedAmount = aiCat.budgetedAmount;
                } else {
                    // Add AI-suggested system category
                    finalCategories.push({...aiCat, isSystemCategory: true});
                }
            } else {
                // It's a non-system category from AI, add it.
                finalCategories.push(aiCat);
            }
        });

        // Remove duplicates by ID (preferring AI suggested if ID collision, unlikely with UUIDs)
        finalCategories = finalCategories.filter((cat, index, self) =>
            index === self.findIndex((c) => c.id === cat.id)
        );
        
        // Ensure flags and names are correct after merge
        const { updatedCategories: finalProcessedCategories } = ensureSystemCategoryFlags(finalCategories.map(c => ({...c, expenses: c.expenses || [], subcategories: (c.subcategories || []).map(sc => ({...sc, expenses: sc.expenses || []})) } as BudgetCategory)));

        setEditableCategories(finalProcessedCategories.map(c => ({
          id: c.id,
          name: c.name,
          budgetedAmount: c.budgetedAmount,
          subcategories: (c.subcategories || []).map(sc => ({ id: sc.id, name: sc.name, budgetedAmount: sc.budgetedAmount, expenses: sc.expenses || [] })),
          isSystemCategory: c.isSystemCategory,
          expenses: c.expenses || [], 
        })));

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


  if (!isOpen) { 
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
              <h3 className="text-md font-medium flex items-center"><Wand2 className="mr-2 h-5 w-5 text-primary/80" /> AI Budget Setup from File</h3>
              <p className="text-xs text-muted-foreground">Upload an image or PDF of your current budget and let AI suggest categories and amounts. This will replace existing non-system categories and update system categories if suggested.</p>
              
              <Input
                  id="ai-budget-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  ref={aiSetupFileInputRef}
                  onChange={handleAiSetupFileChange}
                  className="hidden" // Hidden, triggered by button
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
                          if (!hasSubcategories || isSystem) { 
                            handleCategoryChange(cat.id, "budgetedAmount", e.target.value);
                          }
                        }}
                        readOnly={(hasSubcategories && !isSystem) || (isSystem && cat.name === "Credit Card Payments" && !cat.budgetedAmount)}
                        placeholder="0.00"
                        className={`mt-1 text-sm ${(hasSubcategories && !isSystem) ? "bg-muted/50 cursor-default" : ""}`}
                      />
                       {hasSubcategories && !isSystem && <p className="text-xs text-muted-foreground mt-1">Parent budget is sum of subcategories.</p>}
                       {cat.budgetedAmount === 0 && (!hasSubcategories || isSystem) && !isSystem && <p className="text-xs text-muted-foreground mt-1">Enter 0 if no budget for this category.</p>}
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

// Helper function (can be outside the component or in a utils file if preferred)
const ensureSystemCategoryFlags = (categories: BudgetCategory[]): { updatedCategories: BudgetCategory[], wasChanged: boolean } => {
  let newCategories = categories ? JSON.parse(JSON.stringify(categories)) : [];
  let wasActuallyChanged = false;

  const systemCategoryNames = ["Savings", "Credit Card Payments"];

  // First, ensure system categories, if present by name, are correctly flagged and named
  newCategories.forEach((cat: BudgetCategory) => {
    const catNameLower = cat.name.toLowerCase();
    if (catNameLower === "savings") {
      if (!cat.isSystemCategory || cat.name !== "Savings" || (cat.subcategories && cat.subcategories.length > 0)) {
        cat.isSystemCategory = true;
        cat.name = "Savings";
        cat.subcategories = [];
        wasActuallyChanged = true;
      }
    } else if (catNameLower === "credit card payments") {
      if (!cat.isSystemCategory || cat.name !== "Credit Card Payments" || (cat.subcategories && cat.subcategories.length > 0)) {
        cat.isSystemCategory = true;
        cat.name = "Credit Card Payments";
        cat.subcategories = [];
        wasActuallyChanged = true;
      }
    } else {
      // Ensure non-system categories don't have the flag
      if (cat.isSystemCategory) {
        cat.isSystemCategory = false;
        wasActuallyChanged = true;
      }
    }
  });
  return { updatedCategories: newCategories, wasChanged: wasActuallyChanged };
};
