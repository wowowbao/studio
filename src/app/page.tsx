
"use client";
import { useState, useEffect } from 'react';
import { useAuth } from "@/hooks/useAuth"; 
import { useBudget } from "@/hooks/useBudget";
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { CategoryCard } from "@/components/budget/CategoryCard";
import { SummaryCards } from "@/components/budget/SummaryCards";
import { BudgetActions } from "@/components/budget/BudgetActions";
import { BudgetChart } from "@/components/budget/BudgetChart";
import { EditBudgetModal } from "@/components/budget/EditBudgetModal";
import { AddExpenseModal } from "@/components/budget/AddExpenseModal";
import { AddIncomeModal } from "@/components/budget/AddIncomeModal"; 
import { CreditCardDebtSummary } from "@/components/budget/CreditCardDebtSummary";
import { MonthEndSummaryModal } from "@/components/budget/MonthEndSummaryModal";
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, LayoutDashboard, Moon, Sun, LogOut, UserCircle, ShieldX, Sparkles, Coins, PiggyBank, XCircle } from 'lucide-react';
import { useTheme } from "next-themes";
import { auth } from '@/lib/firebase'; 
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BudgetCategory, BudgetMonth } from '@/types/budget';
import { parseYearMonth } from '@/hooks/useBudgetCore';
import Link from 'next/link';


