
"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { BudgetMonth } from "@/types/budget";
import { useTheme } from "next-themes"; // If you install next-themes, otherwise use a simpler theme detection

interface BudgetChartProps {
  budgetMonth: BudgetMonth | undefined;
}

export function BudgetChart({ budgetMonth }: BudgetChartProps) {
  // const { resolvedTheme } = useTheme(); // Requires next-themes, or manage theme state manually
  // For simplicity, let's assume light theme for colors or use CSS variables directly if Recharts supports it easily.
  // Recharts typically takes direct color strings. We will use fixed colors or try to map from CSS vars.
  
  const primaryColor = "hsl(var(--primary))"; // Use HSL strings
  const accentColor = "hsl(var(--accent))";   // Use HSL strings for chart colors

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

  const chartData = budgetMonth.categories.map(cat => ({
    name: cat.name,
    Budgeted: cat.budgetedAmount,
    Spent: cat.spentAmount,
  }));

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle>Spending Breakdown</CardTitle>
        <CardDescription>Comparison of budgeted vs. spent amounts per category.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" stroke="hsl(var(--foreground))" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="hsl(var(--foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}
              labelStyle={{ color: 'hsl(var(--foreground))' }}
              itemStyle={{ color: 'hsl(var(--foreground))' }}
            />
            <Legend wrapperStyle={{ color: 'hsl(var(--foreground))' }} />
            <Bar dataKey="Budgeted" fill={primaryColor} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Spent" fill={accentColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
