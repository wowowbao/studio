
"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { BudgetMonth, BudgetCategory } from "@/types/budget"; // Added BudgetCategory
import { useTheme } from "next-themes"; 

interface BudgetChartProps {
  budgetMonth: BudgetMonth | undefined;
}

// Helper function to calculate spent amount for a category
const getCategorySpentAmount = (category: BudgetCategory): number => {
  return category.expenses.reduce((sum, exp) => sum + exp.amount, 0);
};

export function BudgetChart({ budgetMonth }: BudgetChartProps) {
  const { resolvedTheme } = useTheme(); 
  
  const primaryColor = "hsl(var(--primary))"; 
  const accentColor = "hsl(var(--accent))";   
  const chartGridColor = resolvedTheme === 'dark' ? "hsl(var(--border) / 0.5)" : "hsl(var(--border))";
  const chartTextColor = "hsl(var(--foreground))";

  if (!budgetMonth || budgetMonth.categories.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Spending Breakdown</CardTitle>
          <CardDescription>No data available for chart.</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add categories and expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = budgetMonth.categories
    .filter(cat => cat.name.toLowerCase() !== 'savings') // Exclude savings from this chart
    .map(cat => ({
      name: cat.name,
      Budgeted: cat.budgetedAmount,
      Spent: getCategorySpentAmount(cat),
    }));

  if (chartData.length === 0) {
     return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Spending Breakdown</CardTitle>
          <CardDescription>No spending data available for chart (excluding savings).</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add non-savings categories and expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle>Spending Breakdown (Excl. Savings)</CardTitle>
        <CardDescription>Comparison of budgeted vs. spent amounts per category.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
            <XAxis dataKey="name" stroke={chartTextColor} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke={chartTextColor} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}
              labelStyle={{ color: chartTextColor }}
              itemStyle={{ color: chartTextColor }}
              cursor={{fill: 'hsl(var(--accent) / 0.3)'}}
            />
            <Legend wrapperStyle={{ color: chartTextColor }} />
            <Bar dataKey="Budgeted" fill={primaryColor} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Spent" fill={accentColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
