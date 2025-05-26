
"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useBudget } from "@/hooks/useBudget";
import { useAuth } from "@/hooks/useAuth"; // Import useAuth
import { auth } from '@/lib/firebase'; // Import auth for signOut
import { signOut } from 'firebase/auth';
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { CategoryCard } from "@/components/budget/CategoryCard";
import { SummaryCards } from "@/components/budget/SummaryCards";
import { BudgetActions } from "@/components/budget/BudgetActions";
import { BudgetChart } from "@/components/budget/BudgetChart";
import { EditBudgetModal } from "@/components/budget/EditBudgetModal";
import { AddExpenseModal } from "@/components/budget/AddExpenseModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, LayoutDashboard, LogIn, LogOut, Moon, Sun, UserCircle } from 'lucide-react';
import { useTheme } from "next-themes";
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const { user, isLoading: authLoading } = useAuth();
  const { 
    currentBudgetMonth, 
    currentDisplayMonthId, 
    isLoading: budgetLoading, 
    ensureMonthExists,
    setCurrentDisplayMonthId // To reset month on sign-out/sign-in
  } = useBudget();
  const [isEditBudgetModalOpen, setIsEditBudgetModalOpen] = useState(false);
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  // Effect for ensuring month exists, depends on budgetLoading and user auth state
  useEffect(() => {
    if (!budgetLoading && currentDisplayMonthId && user) { // Only ensure month if user is loaded and present
      ensureMonthExists(currentDisplayMonthId);
    }
  }, [currentDisplayMonthId, budgetLoading, ensureMonthExists, user]);
  
  // Effect to reset display month when user logs out or logs in to avoid data mismatch
  useEffect(() => {
    if (!authLoading) { // Once auth state is resolved
      setCurrentDisplayMonthId(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'));
    }
  }, [user, authLoading, setCurrentDisplayMonthId]);


  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // The AuthContext will automatically update the user state
      // Optionally, redirect or show a toast message
      router.push('/'); // Or to a sign-in page
    } catch (error) {
      console.error("Sign out error:", error);
      // Handle sign out error (e.g., show a toast)
    }
  };

  const isLoading = authLoading || budgetLoading;

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
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-sm text-muted-foreground hidden sm:inline">{user.email}</span>
                <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
                  <LogOut className="h-5 w-5" />
                </Button>
              </>
            ) : (
              <Link href="/signin" legacyBehavior>
                <Button variant="ghost" aria-label="Sign in">
                  <LogIn className="h-5 w-5 sm:mr-2" /> <span className="hidden sm:inline">Sign In</span>
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
        {!user ? (
          <Card className="text-center p-8 shadow-xl mt-10">
            <CardHeader>
              <UserCircle className="mx-auto h-16 w-16 text-primary mb-4" />
              <CardTitle className="text-3xl">Welcome to BudgetFlow!</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-6 text-lg">
                Please sign in to manage your personal budget and track your expenses.
              </p>
              <Link href="/signin" legacyBehavior>
                <Button size="lg">
                  <LogIn className="mr-2 h-5 w-5" /> Sign In / Sign Up
                </Button>
              </Link>
            </CardContent>
             <CardDescription className="mt-4 text-sm">
                Continue as guest? Your data will be stored locally and not synced.
              </CardDescription>
          </Card>
        ) : (
          <>
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
          </>
        )}
      </main>
      
      <footer className="py-6 mt-auto border-t">
          <div className="container mx-auto text-center text-sm text-muted-foreground">
              © {new Date().getFullYear()} BudgetFlow. Your finances, simplified.
          </div>
      </footer>

      {user && currentDisplayMonthId && ( // Only render modals if user is logged in
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
        </>
      )}
    </div>
  );
}
