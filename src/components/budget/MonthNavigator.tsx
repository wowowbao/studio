
"use client";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/hooks/useBudget";
import { parseYearMonth } from "@/hooks/useBudgetCore";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function MonthNavigator() {
  const { currentDisplayMonthId, navigateToPreviousMonth, navigateToNextMonth } = useBudget();

  const displayDate = parseYearMonth(currentDisplayMonthId);
  const monthName = displayDate.toLocaleString('default', { month: 'long' });
  const year = displayDate.getFullYear();

  return (
    <div className="flex items-center justify-center space-x-4 my-4">
      <Button variant="outline" size="icon" onClick={navigateToPreviousMonth} aria-label="Previous month">
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <h2 className="text-xl font-semibold text-center w-40 tabular-nums">
        {monthName} {year}
      </h2>
      <Button variant="outline" size="icon" onClick={navigateToNextMonth} aria-label="Next month">
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
