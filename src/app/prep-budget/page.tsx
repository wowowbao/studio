
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import type { BudgetMonth } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, UploadCloud, FileText, Trash2, Users, DollarSign, PiggyBank, CreditCard, Paperclip, ArrowLeft, RotateCcw, XCircle, Info, Sparkles, MessageSquareText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type GranularGoals = {
  planIncome: string;
  planStartMonth: string;
  familySize: string;
  savingsGoalOptions: string[];
  savingsGoalOtherText: string;
  debtGoalText: string;
  purchaseGoalText: string;
  cutbackGoalOptions: string[];
  cutbackGoalOtherText: string;
  otherGoalText: string;
};

const SAVINGS_GOAL_PRESETS = [
  { id: "emergency_fund", label: "Build an Emergency Fund" },
  { id: "vacation", label: "Save for a Vacation" },
  { id: "down_payment", label: "Save for a Down Payment (e.g., house, car)" },
  { id: "large_purchase", label: "Plan a Large Purchase (e.g., electronics, furniture)" },
  { id: "retirement", label: "Invest for Retirement" },
];

const CUTBACK_AREA_PRESETS = [
  { id: "dining_out", label: "Dining Out / Takeaways" },
  { id: "subscriptions", label: "Subscriptions (e.g., streaming, apps)" },
  { id: "shopping_non_essential", label: "Shopping (non-essential clothes, gadgets)" },
  { id: "entertainment_outings", label: "Entertainment (outings, events, hobbies)" },
];


