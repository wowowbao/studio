
'use server';
/**
 * @fileOverview An AI agent to help prepare a budget for the next month, or an initial financial plan.
 *
 * - prepareNextMonthBudget - A function that handles next month's budget preparation or initial plan.
 * - PrepareBudgetInput - The input type for the prepareNextMonthBudget function.
 * - PrepareBudgetOutput - The return type for the prepareNextMonthBudget function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

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
  userGoals: z.string().describe("A text description of the user's financial goals. For an initial plan, this should include desired outcomes, timelines (e.g., 'save for a house in 2 years'), approximate monthly income (e.g., 'my income is $4000/month'), and if they specify a desired starting month (e.g., 'start this plan in August'). For next month planning, this might contain refinements, specific questions about a previous plan, or goals for the upcoming month. Analyze this input carefully to understand the user's current intent and whether this is an initial setup or ongoing planning."),
  currentMonthId: z.string().describe("The ID of the current month (YYYY-MM) from which planning is being done, or if this is an initial setup, it could be the current actual month."),
  currentIncome: z.number().describe("The user's total income for the *current* month from app data. If userGoals specifies a different income for the *next* month or for an initial plan, prioritize that for budgeting and report it in incomeBasisForBudget output. Do NOT create an 'Income' category in your suggestions."),
  currentSavingsTotal: z.number().describe("The user's current total *actual savings contribution* for this month (sum of amounts put into the 'Savings' category). For an initial setup, this might be 0 if no app data exists."),
  currentCCDebtTotal: z.number().describe("The user's current total *outstanding* credit card debt (estimated for end of current month). For an initial setup, this might be 0 or a figure provided in userGoals."),
  previousMonthFeedback: z.string().optional().describe("Optional: User's feedback on how the previous month's budget felt (e.g., 'too_strict', 'just_right', 'easy'). Use this to adjust the tone/flexibility of the new budget."),
});
export type PrepareBudgetInput = z.infer<typeof PrepareBudgetInputSchema>;

const PrepareBudgetOutputSchema = z.object({
  incomeBasisForBudget: z.number().optional().describe("The income amount the AI used as the primary basis for the suggested budget categories. If userGoals specifies an income (e.g., 'My income next month will be $X' or 'My income is $Y'), prioritize that. Otherwise, use currentIncome. Report this value."),
  suggestedCategories: z.array(SuggestedCategorySchema).optional().describe("An array of suggested categories for the next month's budget (or the first month of a new plan), potentially with nested subcategories and their budgeted amounts. This should be a comprehensive budget proposal. DO NOT include an 'Income' category here."),
  financialAdvice: z.string().describe("Actionable financial advice and explanations to help the user achieve their goals and improve financial health. This should address their stated goals (including any questions or desired changes), spending patterns (if statements were provided), and offer specific, encouraging recommendations. If a large purchase goal is mentioned, advise on saving strategies or low-interest financing rather than high-interest debt. If this is an initial plan, provide foundational advice and a brief roadmap if a timeline was mentioned."),
  aiError: z.string().optional().describe('Any error message if the AI failed to process the request.'),
});
export type PrepareBudgetOutput = z.infer<typeof PrepareBudgetOutputSchema>;

export async function prepareNextMonthBudget(input: PrepareBudgetInput): Promise<PrepareBudgetOutput> {
  if (!input.userGoals) {
    return { financialAdvice: "Please provide your financial goals to get personalized suggestions.", aiError: "User goals are required." };
  }
  return prepareNextMonthBudgetFlow(input);
}

const prompt = ai.definePrompt({
  name: 'prepareNextMonthBudgetPrompt',
  input: {schema: PrepareBudgetInputSchema},
  output: {schema: PrepareBudgetOutputSchema},
  prompt: `You are a friendly, empathetic, and highly skilled financial planning assistant.
Your primary goal is to help the user create a realistic, effective, AND sustainable budget for their *next* month (or the first month of a new plan if 'userGoals' suggests an initial setup). A budget that sacrifices all joy or discretionary spending is unlikely to be followed long-term. Aim for a balance that allows the user to achieve their financial goals while maintaining a reasonable quality of life.

User's Current Financial Context (based on their current month ending '{{currentMonthId}}', or potentially representing initial inputs if this is a new plan):
- Income This Month (Source Data): \${{currentIncome}} (This is the income reported from their app data for the source month. If 'userGoals' states a specific income for the plan, prioritize that for budgeting. If 'userGoals' suggests this is an initial plan and provides an income, use that.)
- Actual Savings Contributed This Month (Source Data): \${{currentSavingsTotal}}
- Estimated Total Outstanding Credit Card Debt at end of this month (Source Data): \${{currentCCDebtTotal}}

{{#if previousMonthFeedback}}
User's Feedback on Last Month's Budget: "{{previousMonthFeedback}}"
- If feedback was 'too_strict', try to build in a bit more flexibility or slightly increase discretionary spending, if possible, while still aiming for their goals.
- If feedback was 'easy', consider suggesting slightly more aggressive savings or debt repayment, if their goals align.
- If 'just_right', maintain a similar balance.
Acknowledge this feedback in your financial advice.
{{/if}}

User's Financial Goals and Context (this may contain initial goals for a new plan including income and desired start, or questions/refinements based on a previous suggestion from you):
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
Based on ALL the information above (goals, income context, debt, savings contributions, past spending if available, previous month's feedback if available, and any specific questions or change requests embedded in their 'userGoals'), provide the following:

0.  'incomeBasisForBudget': Determine the income basis for the plan.
    -   If 'userGoals' explicitly state a target income for the plan (e.g., "My income next month will be $X", "My income is $Y", "Plan for an income of $Z"), prioritize that stated income. Report this value in 'incomeBasisForBudget'.
    -   Otherwise, use the provided 'currentIncome' (from the user's current month app data, which might be 0 if it's a new user) as the basis. Report this value in 'incomeBasisForBudget'.
    -   All subsequent budget category suggestions should sum up to (or be less than) this 'incomeBasisForBudget'. If income is 0 or very low and not specified in goals, your advice should address the need for income information.

1.  'suggestedCategories': A comprehensive suggested budget for the *next* month (or first month of a new plan), based on the 'incomeBasisForBudget' you determined.
    -   The budget should be realistic, achievable, and sustainable.
    -   DO NOT create a category named "Income" or similar.
    -   Include essential categories (e.g., Housing, Utilities, Groceries, Transportation). Try to be specific where possible (e.g., Utilities -> Electricity, Internet; Subscriptions -> Netflix, Gym). If userGoals mention specific needs like "rent payment", ensure "Housing" or "Rent" is a category.
    -   Critically, incorporate categories related to their stated goals (e.g., a "Vacation Fund" category if they want to save for one, or a "New PC Fund"). If a goal is to "reduce dining out", reflect this by suggesting a lower budget for that category. If the user explicitly asks to change a specific category's budget, try to accommodate this if feasible or explain why it's challenging.
    -   **Always include "Savings" and "Credit Card Payments" as top-level categories.** Suggest reasonable budgeted amounts. For "Savings", align with their goals. For "Credit Card Payments", suggest meaningful progress on debt, considering 'incomeBasisForBudget' and other goals. If currentCCDebtTotal is 0, a small or zero budget for "Credit Card Payments" is fine unless goals indicate otherwise.
    -   **Include reasonable allocations for some discretionary spending** (e.g., "Entertainment," "Hobbies," "Personal Care," or a general "Fun Money" category) unless the user *explicitly* states they want to eliminate these or income is extremely constrained. A budget that is too restrictive is hard to maintain. Consider `previousMonthFeedback` when setting these.
    -   If past spending patterns are available, use them to inform realistic budget amounts for discretionary categories. However, if their goals require spending cuts, proactively suggest these reductions while still aiming for sustainability.
    -   **The sum of all top-level category budgets (including planned savings and CC payments) should ideally not exceed 'incomeBasisForBudget'.** If it does, clearly point out the shortfall in 'financialAdvice' and suggest specific categories where cuts could be made, or discuss if goals need to be adjusted or timelines extended.
    -   If applicable, suggest logical subcategories under broader categories (e.g., Groceries > Produce, Dairy; Utilities > Electricity, Water, Internet; Entertainment > Streaming Services, Movies).
    -   If the user states an urgent need for a large purchase (e.g., "I need a new PC or I can't work"), acknowledge this urgency.

2.  'financialAdvice': Detailed, actionable, empathetic financial advice, and **explanations for your budget choices**.
    -   **Explain Key Budget Decisions:** For significant categories, or where the budget might differ from what a user might expect, briefly explain the reasoning. For example, "Your 'Dining Out' budget is suggested at $X to help you meet your goal of saving $Y this month, while still allowing for some enjoyment. This is based on your income of $Z and past spending patterns (if available)."
    -   **Address User's Questions/Refinements:** If 'userGoals' text contains explicit questions about previous suggestions or requests for changes, address these directly. Explain the impact of requested changes on the overall budget and other goals.
    -   Directly address how 'suggestedCategories' help achieve their stated goals.
    -   If they have a large purchase goal, explain how the budget helps save towards it. Suggest realistic timelines.
    -   **Debt Management:** If currentCCDebtTotal is high, emphasize strategies for paying it down. Frame debt repayment as a positive step towards financial freedom, but balance aggressive repayment with other life needs unless the user strongly indicates an "all-in" approach to debt.
    -   **Large Purchases:**
        -   Generally, strongly advise saving up for large discretionary purchases.
        -   If extreme urgency for an essential item is expressed, and saving quickly isn't feasible, *cautiously* mention exploring 0% interest installment plans as a *last resort*, emphasizing that saving first is always preferable. Explicitly advise AGAINST standard high-interest credit cards.
    -   Provide general tips for improving financial health and maintaining the budget long-term. Stress that a budget is a living document and can be adjusted.
    -   If this is an initial plan setup, offer foundational advice and a brief roadmap if a timeline was mentioned in their goals.
    -   **Address Trade-offs Gently:** If achieving one goal means reducing spending elsewhere, acknowledge this supportively and explain the rationale.
    -   If incomeBasisForBudget is 0 or very low because no income was provided, your primary advice must be that a realistic budget cannot be formed without income information, and prompt the user to provide it.
    -   Your tone should be encouraging, supportive, and non-judgmental. Help them feel empowered, not restricted. Focus on positive framing.

Ensure your 'suggestedCategories' output is well-structured.
If you cannot reasonably create a budget (e.g., no income info and impossible goals), set 'aiError'.
Focus on practical, step-by-step advice.
If the user mentions a timeline (e.g., 'save X in 6 months'), reflect this in your advice and plan.
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
            financialAdvice: "The AI could not generate budget suggestions or advice at this time. Please try rephrasing your goals or providing more details (especially income if this is an initial setup), or ensure any uploaded statements are clear.",
            incomeBasisForBudget: input.currentIncome, 
            aiError: output?.aiError || 'AI processing returned no meaningful output.'
        };
      }
      
      if (output.suggestedCategories) {
        // Ensure "Savings" and "Credit Card Payments" are consistently named if AI suggests them
        output.suggestedCategories = output.suggestedCategories.map(cat => {
          const nameLower = cat.name.toLowerCase();
          if (nameLower.includes("savings")) { 
            return { ...cat, name: "Savings", isSystemCategory: true, subcategories: cat.subcategories || [] }; 
          }
          if (nameLower.includes("credit card payment")) { 
            return { ...cat, name: "Credit Card Payments", isSystemCategory: true, subcategories: cat.subcategories || [] };
          }
          return { ...cat, isSystemCategory: false, subcategories: cat.subcategories || [] };
        });

        const hasSavings = output.suggestedCategories.some(c => c.name === "Savings");
        const hasCCPayments = output.suggestedCategories.some(c => c.name === "Credit Card Payments");

        if (!hasSavings) {
            output.suggestedCategories.unshift({ name: "Savings", budgetedAmount: 0, subcategories: [], isSystemCategory: true });
        }
        if (!hasCCPayments) { 
             output.suggestedCategories.push({ name: "Credit Card Payments", budgetedAmount: 0, subcategories: [], isSystemCategory: true });
        }
      } else {
        output.suggestedCategories = [
            { name: "Savings", budgetedAmount: 0, subcategories: [], isSystemCategory: true },
            { name: "Credit Card Payments", budgetedAmount: 0, subcategories: [], isSystemCategory: true }
        ];
      }
      
      if (output.incomeBasisForBudget === undefined || output.incomeBasisForBudget === null) {
          output.incomeBasisForBudget = input.currentIncome; 
      }

      return output;
    } catch (e: any) {
      console.error("Error in prepareNextMonthBudgetFlow:", e);
      return {
        financialAdvice: "An unexpected error occurred while preparing your budget. Please try again later.",
        incomeBasisForBudget: input.currentIncome, 
        aiError: e.message || 'An unexpected error occurred during AI processing.'
      };
    }
  }
);

