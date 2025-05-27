
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetMonth } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, UploadCloud, FileText, Trash2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard, Paperclip, ArrowLeft } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import Image from "next/image";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Separator } from "@/components/ui/separator";
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PrepareBudgetPage() {
  const { getBudgetForMonth, applyAiGeneratedBudget, setCurrentDisplayMonthId, currentDisplayMonthId: initialMonthId } = useBudget();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [currentMonthData, setCurrentMonthData] = useState<BudgetMonth | null>(null);
  const [isLoadingPageData, setIsLoadingPageData] = useState(true);

  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [statementPreviewDetails, setStatementPreviewDetails] = useState<{ name: string; type: string; dataUri?: string }[]>([]);
  const [statementDataUris, setStatementDataUris] = useState<string[]>([]);
  const [userGoals, setUserGoals] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiSuggestions, setAiSuggestions] = useState<PrepareBudgetOutput | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const statementFileInputRef = useRef<HTMLInputElement>(null);

  const [currentIncome, setCurrentIncome] = useState(0);
  const [currentActualSavings, setCurrentActualSavings] = useState(0);
  const [currentEstimatedDebt, setCurrentEstimatedDebt] = useState(0);

  useEffect(() => {
    // Use initialMonthId from useBudget hook as the source month for prep.
    const sourceMonthId = initialMonthId;
    const data = getBudgetForMonth(sourceMonthId);
    if (data) {
      setCurrentMonthData(data);
      setIsLoadingPageData(false);
    } else {
      // Handle case where source month data might not be loaded yet or doesn't exist
      // This might indicate a need to ensure useBudget hook has loaded its initial state
      toast({ title: "Error", description: `Could not load data for month ${sourceMonthId}. Please ensure the month exists.`, variant: "destructive" });
      router.push('/'); // Redirect if data is missing
      setIsLoadingPageData(false);
    }
  }, [initialMonthId, getBudgetForMonth, router, toast]);


  useEffect(() => {
    setIsLoadingAi(false); // Always ensure AI loading is reset when component mounts or dependencies change
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setUserGoals("");
    setAiSuggestions(null);
    setAiError(null);
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
  }, []); // Runs once on mount

  useEffect(() => {
    if (currentMonthData) {
      const incomesArray = Array.isArray(currentMonthData.incomes) ? currentMonthData.incomes : [];
      const categoriesArray = Array.isArray(currentMonthData.categories) ? currentMonthData.categories : [];

      const totalIncome = incomesArray.reduce((sum, inc) => sum + inc.amount, 0);
      setCurrentIncome(totalIncome);

      const savingsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
      const actualSavings = (savingsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setCurrentActualSavings(actualSavings);
      
      const ccPaymentsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
      const paymentsMadeThisMonth = (ccPaymentsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setCurrentEstimatedDebt(Math.max(0, (currentMonthData.startingCreditCardDebt || 0) - paymentsMadeThisMonth));
    } else {
      setCurrentIncome(0);
      setCurrentActualSavings(0);
      setCurrentEstimatedDebt(0);
    }
  }, [currentMonthData]);


  const handleStatementFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFilesArray = Array.from(files);
      setStatementFiles(prev => [...prev, ...newFilesArray]);
      setAiError(null);

      const newPreviewDetailsArray: { name: string; type: string; dataUri?: string }[] = [];
      const newDataUrisArray: string[] = [];

      for (const file of newFilesArray) {
        try {
          const dataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          newDataUrisArray.push(dataUri);
          newPreviewDetailsArray.push({
            name: file.name,
            type: file.type,
            dataUri: file.type.startsWith('image/') ? dataUri : undefined,
          });
        } catch (error) {
          console.error("Error reading file:", file.name, error);
          setAiError(`Error processing file: ${file.name}.`);
        }
      }
      setStatementDataUris(prev => [...prev, ...newDataUrisArray]);
      setStatementPreviewDetails(prev => [...prev, ...newPreviewDetailsArray]);
    }
    if (event.target) event.target.value = '';
  };

  const handleClearStatementFiles = () => {
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setAiError(null);
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
  };
  
  const handleRemoveStatementFile = (indexToRemove: number) => {
    setStatementFiles(prev => prev.filter((_, index) => index !== indexToRemove));
    setStatementPreviewDetails(prev => prev.filter((_, index) => index !== indexToRemove));
    setStatementDataUris(prev => prev.filter((_, index) => index !== indexToRemove));
  };


  const handleGetAiSuggestions = async () => {
    if (!currentMonthData) {
        setAiError("Source month data is not available.");
        toast({ title: "Data Error", description: "Could not load data for the current month to base suggestions on.", variant: "destructive" });
        return;
    }
    if (!userGoals.trim()) {
      setAiError("Please describe your financial goals for next month.");
      toast({ title: "Goals Required", description: "Please describe your financial goals.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);
    setAiSuggestions(null);

    const input: PrepareBudgetInput = {
      statementDataUris: statementDataUris.length > 0 ? statementDataUris : undefined,
      userGoals,
      currentMonthId: currentMonthData.id,
      currentIncome: currentIncome,
      currentSavingsTotal: currentActualSavings, 
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
    if (!currentMonthData) {
        toast({ title: "Error", description: "Source month data is missing for applying the budget.", variant: "destructive" });
        return;
    }
    if (!aiSuggestions?.suggestedCategories || aiSuggestions.suggestedCategories.length === 0) {
      toast({ title: "No Budget to Apply", description: "AI did not provide budget categories.", variant: "destructive" });
      return;
    }

    const currentMonthDate = parseYearMonth(currentMonthData.id);
    currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentMonthDate);
    
    // Calculate payments made in the *current* source month
    const ccPaymentsCat = currentMonthData.categories.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
    const paymentsMadeThisMonth = (ccPaymentsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);

    applyAiGeneratedBudget(
      nextMonthId,
      aiSuggestions.suggestedCategories,
      currentIncome, 
      currentMonthData.startingCreditCardDebt || 0,
      paymentsMadeThisMonth
    );

    toast({
      title: "Budget Applied!",
      description: `AI-suggested budget has been applied to ${getFormattedMonthTitle(nextMonthId)}. You will be navigated to the new month.`,
      action: <CheckCircle className="text-green-500" />,
    });
    setCurrentDisplayMonthId(nextMonthId);
    router.push('/'); // Navigate to home page which will show the new month
  };
  
  const renderSuggestedCategories = (categories: PrepareBudgetOutput['suggestedCategories']) => {
    if (!categories || categories.length === 0) {
      return <p className="text-sm text-muted-foreground">No budget categories suggested.</p>;
    }
    return (
      <ul className="space-y-2 text-sm">
        {categories.map((cat, index) => (
          <li key={index} className="p-3 border rounded-md bg-background shadow-sm">
            <div className="font-semibold text-base">{cat.name}: ${cat.budgetedAmount?.toFixed(2) || '0.00'}</div>
            {cat.subcategories && cat.subcategories.length > 0 && (
              <ul className="pl-4 mt-2 space-y-1 text-xs border-l ml-2 border-border">
                {cat.subcategories.map((sub, subIndex) => (
                  <li key={subIndex} className="text-muted-foreground">{sub.name}: <span className="font-medium text-foreground">${sub.budgetedAmount?.toFixed(2) || '0.00'}</span></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const getFormattedMonthTitle = (monthId: string) => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  if (isLoadingPageData || !currentMonthData) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
             <Button variant="outline" size="icon" onClick={() => router.back()}>
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary">AI Budget Prep</h1>
            <div className="w-8"></div> {/* Placeholder for balance */}
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
            <Skeleton className="h-12 w-1/2 mb-6" />
            <Skeleton className="h-32 w-full mb-4" />
            <Skeleton className="h-20 w-full mb-4" />
            <Skeleton className="h-40 w-full mb-4" />
            <Skeleton className="h-10 w-full" />
        </main>
      </div>
    );
  }

  const nextMonthToPrep = getFormattedMonthTitle(getYearMonthFromDate(new Date(parseYearMonth(currentMonthData.id).setMonth(parseYearMonth(currentMonthData.id).getMonth() + 1))));

  return (
    <div className="flex flex-col min-h-screen bg-background">
       <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary truncate px-2">AI Prep for {nextMonthToPrep}</h1>
            <div className="w-8"></div> {/* Placeholder for balance */}
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
        <ScrollArea className="h-full pr-2"> {/* Ensure ScrollArea takes available height */}
          <div className="space-y-8 pb-8">
            
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Current Financial Snapshot</CardTitle>
                    <CardDescription>Based on your latest data for {getFormattedMonthTitle(currentMonthData.id)}.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                        <DollarSign className="h-5 w-5 text-green-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Income This Month</p>
                        <p className="font-semibold text-lg">${currentIncome.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                        <PiggyBank className="h-5 w-5 text-blue-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Actual Savings This Month</p>
                        <p className="font-semibold text-lg">${currentActualSavings.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                        <CreditCard className="h-5 w-5 text-red-500 mb-1"/>
                        <p className="text-xs text-muted-foreground">Est. CC Debt End of Month</p>
                        <p className="font-semibold text-lg">${currentEstimatedDebt.toFixed(2)}</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Your Financial Goals for Next Month</CardTitle>
                    <CardDescription>Describe what you want to achieve. E.g., "Save $500 for vacation, reduce dining out, start an emergency fund, buy a new PC for $5000..."</CardDescription>
                </CardHeader>
                <CardContent>
                    <Textarea
                        id="userGoals"
                        value={userGoals}
                        onChange={(e) => setUserGoals(e.target.value)}
                        placeholder="Be specific about your goals..."
                        className="min-h-[100px] text-base"
                        rows={4}
                        disabled={isLoadingAi}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Upload Past Bank Statement(s)</CardTitle>
                    <CardDescription>Optional: Provide images or PDFs of recent bank statements or spending summaries for more tailored AI suggestions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Input
                        id="statementUpload"
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
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
                        <UploadCloud className="mr-2 h-4 w-4" /> Select Statement File(s)
                    </Button>
                    {statementFiles.length > 0 && (
                        <div className="mt-4 space-y-3">
                        <div className="flex justify-between items-center">
                            <Label className="text-sm font-medium">Selected Files ({statementFiles.length}):</Label>
                            <Button variant="ghost" size="sm" onClick={handleClearStatementFiles} disabled={isLoadingAi} className="text-xs h-7">
                            <Trash2 className="mr-1 h-3 w-3" /> Clear All
                            </Button>
                        </div>
                        <ScrollArea className="h-40 border rounded-md p-3 bg-muted/20">
                            <ul className="space-y-2">
                            {statementPreviewDetails.map((detail, index) => (
                                <li key={index} className="flex items-center justify-between text-xs p-2 bg-background rounded-md shadow">
                                <div className="flex items-center space-x-2 overflow-hidden flex-1">
                                    {detail.type.startsWith('image/') && detail.dataUri ? (
                                    <div className="relative w-12 h-12 border rounded-sm overflow-hidden bg-muted shrink-0">
                                        <Image src={detail.dataUri} alt={`${detail.name} preview`} layout="fill" objectFit="contain" data-ai-hint="bank statement financial"/>
                                    </div>
                                    ) : detail.type === 'application/pdf' ? (
                                    <FileText className="h-8 w-8 text-destructive shrink-0" />
                                    ) : <Paperclip className="h-6 w-6 text-muted-foreground shrink-0"/> }
                                    <span className="font-medium truncate flex-grow" title={detail.name}>{detail.name}</span>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => handleRemoveStatementFile(index)} disabled={isLoadingAi} className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 ml-2">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                </li>
                            ))}
                            </ul>
                        </ScrollArea>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            <Button onClick={handleGetAiSuggestions} disabled={isLoadingAi || !userGoals.trim()} className="w-full py-3 text-base font-semibold">
              {isLoadingAi ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wand2 className="mr-2 h-5 w-5" />}
              {isLoadingAi ? "Getting Suggestions..." : "Get AI Budget Suggestions"}
            </Button>

            {aiError && (
              <Alert variant="destructive" className="mt-4">
                  <Info className="h-4 w-4"/>
                  <AlertTitle>AI Error</AlertTitle>
                  <AlertDescription>{aiError}</AlertDescription>
              </Alert>
            )}

            {aiSuggestions && (
              <Card className="mt-8">
                <CardHeader>
                    <CardTitle className="text-xl text-primary">AI Suggestions for {nextMonthToPrep}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <h4 className="text-lg font-medium flex items-center"><Info className="mr-2 h-5 w-5 text-blue-500"/>Financial Advice:</h4>
                        <ScrollArea className="h-40 p-4 border rounded-lg bg-muted/20 text-sm shadow-inner">
                            <p className="whitespace-pre-wrap leading-relaxed">{aiSuggestions.financialAdvice}</p>
                        </ScrollArea>
                    </div>
                    <Separator />
                    <div className="space-y-3">
                        <h4 className="text-lg font-medium">Suggested Budget Categories:</h4>
                         <Alert>
                            <Info className="h-4 w-4" />
                            <AlertDescription>
                                Review the AI's suggestions. You can manually adjust this budget later using "Manage Budget" for {nextMonthToPrep} if needed.
                            </AlertDescription>
                        </Alert>
                        {renderSuggestedCategories(aiSuggestions.suggestedCategories)}
                    </div>
                    
                    <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button className="w-full mt-6 py-3 text-base font-semibold" variant="default" size="lg" disabled={!aiSuggestions.suggestedCategories || aiSuggestions.suggestedCategories.length === 0 || isLoadingAi}>
                            <CheckCircle className="mr-2 h-5 w-5"/> Apply This Budget to Next Month
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Apply Budget</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will set up the budget for {nextMonthToPrep} 
                            using the AI's suggestions. Any existing budget for that month will be overwritten. Are you sure?
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel disabled={isLoadingAi}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleApplyBudget} disabled={isLoadingAi}>
                            {isLoadingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null }
                            Yes, Apply Budget
                        </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>

                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
        </main>
    </div>
  );
}