export default function PrepareBudgetPage() {
  const { getBudgetForMonth, currentDisplayMonthId: initialMonthId } = useBudget();
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
    familySize: "",
    savingsGoalOptions: [],
    savingsGoalOtherText: "",
    debtGoalText: "",
    purchaseGoalText: "",
    cutbackGoalOptions: [],
    cutbackGoalOtherText: "",
    otherGoalText: "",
  });

  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(true); // Initialize to true
  const [aiError, setAiError] = useState<string | null>(null);
  const statementFileInputRef = useRef<HTMLInputElement>(null);

  const [editableCurrentIncome, setEditableCurrentIncome] = useState<string>("0");
  const [editableActualSavings, setEditableActualSavings] = useState<string>("0");
  const [editableEstimatedDebt, setEditableEstimatedDebt] = useState<string>("0");

  const isInitialOnboarding = !initialMonthId || !getBudgetForMonth(initialMonthId);

  useEffect(() => {
    setIsLoadingPageData(true);
    const sourceMonthId = initialMonthId || getYearMonthFromDate(new Date());
    if (!sourceMonthId) {
      toast({ title: "Error", description: "Current month ID is not available. Please return to the dashboard.", variant: "destructive" });
      router.push('/');
      setIsLoadingPageData(false);
      setIsLoadingAi(false); // Ensure AI loading is false if we error out
      return;
    }
    const data = getBudgetForMonth(sourceMonthId);
    setCurrentMonthData(data || null);
    setIsLoadingPageData(false); // This will trigger the next effect
  }, [initialMonthId, getBudgetForMonth, router, toast]);


  useEffect(() => {
    // This effect runs when currentMonthData is loaded or if the page is directly loaded (isLoadingPageData becomes false)
    if (!isLoadingPageData) {
      setAiError(null);
      setStatementFiles([]);
      setStatementPreviewDetails([]);
      setStatementDataUris([]);
      setGranularGoals({
        planIncome: "",
        planStartMonth: "next month",
        familySize: "",
        savingsGoalOptions: [],
        savingsGoalOtherText: "",
        debtGoalText: "",
        purchaseGoalText: "",
        cutbackGoalOptions: [],
        cutbackGoalOtherText: "",
        otherGoalText: "",
      });
      if (statementFileInputRef.current) {
        statementFileInputRef.current.value = "";
      }

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
      
      setIsLoadingAi(false); // CRITICAL: Enable inputs after all state is reset/populated
    }
  }, [isLoadingPageData, currentMonthData]);


  const handleGranularGoalChange = (field: keyof GranularGoals, value: string | string[]) => {
    setGranularGoals(prev => ({ ...prev, [field]: value }));
  };

  const handleCheckboxChange = (field: 'savingsGoalOptions' | 'cutbackGoalOptions', checkedValue: string) => {
    setGranularGoals(prev => {
      const currentOptions = prev[field] || [];
      const newOptions = currentOptions.includes(checkedValue)
        ? currentOptions.filter(v => v !== checkedValue)
        : [...currentOptions, checkedValue];
      return { ...prev, [field]: newOptions };
    });
  };


  const handleStatementFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFilesArray = Array.from(files);
      const combinedFiles = [...statementFiles, ...newFilesArray].slice(0, 5); 
      setStatementFiles(combinedFiles);
      setAiError(null);

      const newPreviewDetailsAccumulator: { name: string; type: string; dataUri?: string }[] = [];
      const newDataUrisAccumulator: string[] = [];
      
      const filesToProcess = statementFiles.length > 0 ? combinedFiles : newFilesArray;

      for (const file of filesToProcess) {
        if (newDataUrisAccumulator.length >= 5) break;
        const existingDetailIndex = statementPreviewDetails.findIndex(pd => pd.name === file.name); 
        const existingUri = existingDetailIndex !== -1 ? statementDataUris[existingDetailIndex] : undefined;
        
        if (existingUri && statementPreviewDetails[existingDetailIndex]) {
            newDataUrisAccumulator.push(existingUri);
            newPreviewDetailsAccumulator.push(statementPreviewDetails[existingDetailIndex]);
        } else {
            try {
                const dataUri = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                newDataUrisAccumulator.push(dataUri);
                newPreviewDetailsAccumulator.push({
                    name: file.name,
                    type: file.type,
                    dataUri: file.type.startsWith('image/') ? dataUri : undefined,
                });
            } catch (error) {
                console.error("Error reading new file:", file.name, error);
                setAiError(`Error processing file: ${file.name}.`);
            }
        }
      }

      setStatementDataUris(newDataUrisAccumulator.slice(0,5));
      setStatementPreviewDetails(newPreviewDetailsAccumulator.slice(0,5));
      setStatementFiles(filesToProcess.filter(f => newPreviewDetailsAccumulator.some(pd => pd.name === f.name)).slice(0,5));


      if (Array.from(files).length + statementFiles.length > 5 && statementFiles.length < 5) {
          toast({title: "File Limit Reached", description: "Maximum of 5 statement files allowed. Some files were not added.", variant: "default"});
      }
    }
    if (event.target) event.target.value = ''; 
  };

  const handleClearAllStatementFiles = () => {
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
    else goals += `User has not specified an income for this plan; use current month's income snapshot from app data if available, or assume a general case if snapshot is 0. `;

    if (granularGoals.planStartMonth.trim()) goals += `I want to start this plan in ${granularGoals.planStartMonth}. `;
    else goals += `Assume the plan starts next month. `;

    if (granularGoals.familySize.trim()) goals += `This budget is for a household of ${granularGoals.familySize} people. `;

    if (granularGoals.savingsGoalOptions.length > 0) {
      goals += `My primary savings goals include: ${granularGoals.savingsGoalOptions.join(', ')}. `;
    }
    if (granularGoals.savingsGoalOtherText.trim()) {
      goals += `Other specific savings details: ${granularGoals.savingsGoalOtherText}. `;
    }

    if (granularGoals.debtGoalText.trim()) goals += `Debt repayment goal: ${granularGoals.debtGoalText}. `;
    if (granularGoals.purchaseGoalText.trim()) goals += `Major purchase goal: ${granularGoals.purchaseGoalText}. `;

    if (granularGoals.cutbackGoalOptions.length > 0) {
      goals += `I'd like to try and cut back spending on: ${granularGoals.cutbackGoalOptions.join(', ')}. `;
    }
    if (granularGoals.cutbackGoalOtherText.trim()) {
      goals += `Other specific cutback details: ${granularGoals.cutbackGoalOtherText}. `;
    }

    if (granularGoals.otherGoalText.trim()) goals += `Other general notes, financial questions, or specific changes I'd like for this plan: ${granularGoals.otherGoalText}.`;

    if (goals.length === 0 || (
        !granularGoals.savingsGoalOptions.length && 
        !granularGoals.savingsGoalOtherText.trim() &&
        !granularGoals.debtGoalText.trim() && 
        !granularGoals.purchaseGoalText.trim() && 
        !granularGoals.cutbackGoalOptions.length &&
        !granularGoals.cutbackGoalOtherText.trim() &&
        !granularGoals.otherGoalText.trim()
    )) {
        goals += "User has not provided many specific financial goals beyond potentially their income, start month, and family size. Please provide general, foundational budgeting advice and suggestions based on the income provided."
    }
    return goals.trim();
  };

  const handleGetInitialAiSuggestions = async () => {
    const userGoalsString = constructUserGoalsString();
    if (!granularGoals.planIncome.trim() && parseFloat(editableCurrentIncome) === 0) {
      setAiError("Please provide your approximate monthly income for the new plan (in the 'About Your Income...' section), or ensure your current month's income snapshot above is set if that's what you intend to use.");
      toast({ title: "Income Required", description: "Please provide your planned income or ensure current income is reflected in the snapshot.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);

    const baseMonthIdForAI = currentMonthData?.id || initialMonthId || getYearMonthFromDate(new Date());
    const incomeForAIContext = parseFloat(editableCurrentIncome) || 0;
    const savingsForAIContext = parseFloat(editableActualSavings) || 0;
    const debtForAIContext = parseFloat(editableEstimatedDebt) || 0;
    const familySizeForAI = granularGoals.familySize.trim() ? parseInt(granularGoals.familySize, 10) : undefined;

    if (familySizeForAI !== undefined && (isNaN(familySizeForAI) || familySizeForAI <= 0)) {
        toast({ title: "Invalid Input", description: "Please enter a valid positive number for family size.", variant: "destructive" });
        setIsLoadingAi(false);
        return;
    }

    const sourceMonthDataForFeedback = getBudgetForMonth(baseMonthIdForAI);
    const previousMonthFeedbackFromSource = sourceMonthDataForFeedback?.monthEndFeedback;

    const input: PrepareBudgetInput = {
      statementDataUris: statementDataUris.length > 0 ? statementDataUris : undefined,
      userGoals: userGoalsString,
      currentMonthId: baseMonthIdForAI,
      currentIncome: incomeForAIContext,
      currentSavingsTotal: savingsForAIContext,
      currentCCDebtTotal: debtForAIContext,
      previousMonthFeedback: previousMonthFeedbackFromSource,
      familySize: familySizeForAI,
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
          currentIncome: incomeForAIContext,
          currentActualSavings: savingsForAIContext,
          currentEstimatedDebt: debtForAIContext,
          statementDataUris, 
          previousMonthFeedback: previousMonthFeedbackFromSource,
          familySize: familySizeForAI,
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
    setIsLoadingAi(true); 

    setAiError(null);
    setStatementFiles([]);
    setStatementPreviewDetails([]);
    setStatementDataUris([]);
    setGranularGoals({
      planIncome: "",
      planStartMonth: "next month",
      familySize: "",
      savingsGoalOptions: [],
      savingsGoalOtherText: "",
      debtGoalText: "",
      purchaseGoalText: "",
      cutbackGoalOptions: [],
      cutbackGoalOtherText: "",
      otherGoalText: "",
    });
    if (statementFileInputRef.current) {
      statementFileInputRef.current.value = "";
    }

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
    
    toast({title: "Form Reset", description: "All inputs cleared. Please enter your goals and upload statements again."});
    setIsLoadingAi(false); 
  };

  if (isLoadingPageData) { 
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
             <Button variant="outline" size="icon" onClick={() => router.push('/')} aria-label="Go back to dashboard">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary">Let's Create Your Financial Plan!</h1>
            <div className="w-10"></div> 
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

  const sourceMonthForSnapshot = currentMonthData?.id || initialMonthId || getYearMonthFromDate(new Date());
  const nextMonthToPrepFor = getFormattedMonthTitle(getYearMonthFromDate(new Date(parseYearMonth(sourceMonthForSnapshot).setMonth(parseYearMonth(sourceMonthForSnapshot).getMonth() + 1))));

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
                <RotateCcw className="mr-2 h-4 w-4" /> Clear All
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
                        This snapshot helps us set a baseline for your new financial plan. Feel free to adjust these numbers to best reflect your starting point for the plan we're about to create for <span className="font-semibold">{nextMonthToPrepFor}</span>.
                        <span className="block mt-1 text-xs text-muted-foreground">For a completely fresh AI plan, you can set these values to 0 or your new desired baseline.</span>
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                      <div>
                          <Label htmlFor="editableCurrentIncome" className="text-xs text-muted-foreground flex items-center"><DollarSign className="h-4 w-4 mr-1 text-green-500"/>Income This Month (App Data)</Label>
                          <Input id="editableCurrentIncome" type="number" value={editableCurrentIncome} onChange={(e) => setEditableCurrentIncome(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                      <div>
                          <Label htmlFor="editableActualSavings" className="text-xs text-muted-foreground flex items-center"><PiggyBank className="h-4 w-4 mr-1 text-blue-500"/>Actual Savings This Month (App Data)</Label>
                          <Input id="editableActualSavings" type="number" value={editableActualSavings} onChange={(e) => setEditableActualSavings(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                      <div>
                          <Label htmlFor="editableEstimatedDebt" className="text-xs text-muted-foreground flex items-center"><CreditCard className="h-4 w-4 mr-1 text-red-500"/>Est. CC Debt End of Month (App Data)</Label>
                          <Input id="editableEstimatedDebt" type="number" value={editableEstimatedDebt} onChange={(e) => setEditableEstimatedDebt(e.target.value)} disabled={isLoadingAi} className="mt-1 font-semibold text-base"/>
                      </div>
                  </CardContent>
              </Card>
              {isInitialOnboarding && (
                 <Alert>
                    <Sparkles className="h-4 w-4" />
                    <AlertTitle>Welcome to AI Financial Planning!</AlertTitle>
                    <AlertDescription>
                      Since this looks like your first time creating a plan, the snapshot above might be zero.
                      Please fill in your income for the new plan below, and tell me about your goals.
                      I'll then help create your first budget!
                    </AlertDescription>
                  </Alert>
              )}

              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">About Your Income & Timing for This Plan</CardTitle>
                      <CardDescription>Let's set the stage for your new budget.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div>
                          <Label htmlFor="planIncome">What's your approximate monthly income we'll be working with for this plan? (Required if snapshot income is 0)</Label>
                          <Input id="planIncome" type="number" placeholder="e.g., 4000" value={granularGoals.planIncome} onChange={(e) => handleGranularGoalChange('planIncome', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                          <p className="text-xs text-muted-foreground mt-1">If this is for a new plan, enter the income you want me to use. Otherwise, I'll use the snapshot income if this is blank.</p>
                      </div>
                      <div>
                          <Label htmlFor="planStartMonth">When would you ideally like this new financial chapter to begin?</Label>
                          <Input id="planStartMonth" placeholder="e.g., next month, or August 2025" value={granularGoals.planStartMonth} onChange={(e) => handleGranularGoalChange('planStartMonth', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                      </div>
                      <div>
                          <Label htmlFor="familySize" className="flex items-center">
                            <Users className="mr-2 h-4 w-4 text-muted-foreground"/>
                            How many people (including yourself!) are we budgeting for in your household? (Optional)
                          </Label>
                          <Input id="familySize" type="number" placeholder="e.g., 1, 2, 4" value={granularGoals.familySize} onChange={(e) => handleGranularGoalChange('familySize', e.target.value)} disabled={isLoadingAi} className="mt-1"/>
                      </div>
                  </CardContent>
              </Card>

              <Card>
                <CardHeader>
                    <CardTitle className="text-lg">What Are Your Financial Dreams & Priorities?</CardTitle>
                    <CardDescription>Thinking about your goals helps us build a plan that truly works for you. Select common goals or specify your own.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div>
                        <Label className="text-base font-medium mb-2 block">What are you aiming to save for?</Label>
                        <div className="space-y-2">
                            {SAVINGS_GOAL_PRESETS.map(goal => (
                                <div key={goal.id} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`savings-${goal.id}`}
                                    checked={granularGoals.savingsGoalOptions.includes(goal.label)}
                                    onCheckedChange={() => handleCheckboxChange('savingsGoalOptions', goal.label)}
                                    disabled={isLoadingAi}
                                />
                                <Label htmlFor={`savings-${goal.id}`} className="text-sm font-normal">
                                    {goal.label}
                                </Label>
                                </div>
                            ))}
                        </div>
                        <Textarea 
                            id="savingsGoalOtherText" 
                            placeholder="Other savings goals or specific details (e.g., 'Save $2000 for a trip to Italy in December')" 
                            value={granularGoals.savingsGoalOtherText} 
                            onChange={(e) => handleGranularGoalChange('savingsGoalOtherText', e.target.value)} 
                            disabled={isLoadingAi} 
                            className="mt-3" 
                            rows={2}
                        />
                    </div>
                    
                    <div>
                        <Label htmlFor="debtGoalText" className="text-base font-medium">Are there any debts you're focused on reducing or paying off?</Label>
                        <Textarea id="debtGoalText" placeholder="e.g., Pay an extra $100 on my Visa card (balance $3000). Or, pay off student loan in 5 years." value={granularGoals.debtGoalText} onChange={(e) => handleGranularGoalChange('debtGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>
                    <div>
                        <Label htmlFor="purchaseGoalText" className="text-base font-medium">Any significant purchases or financial milestones on your mind?</Label>
                        <Textarea id="purchaseGoalText" placeholder="e.g., Save for a new computer, $1500 in 6 months. Or, plan for a car down payment of $5000 in 2 years." value={granularGoals.purchaseGoalText} onChange={(e) => handleGranularGoalChange('purchaseGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={2}/>
                    </div>

                    <div>
                        <Label className="text-base font-medium mb-2 block">Are there specific areas where you'd like to try and reduce spending?</Label>
                        <div className="space-y-2">
                            {CUTBACK_AREA_PRESETS.map(area => (
                                <div key={area.id} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`cutback-${area.id}`}
                                    checked={granularGoals.cutbackGoalOptions.includes(area.label)}
                                    onCheckedChange={() => handleCheckboxChange('cutbackGoalOptions', area.label)}
                                    disabled={isLoadingAi}
                                />
                                <Label htmlFor={`cutback-${area.id}`} className="text-sm font-normal">
                                    {area.label}
                                </Label>
                                </div>
                            ))}
                        </div>
                         <Textarea 
                            id="cutbackGoalOtherText" 
                            placeholder="Other areas to cut back or specific details (e.g., 'Reduce coffee shop visits to once a week')" 
                            value={granularGoals.cutbackGoalOtherText} 
                            onChange={(e) => handleGranularGoalChange('cutbackGoalOtherText', e.target.value)} 
                            disabled={isLoadingAi} 
                            className="mt-3" 
                            rows={2}
                        />
                    </div>

                    <div>
                        <Label htmlFor="otherGoalText" className="text-base font-medium">Anything else important for your financial plan?</Label>
                        <Textarea id="otherGoalText" placeholder="e.g., 'My previous month's budget felt too strict.' or 'Can we increase travel to $Y?' or 'Help me understand why X is suggested.'" value={granularGoals.otherGoalText} onChange={(e) => handleGranularGoalChange('otherGoalText', e.target.value)} disabled={isLoadingAi} className="mt-1" rows={3}/>
                    </div>
                </CardContent>
              </Card>

              <Card>
                  <CardHeader>
                      <CardTitle className="text-lg">Want Even More Personalized Advice? <span className="text-xs text-muted-foreground">(Optional, Max 5 Files)</span></CardTitle>
                      <CardDescription>If you have recent bank statements or spending summaries (images or PDFs), sharing them helps me understand your current habits to give smarter suggestions.</CardDescription>
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
                              <Button variant="ghost" size="sm" onClick={handleClearAllStatementFiles} disabled={isLoadingAi} className="text-xs h-7">
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
                                          <Image src={detail.dataUri} alt={`${detail.name} preview`} layout="fill" objectFit="contain" data-ai-hint="financial document"/>
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

              <Button onClick={handleGetInitialAiSuggestions} disabled={isLoadingAi || (!granularGoals.planIncome.trim() && parseFloat(editableCurrentIncome) === 0))} className="w-full py-3 text-base font-semibold">
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
