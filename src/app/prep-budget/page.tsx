
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetMonth } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, UploadCloud, FileText, Trash2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard, Paperclip, ArrowLeft, RotateCcw, MessageSquareText, Edit3, ListChecks, Users } from "lucide-react";
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

// Define specific goal input states
type GranularGoals = {
  planIncome: string;
  planStartMonth: string;
  familySize: string; // New field
  savingsGoalText: string;
  debtGoalText: string;
  purchaseGoalText: string;
  cutbackGoalText: string;
  otherGoalText: string;
};

export default function PrepareBudgetPage() {
  const { getBudgetForMonth, setCurrentDisplayMonthId, currentDisplayMonthId: initialMonthId } = useBudget();
  const { toast } = useToast();
  const router = useRouter();

  const [currentMonthData, setCurrentMonthData] = useState<BudgetMonth | null>(null);
  const [isLoadingPageData, setIsLoadingPageData] = useState(true);
  
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [statementPreviewDetails, setStatementPreviewDetails] = useState<{ name: string; type: string; dataUri?: string }[]>([]);
  const [statementDataUris, setStatementDataUris] = useState<string[]>([]);
  
  const [granularGoals, setGranularGoals] = useState<GranularGoals>({
    planIncome: "",
    planStartMonth: "next month",
    familySize: "", // New field
    savingsGoalText: "",
    debtGoalText: "",
    purchaseGoalText: "",
    cutbackGoalText: "",
    otherGoalText: "",
  });

  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const statementFileInputRef = useRef<HTMLInputElement>(null);

  const [editableCurrentIncome, setEditableCurrentIncome] = useState<string>("0");
  const [editableActualSavings, setEditableActualSavings] = useState<string>("0");
  const [editableEstimatedDebt, setEditableEstimatedDebt] = useState<string>("0");

  const isInitialOnboarding = !currentMonthData || Object.keys(currentMonthData).length === 0;

  useEffect(() => {
    const sourceMonthId = initialMonthId || getYearMonthFromDate(new Date());
    if (!sourceMonthId) {
      toast({ title: "Error", description: "Current month ID is not available. Please return to the dashboard.", variant: "destructive" });
      router.push('/');
      setIsLoadingPageData(false);
      return;
    }
    const data = getBudgetForMonth(sourceMonthId);
    setCurrentMonthData(data || null); 
    setIsLoadingPageData(false);
  }, [initialMonthId, getBudgetForMonth, router, toast]);

  useEffect(() => {
    // Reset form fields when the page effectively loads or is reset
    setIsLoadingAi(false); 
    setAiError(null);
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setGranularGoals({
        planIncome: "",
        planStartMonth: "next month",
        familySize: "", // Reset new field
        savingsGoalText: "",
        debtGoalText: "",
        purchaseGoalText: "",
        cutbackGoalText: "",
        otherGoalText: "",
    });
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
  }, []); 

  useEffect(() => {
    if (currentMonthData) { 
      const incomesArray = Array.isArray(currentMonthData.incomes) ? currentMonthData.incomes : [];
      const categoriesArray = Array.isArray(currentMonthData.categories) ? currentMonthData.categories : [];

      const totalIncome = incomesArray.reduce((sum, inc) => sum + inc.amount, 0);
      setEditableCurrentIncome(totalIncome.toFixed(2));

      const savingsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
      const actualSavingsContribution = (savingsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setEditableActualSavings(actualSavingsContribution.toFixed(2));
      
      const ccPaymentsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
      const paymentsMadeThisMonth = (ccPaymentsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
      setEditableEstimatedDebt(Math.max(0, (currentMonthData.startingCreditCardDebt || 0) - paymentsMadeThisMonth).toFixed(2));
    } else { 
      setEditableCurrentIncome("0");
      setEditableActualSavings("0");
      setEditableEstimatedDebt("0");
    }
  }, [currentMonthData]);

  const handleGranularGoalChange = (field: keyof GranularGoals, value: string) => {
    setGranularGoals(prev => ({ ...prev, [field]: value }));
  };

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

  const constructUserGoalsString = (): string => {
    let goals = "";
    if (granularGoals.planIncome.trim()) goals += `My income for this plan will be $${granularGoals.planIncome}. `;
    else goals += `User has not specified an income for this plan; use current month's income from app data if available, or assume a general case. `;
    
    if (granularGoals.planStartMonth.trim()) goals += `I want to start this plan in ${granularGoals.planStartMonth}. `;
    else goals += `Assume the plan starts next month. `;

    if (granularGoals.familySize.trim()) goals += `This budget is for a household of ${granularGoals.familySize} people. `;

    if (granularGoals.savingsGoalText.trim()) goals += `Savings goal: ${granularGoals.savingsGoalText}. `;
    if (granularGoals.debtGoalText.trim()) goals += `Debt repayment goal: ${granularGoals.debtGoalText}. `;
    if (granularGoals.purchaseGoalText.trim()) goals += `Major purchase goal: ${granularGoals.purchaseGoalText}. `;
    if (granularGoals.cutbackGoalText.trim()) goals += `I'd like to cut back on: ${granularGoals.cutbackGoalText}. `;
    if (granularGoals.otherGoalText.trim()) goals += `Other notes: ${granularGoals.otherGoalText}.`;
    
    if (goals.length === 0 || (!granularGoals.savingsGoalText.trim() && !granularGoals.debtGoalText.trim() && !granularGoals.purchaseGoalText.trim() && !granularGoals.cutbackGoalText.trim() && !granularGoals.otherGoalText.trim())) {
        goals += "User has not provided specific financial goals beyond potentially their income, start month, and family size. Provide general, foundational budgeting advice and suggestions."
    }
    return goals.trim();
  };

  const handleGetInitialAiSuggestions = async () => {
    const userGoalsString = constructUserGoalsString();
    if (!granularGoals.planIncome.trim() && isInitialOnboarding) { 
      setAiError("Please provide your approximate monthly income for the new plan.");
      toast({ title: "Income Required", description: "Please provide your planned income to get started.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);

    let baseMonthIdForAI = initialMonthId || getYearMonthFromDate(new Date());
    
    const incomeForAI = parseFloat(editableCurrentIncome) || 0;
    const savingsForAI = parseFloat(editableActualSavings) || 0;
    const debtForAI = parseFloat(editableEstimatedDebt) || 0;
    const familySizeForAI = granularGoals.familySize.trim() ? parseInt(granularGoals.familySize, 10) : undefined;

    if (familySizeForAI !== undefined && (isNaN(familySizeForAI) || familySizeForAI <= 0)) {
        toast({ title: "Invalid Input", description: "Please enter a valid positive number for family size.", variant: "destructive" });
        setIsLoadingAi(false);
        return;
    }
    
    // Fetch the source month's feedback to pass to the AI
    const sourceMonthData = getBudgetForMonth(baseMonthIdForAI);
    const previousMonthFeedbackFromSource = sourceMonthData?.monthEndFeedback;

    const input: PrepareBudgetInput = {
      statementDataUris: statementDataUris.length > 0 ? statementDataUris : undefined,
      userGoals: userGoalsString,
      currentMonthId: baseMonthIdForAI,
      currentIncome: incomeForAI, 
      currentSavingsTotal: savingsForAI, 
      currentCCDebtTotal: debtForAI,
      previousMonthFeedback: previousMonthFeedbackFromSource, // Pass feedback from source month
      familySize: familySizeForAI, // Pass family size
    };

    try {
      const result = await prepareNextMonthBudget(input);
      if (result.aiError) {
        setAiError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        sessionStorage.setItem('aiPrepInitialSuggestions', JSON.stringify(result));
        sessionStorage.setItem('aiPrepInitialInputs', JSON.stringify({
          granularGoals, 
          statementFileNames: statementPreviewDetails.map(f => f.name),
          currentMonthId: baseMonthIdForAI,
          currentIncome: incomeForAI, 
          currentActualSavings: savingsForAI,
          currentEstimatedDebt: debtForAI,
          statementDataUris,
          previousMonthFeedback: previousMonthFeedbackFromSource, 
          familySize: familySizeForAI, // Store family size for review page
        }));
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
  
  const handleClearAllAndRestart = () => {
    setIsLoadingAi(false);
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setGranularGoals({
        planIncome: "",
        planStartMonth: "next month",
        familySize: "", // Reset new field
        savingsGoalText: "",
        debtGoalText: "",
        purchaseGoalText: "",
        cutbackGoalText: "",
        otherGoalText: "",
    });
    setAiError(null);
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }
    // Re-initialize editable snapshot from currentMonthData or to 0
    if (currentMonthData) {
        const incomesArray = Array.isArray(currentMonthData.incomes) ? currentMonthData.incomes : [];
        const categoriesArray = Array.isArray(currentMonthData.categories) ? currentMonthData.categories : [];
        const totalIncome = incomesArray.reduce((sum, inc) => sum + inc.amount, 0);
        setEditableCurrentIncome(totalIncome.toFixed(2));
        const savingsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'savings');
        const actualSavingsContribution = (savingsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
        setEditableActualSavings(actualSavingsContribution.toFixed(2));
        const ccPaymentsCat = categoriesArray.find(c => c.isSystemCategory && c.name.toLowerCase() === 'credit card payments');
        const paymentsMadeThisMonth = (ccPaymentsCat?.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
        setEditableEstimatedDebt(Math.max(0, (currentMonthData.startingCreditCardDebt || 0) - paymentsMadeThisMonth).toFixed(2));
    } else {
        setEditableCurrentIncome("0");
        setEditableActualSavings("0");
        setEditableEstimatedDebt("0");
    }
    toast({title: "Form Reset", description: "Please enter your goals and upload statements again."});
  };

  if (isLoadingPageData && !initialMonthId) { 
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
             <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Go back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary">Let's Create Your Financial Plan!</h1>
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
    : getFormattedMonthTitle(getYearMonthFromDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)));

  return (
    <div className="flex flex-col min-h-screen bg-background">
       <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary truncate px-2">
             Let's Create Your Financial Plan!
            </h1>
             <Button variant="outline" size="sm" onClick={handleClearAllAndRestart} disabled={isLoadingAi} aria-label="Clear Inputs & Suggestions">
                <RotateCcw className="mr-2 h-4 w-4" /> Clear All & Restart
            </Button>
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
        <ScrollArea className="h-full pr-2"> 
          <div className="space-y-8 pb-8">
              
              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">Your Current Financial Starting Point</CardTitle>
                      <CardDescription>
                        This snapshot from {currentMonthData ? getFormattedMonthTitle(currentMonthData.id) : 'your current situation'} helps the AI plan for {nextMonthToPrepFor}. 
                        Adjust these figures if they don't reflect your true starting point for the plan. If this is your first time, these might be 0.
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                          <Label htmlFor="editableCurrentIncome" className="text-xs text-muted-foreground flex items-center"><DollarSign className="h-4 w-4 mr-1 text-green-500"/>Income This Month</Label>
                          <Input id="editableCurrentIncome" type="number" value={editableCurrentIncome} onChange={(e) => setEditableCurrentIncome(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                      <div>
                          <Label htmlFor="editableActualSavings" className="text-xs text-muted-foreground flex items-center"><PiggyBank className="h-4 w-4 mr-1 text-blue-500"/>Actual Savings This Month</Label>
                          <Input id="editableActualSavings" type="number" value={editableActualSavings} onChange={(e) => setEditableActualSavings(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                      <div>
                          <Label htmlFor="editableEstimatedDebt" className="text-xs text-muted-foreground flex items-center"><CreditCard className="h-4 w-4 mr-1 text-red-500"/>Est. CC Debt End of Month</Label>
                          <Input id="editableEstimatedDebt" type="number" value={editableEstimatedDebt} onChange={(e) => setEditableEstimatedDebt(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                  </CardContent>
              </Card>
              {isInitialOnboarding && !currentMonthData && (
                 <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Welcome to AI Financial Planning!</AlertTitle>
                    <AlertDescription>
                      Since this is your first time, the snapshot above is likely zero. Please fill in your income for the new plan below, and share your goals. 
                      The AI will then help create your first budget!
                    </AlertDescription>
                  </Alert>
              )}

              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">Your Financial Picture for the New Plan</CardTitle>
                      <CardDescription>
                          Let's get some details to help me create the best plan for you.
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div>
                          <Label htmlFor="planIncome">What is your approximate monthly income for this new plan? (Required if this is your first plan)</Label>
                          <Input id="planIncome" type="number" placeholder="e.g., 4000" value={granularGoals.planIncome} onChange={(e) => handleGranularGoalChange('planIncome', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                      </div>
                      <div>
                          <Label htmlFor="planStartMonth">When would you like this plan to ideally start?</Label>
                          <Input id="planStartMonth" placeholder="e.g., next month, August" value={granularGoals.planStartMonth} onChange={(e) => handleGranularGoalChange('planStartMonth', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                      </div>
                      <div>
                          <Label htmlFor="familySize" className="flex items-center">
                            <Users className="mr-2 h-4 w-4 text-muted-foreground"/>
                            Number of People in Household (Optional)
                          </Label>
                          <Input id="familySize" type="number" placeholder="e.g., 1, 2, 4" value={granularGoals.familySize} onChange={(e) => handleGranularGoalChange('familySize', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                      </div>
                  </CardContent>
              </Card>

              <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Your Financial Goals</CardTitle>
                    <CardDescription>The more detail you provide, the better I can assist you!</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="savingsGoalText">What are your primary savings goals? (e.g., amount per month, specific target like 'vacation fund $200/month')</Label>
                        <Textarea id="savingsGoalText" placeholder="e.g., Save $500/month for an emergency fund, contribute to vacation fund." value={granularGoals.savingsGoalText} onChange={(e) => handleGranularGoalChange('savingsGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>
                    <div>
                        <Label htmlFor="debtGoalText">What are your debt repayment goals? (e.g., 'Pay off CC X with $300/month', 'Reduce student loan payments')</Label>
                        <Textarea id="debtGoalText" placeholder="e.g., Pay an extra $100 on my main credit card." value={granularGoals.debtGoalText} onChange={(e) => handleGranularGoalChange('debtGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>
                    <div>
                        <Label htmlFor="purchaseGoalText">Are you planning any major purchases or have specific financial milestones? (e.g., 'New car in 1 year, approx $10k', 'Down payment for a house')</Label>
                        <Textarea id="purchaseGoalText" placeholder="e.g., Save for a new computer, $1500 in 6 months." value={granularGoals.purchaseGoalText} onChange={(e) => handleGranularGoalChange('purchaseGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>
                    <div>
                        <Label htmlFor="cutbackGoalText">Are there any specific areas where you'd like to reduce spending?</Label>
                        <Textarea id="cutbackGoalText" placeholder="e.g., Dining out less, cancel unused subscriptions." value={granularGoals.cutbackGoalText} onChange={(e) => handleGranularGoalChange('cutbackGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>
                    <div>
                        <Label htmlFor="otherGoalText">Any other financial notes, questions you have for me, or specific changes to a previous suggestion?</Label>
                        <Textarea id="otherGoalText" placeholder="e.g., 'My previous month's budget felt too strict.' or 'Can we increase travel to $Y?'" value={granularGoals.otherGoalText} onChange={(e) => handleGranularGoalChange('otherGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={3}/>
                    </div>
                </CardContent>
              </Card>


              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">Share Your Spending Habits? <span className="text-xs text-muted-foreground">(Optional, Max 5 Files)</span></CardTitle>
                      <CardDescription>For even more tailored suggestions, you can upload images or PDFs of recent bank statements or spending summaries. I'll analyze them to understand your typical spending patterns.</CardDescription>
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
              
              <Button onClick={handleGetInitialAiSuggestions} disabled={isLoadingAi || (!granularGoals.planIncome.trim() && isInitialOnboarding && !currentMonthData)} className="w-full py-3 text-base font-semibold">
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

    
