
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
  name: z.string().describe("The name of the suggested category (e.g., 'Groceries', 'Rent', 'Savings', 'Credit Card Payments'). Do NOT suggest a category named 'Income' or similar; income is a given figure, not a budget item."),
  budgetedAmount: z.number().optional().describe("The suggested budgeted amount for this category. If the category has subcategories, this amount should be the sum of subcategory budgets, or left blank if sums are handled by the app. If no subcategories, this is the direct budget. If not determinable, leave blank."),
  subcategories: z.array(SuggestedSubCategorySchema).optional().describe("An array of suggested subcategories under this category."),
});


const PrepareBudgetInputSchema = z.object({
  statementDataUris: z
    .array(z.string())
    .optional()
    .describe(
      "Optional: An array of bank statements or spending summaries (images or PDFs), as data URIs. Format for each: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  userGoals: z.string().describe("A text description of the user's financial goals for the next month. This input may contain their initial goals, or it might include questions about a budget plan previously suggested, or specific requests to change parts of a previously suggested plan. Analyze this input carefully to understand the user's current intent."),
  currentMonthId: z.string().describe("The ID of the current month (YYYY-MM) from which planning is being done."),
  currentIncome: z.number().describe("The user's total income for the current month. This is the base income provided. If userGoals specifies a different income for next month, prioritize that for budgeting and report it in incomeBasisForBudget output. Do NOT create an 'Income' category in your suggestions."),
  currentSavingsTotal: z.number().describe("The user's current total *actual savings contribution* for this month (sum of amounts put into the 'Savings' category)."),
  currentCCDebtTotal: z.number().describe("The user's current total *outstanding* credit card debt (estimated for end of current month)."),
});
export type PrepareBudgetInput = z.infer<typeof PrepareBudgetInputSchema>;

const PrepareBudgetOutputSchema = z.object({
  incomeBasisForBudget: z.number().optional().describe("The income amount the AI used as the primary basis for the suggested budget categories. This might be the currentIncome provided, or an income figure derived from userGoals if specified for the next month."),
  suggestedCategories: z.array(SuggestedCategorySchema).optional().describe("An array of suggested categories for the next month's budget, potentially with nested subcategories and their budgeted amounts. This should be a comprehensive budget proposal. DO NOT include an 'Income' category here."),
  financialAdvice: z.string().describe("Actionable financial advice and explanations to help the user achieve their goals and improve financial health. This should address their stated goals (including any questions or desired changes), spending patterns (if statements were provided), and offer specific, encouraging recommendations. If a large purchase goal is mentioned, advise on saving strategies or low-interest financing rather than high-interest debt."),
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
Your primary goal is to help the user create a realistic and effective budget for their *next* month and provide actionable, supportive financial advice and explanations.

User's Current Financial Context (based on their current month ending '{{currentMonthId}}'):
- Income This Month (Source Data): \${{currentIncome}} (This is the income reported from their current month's app data. Use this as a reference.)
- Actual Savings Contributed This Month: \${{currentSavingsTotal}}
- Estimated Total Outstanding Credit Card Debt at end of this month: \${{currentCCDebtTotal}}

User's Financial Goals for Next Month (this may contain initial goals, or questions/refinements based on a previous suggestion from you, including a desired income for next month):
"{{{userGoals}}}"

{{#if statementDataUris}}
Analysis of User's Past Spending (from provided statement(s)/document(s)):
{{#each statementDataUris}}
Document:
{{media url=this}}
---
{{/each}}
Carefully analyze these document(s) to understand the user's typical spending patterns, recurring expenses, and potential areas for optimization. Be as detailed as reasonably possible.
{{else}}
No past spending document(s) were provided. Base your budget suggestions primarily on their stated goals, income context, and general financial best practices.
{{/if}}

Your Task:
Based on ALL the information above (goals, income context, debt, savings contributions, past spending if available, and any specific questions or change requests embedded in their 'userGoals'), provide the following:

0.  'incomeBasisForBudget': Determine the income basis for the next month's budget.
    -   If the 'userGoals' explicitly state a target income for the *next* month (e.g., "My income next month will be $X" or "Plan for an income of $Y"), prioritize that stated income. Report this value in 'incomeBasisForBudget'.
    -   Otherwise, use the provided 'currentIncome' (from the user's current month data) as the basis. Report this value in 'incomeBasisForBudget'.
    -   All subsequent budget category suggestions should sum up to (or be less than) this 'incomeBasisForBudget'.

1.  'suggestedCategories': A comprehensive suggested budget for the *next* month, based on the 'incomeBasisForBudget' you determined.
    -   The budget should be realistic and achievable.
    -   DO NOT create a category named "Income" or similar.
    -   Include essential categories (e.g., Housing, Utilities, Groceries, Transportation). Try to be specific where possible (e.g., Utilities -> Electricity, Internet; Subscriptions -> Netflix, Gym).
    -   Critically, incorporate categories related to their stated goals (e.g., a "Vacation Fund" category if they want to save for one, or a "New PC Fund"). If a goal is to "reduce dining out", reflect this by suggesting a lower budget for that category compared to past spending (if known) or a reasonable general amount. If the user explicitly asks to change a specific category's budget, try to accommodate this if feasible or explain why it's challenging.
    -   **Always include "Savings" and "Credit Card Payments" as top-level categories.** Suggest reasonable budgeted amounts for these. For "Savings", align with their goals (e.g., if they want to save $500, budget $500 for Savings). For "Credit Card Payments", suggest an amount that makes meaningful progress on their debt, considering the 'incomeBasisForBudget' and other goals.
    -   If past spending patterns are available, use them to inform realistic budget amounts for discretionary categories. However, if their goals require spending cuts, proactively suggest these reductions.
    -   **The sum of all top-level category budgets (including planned savings and CC payments) should ideally not exceed the 'incomeBasisForBudget'.** If it does, clearly point out the shortfall in your 'financialAdvice' and suggest specific categories where cuts could be made, or discuss if goals need to be adjusted or timelines extended.
    -   If applicable, suggest logical subcategories under broader categories (e.g., Groceries > Produce, Dairy; Utilities > Electricity, Water, Internet; Entertainment > Streaming Services, Movies).
    -   If the user states an urgent need for a large purchase (e.g., "I need a new PC or I can't work"), acknowledge this urgency.

2.  'financialAdvice': Detailed, actionable, empathetic financial advice, and **explanations for your budget choices**.
    -   **Explain Key Budget Decisions:** For significant categories, or where the budget might differ from what a user might expect (e.g., a lower budget for 'Dining Out' if their goal is to save more), briefly explain the reasoning behind the suggested amount. For example, "Your 'Dining Out' budget is suggested at $X to help you meet your goal of saving $Y this month, based on your income of $Z."
    -   **Address User's Questions/Refinements:** If the 'userGoals' text contains explicit questions about previous suggestions or requests for changes (e.g., "Why is my travel budget $50?" or "Can I increase groceries to $400?"), address these directly in your advice. Explain the impact of any requested changes on the overall budget (based on 'incomeBasisForBudget') and other goals.
    -   Directly address how the 'suggestedCategories' help achieve their stated goals. Explain the connection.
    -   If they have a large purchase goal (e.g., a $5000 PC with current savings of $2000 and a planned monthly income of $3000), explain how the budget helps them save towards it. Suggest realistic timelines. For example: "Based on saving $X per month in your 'New PC Fund', you could reach your $5000 goal in Y months."
    -   Debt Management: If currentCCDebtTotal is high, emphasize strategies for paying it down.
    -   Large Purchases:
        -   Generally, strongly advise saving up for large discretionary purchases rather than incurring new debt.
        -   If the user expresses *extreme urgency* for an item essential for work or well-being, and saving quickly isn't feasible, you may *cautiously* mention exploring 0% interest installment plans as a *last resort*. Immediately follow this by emphasizing that saving first is always preferable to avoid any potential debt risks. Explicitly advise AGAINST using standard high-interest credit cards for such purchases.
    -   Provide general tips for improving financial health based on their situation (e.g., building an emergency fund if their "Actual Savings Contributed This Month" is low, strategies for debt reduction).
    -   **Address Trade-offs:** If achieving one goal (e.g., aggressive saving) means reducing spending in another desired area, or if accommodating a user's requested budget change impacts other goals, acknowledge this trade-off in a supportive way.
    -   If information seems insufficient to make a concrete plan (e.g., vague goals with very low income), state what additional information would be helpful, or make reasonable assumptions and clearly state them.
    *   Your tone should be encouraging, supportive, and non-judgmental. Help them feel empowered and capable of achieving their financial goals. Avoid overly restrictive or negative language. Focus on positive framing and solutions.

Ensure your 'suggestedCategories' output is well-structured.
If you cannot reasonably create a budget or provide advice (e.g., conflicting or impossible goals given the income, completely uncooperative user description), set an 'aiError' explaining why.
Focus on providing practical, step-by-step advice.
`,
});

const prepareNextMonthBudgetFlow = ai.defineFlow(
  {
    name: 'prepareNextMonthBudgetFlow',
    inputSchema: PrepareBudgetInputSchema,
    outputSchema: PrepareBudgetOutputSchema,
  },
  async (input: PrepareBudgetInput) => {
    if (input.statementDataUris && input.statementDataUris.some(uri => !uri.startsWith('data:'))) {
        return { financialAdvice: "Invalid statement file format provided.", aiError: 'One or more statement data URIs are invalid.' };
    }

    try {
      const {output} = await prompt(input);
      if (!output || (!output.suggestedCategories && !output.financialAdvice && !output.incomeBasisForBudget)) {
        return {
            financialAdvice: "The AI could not generate budget suggestions or advice at this time. Please try rephrasing your goals or providing more details, or ensure any uploaded statements are clear.",
            incomeBasisForBudget: input.currentIncome, // Fallback to input income
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
      
      // Ensure incomeBasisForBudget is set, fallback to input.currentIncome if AI didn't provide it
      if (output.incomeBasisForBudget === undefined || output.incomeBasisForBudget === null) {
          output.incomeBasisForBudget = input.currentIncome;
      }


      return output;
    } catch (e: any) {
      console.error("Error in prepareNextMonthBudgetFlow:", e);
      return {
        financialAdvice: "An unexpected error occurred while preparing your next month's budget. Please try again later.",
        incomeBasisForBudget: input.currentIncome, // Fallback to input income
        aiError: e.message || 'An unexpected error occurred during AI processing.'
      };
    }
  }
);

    

    

    


