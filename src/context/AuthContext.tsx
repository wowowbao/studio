
"use client";
import type React from 'react';
import { createContext, useState, useEffect, useContext } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Ensure this path is correct
import { LayoutDashboard } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';


interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  userId: string | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setUserId(currentUser ? currentUser.uid : null);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
        <LayoutDashboard className="h-16 w-16 text-primary mb-4 animate-pulse" />
        <h1 className="text-3xl font-bold text-primary mb-2">BudgetFlow</h1>
        <p className="text-muted-foreground">Initializing authentication...</p>
        <div className="w-full max-w-md mt-8 space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, userId }}>
      {children}
    </AuthContext.Provider>
  );
};
