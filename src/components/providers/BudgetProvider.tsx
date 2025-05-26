
"use client";
import type React from 'react';
import { BudgetContext } from '@/hooks/useBudget';
import { useBudgetCore } from '@/hooks/useBudgetCore';

export const BudgetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const budgetData = useBudgetCore();
  return <BudgetContext.Provider value={budgetData}>{children}</BudgetContext.Provider>;
};
