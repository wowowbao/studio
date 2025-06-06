
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTrigger, AlertDialogTitle, AlertDialogFooter } from "@/components/ui/alert-dialog";
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
    isLoading: isLoadingBudgetHook,
  } = useBudget();

  const [editableCategories, setEditableCategories] = useState<EditableCategory[]>([]);
  const [startingDebt, setStartingDebt] = useState<number>(0);
  const { toast } = useToast();

  const [aiSetupFile, setAiSetupFile] = useState<File | null>(null);
  const [aiSetupFilePreviewUrl, setAiSetupFilePreviewUrl] = useState<string | null>(null);
  const [aiSetupFileDataUri, setAiSetupFileDataUri] = useState<string | null>(null);
  const [isAiBudgetProcessing, setIsAiBudgetProcessing] = useState<boolean>(false);
  const [aiBudgetError, setAiBudgetError] = useState<string | null>(null);
  const aiSetupFileInputRef = useRef<HTMLInputElement>(null);
  
  // This ref tracks if data has been initialized for the current open instance of the modal
  const initialLoadPerformedForThisOpen = useRef(false);


  const onCloseModal = useCallback(() => {
    // Don't reset editableCategories and startingDebt here,
    // let the useEffect handle re-initialization based on isOpen.
    setAiSetupFile(null);
    setAiSetupFilePreviewUrl(null);
    setAiSetupFileDataUri(null);
    setIsAiBudgetProcessing(false);
    setAiBudgetError(null);
    if (aiSetupFileInputRef.current) {
      aiSetupFileInputRef.current.value = "";
    }
    initialLoadPerformedForThisOpen.current = false; // CRITICAL: Reset for next open
    onClose();
  }, [onClose]);

  useEffect(() => {
    // This effect runs when the modal opens or its key dependencies change.
    // Its main job is to load initial data ONCE PER MODAL OPENING if data is not stale.
    if (isOpen && monthId && !isLoadingBudgetHook) {
      if (!initialLoadPerformedForThisOpen.current) {
        // console.log(`EditBudgetModal: Initializing data for ${monthId}`);
        const budgetDataForMonth = getBudgetForMonth(monthId);
        const clonedCategories: EditableCategory[] = budgetDataForMonth?.categories
          ? JSON.parse(JSON.stringify(budgetDataForMonth.categories)).map((c: BudgetCategory) => ({
              id: c.id || uuidv4(),
              name: c.name,
              budgetedAmount: c.budgetedAmount === undefined || c.budgetedAmount === null ? 0 : Number(c.budgetedAmount),
              expenses: c.expenses || [],
              subcategories: (c.subcategories || []).map((sc: SubCategory) => ({
                id: sc.id || uuidv4(),
                name: sc.name,
                budgetedAmount: sc.budgetedAmount === undefined || sc.budgetedAmount === null ? 0 : Number(sc.budgetedAmount),
                expenses: sc.expenses || [],
              })),
              isSystemCategory: c.isSystemCategory || false,
            }))
          : [];
        
        setEditableCategories(clonedCategories);
        setStartingDebt(budgetDataForMonth?.startingCreditCardDebt || 0);

        // Reset AI fields only on initial open
        setAiSetupFile(null);
        setAiSetupFilePreviewUrl(null);
        setAiSetupFileDataUri(null);
        setAiBudgetError(null);
        if (aiSetupFileInputRef.current) {
          aiSetupFileInputRef.current.value = "";
        }
        initialLoadPerformedForThisOpen.current = true;
      }
    }
    // The ref is reset by onCloseModal when the modal closes.
  }, [isOpen, monthId, getBudgetForMonth, isLoadingBudgetHook]);


  const handleCategoryChange = (id: string, field: keyof EditableCategory , value: string | number) => {
    setEditableCategories(prev =>
      prev.map(cat => {
        if (cat.id === id) {
          if (cat.isSystemCategory && field === 'name') {
            return cat;
          }
          const isNonSystemWithSubs = !cat.isSystemCategory && cat.subcategories && cat.subcategories.length > 0;
          if (field === 'budgetedAmount' && isNonSystemWithSubs) {
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
        const currentSubcategories = cat.subcategories || [];
        const updatedSubcategories = [...currentSubcategories, newSub];
        const updatedParentBudget = !cat.isSystemCategory 
            ? updatedSubcategories.reduce((sum, sub) => sum + (Number(sub.budgetedAmount) || 0), 0)
            : cat.budgetedAmount; // System cat budget is not sum of subs
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: updatedParentBudget };
      }
      return cat;
    }));
  };

  const handleSubCategoryChange = (parentCategoryId: string, subId: string, field: keyof Omit<SubCategory, 'id' | 'expenses'>, value: string | number) => {
    setEditableCategories(prev => prev.map(cat => {
      if (cat.id === parentCategoryId) {
        const newSubcategories = (cat.subcategories || []).map(sub =>
            sub.id === subId ? { ...sub, [field]: typeof value === 'string' && field !== 'name' ? parseFloat(value) || 0 : value } : sub
          );
        const newParentBudget = !cat.isSystemCategory 
          ? newSubcategories.reduce((sum, subCat) => sum + (Number(subCat.budgetedAmount) || 0), 0)
          : cat.budgetedAmount; // System categories don't derive budget from subs

        return {
          ...cat,
          subcategories: newSubcategories,
          budgetedAmount: newParentBudget 
        };
      }
      return cat;
    }));
  };

  const handleDeleteSubCategory = (parentCategoryId: string, subId: string) => {
    setEditableCategories(prev => prev.map(cat => {
      if (cat.id === parentCategoryId) {
        const updatedSubcategories = (cat.subcategories || []).filter(sub => sub.id !== subId);
        const newParentBudget = !cat.isSystemCategory 
          ? updatedSubcategories.reduce((sum, subCat) => sum + (Number(subCat.budgetedAmount) || 0), 0)
          : cat.budgetedAmount; // System categories don't derive budget from subs
        return { ...cat, subcategories: updatedSubcategories, budgetedAmount: newParentBudget };
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
                budgetedAmount: catBudget === undefined || catBudget === null ? 0 : parseFloat(String(catBudget)),
                expenses: cat.expenses || [], // Preserve existing expenses
                isSystemCategory: cat.isSystemCategory || false,
                subcategories: (cat.isSystemCategory) ? [] : (cat.subcategories || [])
                    .filter(sub => sub.name.trim() !== "")
                    .map(sub => ({
                        id: sub.id,
                        name: sub.name,
                        budgetedAmount: parseFloat(String(sub.budgetedAmount)) || 0,
                        expenses: sub.expenses || [], // Preserve existing sub-expenses
                    })),
            };
        });

    updateMonthBudget(monthId, {
      categories: finalCategoriesToSave,
      startingCreditCardDebt: startingDebt,
    });
    toast({
      title: "Budget Updated",
      description: `Budget for ${getFormattedMonthTitle(monthId)} has been saved.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onCloseModal();
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
     if (event.target) { 
      event.target.value = "";
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

        let aiSuggestedCategoriesAsUserCategories: EditableCategory[] = result.categories.map(suggestedCat => {
            const subcategories = (suggestedCat.subcategories || []).map(suggestedSub => ({
                id: uuidv4(),
                name: suggestedSub.name,
                budgetedAmount: suggestedSub.budgetedAmount === undefined || suggestedSub.budgetedAmount === null ? 0 : Number(suggestedSub.budgetedAmount),
                expenses: [],
            }));

            let finalBudgetedAmount = suggestedCat.budgetedAmount === undefined || suggestedCat.budgetedAmount === null ? 0 : Number(suggestedCat.budgetedAmount);
            // For non-system cats suggested by AI, if they have subs, parent budget is sum of subs
            if (subcategories.length > 0 && !["Savings", "Credit Card Payments", "Car Loan"].includes(suggestedCat.name)) { 
                finalBudgetedAmount = subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
            }

            return {
              id: uuidv4(), 
              name: suggestedCat.name,
              budgetedAmount: finalBudgetedAmount,
              subcategories: subcategories,
              isSystemCategory: false, // Initially mark all AI suggestions as non-system
              expenses: [],
            };
        });
        
        const existingSystemCategories = editableCategories.filter(c => c.isSystemCategory);
        const finalCategories: EditableCategory[] = [];
        const systemCategoryNames = ["Savings", "Credit Card Payments", "Car Loan"];

        systemCategoryNames.forEach(sysName => {
            const existingSysCat = existingSystemCategories.find(c => c.name === sysName); // Exact match now
            let aiSuggestedThisSysCat = null;
            let aiSuggestedThisSysCatIndex = -1;

            for(let i=0; i < aiSuggestedCategoriesAsUserCategories.length; i++) {
                if(aiSuggestedCategoriesAsUserCategories[i].name.toLowerCase() === sysName.toLowerCase()) {
                    aiSuggestedThisSysCat = aiSuggestedCategoriesAsUserCategories[i];
                    aiSuggestedThisSysCatIndex = i;
                    break;
                }
            }

            if (existingSysCat) {
                let updatedBudget = existingSysCat.budgetedAmount;
                if (aiSuggestedThisSysCat) { 
                    updatedBudget = aiSuggestedThisSysCat.budgetedAmount; // Use AI's budget for system cat
                }
                finalCategories.push({
                    ...existingSysCat, 
                    budgetedAmount: updatedBudget,
                });
                if (aiSuggestedThisSysCatIndex !== -1) {
                    aiSuggestedCategoriesAsUserCategories.splice(aiSuggestedThisSysCatIndex, 1);
                }
            } else if (aiSuggestedThisSysCat) {
                 finalCategories.push({
                    id: aiSuggestedThisSysCat.id, 
                    name: sysName, 
                    budgetedAmount: aiSuggestedThisSysCat.budgetedAmount, 
                    isSystemCategory: true,
                    subcategories: [], 
                    expenses: [],
                });
                if (aiSuggestedThisSysCatIndex !== -1) {
                   aiSuggestedCategoriesAsUserCategories.splice(aiSuggestedThisSysCatIndex, 1);
                }
            }
        });
        
        const newEditableCategories = [
            ...finalCategories, 
            ...aiSuggestedCategoriesAsUserCategories 
        ];

        setEditableCategories(newEditableCategories);
        toast({ title: "AI Budget Applied", description: "Review the suggested budget. System categories have been preserved or updated if suggested by name.", action: <CheckCircle className="text-green-500"/>, duration: 7000 });
        handleClearAiSetupFile();
      } else {
        setAiBudgetError("AI did not return any budget suggestions from the file.");
        toast({ title: "AI Suggestion", description: "AI found no budget items in the file.", variant: "default" });
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

  const getFormattedMonthTitle = (monthIdToFormat: string) => {
    if (!monthIdToFormat) return "";
    const dateObj = parseYearMonth(monthIdToFormat);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };


  if (!isOpen) {
    return null;
  }
  
  const isModalContentLoading = isLoadingBudgetHook && !initialLoadPerformedForThisOpen.current;


  if (isModalContentLoading) {
     return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
            <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-semibold">Manage Budget for {getFormattedMonthTitle(monthId)}</DialogTitle>
                </DialogHeader>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                    <p className="ml-4 text-muted-foreground">Loading budget data...</p>
                </div>
                 <DialogFooter>
                    <DialogClose asChild>
                        <Button variant="outline" onClick={onCloseModal}>
                        <XCircle className="mr-2 h-4 w-4" /> Close
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
     );
  }


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
      <DialogContent className="max-w-md sm:max-w-lg md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Manage Budget for {getFormattedMonthTitle(monthId)}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] p-1">
          <div className="space-y-6 pr-4">
            <div className="p-4 border rounded-lg shadow-sm bg-card/30 space-y-3">
              <h3 className="text-md font-medium flex items-center"><Wand2 className="mr-2 h-5 w-5 text-primary/80" /> AI Budget Setup from File</h3>
              <p className="text-xs text-muted-foreground">Upload an image or PDF of your current budget. AI will suggest categories and amounts. This will replace your current non-system categories. System categories ("Savings", "Credit Card Payments", "Car Loan") will be updated if suggested by AI, or preserved.</p>

              <Button
                type="button"
                variant="outline"
                onClick={() => aiSetupFileInputRef.current?.click()}
                disabled={isAiBudgetProcessing}
                className="w-full"
              >
                <UploadCloud className="mr-2 h-4 w-4" /> Select Budget File (Image or PDF)
              </Button>
              <Input
                  id="ai-budget-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  ref={aiSetupFileInputRef}
                  onChange={handleAiSetupFileChange}
                  className="hidden"
                  disabled={isAiBudgetProcessing}
              />


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
                          Applying AI suggestions will replace your current user-defined categories and their budgets for this month. System categories like "Savings", "Credit Card Payments", and "Car Loan" will be updated if suggested by AI, or preserved if not mentioned by the AI. Are you sure you want to proceed?
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
                         isSystem && cat.name === "Car Loan" ? "Planned Car Loan Payment" :
                         hasSubcategories ? "Total Subcategory Budget (Read-only)" :
                         "Category Budgeted Amount"}
                      </Label>
                      <Input
                        id={`categoryBudget-${cat.id}`}
                        type="number"
                        value={cat.budgetedAmount} // Direct binding
                        onChange={(e) => {
                            if (isSystem || !hasSubcategories) { 
                                handleCategoryChange(cat.id, "budgetedAmount", e.target.value);
                            }
                        }}
                        readOnly={hasSubcategories && !isSystem} 
                        placeholder="0.00"
                        className={`mt-1 text-sm ${(hasSubcategories && !isSystem) ? "bg-muted/50 cursor-default" : ""}`}
                      />
                       {hasSubcategories && !isSystem && <p className="text-xs text-muted-foreground mt-1">Parent budget is sum of subcategories.</p>}
                       {((cat.budgetedAmount === 0 || cat.budgetedAmount === undefined) && (!hasSubcategories || isSystem) && !(isSystem && cat.name === "Credit Card Payments")  && !(isSystem && cat.name === "Car Loan")) && <p className="text-xs text-muted-foreground mt-1">Enter 0 if no budget for this category.</p>}
                       {(isSystem && cat.name === "Credit Card Payments" && (cat.budgetedAmount === 0 || cat.budgetedAmount === undefined)) && <p className="text-xs text-muted-foreground mt-1">Set your planned payment. Start of month debt: ${startingDebt.toFixed(2)}.</p>}
                       {(isSystem && cat.name === "Car Loan" && (cat.budgetedAmount === 0 || cat.budgetedAmount === undefined)) && <p className="text-xs text-muted-foreground mt-1">Set your planned car loan payment.</p>}
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
                                    value={sub.budgetedAmount} // Direct binding
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
                        {cat.name === "Car Loan" && " Set your planned car loan payment above."}
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
