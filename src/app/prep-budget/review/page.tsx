
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetMonth, BudgetCategory as BudgetCategoryType } from "@/types/budget"; // Renamed to avoid conflict
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Wand2, Loader2, CheckCircle, XCircle, Info, DollarSign, PiggyBank, CreditCard, ArrowLeft, MessageSquareText, ListChecks, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { prepareNextMonthBudget, type PrepareBudgetInput, type PrepareBudgetOutput } from "@/ai/flows/prepare-next-month-budget-flow";
import { getYearMonthFromDate, parseYearMonth } from "@/hooks/useBudgetCore";
import { Separator } from "@/components/ui/separator";
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StoredAIPrepData {
    userGoals: string;
    statementFileNames: string[];
    currentMonthId: string;
    currentIncome: number;
    currentActualSavings: number;
    currentEstimatedDebt: number;
    statementDataUris?: string[]; 
}

export default function PrepareBudgetReviewPage() {
  const { applyAiGeneratedBudget, setCurrentDisplayMonthId } = useBudget();
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

  const handleUpdateSuggestions = async () => {
    if (!initialInputs) {
      setAiError("Initial input data is missing. Cannot refine.");
      toast({ title: "Error", description: "Missing initial data. Please start over.", variant: "destructive" });
      return;
    }
    setIsLoadingAi(true);
    setAiError(null);

    // Combine original goals with new refinement text
    const updatedUserGoals = `${initialInputs.userGoals}\n\n--- Refinement Request ---\n${refinementText}`;

    const input: PrepareBudgetInput = {
      statementDataUris: initialInputs.statementDataUris, 
      userGoals: updatedUserGoals,
      currentMonthId: initialInputs.currentMonthId,
      currentIncome: initialInputs.currentIncome,
      currentSavingsTotal: initialInputs.currentActualSavings,
      currentCCDebtTotal: initialInputs.currentEstimatedDebt,
    };

    try {
      const result = await prepareNextMonthBudget(input);
      if (result.aiError) {
        setAiError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        setCurrentSuggestions(result);
        setRefinementText(""); 
        toast({ title: "AI Suggestions Updated", description: "Review the updated plan.", duration: 5000 });
        sessionStorage.setItem('aiPrepInitialSuggestions', JSON.stringify(result));
        sessionStorage.setItem('aiPrepInitialInputs', JSON.stringify({
            ...initialInputs,
            userGoals: updatedUserGoals 
        }));

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
    if (!initialInputs) {
        toast({ title: "Error", description: "Initial input data for context is missing.", variant: "destructive" });
        return;
    }

    const currentMonthDate = parseYearMonth(initialInputs.currentMonthId);
    currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
    const nextMonthId = getYearMonthFromDate(currentMonthDate);
    
    const ccPaymentsCategory = currentSuggestions.suggestedCategories.find(c => c.name.toLowerCase() === "credit card payments");
    const aiSuggestedCCPayment = ccPaymentsCategory?.budgetedAmount || 0;
    // For applyAiGeneratedBudget, ccPaymentsMadeInCurrentMonth should be ACTUAL payments from CURRENT month.
    // This info isn't directly available in initialInputs which has *estimated* debt.
    // For simplicity, we'll pass the AI's suggested CC payment for *next* month.
    // The useBudgetCore hook's applyAi... will need to correctly calculate next month's starting debt.
    // This is a point of potential refinement for debt carryover accuracy.
    
    applyAiGeneratedBudget(
      nextMonthId,
      currentSuggestions.suggestedCategories,
      initialInputs.currentIncome, 
      initialInputs.currentEstimatedDebt, 
      aiSuggestedCCPayment // Passing AI's suggested payment for next month.
                           // Actual previous month's payment needs to be fetched or calculated.
                           // `useBudgetCore` `applyAiGeneratedBudget` should use `initialInputs.currentEstimatedDebt` as the starting debt for next month for now.
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
    currentSuggestions.suggestedCategories.forEach(cat => {
        if (cat.subcategories && cat.subcategories.length > 0) {
            cat.subcategories.forEach(sub => {
                totalBudgeted += sub.budgetedAmount || 0;
            });
        } else {
            totalBudgeted += cat.budgetedAmount || 0;
        }
    });
    const projectedIncome = initialInputs.currentIncome;
    const balance = projectedIncome - totalBudgeted;
    return { totalBudgeted, balance, projectedIncome };
  };

  const budgetSummary = calculateBudgetSummary();

  if (pageIsLoading || !initialInputs || !currentSuggestions) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <h1 className="text-xl font-bold text-primary">Review AI Budget</h1>
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

  return (
    <div className="flex flex-col min-h-screen bg-background">
       <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
            <Button variant="outline" size="icon" onClick={handleGoBackToInputs} aria-label="Back to inputs">
                <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-primary truncate px-2">Review & Refine for {nextMonthToPrep}</h1>
            <div className="w-8"></div> 
          </div>
        </header>
        <main className="flex-1 container max-w-3xl mx-auto p-4 sm:p-6 md:p-8">
        <ScrollArea className="h-full pr-2">
          <div className="space-y-8 pb-8">
                <Card className="shadow-lg border-primary/30">
                    <CardHeader>
                        <CardTitle className="text-xl text-primary">AI Suggestions for {nextMonthToPrep}</CardTitle>
                        <CardDescription>Review the AI's plan. You can refine it below or apply if satisfied.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <Card className="bg-muted/30">
                          <CardHeader className="pb-2">
                              <CardTitle className="text-base">Inputs Used for Current Suggestion:</CardTitle>
                          </CardHeader>
                          <CardContent className="text-xs space-y-1">
                              <p className="whitespace-pre-wrap"><span className="font-semibold">Your Goals:</span> {initialInputs.userGoals || "Not specified"}</p>
                              <p><span className="font-semibold">Statements:</span> {initialInputs.statementFileNames.length > 0 ? initialInputs.statementFileNames.join(', ') : "None provided"}</p>
                          </CardContent>
                        </Card>

                        <div>
                            <h4 className="text-lg font-medium flex items-center mb-2"><MessageSquareText className="mr-2 h-5 w-5 text-blue-500"/>Financial Advice & Explanations:</h4>
                            <ScrollArea className="h-48 p-4 border rounded-lg bg-muted/20 text-sm shadow-inner">
                                <p className="whitespace-pre-wrap leading-relaxed">{currentSuggestions.financialAdvice}</p>
                            </ScrollArea>
                        </div>
                        
                        <div>
                            <h4 className="text-lg font-medium flex items-center mb-2"><ListChecks className="mr-2 h-5 w-5 text-green-500"/>Suggested Budget Categories:</h4>
                            {renderSuggestedCategoriesList(currentSuggestions.suggestedCategories)}
                        </div>

                        <Separator className="my-6"/>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">AI Budget Overview</CardTitle>
                                <CardDescription>Summary of the AI's suggested plan against your income.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between"><span>Projected Income:</span> <span className="font-semibold">${budgetSummary.projectedIncome.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span>Total Suggested Budget:</span> <span className="font-semibold">${budgetSummary.totalBudgeted.toFixed(2)}</span></div>
                                <div className={`flex justify-between font-semibold ${budgetSummary.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
                                    <span>{budgetSummary.balance >= 0 ? 'Remaining Unbudgeted:' : 'Shortfall:'}</span> 
                                    <span>${Math.abs(budgetSummary.balance).toFixed(2)}</span>
                                </div>
                            </CardContent>
                        </Card>


                        <Separator className="my-6"/>
                        
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Refine Suggestions</CardTitle>
                                <CardDescription>
                                    Type any questions, desired changes, or clarifications here. The AI will use this and your original inputs to generate an updated plan. 
                                    E.g., "Why is my dining out budget so low?", "Can you try to allocate $100 more to Groceries?", "Explain the savings strategy."
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    id="refinementText"
                                    value={refinementText}
                                    onChange={(e) => setRefinementText(e.target.value)}
                                    placeholder="Enter your refinement requests or questions here..."
                                    className="min-h-[100px] text-base"
                                    rows={4}
                                    disabled={isLoadingAi}
                                />
                                <Button onClick={handleUpdateSuggestions} disabled={isLoadingAi || !refinementText.trim()} className="w-full mt-4 py-3 text-base font-semibold">
                                    {isLoadingAi ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Wand2 className="mr-2 h-5 w-5" />}
                                    Update Suggestions with Refinements
                                </Button>
                            </CardContent>
                        </Card>
                                              
                        <div className="mt-6">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button className="w-full py-3 text-base font-semibold" variant="default" size="lg" disabled={!currentSuggestions.suggestedCategories || currentSuggestions.suggestedCategories.length === 0 || isLoadingAi}>
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

    
