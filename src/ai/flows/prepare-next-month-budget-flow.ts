
'use server';
/**
 * @fileOverview An AI agent to help prepare a budget for the next month.
 *
 * - prepareNextMonthBudget - A function that handles next month's budget preparation.
 * - PrepareBudgetInput - The input type for the prepareNextMonthBudget function.
 * - PrepareBudgetOutput - The return type for the prepareNextMonthBudget function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

// Re-using SuggestedCategorySchema from setup-budget-flow.ts for consistency if possible,
// or define it here if it needs to be different. For now, let's assume it's similar.
const SuggestedSubCategorySchema = z.object({
  name: z.string().describe("The name of the suggested subcategory."),
  budgetedAmount: z.number().optional().describe("The suggested budgeted amount for this subcategory. If not clearly identifiable or applicable, leave this field blank."),
});

const SuggestedCategorySchema = z.object({
  name: z.string().describe("The name of the suggested category (e.g., 'Groceries', 'Rent', 'Savings', 'Credit Card Payments')."),
  budgetedAmount: z.number().optional().describe("The suggested budgeted amount for this category. If the category has subcategories, this amount should be the sum of subcategory budgets, or left blank if sums are handled by the app. If no subcategories, this is the direct budget. If not determinable, leave blank."),
  subcategories: z.array(SuggestedSubCategorySchema).optional().describe("An array of suggested subcategories under this category."),
});


const PrepareBudgetInputSchema = z.object({
  statementDataUri: z
    .string()
    .optional()
    .describe(
      "An optional bank statement or spending summary (image or PDF), as a data URI. Format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  userGoals: z.string().describe("A text description of the user's financial goals for the next month (e.g., 'Save $500 for a vacation, reduce dining out by 20%, pay off $200 on credit card X')."),
  currentMonthId: z.string().describe("The ID of the current month (YYYY-MM) from which planning is being done."),
  currentIncome: z.number().describe("The user's total income for the current month."),
  currentSavingsTotal: z.number().describe("The user's current total accumulated savings amount."),
  currentCCDebtTotal: z.number().describe("The user's current total outstanding credit card debt."),
});
export type PrepareBudgetInput = z.infer<typeof PrepareBudgetInputSchema>;

const PrepareBudgetOutputSchema = z.object({
  suggestedCategories: z.array(SuggestedCategorySchema).optional().describe("An array of suggested categories for the next month's budget, potentially with nested subcategories and their budgeted amounts. This should be a comprehensive budget proposal."),
  financialAdvice: z.string().describe("Actionable financial advice to help the user achieve their goals and improve financial health. This should address their stated goals, spending patterns (if a statement was provided), and offer specific, encouraging recommendations. If a large purchase goal is mentioned, advise on saving strategies or low-interest financing rather than high-interest debt."),
  aiError: z.string().optional().describe('Any error message if the AI failed to process the request.'),
});
export type PrepareBudgetOutput = z.infer<typeof PrepareBudgetOutputSchema>;

export async function prepareNextMonthBudget(input: PrepareBudgetInput): Promise<PrepareBudgetOutput> {
  // Basic validation or pre-processing can go here
  if (!input.userGoals) {
    return { financialAdvice: "Please provide your financial goals for next month to get personalized suggestions.", aiError: "User goals are required." };
  }
  return prepareNextMonthBudgetFlow(input);
}

const prompt = ai.definePrompt({
  name: 'prepareNextMonthBudgetPrompt',
  input: {schema: PrepareBudgetInputSchema},
  output: {schema: PrepareBudgetOutputSchema},
  prompt: `You are a friendly, empathetic, and highly skilled financial planning assistant.
Your task is to help the user prepare a budget for their *next* month and provide actionable advice.

User's Current Situation (for context, based on their current month ending '{{currentMonthId}}'):
- Income this month: \${{currentIncome}}
- Current total savings: \${{currentSavingsTotal}}
- Current total credit card debt: \${{currentCCDebtTotal}}

User's Financial Goals for Next Month:
"{{{userGoals}}}"

{{#if statementDataUri}}
User's Past Spending (from provided statement/document):
{{media url=statementDataUri}}
Analyze this document to understand typical spending patterns.
{{else}}
No past spending document was provided. Base your suggestions on their stated goals and general financial best practices.
{{/if}}

Based on all the information above, please provide:
1.  'suggestedCategories': A comprehensive suggested budget for the *next* month.
    -   Include essential categories (e.g., Housing, Utilities, Groceries, Transportation).
    -   Incorporate categories related to their goals (e.g., a "Vacation Fund" category if they want to save for one, or a "New PC Fund").
    -   Include "Savings" and "Credit Card Payments" as top-level categories. Suggest reasonable budgeted amounts for these based on their goals, income, and debt.
    -   If past spending patterns are available, use them to inform realistic budget amounts for discretionary categories, but also suggest areas for potential reduction if it aligns with their goals (e.g., reducing dining out).
    -   Allocate amounts that are realistic for their stated income. The sum of all top-level category budgets (including planned savings and CC payments) should ideally not exceed their income, or if it does, clearly explain the shortfall in your advice.
    -   If applicable, suggest subcategories under broader categories (e.g., Groceries > Produce, Dairy).
2.  'financialAdvice': Actionable financial advice.
    -   Directly address how the suggested budget helps achieve their stated goals.
    -   If they have a large purchase goal (e.g., a $5000 PC) and limited current savings, explain how the budget helps them save towards it. Suggest realistic timelines.
    -   Strongly advise against using high-interest credit card debt for large discretionary purchases. If appropriate, you can mention looking for 0% interest installment plans as a *last resort* if the user insists on acquiring an item sooner than they can save for it, but emphasize that saving first is usually better.
    -   Provide general tips for improving financial health based on their situation (e.g., building an emergency fund if savings are low, strategies for paying down debt faster if CC debt is high).
    -   Your tone should be encouraging, supportive, and non-judgmental. Help them feel empowered.

Ensure your 'suggestedCategories' output is well-structured.
If you cannot reasonably create a budget or provide advice (e.g., conflicting goals, insufficient information and no statement), set an 'aiError'.
`,
});

const prepareNextMonthBudgetFlow = ai.defineFlow(
  {
    name: 'prepareNextMonthBudgetFlow',
    inputSchema: PrepareBudgetInputSchema,
    outputSchema: PrepareBudgetOutputSchema,
  },
  async (input: PrepareBudgetInput) => {
    if (input.statementDataUri && !input.statementDataUri.startsWith('data:')) {
        return { financialAdvice: "Invalid statement file format.", aiError: 'Invalid statement data URI format.' };
    }

    try {
      const {output} = await prompt(input);
      if (!output || (!output.suggestedCategories && !output.financialAdvice)) {
        return { 
            financialAdvice: "The AI could not generate budget suggestions or advice at this time. Please try rephrasing your goals or providing more details.",
            aiError: output?.aiError || 'AI processing returned no meaningful output.' 
        };
      }
      // Ensure system categories are well-formed if suggested
      if (output.suggestedCategories) {
        output.suggestedCategories = output.suggestedCategories.map(cat => {
          const nameLower = cat.name.toLowerCase();
          if (nameLower === "savings" || nameLower === "credit card payments") {
            return { ...cat, name: nameLower === "savings" ? "Savings" : "Credit Card Payments", subcategories: [] }; // System cats don't have subs from AI
          }
          return cat;
        });
      }

      return output;
    } catch (e: any) {
      console.error("Error in prepareNextMonthBudgetFlow:", e);
      return { 
        financialAdvice: "An unexpected error occurred while preparing your next month's budget. Please try again.",
        aiError: e.message || 'An unexpected error occurred during AI processing.' 
      };
    }
  }
);

    