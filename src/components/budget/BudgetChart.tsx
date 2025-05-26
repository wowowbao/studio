
"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { BudgetMonth, BudgetCategory, SubCategory } from "@/types/budget"; 
import { useTheme } from "next-themes"; 

interface BudgetChartProps {
  budgetMonth: BudgetMonth | undefined;
}

const getSpentAmount = (item: BudgetCategory | SubCategory): number => {
  return item.expenses.reduce((sum, exp) => sum + exp.amount, 0);
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
          <CardTitle>Spending Breakdown</CardTitle>
          <CardDescription>No data available for chart.</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add categories and expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData: { name: string; Budgeted: number; Spent: number }[] = [];

  budgetMonth.categories.forEach(cat => {
    if (cat.name.toLowerCase() === 'savings') return; // Exclude savings category

    if (cat.subcategories && cat.subcategories.length > 0) {
      cat.subcategories.forEach(sub => {
        chartData.push({
          name: `${cat.name} > ${sub.name}`,
          Budgeted: sub.budgetedAmount,
          Spent: getSpentAmount(sub),
        });
      });
    } else {
      chartData.push({
        name: cat.name,
        Budgeted: cat.budgetedAmount,
        Spent: getSpentAmount(cat),
      });
    }
  });


  if (chartData.length === 0) {
     return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Spending Breakdown</CardTitle>
          <CardDescription>No spending data available for chart (excluding savings).</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center">
          <p className="text-muted-foreground">Add non-savings categories, subcategories, and expenses to see the chart.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle>Spending Breakdown (Excl. Savings)</CardTitle>
        <CardDescription>Comparison of budgeted vs. spent amounts per category/subcategory.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
            <XAxis 
              dataKey="name" 
              stroke={chartTextColor} 
              fontSize={10} 
              tickLine={false} 
              axisLine={false} 
              interval={0} 
              angle={chartData.length > 5 ? -30 : 0} 
              textAnchor={chartData.length > 5 ? "end" : "middle"}
              height={chartData.length > 5 ? 70 : 30}
            />
            <YAxis stroke={chartTextColor} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 'var(--radius)'}}
              labelStyle={{ color: chartTextColor, fontSize: '12px' }}
              itemStyle={{ color: chartTextColor, fontSize: '12px' }}
              cursor={{fill: 'hsl(var(--accent) / 0.3)'}}
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

