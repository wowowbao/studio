
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetMonth } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, UploadCloud, FileText, Trash2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard, Paperclip, ArrowLeft, RotateCcw, MessageSquareText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import Image from "next/image";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Separator } from "@/components/ui/separator";
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


export default function PrepareBudgetPage() {
  const { getBudgetForMonth, setCurrentDisplayMonthId, currentDisplayMonthId: initialMonthId } = useBudget();
  const { toast } = useToast();
  const router = useRouter();

  const [currentMonthData, setCurrentMonthData] = useState<BudgetMonth | null>(null);
  const [isLoadingPageData, setIsLoadingPageData] = useState(true);
  
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [statementPreviewDetails, setStatementPreviewDetails] = useState<{ name: string; type: string; dataUri?: string }[]>([]);
  const [statementDataUris, setStatementDataUris] = useState<string[]>([]);
  const [userGoals, setUserGoals] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const statementFileInputRef = useRef<HTMLInputElement>(null);

  const [currentIncomeForDisplay, setCurrentIncomeForDisplay] = useState(0);
  const [currentActualSavingsForDisplay, setCurrentActualSavingsForDisplay] = useState(0);
  const [currentEstimatedDebtForDisplay, setCurrentEstimatedDebtForDisplay] = useState(0);

  const isInitialOnboarding = !currentMonthData; // True if there's no previous month data to base off
  

  useEffect(() => {
    const sourceMonthId = initialMonthId;
    if (!sourceMonthId) {
      toast({ title: "Error", description: "Current month ID is not available. Please return to the dashboard.", variant: "destructive" });
      router.push('/');
      setIsLoadingPageData(false);
      return;
    }
    const data = getBudgetForMonth(sourceMonthId);
    // If no data for current month (e.g., new user via onboarding), setCurrentMonthData to null
    // This allows the UI to adapt for true onboarding vs. planning for an existing user.
    setCurrentMonthData(data || null); 
    setIsLoadingPageData(false);
  }, [initialMonthId, getBudgetForMonth, router, toast]);


  useEffect(() => {
    setIsLoadingAi(false); 
    setAiError(null);
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setUserGoals("");
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
  }, [initialMonthId]); 

  useEffect(() => {
    if (currentMonthData) { // Only calculate if there is a current month's data
      const incomesArray = Array.isArray(currentMonthData.incomes) ? currentMonthData.incomes : [];
      const categoriesArray = Array.isArray(currentMonthData.categories) ? currentMonthData.categories : [];

      const totalIncome = incomesArray.reduce((sum, inc) => sum + inc.amount, 0);
      setCurrentIncomeForDisplay(totalIncome);

      const savingsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
      const actualSavingsContribution = (savingsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setCurrentActualSavingsForDisplay(actualSavingsContribution);
      
      const ccPaymentsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
      const paymentsMadeThisMonth = (ccPaymentsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setCurrentEstimatedDebtForDisplay(Math.max(0, (currentMonthData.startingCreditCardDebt || 0) - paymentsMadeThisMonth));
    } else { // For onboarding or if no current month data, default to 0
      setCurrentIncomeForDisplay(0);
      setCurrentActualSavingsForDisplay(0);
      setCurrentEstimatedDebtForDisplay(0);
    }
  }, [currentMonthData]);


  const handleStatementFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFilesArray = Array.from(files);
      setStatementFiles(prev => [...prev, ...newFilesArray].slice(0, 5)); 
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
      setStatementDataUris(prev => [...prev, ...newDataUrisArray].slice(0, 5));
      setStatementPreviewDetails(prev => [...prev, ...newPreviewDetailsArray].slice(0, 5));
      if (Array.from(files).length + statementFiles.length > 5) {
          toast({title: "File Limit", description: "Maximum of 5 statement files allowed.", variant: "default"});
      }
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


  const handleGetInitialAiSuggestions = async () => {
    if (!userGoals.trim()) {
      setAiError("Please describe your financial goals.");
      toast({ title: "Goals Required", description: "Please describe your financial goals.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);

    let baseMonthIdForAI = initialMonthId || getYearMonthFromDate(new Date());
    let incomeForAI = currentIncomeForDisplay;
    let savingsForAI = currentActualSavingsForDisplay;
    let debtForAI = currentEstimatedDebtForDisplay;

    if (isInitialOnboarding) { // If it's onboarding, these values are likely 0
      // The AI flow will be instructed to derive income from userGoals if possible
      // If not, it will proceed with the provided 0s, and its advice should reflect this.
      // baseMonthIdForAI remains the current month or next if current is problematic
      // (though AI plans for the "next" month from this base)
    }


    const input: PrepareBudgetInput = {
      statementDataUris: statementDataUris.length > 0 ? statementDataUris : undefined,
      userGoals,
      currentMonthId: baseMonthIdForAI,
      currentIncome: incomeForAI,
      currentSavingsTotal: savingsForAI, 
      currentCCDebtTotal: debtForAI,
    };

    try {
      const result = await prepareNextMonthBudget(input);
      if (result.aiError) {
        setAiError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        sessionStorage.setItem('aiPrepInitialSuggestions', JSON.stringify(result));
        sessionStorage.setItem('aiPrepInitialInputs', JSON.stringify({
          userGoals,
          statementFileNames: statementPreviewDetails.map(f => f.name),
          currentMonthId: baseMonthIdForAI, // The month ID AI used as its "current"
          currentIncome: incomeForAI, // The income figure AI started with
          currentActualSavings: savingsForAI,
          currentEstimatedDebt: debtForAI,
          statementDataUris 
        }));
        
        toast({ title: "AI Suggestions Ready!", description: "Redirecting to review page...", duration: 3000 });
        router.push('/prep-budget/review');
      }
    } catch (error: any) {
      const message = error.message || "An unexpected error occurred while getting AI suggestions.";
      setAiError(message);
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsLoadingAi(false);
    }
  };
  
  const getFormattedMonthTitle = (monthId: string) => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };
  
  const handleClearInputs = () => {
    setIsLoadingAi(false);
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setUserGoals("");
    setAiError(null);
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
    toast({title: "Form Reset", description: "Please enter your goals and upload statements again."});
  };


  if (isLoadingPageData) { // Simplified loading, currentMonthData might be null for onboarding
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
             <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Go back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary">AI Budget Prep</h1>
            <div className="w-8"></div> 
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

  const nextMonthToPrepFor = currentMonthData 
    ? getFormattedMonthTitle(getYearMonthFromDate(new Date(parseYearMonth(currentMonthData.id).setMonth(parseYearMonth(currentMonthData.id).getMonth() + 1))))
    : getFormattedMonthTitle(getYearMonthFromDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1))); // Default to next calendar month if no current data


  const goalsPlaceholderText = isInitialOnboarding 
    ? "Describe your overall financial goals (e.g., 'Save for a down payment in 1 year', 'Reduce debt by $X in 6 months'). Include your approximate monthly income (e.g., 'My income is $3000/month') and when you'd like this plan to start (e.g., 'Start this plan next month'). The more detail, the better!"
    : "Describe what you want to achieve next month (e.g., 'Save $500 for vacation', 'Reduce dining out'). The AI will also consider your current month's data. If your income for next month will be different, please specify (e.g., 'My income next month will be $X').";


  return (
    <div className="flex flex-col min-h-screen bg-background">
       <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary truncate px-2">
              {isInitialOnboarding ? "AI Financial Plan Setup" : `AI Prep for ${nextMonthToPrepFor}`}
            </h1>
             <Button variant="outline" size="sm" onClick={handleClearInputs} disabled={isLoadingAi} aria-label="Clear Inputs">
                <RotateCcw className="mr-2 h-4 w-4" /> Clear Inputs
            </Button>
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
        <ScrollArea className="h-full pr-2"> 
          <div className="space-y-8 pb-8">
              
              {!isInitialOnboarding && currentMonthData && ( // Only show snapshot if not onboarding and current month data exists
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Current Financial Snapshot</CardTitle>
                        <CardDescription>Based on your latest data for {getFormattedMonthTitle(currentMonthData.id)}. This info helps the AI.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                            <DollarSign className="h-5 w-5 text-green-500 mb-1"/>
                            <p className="text-xs text-muted-foreground">Income This Month</p>
                            <p className="font-semibold text-lg">${currentIncomeForDisplay.toFixed(2)}</p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                            <PiggyBank className="h-5 w-5 text-blue-500 mb-1"/>
                            <p className="text-xs text-muted-foreground">Actual Savings This Month</p>
                            <p className="font-semibold text-lg">${currentActualSavingsForDisplay.toFixed(2)}</p>
                        </div>
                        <div className="p-3 bg-muted/50 rounded-lg shadow-inner">
                            <CreditCard className="h-5 w-5 text-red-500 mb-1"/>
                            <p className="text-xs text-muted-foreground">Est. CC Debt End of Month</p>
                            <p className="font-semibold text-lg">${currentEstimatedDebtForDisplay.toFixed(2)}</p>
                        </div>
                    </CardContent>
                </Card>
              )}
              {isInitialOnboarding && (
                 <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Welcome to AI Financial Planning!</AlertTitle>
                    <AlertDescription>
                      Let's create your first budget. Please describe your financial goals, income, and when you'd like to start. 
                      Optionally, upload past bank statements for more tailored suggestions.
                    </AlertDescription>
                  </Alert>
              )}

              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">
                        {isInitialOnboarding ? "Your Financial Goals & Income" : "Your Financial Goals for Next Month"}
                      </CardTitle>
                      <CardDescription>
                          {isInitialOnboarding 
                            ? "Be specific about your goals, your typical monthly income, and when you'd like this plan to begin. The more detail, the better the AI can assist."
                            : "Describe what you want to achieve. The AI will consider these comments and your current month's data when generating suggestions. If your income for next month will differ, please state it."
                          }
                      </CardDescription>
                  </CardHeader>
                  <CardContent>
                      <Textarea
                          id="userGoals"
                          value={userGoals}
                          onChange={(e) => setUserGoals(e.target.value)}
                          placeholder={goalsPlaceholderText}
                          className="min-h-[100px] text-base"
                          rows={5}
                          disabled={isLoadingAi}
                      />
                  </CardContent>
              </Card>

              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">Upload Past Bank Statement(s) <span className="text-xs text-muted-foreground">(Optional, Max 5 Files)</span></CardTitle>
                      <CardDescription>Provide images or PDFs of recent bank statements or spending summaries for more tailored AI suggestions.</CardDescription>
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
                          disabled={isLoadingAi || statementFiles.length >= 5}
                      />
                      <Button
                          type="button"
                          variant="outline"
                          onClick={() => statementFileInputRef.current?.click()}
                          disabled={isLoadingAi || statementFiles.length >= 5}
                          className="w-full"
                      >
                          <UploadCloud className="mr-2 h-4 w-4" /> Select Statement File(s)
                      </Button>
                      {statementFiles.length >= 5 && <p className="text-xs text-destructive text-center">Maximum of 5 files reached.</p>}
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
              
              <Button onClick={handleGetInitialAiSuggestions} disabled={isLoadingAi || !userGoals.trim()} className="w-full py-3 text-base font-semibold">
                {isLoadingAi ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wand2 className="mr-2 h-5 w-5" />}
                Get AI Budget Suggestions
              </Button>
            
              {aiError && (
                <Alert variant="destructive" className="mt-4">
                    <XCircle className="h-4 w-4"/>
                    <AlertTitle>AI Error</AlertTitle>
                    <AlertDescription>{aiError}</AlertDescription>
                </Alert>
              )}
          </div>
        </ScrollArea>
        </main>
    </div>
  );
}
