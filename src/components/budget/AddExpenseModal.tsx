
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetCategory, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Calendar as CalendarIcon, UploadCloud, FileImage, Trash2, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import Image from 'next/image';
import { categorizeExpenseFromImage, type CategorizeExpenseInput, type CategorizeExpenseOutput } from '@/ai/flows/categorize-expense-flow';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

interface CategoryOption {
  value: string; // ID of category or subcategory
  label: string; // Display name
  isSubcategory: boolean;
  parentCategoryId?: string;
}

export function AddExpenseModal({ isOpen, onClose, monthId }: AddExpenseModalProps) {
  const { getBudgetForMonth, addExpense, isLoading: budgetLoading } = useBudget();
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [isTargetSubcategory, setIsTargetSubcategory] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const { toast } = useToast();

  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [aiSuggestionError, setAiSuggestionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetFormFields = () => {
    setSelectedTargetId("");
    setIsTargetSubcategory(false);
    setAmount("");
    setDescription("");
    setDate(new Date());
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageDataUri(null);
    setAiSuggestionError(null);
    setIsAiProcessing(false);
  };
  
  useEffect(() => {
    if (isOpen && monthId && !budgetLoading) {
      resetFormFields(); // Reset all fields when modal opens

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
        // Don't auto-select first, let user or AI choose
        // setSelectedTargetId(options[0].value);
        // setIsTargetSubcategory(options[0].isSubcategory);
      }
    }
  }, [isOpen, monthId, getBudgetForMonth, budgetLoading]);


  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedImageFile(file);
      setAiSuggestionError(null); // Clear previous AI errors
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviewUrl(reader.result as string);
        setImageDataUri(reader.result as string); // Save Data URI
      };
      reader.readAsDataURL(file);
    }
    event.target.value = ''; // Reset file input
  };

  const handleClearImage = () => {
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageDataUri(null);
    setAiSuggestionError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ""; // Clear the actual file input
    }
  };

  const handleAiCategorize = async () => {
    if (!imageDataUri || categoryOptions.length === 0) {
      setAiSuggestionError("Please select an image and ensure categories are loaded.");
      return;
    }
    setIsAiProcessing(true);
    setAiSuggestionError(null);

    const aiInputCategories = categoryOptions.map(opt => ({ id: opt.value, name: opt.label }));

    try {
      const result: CategorizeExpenseOutput = await categorizeExpenseFromImage({
        imageDataUri,
        availableCategories: aiInputCategories,
      });

      if (result.aiError) {
        setAiSuggestionError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        if (result.suggestedCategoryId) {
          const foundOption = categoryOptions.find(opt => opt.value === result.suggestedCategoryId);
          if (foundOption) {
            setSelectedTargetId(foundOption.value);
            setIsTargetSubcategory(foundOption.isSubcategory);
          } else {
             setAiSuggestionError(`AI suggested category ID '${result.suggestedCategoryId}' not found.`);
          }
        }
        if (result.suggestedAmount !== undefined) {
          setAmount(result.suggestedAmount.toFixed(2));
        }
        if (result.suggestedDescription) {
          setDescription(result.suggestedDescription);
        }
        toast({ title: "AI Suggestions Applied", description: "Review and confirm the expense details.", action: <CheckCircle className="text-green-500"/> });
      }
    } catch (error: any) {
      console.error("Error calling AI flow:", error);
      const message = error.message || "An unexpected error occurred while getting AI suggestions.";
      setAiSuggestionError(message);
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsAiProcessing(false);
    }
  };
  
  useEffect(() => {
    // Automatically trigger AI categorization if an image data URI is set and category options are loaded
    // This effect runs when imageDataUri or categoryOptions change
    if (imageDataUri && categoryOptions.length > 0 && isOpen) { // Only if modal is open
      handleAiCategorize();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUri]); // Trigger only when imageDataUri is set/changed. categoryOptions are set once on open usually.

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
    onCloseModal();
  };
  
  const onCloseModal = () => {
    resetFormFields();
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Add Expense for {monthId}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
           {/* Image Upload Section */}
           <div className="space-y-2">
            <Label htmlFor="receipt-upload">Receipt Image (Optional)</Label>
            <div className="flex items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAiProcessing}
                >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Upload Image
                </Button>
                <Input
                    id="receipt-upload"
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageFileChange}
                    className="hidden"
                    disabled={isAiProcessing}
                />
                {selectedImageFile && (
                     <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleClearImage}
                        disabled={isAiProcessing}
                        aria-label="Clear image"
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                )}
            </div>

            {imagePreviewUrl && (
                <div className="mt-2 relative w-full aspect-video border rounded-md overflow-hidden">
                    <Image src={imagePreviewUrl} alt="Receipt preview" layout="fill" objectFit="contain" />
                </div>
            )}
             {isAiProcessing && (
              <div className="flex items-center text-sm text-muted-foreground mt-2">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                AI is analyzing your receipt...
              </div>
            )}
            {aiSuggestionError && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4"/>
                <AlertTitle>AI Suggestion Error</AlertTitle>
                <AlertDescription>{aiSuggestionError}</AlertDescription>
              </Alert>
            )}
          </div>


          {/* Form Fields */}
          {budgetLoading ? (
            <p>Loading categories...</p>
          ) : categoryOptions.length === 0 ? (
            <p className="text-muted-foreground py-4">No categories or subcategories available for this month. Please add them first in 'Edit Budget'.</p>
          ) : (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="category" className="text-right col-span-1">
                  Category
                </Label>
                <Select value={selectedTargetId} onValueChange={handleSelectionChange} disabled={isAiProcessing}>
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
                  disabled={isAiProcessing}
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
                  disabled={isAiProcessing}
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
                      disabled={isAiProcessing}
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
            </>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" onClick={onCloseModal} disabled={isAiProcessing}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={budgetLoading || categoryOptions.length === 0 || isAiProcessing}>
            {isAiProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            {isAiProcessing ? "Processing..." : "Add Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helper to import AlertTriangle if not already available
const AlertTriangle = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn("lucide lucide-alert-triangle", className)}
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);
