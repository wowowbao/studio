
"use client";
import { useState, useEffect } from 'react';
import { useBudget } from "@/hooks/useBudget";
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { CategoryCard } from "@/components/budget/CategoryCard";
import { SummaryCards } from "@/components/budget/SummaryCards";
import { BudgetActions } from "@/components/budget/BudgetActions";
import { BudgetChart } from "@/components/budget/BudgetChart";
import { EditBudgetModal } from "@/components/budget/EditBudgetModal";
import { AddExpenseModal } from "@/components/budget/AddExpenseModal";
import { AddIncomeModal } from "@/components/budget/AddIncomeModal"; // New Import
import { CreditCardDebtSummary } from "@/components/budget/CreditCardDebtSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, LayoutDashboard, Moon, Sun, KeyRound, Lock } from 'lucide-react';
import { useTheme } from "next-themes";

const APP_PASSWORD = "2007"; // Updated password

export default function HomePage() {
  const [isPseudoAuthenticated, setIsPseudoAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [appLoading, setAppLoading] = useState(true);

  const { 
    currentBudgetMonth, 
    currentDisplayMonthId, 
    isLoading: budgetLoading, 
    ensureMonthExists,
  } = useBudget();
  const [isEditBudgetModalOpen, setIsEditBudgetModalOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const [isAddIncomeModalOpen, setIsAddIncomeModalOpen] = useState(false); // New State
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const storedAuth = localStorage.getItem('budgetFlowPseudoAuth');
    if (storedAuth === 'true') {
      setIsPseudoAuthenticated(true);
    }
    setAppLoading(false);
  }, []);

  useEffect(() => {
    if (!budgetLoading && currentDisplayMonthId && isPseudoAuthenticated) {
      ensureMonthExists(currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, budgetLoading, ensureMonthExists, isPseudoAuthenticated]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === APP_PASSWORD) {
      localStorage.setItem('budgetFlowPseudoAuth', 'true');
      setIsPseudoAuthenticated(true);
      setLoginError(null);
      setPasswordInput('');
    } else {
      setLoginError("Incorrect password. Please try again.");
    }
  };

  const handleLockApp = () => {
    localStorage.removeItem('budgetFlowPseudoAuth');
    setIsPseudoAuthenticated(false);
  };

  const isLoading = appLoading || (isPseudoAuthenticated && budgetLoading);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
        <LayoutDashboard className="h-16 w-16 text-primary mb-4 animate-pulse" />
        <h1 className="text-3xl font-bold text-primary mb-2">BudgetFlow</h1>
        <p className="text-muted-foreground">Loading...</p>
        <div className="w-full max-w-md mt-8 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  
  if (!isPseudoAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="w-full max-w-sm shadow-xl">
          <CardHeader className="text-center">
            <KeyRound className="mx-auto h-12 w-12 text-primary mb-3" />
            <CardTitle className="text-2xl">Enter Password</CardTitle>
            <CardDescription>This app is for private use.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••" // Adjusted placeholder
                  required
                  className="mt-1"
                />
              </div>
              {loginError && <p className="text-sm text-destructive flex items-center"><AlertTriangle className="w-4 h-4 mr-1" /> {loginError}</p>}
              <Button type="submit" className="w-full">
                Unlock
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const categories = currentBudgetMonth?.categories || [];

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold text-primary">BudgetFlow</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleLockApp} aria-label="Lock app">
              <Lock className="h-5 w-5" />
            </Button>
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
        <MonthNavigator />
        
        {!currentBudgetMonth ? (
          <Card className="text-center p-8 shadow-lg">
            <CardHeader>
              <AlertTriangle className="mx-auto h-12 w-12 text-accent mb-4" />
              <CardTitle className="text-2xl">No Budget Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-6">
                It looks like there's no budget set up for {currentDisplayMonthId}.
              </p>
              <Button onClick={() => setIsEditBudgetModalOpen(true)}>
                Create Budget for {currentDisplayMonthId}
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
              onAddIncome={() => setIsAddIncomeModalOpen(true)} // New Prop
            />

            {categories.length > 0 ? (
              <>
                <h2 className="text-xl font-semibold mt-8 mb-4 text-primary">Categories</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categories.map(cat => (
                    <CategoryCard key={cat.id} category={cat} />
                  ))}
                </div>
                <BudgetChart budgetMonth={currentBudgetMonth} />
              </>
            ) : (
              <Card className="text-center p-8 mt-8 shadow-md">
                <CardHeader>
                  <AlertTriangle className="mx-auto h-10 w-10 text-accent mb-3" />
                  <CardTitle className="text-xl">No Categories Found</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    You haven't added any categories to your budget for {currentDisplayMonthId}.
                  </p>
                  <Button variant="outline" onClick={() => setIsEditBudgetModalOpen(true)}>
                    Add Categories
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
      
      <footer className="py-6 mt-auto border-t">
          <div className="container mx-auto text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} BudgetFlow. Your finances, simplified.
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
        </>
      )}
    </div>
  );
}
