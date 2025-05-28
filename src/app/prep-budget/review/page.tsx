
"use client";
import { useState, useEffect, useCallback } from "react";
import type { BudgetMonth, BudgetCategory as BudgetCategoryType } from "@/types/budget"; 
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard, ArrowLeft, MessageSquareText, ListChecks, FileText, Edit3, Users, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Separator } from "@/components/ui/separator";
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Match the granular goals structure from the input page
type GranularGoalsForReview = {
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

interface StoredAIPrepData {
    granularGoals: GranularGoalsForReview; 
    statementFileNames: string[];
    currentMonthId: string;
    currentIncome: number; 
    currentActualSavings: number; 
    currentEstimatedDebt: number; 
    statementDataUris?: string[];
    previousMonthFeedback?: string; 
    familySize?: number; 
}

export default function PrepareBudgetReviewPage() {
  const { applyAiGeneratedBudget, setCurrentDisplayMonthId, getBudgetForMonth } = useBudget();
  const { toast } = useToast();
  const router = useRouter();

  const [initialInputs, setInitialInputs] = useState<StoredAIPrepData | null>(null);
  const [currentSuggestions, setCurrentSuggestions] = useState<PrepareBudgetOutput | null>(null);
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [refinementText, setRefinementText] = useState<string>("");
  const [pageIsLoading, setPageIsLoading] = useState(true);

  useEffect(() => {
    const storedSuggestions = sessionStorage.getItem('aiPrepInitialSuggestions');
    const storedInputs = sessionStorage.getItem('aiPrepInitialInputs');

    if (storedSuggestions && storedInputs) {
      try {
        setCurrentSuggestions(JSON.parse(storedSuggestions));
        setInitialInputs(JSON.parse(storedInputs));
      } catch (e) {
        console.error("Error parsing stored AI prep data:", e);
        toast({ title: "Error", description: "Could not load AI suggestions. Please start over.", variant: "destructive" });
        router.push('/prep-budget');
      }
    } else {
      toast({ title: "No Data", description: "No AI suggestions found. Please start the budget prep process again.", variant: "destructive" });
      router.push('/prep-budget');
    }
    setPageIsLoading(false);
  }, [router, toast]);

  const constructUserGoalsStringFromGranular = useCallback((granular: GranularGoalsForReview | undefined, additionalRefinement?: string): string => {
    let goals = "";
    if (granular) {
        if (granular.planIncome.trim()) goals += `My income for this plan will be $${granular.planIncome}. `;
        if (granular.planStartMonth.trim()) goals += `I want to start this plan in ${granular.planStartMonth}. `;
        if (granular.familySize.trim()) goals += `This budget is for a household of ${granular.familySize} people. `;
        
        if (granular.savingsGoalOptions && granular.savingsGoalOptions.length > 0) {
          goals += `Primary savings goals: ${granular.savingsGoalOptions.join(', ')}. `;
        }
        if (granular.savingsGoalOtherText && granular.savingsGoalOtherText.trim()) {
          goals += `Other savings details: ${granular.savingsGoalOtherText}. `;
        }

        if (granular.debtGoalText && granular.debtGoalText.trim()) goals += `Debt repayment goal: ${granular.debtGoalText}. `;
        if (granular.purchaseGoalText && granular.purchaseGoalText.trim()) goals += `Major purchase goal: ${granular.purchaseGoalText}. `;

        if (granular.cutbackGoalOptions && granular.cutbackGoalOptions.length > 0) {
          goals += `I'd like to cut back on: ${granular.cutbackGoalOptions.join(', ')}. `;
        }
        if (granular.cutbackGoalOtherText && granular.cutbackGoalOtherText.trim()) {
          goals += `Other cutback details: ${granular.cutbackGoalOtherText}. `;
        }

        if (granular.otherGoalText && granular.otherGoalText.trim()) goals += `Other notes or questions: ${granular.otherGoalText}.`;
    }
    if (additionalRefinement && additionalRefinement.trim()) {
        goals += `\n\n--- User Refinement Request/Question for Current Plan ---\n${additionalRefinement.trim()}`;
    }
    if (goals.length === 0 || (granular &&
        !granular.savingsGoalOptions.length && 
        !granular.savingsGoalOtherText.trim() &&
        !granular.debtGoalText.trim() && 
        !granular.purchaseGoalText.trim() && 
        !granular.cutbackGoalOptions.length &&
        !granular.cutbackGoalOtherText.trim() &&
        !granular.otherGoalText.trim() &&
        !additionalRefinement?.trim()
    )) {
        goals = "User has not provided specific financial goals for this refinement.";
    }
    return goals.trim();
  }, []);


  const handleUpdateSuggestions = async () => {
    if (!initialInputs) {
      setAiError("Initial input data is missing. Cannot refine.");
      toast({ title: "Error", description: "Missing initial data. Please start over.", variant: "destructive" });
      return;
    }
    if (!refinementText.trim()) {
        toast({ title: "Refinement Needed", description: "Please type your questions or requested changes.", variant: "default" });
        return;
    }
    setIsLoadingAi(true);
    setAiError(null);

    const updatedUserGoalsForAI = constructUserGoalsStringFromGranular(initialInputs.granularGoals, refinementText);

    const input: PrepareBudgetInput = {
      statementDataUris: initialInputs.statementDataUris, 
      userGoals: updatedUserGoalsForAI, 
      currentMonthId: initialInputs.currentMonthId,
      currentIncome: initialInputs.currentIncome, 
      currentSavingsTotal: initialInputs.currentActualSavings,
      currentCCDebtTotal: initialInputs.currentEstimatedDebt,
      previousMonthFeedback: initialInputs.previousMonthFeedback, 
      familySize: initialInputs.familySize, 
    };

    try {
      const result = await prepareNextMonthBudget(input);
      if (result.aiError) {
        setAiError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        setCurrentSuggestions(result);
        setRefinementText(""); 
        toast({ title: "AI Suggestions Updated!", description: "Review the updated plan below.", duration: 5000 });
        sessionStorage.setItem('aiPrepInitialSuggestions', JSON.stringify(result));
      }
    } catch (error: any) {
      const message = error.message || "An unexpected error occurred while updating AI suggestions.";
      setAiError(message);
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsLoadingAi(false);
    }
  };

  const handleApplyBudget = () => {
    if (!currentSuggestions?.suggestedCategories || currentSuggestions.suggestedCategories.length === 0) {
      toast({ title: "No Budget to Apply", description: "AI did not provide budget categories.", variant: "destructive" });
      return;
    }
    if (!initialInputs || currentSuggestions.incomeBasisForBudget === undefined) {
        toast({ title: "Error", description: "Initial input data or AI income basis for context is missing.", variant: "destructive" });
        return;
    }

    const currentMonthDate = parseYearMonth(initialInputs.currentMonthId);
    currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentMonthDate);
    
    applyAiGeneratedBudget(
      nextMonthId,
      currentSuggestions.suggestedCategories,
      currentSuggestions.incomeBasisForBudget, 
      initialInputs.currentEstimatedDebt 
    );

    toast({
      title: "Budget Applied!",
      description: `AI-suggested budget has been applied to ${getFormattedMonthTitle(nextMonthId)}. You will be navigated to the new month.`,
      action: <CheckCircle className="text-green-500" />,
    });
    sessionStorage.removeItem('aiPrepInitialSuggestions');
    sessionStorage.removeItem('aiPrepInitialInputs');
    setCurrentDisplayMonthId(nextMonthId);
    router.push('/'); 
  };

  const getFormattedMonthTitle = (monthId: string) => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  const handleGoBackToInputs = () => {
    router.push('/prep-budget');
  };
  
  const renderSuggestedCategoriesList = (categories: PrepareBudgetOutput['suggestedCategories']) => {
    if (!categories || categories.length === 0) {
      return <p className="text-sm text-muted-foreground">No budget categories suggested by AI.</p>;
    }
    return (
      <ScrollArea className="h-72 border rounded-md p-3 bg-muted/20 shadow-inner">
        <ul className="space-y-3 text-sm">
          {categories.map((cat, index) => (
            <li key={index} className="p-3 border rounded-md bg-background shadow-sm hover:shadow-md transition-shadow">
              <div className="font-semibold text-base text-primary">{cat.name}: ${cat.budgetedAmount?.toFixed(2) || '0.00'}</div>
              {cat.subcategories && cat.subcategories.length > 0 && (
                <ul className="pl-4 mt-2 space-y-1.5 text-xs border-l-2 ml-2 border-border">
                  {cat.subcategories.map((sub, subIndex) => (
                    <li key={subIndex} className="text-muted-foreground pt-1 border-t border-dashed border-border/50 first:border-t-0 first:pt-0">
                      {sub.name}: <span className="font-medium text-foreground">${sub.budgetedAmount?.toFixed(2) || '0.00'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </ScrollArea>
    );
  };

  const calculateBudgetSummary = () => {
    if (!currentSuggestions?.suggestedCategories || !initialInputs) {
        return { totalBudgeted: 0, balance: 0, projectedIncome: 0 };
    }
    let totalBudgeted = 0;
    (currentSuggestions.suggestedCategories || []).forEach(cat => {
        if (cat.subcategories && cat.subcategories.length > 0) {
            cat.subcategories.forEach(sub => {
                totalBudgeted += sub.budgetedAmount || 0;
            });
        } else {
            totalBudgeted += cat.budgetedAmount || 0;
        }
    });
    const incomeForCalculation = currentSuggestions.incomeBasisForBudget ?? initialInputs.currentIncome;
    const balance = incomeForCalculation - totalBudgeted;
    return { totalBudgeted, balance, projectedIncome: incomeForCalculation };
  };

  const budgetSummary = calculateBudgetSummary();

  if (pageIsLoading || !initialInputs || !currentSuggestions) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
             <Button variant="outline" size="icon" onClick={handleGoBackToInputs} aria-label="Back to inputs">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary">Review AI Budget</h1>
             <div className="w-10"></div>
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
            <Skeleton className="h-12 w-1/2 mb-6" />
            <Skeleton className="h-40 w-full mb-4" />
            <Skeleton className="h-60 w-full mb-4" />
            <Skeleton className="h-10 w-full" />
        </main>
      </div>
    );
  }

  const nextMonthToPrep = getFormattedMonthTitle(getYearMonthFromDate(new Date(parseYearMonth(initialInputs.currentMonthId).setMonth(parseYearMonth(initialInputs.currentMonthId).getMonth() + 1))));

  const renderGranularGoals = (goals: GranularGoalsForReview | undefined) => {
    if (!goals) return <p className="text-xs italic">No granular goals provided.</p>;
    const goalItems: {label: string, value: string | number | undefined | string[]}[] = [ 
        {label: "Planned Income for New Plan", value: goals.planIncome ? `$${goals.planIncome}` : "Not specified"},
        {label: "Desired Start Month", value: goals.planStartMonth || "Not specified"},
        {label: "Household Size", value: goals.familySize || (initialInputs?.familySize ? String(initialInputs.familySize) : "Not specified") }, 
        {label: "Primary Savings Goals", value: goals.savingsGoalOptions && goals.savingsGoalOptions.length > 0 ? goals.savingsGoalOptions.join(', ') : "Not specified"},
        {label: "Other Savings Details", value: goals.savingsGoalOtherText || "Not specified"},
        {label: "Debt Repayment Goals", value: goals.debtGoalText || "Not specified"},
        {label: "Major Purchase Goals", value: goals.purchaseGoalText || "Not specified"},
        {label: "Areas to Cut Back Spending", value: goals.cutbackGoalOptions && goals.cutbackGoalOptions.length > 0 ? goals.cutbackGoalOptions.join(', ') : "Not specified"},
        {label: "Other Cutback Details", value: goals.cutbackGoalOtherText || "Not specified"},
        {label: "Other Notes/General Goals", value: goals.otherGoalText || "Not specified"},
    ];
    return (
        <ul className="space-y-1">
            {goalItems.filter(item => item.value && (Array.isArray(item.value) ? item.value.length > 0 : String(item.value).trim() !== "" && item.value !== "Not specified")).map(item => (
                <li key={item.label}><span className="font-semibold">{item.label}:</span> {Array.isArray(item.value) ? item.value.join(', ') : item.value}</li>
            ))}
        </ul>
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
       <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <Button variant="outline" size="icon" onClick={handleGoBackToInputs} aria-label="Back to initial inputs">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary truncate px-2">Your AI-Powered Financial Plan for {nextMonthToPrep}</h1>
             <Button variant="outline" size="sm" onClick={handleGoBackToInputs} disabled={isLoadingAi}>
                <Edit3 className="mr-2 h-4 w-4" /> Edit Inputs & Regenerate
            </Button>
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-8 pb-8">
                <Card className="shadow-lg border-primary/30">
                    <CardHeader>
                        <CardTitle className="text-xl text-primary flex items-center"><Sparkles className="mr-2 h-6 w-6 text-amber-500" /> My AI Financial Advisor's Plan for {nextMonthToPrep}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <Card className="bg-muted/30">
                          <CardHeader className="pb-2">
                              <CardTitle className="text-base">Here's What I Used to Create Your Plan:</CardTitle>
                          </CardHeader>
                          <CardContent className="text-xs space-y-2">
                              <div>
                                <h5 className="font-medium mb-1">Your Stated Goals & Context:</h5>
                                {renderGranularGoals(initialInputs.granularGoals)}
                              </div>
                              {initialInputs.statementFileNames.length > 0 && <p><span className="font-semibold">Statements Provided:</span> {initialInputs.statementFileNames.join(', ')}</p> }
                               <p><span className="font-semibold">Source Month Income (App Data):</span> ${initialInputs.currentIncome.toFixed(2)}</p>
                               <p><span className="font-semibold">Source Month Actual Savings (App Data):</span> ${initialInputs.currentActualSavings.toFixed(2)}</p>
                               <p><span className="font-semibold">Source Month Est. CC Debt (App Data):</span> ${initialInputs.currentEstimatedDebt.toFixed(2)}</p>
                               {initialInputs.previousMonthFeedback && <p><span className="font-semibold">Your Feedback on Source Month:</span> {initialInputs.previousMonthFeedback}</p>}
                          </CardContent>
                        </Card>

                        <div>
                            <h4 className="text-lg font-medium flex items-center mb-2"><MessageSquareText className="mr-2 h-5 w-5 text-blue-500"/>My Financial Advice & How This Plan Helps You:</h4>
                            <ScrollArea className="h-48 p-4 border rounded-lg bg-muted/20 text-sm shadow-inner">
                                <p className="whitespace-pre-wrap leading-relaxed">{currentSuggestions.financialAdvice}</p>
                            </ScrollArea>
                        </div>
                        
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">AI Budget Overview</CardTitle>
                                <CardDescription>Summary of my suggested plan against the income basis I used for {nextMonthToPrep}.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span>Projected Income (AI Basis for Plan):</span> 
                                    <span className="font-semibold">${budgetSummary.projectedIncome.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Total Suggested Budget:</span> 
                                    <span className="font-semibold">${budgetSummary.totalBudgeted.toFixed(2)}</span>
                                </div>
                                <div className={`flex justify-between font-semibold ${budgetSummary.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                                    <span>{budgetSummary.balance >= 0 ? 'Remaining Unbudgeted:' : 'Shortfall:'}</span> 
                                    <span>${Math.abs(budgetSummary.balance).toFixed(2)}</span>
                                </div>
                            </CardContent>
                        </Card>

                        <div>
                            <h4 className="text-lg font-medium flex items-center mb-2"><ListChecks className="mr-2 h-5 w-5 text-green-500"/>My Suggested Budget For You:</h4>
                            {renderSuggestedCategoriesList(currentSuggestions.suggestedCategories)}
                        </div>

                        <Separator className="my-6"/>
                        
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Want to Make Changes or Ask Questions?</CardTitle>
                                <CardDescription>
                                   This is your plan! Type your questions or requested changes below (e.g., "Why is my 'Fun Money' budget $X?", "Can we try to increase savings by $Y and reduce X by $Z?"). Then click "Update Suggestions Directly" and I'll revise the plan based on your feedback!
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    id="refinementText"
                                    value={refinementText}
                                    onChange={(e) => setRefinementText(e.target.value)}
                                    placeholder="For direct refinement, type your questions or changes here (e.g., 'Increase savings by $100') and click 'Update Suggestions Directly' below."
                                    className="min-h-[100px] text-base"
                                    rows={4}
                                    disabled={isLoadingAi}
                                />
                                <Button onClick={handleUpdateSuggestions} disabled={isLoadingAi || !refinementText.trim()} className="w-full mt-4 py-3 text-base font-semibold">
                                    {isLoadingAi ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wand2 className="mr-2 h-5 w-5" />}
                                    Update Suggestions Directly With Above Refinements
                                </Button>
                            </CardContent>
                        </Card>
                                              
                        <div className="mt-6">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className="w-full py-3 text-base font-semibold" variant="default" size="lg" disabled={!currentSuggestions.suggestedCategories || (currentSuggestions.suggestedCategories || []).length === 0 || isLoadingAi}>
                                    <CheckCircle className="mr-2 h-5 w-5"/> Apply This Budget
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>Confirm Apply Budget</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will set up the budget for {nextMonthToPrep} 
                                    using the current AI suggestions. Any existing budget for that month will be overwritten. Are you sure?
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
                        </div>
                    </CardContent>
                  </Card>
                
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