export default function HomePage() {
  const { user, loading: authLoading, isUserAuthenticated } = useAuth();
  
  const { 
    currentBudgetMonth, 
    currentDisplayMonthId, 
    isLoading: budgetLoading, 
    budgetMonths,
    getBudgetForMonth, 
    ensureMonthExists, 
  } = useBudget();

  const [isEditBudgetModalOpen, setIsEditBudgetModalOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const [isAddIncomeModalOpen, setIsAddIncomeModalOpen] = useState(false);
  const [isMonthEndSummaryModalOpen, setIsMonthEndSummaryModalOpen] = useState(false); 
  const [monthEndSummaryData, setMonthEndSummaryData] = useState<BudgetMonth | undefined>(undefined); 
  const { theme, setTheme } = useTheme();
  const [showGuestAlert, setShowGuestAlert] = useState(false);

  useEffect(() => {
    if (!authLoading && currentDisplayMonthId) { 
      ensureMonthExists(currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, authLoading, ensureMonthExists]);


  useEffect(() => {
    if (!authLoading && !isUserAuthenticated) {
      const guestAlertDismissed = sessionStorage.getItem('guestAlertDismissed');
      if (!guestAlertDismissed) {
        setShowGuestAlert(true);
      }
    }
  }, [authLoading, isUserAuthenticated]);

  const handleSignOut = async () => {
    try {
      await auth.signOut();
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  };

  const dismissGuestAlert = () => {
    setShowGuestAlert(false);
    sessionStorage.setItem('guestAlertDismissed', 'true');
  };

  const openMonthEndSummary = () => {
    const data = getBudgetForMonth(currentDisplayMonthId); 
    if (data) { 
      setMonthEndSummaryData(data);
      setIsMonthEndSummaryModalOpen(true);
    }
  };

  const isLoading = authLoading || budgetLoading;

  const getFormattedMonthTitle = (monthId: string) => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };


  if (isLoading && !Object.keys(budgetMonths).length && !currentBudgetMonth) { 
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
        <LayoutDashboard className="h-16 w-16 text-primary mb-4 animate-bounce" />
        <h1 className="text-3xl font-bold text-primary mb-2">BudgetFlow</h1>
        <p className="text-muted-foreground">Getting your budget ready...</p>
        <div className="w-full max-w-md mt-8 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  
  const allCategories = currentBudgetMonth?.categories || [];
  const systemCategories: BudgetCategory[] = [];
  const operationalCategories: BudgetCategory[] = [];

  allCategories.forEach(cat => {
    if (cat.isSystemCategory && (cat.name.toLowerCase() === 'savings' || cat.name.toLowerCase() === 'credit card payments')) {
      systemCategories.push(cat);
    } else if (!cat.isSystemCategory) {
      operationalCategories.push(cat);
    }
  });

  systemCategories.sort((a, b) => {
    if (a.name.toLowerCase() === 'savings') return -1; 
    if (b.name.toLowerCase() === 'savings') return 1;
    if (a.name.toLowerCase() === 'credit card payments') return -1; 
    if (b.name.toLowerCase() === 'credit card payments') return 1;
    return 0;
  });


  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold text-primary">BudgetFlow</h1>
          </div>
          <div className="flex items-center gap-2">
            {isUserAuthenticated && user ? (
              <>
                <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[150px]">{user.email}</span>
                <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign Out">
                  <LogOut className="h-5 w-5" />
                </Button>
              </>
            ) : (
              <Link href="/signin" legacyBehavior passHref>
                <Button variant="outline" asChild>
                  <a>
                    <UserCircle className="mr-2 h-5 w-5" /> Sign In / Sign Up
                  </a>
                </Button>
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container max-w-5xl mx-auto p-4 sm:p-6 md:p-8">
        {!isUserAuthenticated && showGuestAlert && (
          <Alert className="mb-6 shadow-md">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Guest Mode</AlertTitle>
            <AlertDescription className="flex justify-between items-center">
              <div>
                Your data is saved locally in this browser. Sign up or sign in to save your budget to the cloud and access it on any device.
              </div>
              <Button variant="ghost" size="sm" onClick={dismissGuestAlert} className="ml-4">
                <ShieldX className="mr-1 h-4 w-4"/> Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        )}
        
        <MonthNavigator />
        
        {isLoading && Object.keys(budgetMonths).length > 0 && !currentBudgetMonth ? ( 
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3"> {}
                 {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
              </div>
              <Skeleton className="h-32 w-full rounded-lg" /> 
              <Skeleton className="h-20 w-full rounded-lg" /> 
              <h2 className="text-xl font-semibold mt-8 mb-4 text-primary"><Skeleton className="h-6 w-32"/></h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                 {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-60 w-full rounded-lg" />)}
              </div>
            </div>
        ) : !currentBudgetMonth ? (
          <Card className="text-center p-8 shadow-lg border-dashed border-primary/30 hover:border-primary/50 transition-colors">
            <CardHeader>
              <Sparkles className="mx-auto h-12 w-12 text-primary/70 mb-4" />
              <CardTitle className="text-2xl">Welcome to BudgetFlow!</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-6">
                Let's set up your first budget for {getFormattedMonthTitle(currentDisplayMonthId)}.
              </p>
              <Button onClick={() => setIsEditBudgetModalOpen(true)} size="lg">
                Create Budget for {getFormattedMonthTitle(currentDisplayMonthId)}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <SummaryCards budgetMonth={currentBudgetMonth} />
            <CreditCardDebtSummary budgetMonth={currentBudgetMonth} />
            <BudgetActions 
              onEditBudget={() => setIsEditBudgetModalOpen(true)}
              onAddExpense={() => setIsAddExpenseModalOpen(true)}
              onAddIncome={() => setIsAddIncomeModalOpen(true)}
              onFinalizeMonth={() => openMonthEndSummary()}
            />

            {systemCategories.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-8 mb-4 text-primary flex items-center">
                  <PiggyBank className="mr-2 h-6 w-6 text-primary/80" /> Financial Goals &amp; Obligations
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                  {systemCategories.map(cat => (
                    <CategoryCard key={cat.id} category={cat} />
                  ))}
                </div>
              </>
            )}

            {operationalCategories.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mt-6 mb-4 text-primary flex items-center">
                 <Coins className="mr-2 h-6 w-6 text-primary/80" /> Operational Categories
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {operationalCategories.map(cat => (
                    <CategoryCard key={cat.id} category={cat} />
                  ))}
                </div>
              </>
            )}
            
            {(operationalCategories.length > 0) && ( 
                <BudgetChart budgetMonth={currentBudgetMonth} />
            )}


            {allCategories.length === 0 && ( 
              <Card className="text-center p-8 mt-8 shadow-md border-dashed border-primary/30">
                <CardHeader>
                  <XCircle className="mx-auto h-10 w-10 text-accent mb-3" />
                  <CardTitle className="text-xl">No Categories Found</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    You haven't added any categories to your budget for {getFormattedMonthTitle(currentDisplayMonthId)} yet. Use "Manage Budget" to add them or try the AI setup options.
                  </p>
                  <Button variant="outline" onClick={() => setIsEditBudgetModalOpen(true)}>
                    Manage Budget
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
      
      <footer className="py-6 mt-auto border-t">
          <div className="container mx-auto text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} BudgetFlow. Your finances, simplified. v1.0.23 (Studio Preview)
          </div>
      </footer>

      {currentDisplayMonthId && ( 
        <>
          <EditBudgetModal 
            isOpen={isEditBudgetModalOpen} 
            onClose={() => setIsEditBudgetModalOpen(false)}
            monthId={currentDisplayMonthId}
          />
          <AddExpenseModal
            isOpen={isAddExpenseModalOpen}
            onClose={() => setIsAddExpenseModalOpen(false)}
            monthId={currentDisplayMonthId}
          />
          <AddIncomeModal 
            isOpen={isAddIncomeModalOpen}
            onClose={() => setIsAddIncomeModalOpen(false)}
            monthId={currentDisplayMonthId}
          />
          {monthEndSummaryData && (
            <MonthEndSummaryModal
              isOpen={isMonthEndSummaryModalOpen}
              onClose={() => {
                setIsMonthEndSummaryModalOpen(false);
                const updatedData = getBudgetForMonth(currentDisplayMonthId);
                if (updatedData && updatedData.isRolledOver) { 
                  setMonthEndSummaryData(updatedData);
                } else {
                  setMonthEndSummaryData(undefined); 
                }
              }}
              budgetMonth={monthEndSummaryData}
            />
          )}
        </>
      )}
    </div>
  );
}
