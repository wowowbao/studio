
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, LayoutDashboard, Moon, Sun } from 'lucide-react';
import { useTheme } from "next-themes";

export default function HomePage() {
  const { currentBudgetMonth, currentDisplayMonthId, isLoading, ensureMonthExists } = useBudget();
  const [isEditBudgetModalOpen, setIsEditBudgetModalOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // Ensure current month exists on initial load or when monthId changes
  useEffect(() => {
    if (!isLoading && currentDisplayMonthId) {
      ensureMonthExists(currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, isLoading, ensureMonthExists]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
        <LayoutDashboard className="h-16 w-16 text-primary mb-4 animate-pulse" />
        <h1 className="text-3xl font-bold text-primary mb-2">BudgetFlow</h1>
        <p className="text-muted-foreground">Loading your budget data...</p>
        <div className="w-full max-w-md mt-8 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
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
          <div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
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
            <BudgetActions 
              onEditBudget={() => setIsEditBudgetModalOpen(true)}
              onAddExpense={() => setIsAddExpenseModalOpen(true)}
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
              © {new Date().getFullYear()} BudgetFlow. All rights reserved.
          </div>
      </footer>

      {currentDisplayMonthId && (
        <EditBudgetModal 
          isOpen={isEditBudgetModalOpen} 
          onClose={() => setIsEditBudgetModalOpen(false)}
          monthId={currentDisplayMonthId}
        />
      )}
      {currentDisplayMonthId && (
        <AddExpenseModal
          isOpen={isAddExpenseModalOpen}
          onClose={() => setIsAddExpenseModalOpen(false)}
          monthId={currentDisplayMonthId}
        />
      )}
    </div>
  );
}
