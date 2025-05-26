
"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget";
import { useTheme } from "next-themes";

interface BudgetChartProps {
  budgetMonth: BudgetMonth | undefined;
}

const getSpentAmount = (item: BudgetCategory | SubCategory): number => {
  return (item.expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
};

export function BudgetChart({ budgetMonth }: BudgetChartProps) {
  const { resolvedTheme } = useTheme();

  const primaryColor = "hsl(var(--primary))";
  const accentColor = "hsl(var(--accent))";
  const chartGridColor = resolvedTheme === 'dark' ? "hsl(var(--border) / 0.5)" : "hsl(var(--border))";
  const chartTextColor = "hsl(var(--foreground))";

  if (!budgetMonth) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Operational Spending Breakdown</CardTitle>
          <CardDescription>No data available for chart.</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add categories and expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  const operationalChartDataItems: { name: string; Budgeted: number; Spent: number }[] = [];

  budgetMonth.categories.forEach(cat => {
    const catNameLower = cat.name.toLowerCase();
    // Exclude system categories like Savings and Credit Card Payments from this operational chart
    if (cat.isSystemCategory && (catNameLower === 'savings' || catNameLower === 'credit card payments')) {
      return;
    }

    let categoryBudgeted: number;
    let categorySpent: number;

    if (cat.subcategories && cat.subcategories.length > 0) {
      categoryBudgeted = cat.subcategories.reduce((sum, sub) => sum + sub.budgetedAmount, 0);
      categorySpent = cat.subcategories.reduce((sum, sub) => sum + getSpentAmount(sub), 0);
    } else {
      categoryBudgeted = cat.budgetedAmount;
      categorySpent = getSpentAmount(cat);
    }

    // Only add to chart if there's a budget or spending to show, or if the category name itself is non-empty
    if (cat.name.trim() !== "" && (categoryBudgeted > 0 || categorySpent > 0)) {
       operationalChartDataItems.push({
        name: cat.name,
        Budgeted: categoryBudgeted,
        Spent: categorySpent,
      });
    }
  });

  // Sort categories by budgeted amount in descending order
  const sortedOperationalChartData = [...operationalChartDataItems].sort((a, b) => b.Budgeted - a.Budgeted);


  if (sortedOperationalChartData.length === 0) {
     return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Operational Spending Breakdown</CardTitle>
          <CardDescription>No operational spending or budget data available for chart (excludes Savings & CC Payments).</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add operational categories with budgets or expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle>Operational Spending Breakdown</CardTitle>
        <CardDescription>Budgeted vs. spent for operational categories, sorted by budget. Excludes Savings & Credit Card Payments.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={sortedOperationalChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
            <XAxis
              dataKey="name"
              stroke={chartTextColor}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={sortedOperationalChartData.length > 6 ? -35 : 0} 
              textAnchor={sortedOperationalChartData.length > 6 ? "end" : "middle"}
              height={sortedOperationalChartData.length > 6 ? 80 : 40} 
            />
            <YAxis stroke={chartTextColor} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}
              labelStyle={{ color: chartTextColor, fontSize: '12px', fontWeight: 'bold' }}
              itemStyle={{ color: chartTextColor, fontSize: '12px' }}
              cursor={{fill: 'hsl(var(--accent) / 0.2)'}} 
            />
            <Legend wrapperStyle={{ color: chartTextColor, fontSize: '12px', paddingTop: '10px' }} />
            <Bar dataKey="Budgeted" fill={primaryColor} radius={[4, 4, 0, 0]} barSize={20} />
            <Bar dataKey="Spent" fill={accentColor} radius={[4, 4, 0, 0]} barSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

