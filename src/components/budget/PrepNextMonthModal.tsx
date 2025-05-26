
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetMonth } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, UploadCloud, FileText, Trash2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import Image from "next/image";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Separator } from "@/components/ui/separator";

interface PrepNextMonthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMonthData: BudgetMonth;
}

export function PrepNextMonthModal({ isOpen, onClose, currentMonthData }: PrepNextMonthModalProps) {
  const { applyAiGeneratedBudget, getBudgetForMonth, setCurrentDisplayMonthId } = useBudget();
  const { toast } = useToast();

  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [statementPreviewUrl, setStatementPreviewUrl] = useState<string | null>(null);
  const [statementDataUri, setStatementDataUri] = useState<string | null>(null);
  const [userGoals, setUserGoals] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiSuggestions, setAiSuggestions] = useState<PrepareBudgetOutput | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const statementFileInputRef = useRef<HTMLInputElement>(null);

  const [currentIncome, setCurrentIncome] = useState(0);
  const [currentActualSavings, setCurrentActualSavings] = useState(0);
  const [currentEstimatedDebt, setCurrentEstimatedDebt] = useState(0);


  useEffect(() => {
    if (isOpen && currentMonthData) {
      // Calculate current financial situation for display
      const totalIncome = currentMonthData.incomes.reduce((sum, inc) => sum + inc.amount, 0);
      setCurrentIncome(totalIncome);

      const savingsCat = currentMonthData.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
      const actualSavings = savingsCat?.expenses.reduce((sum, exp) => sum + exp.amount, 0) || 0;
      setCurrentActualSavings(actualSavings);
      
      const ccPaymentsCat = currentMonthData.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
      const paymentsMade = ccPaymentsCat?.expenses.reduce((sum, exp) => sum + exp.amount, 0) || 0;
      setCurrentEstimatedDebt(Math.max(0, (currentMonthData.startingCreditCardDebt || 0) - paymentsMade));

      // Reset form state
      setStatementFile(null);
      setStatementPreviewUrl(null);
      setStatementDataUri(null);
      setUserGoals("");
      setAiSuggestions(null);
      setAiError(null);
      setIsLoadingAi(false);
      if (statementFileInputRef.current) {
        statementFileInputRef.current.value = "";
      }
    }
  }, [isOpen, currentMonthData]);

  const handleStatementFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setStatementFile(file);
      setAiError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setStatementDataUri(reader.result as string);
        if (file.type.startsWith('image/')) {
          setStatementPreviewUrl(reader.result as string);
        } else {
          setStatementPreviewUrl(null);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearStatementFile = () => {
    setStatementFile(null);
    setStatementPreviewUrl(null);
    setStatementDataUri(null);
    setAiError(null);
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
  };

  const handleGetAiSuggestions = async () => {
    if (!userGoals.trim()) {
      setAiError("Please describe your financial goals for next month.");
      toast({ title: "Goals Required", description: "Please describe your financial goals.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);
    setAiSuggestions(null);

    const input: PrepareBudgetInput = {
      statementDataUri: statementDataUri || undefined,
      userGoals,
      currentMonthId: currentMonthData.id,
      currentIncome: currentIncome,
      currentSavingsTotal: currentActualSavings, // This is actual accumulated savings, might need context if user wants to *start* saving.
      currentCCDebtTotal: currentEstimatedDebt,
    };

    try {
      const result = await prepareNextMonthBudget(input);
      if (result.aiError) {
        setAiError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        setAiSuggestions(result);
        toast({ title: "AI Suggestions Loaded", description: "Review the suggestions and apply them to your next month's budget if you're happy.", duration: 5000 });
      }
    } catch (error: any) {
      const message = error.message || "An unexpected error occurred while getting AI suggestions.";
      setAiError(message);
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsLoadingAi(false);
    }
  };

  const handleApplyBudget = () => {
    if (!aiSuggestions?.suggestedCategories || aiSuggestions.suggestedCategories.length === 0) {
      toast({ title: "No Budget to Apply", description: "AI did not provide budget categories.", variant: "destructive" });
      return;
    }

    const currentMonthDate = parseYearMonth(currentMonthData.id);
    currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentMonthDate);
    
    const ccPaymentsCat = currentMonthData.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
    const paymentsMadeThisMonth = ccPaymentsCat?.expenses.reduce((sum, exp) => sum + exp.amount, 0) || 0;

    applyAiGeneratedBudget(
      nextMonthId,
      aiSuggestions.suggestedCategories,
      currentIncome, // For now, carry over current income as next month's income
      currentMonthData.startingCreditCardDebt || 0,
      paymentsMadeThisMonth
    );

    toast({
      title: "Budget Applied!",
      description: `AI-suggested budget has been applied to ${nextMonthId}. You will be navigated to the new month.`,
      action: <CheckCircle className="text-green-500" />,
    });
    setCurrentDisplayMonthId(nextMonthId);
    onClose();
  };
  
  const renderSuggestedCategories = (categories: PrepareBudgetOutput['suggestedCategories']) => {
    if (!categories || categories.length === 0) {
      return <p className="text-sm text-muted-foreground">No budget categories suggested.</p>;
    }
    return (
      <ul className="space-y-2 text-sm">
        {categories.map((cat, index) => (
          <li key={index} className="p-2 border rounded-md bg-muted/20">
            <div className="font-semibold">{cat.name}: ${cat.budgetedAmount?.toFixed(2) || '0.00'}</div>
            {cat.subcategories && cat.subcategories.length > 0 && (
              <ul className="pl-4 mt-1 space-y-1 text-xs border-l ml-2">
                {cat.subcategories.map((sub, subIndex) => (
                  <li key={subIndex}>{sub.name}: ${sub.budgetedAmount?.toFixed(2) || '0.00'}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    );
  };


  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg md:max-w-2xl lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold flex items-center">
            <Wand2 className="mr-3 h-7 w-7 text-primary" /> AI Budget Prep for Next Month
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[75vh] p-1">
          <div className="space-y-6 p-4 pr-2">
            
            <div className="p-4 border rounded-lg bg-card/50">
                <h3 className="text-lg font-medium mb-2">Current Financial Snapshot (Month: {currentMonthData.id})</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="p-2 bg-muted/30 rounded-md">
                        <DollarSign className="h-4 w-4 text-green-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Income This Month</p>
                        <p className="font-semibold">${currentIncome.toFixed(2)}</p>
                    </div>
                    <div className="p-2 bg-muted/30 rounded-md">
                        <PiggyBank className="h-4 w-4 text-blue-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Actual Savings This Month</p>
                        <p className="font-semibold">${currentActualSavings.toFixed(2)}</p>
                    </div>
                    <div className="p-2 bg-muted/30 rounded-md">
                        <CreditCard className="h-4 w-4 text-red-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Est. CC Debt End of Month</p>
                        <p className="font-semibold">${currentEstimatedDebt.toFixed(2)}</p>
                    </div>
                </div>
            </div>

            <div>
              <Label htmlFor="userGoals" className="text-base font-medium">
                Your Financial Goals for Next Month
              </Label>
              <Textarea
                id="userGoals"
                value={userGoals}
                onChange={(e) => setUserGoals(e.target.value)}
                placeholder="e.g., Save $500 for vacation, reduce dining out, start an emergency fund, buy a new PC for $5000..."
                className="mt-1 min-h-[80px]"
                rows={3}
                disabled={isLoadingAi}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="statementUpload" className="text-base font-medium">
                Upload Past Bank Statement (Optional - Image or PDF)
              </Label>
              <Input
                id="statementUpload"
                type="file"
                accept="image/*,application/pdf"
                ref={statementFileInputRef}
                onChange={handleStatementFileChange}
                className="hidden"
                disabled={isLoadingAi}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => statementFileInputRef.current?.click()}
                disabled={isLoadingAi}
                className="w-full"
              >
                <UploadCloud className="mr-2 h-4 w-4" /> Select Statement File
              </Button>
              {statementFile && (
                <div className="mt-2 space-y-1 p-3 border rounded-md bg-muted/50">
                  <div className="flex items-center space-x-2">
                    {statementFile.type.startsWith('image/') && statementPreviewUrl ? (
                      <div className="relative w-16 h-16 border rounded-md overflow-hidden bg-muted shrink-0">
                        <Image src={statementPreviewUrl} alt="Statement preview" layout="fill" objectFit="contain" data-ai-hint="bank statement document"/>
                      </div>
                    ) : statementFile.type === 'application/pdf' ? (
                      <FileText className="h-8 w-8 text-destructive shrink-0" />
                    ) : null}
                    <div className="flex-grow overflow-hidden">
                      <p className="text-sm font-medium truncate" title={statementFile.name}>{statementFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(statementFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleClearStatementFile} disabled={isLoadingAi} className="w-full text-xs h-7">
                    <Trash2 className="mr-1 h-3 w-3" /> Clear Selection
                  </Button>
                </div>
              )}
            </div>

            <Button onClick={handleGetAiSuggestions} disabled={isLoadingAi || !userGoals.trim()} className="w-full py-3 text-base">
              {isLoadingAi ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wand2 className="mr-2 h-5 w-5" />}
              {isLoadingAi ? "Getting Suggestions..." : "Get AI Budget Suggestions"}
            </Button>

            {aiError && (
              <p className="text-sm text-destructive flex items-center"><Info className="h-4 w-4 mr-1 shrink-0" /> {aiError}</p>
            )}

            {aiSuggestions && (
              <div className="mt-6 space-y-4 p-4 border-t border-dashed">
                <h3 className="text-xl font-semibold text-primary">AI Suggestions for Next Month</h3>
                
                <div className="space-y-2">
                    <h4 className="text-md font-medium">Financial Advice:</h4>
                    <ScrollArea className="h-32 p-3 border rounded-md bg-muted/10">
                         <p className="text-sm whitespace-pre-wrap">{aiSuggestions.financialAdvice}</p>
                    </ScrollArea>
                </div>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-md font-medium">Suggested Budget Categories:</h4>
                  {renderSuggestedCategories(aiSuggestions.suggestedCategories)}
                </div>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="w-full mt-4" variant="default" size="lg" disabled={!aiSuggestions.suggestedCategories || aiSuggestions.suggestedCategories.length === 0}>
                        <CheckCircle className="mr-2 h-5 w-5"/> Apply This Budget to Next Month
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm Apply Budget</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will set up the budget for the next month ({ getYearMonthFromDate(new Date(parseYearMonth(currentMonthData.id).setMonth(parseYearMonth(currentMonthData.id).getMonth() + 1))) }) 
                        using the AI's suggestions. Any existing budget for that month will be overwritten. Are you sure?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleApplyBudget}>Yes, Apply Budget</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4 gap-2">
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>
              <XCircle className="mr-2 h-4 w-4" /> Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    