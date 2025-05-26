
'use server';
/**
 * @fileOverview An AI agent to set up a budget from an image.
 *
 * - setupBudgetFromImage - A function that handles budget setup using an image.
 * - SetupBudgetInput - The input type for the setupBudgetFromImage function.
 * - SetupBudgetOutput - The return type for the setupBudgetFromImage function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SetupBudgetInputSchema = z.object({
  imageDataUri: z
    .string()
    .describe(
      "An image of a budget document (e.g., handwritten notes, spreadsheet screenshot), as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type SetupBudgetInput = z.infer<typeof SetupBudgetInputSchema>;

const SuggestedSubCategorySchema = z.object({
  name: z.string().describe("The name of the suggested subcategory."),
  budgetedAmount: z.number().optional().describe("The suggested budgeted amount for this subcategory. If not clearly identifiable from the image, leave this field blank."),
});

const SuggestedCategorySchema = z.object({
  name: z.string().describe("The name of the suggested category."),
  budgetedAmount: z.number().optional().describe("The suggested budgeted amount for this category. This should only be set if the category has NO subcategories. If the category has subcategories, their amounts should be set and this field for the parent category should be left blank. If not clearly identifiable, leave blank."),
  subcategories: z.array(SuggestedSubCategorySchema).optional().describe("An array of suggested subcategories under this category. If the category has no subcategories, this can be an empty array or undefined."),
});

const SetupBudgetOutputSchema = z.object({
  categories: z.array(SuggestedCategorySchema).optional().describe("An array of suggested categories, potentially with nested subcategories and their budgeted amounts. If no structure can be determined, this can be empty or undefined."),
  aiError: z.string().optional().describe('Any error message if the AI failed to process the request or if the image is not suitable.'),
});
export type SetupBudgetOutput = z.infer<typeof SetupBudgetOutputSchema>;

export async function setupBudgetFromImage(input: SetupBudgetInput): Promise<SetupBudgetOutput> {
  return setupBudgetFlow(input);
}

const prompt = ai.definePrompt({
  name: 'setupBudgetPrompt',
  input: {schema: SetupBudgetInputSchema},
  output: {schema: SetupBudgetOutputSchema},
  prompt: `You are an intelligent budget setup assistant.
Analyze the provided image, which could be a handwritten budget, a photo of a spreadsheet, or similar financial planning document.
Your goal is to extract a budget structure including categories, subcategories (if present), and their corresponding budgeted amounts.

Output a list of categories.
For each category:
1.  Identify its name.
2.  If the category has subcategories listed in the image:
    -   Provide a list of these subcategories, each with its name and its specific budgeted amount (if found).
    -   In this case, the 'budgetedAmount' for the main parent category itself should be left blank, as its total will be derived from its subcategories.
3.  If the category does NOT have subcategories:
    -   Provide the 'budgetedAmount' for this main category (if found).
4.  If a budgeted amount for any category or subcategory is not clearly identifiable from the image, leave its 'budgetedAmount' field blank.
5.  Do not invent categories or amounts not present or clearly implied by the image.
6.  If the image does not appear to be a budget or financial plan, or if no structure can be determined, return an empty list of categories or set an 'aiError'.

Image of the budget document:
{{media url=imageDataUri}}`,
});

const setupBudgetFlow = ai.defineFlow(
  {
    name: 'setupBudgetFlow',
    inputSchema: SetupBudgetInputSchema,
    outputSchema: SetupBudgetOutputSchema,
  },
  async (input: SetupBudgetInput) => {
    if (!input.imageDataUri.startsWith('data:image/')) {
        return { aiError: 'Invalid image data URI format. Please provide a valid image.' };
    }

    try {
      const {output} = await prompt(input);
      if (!output || !output.categories || output.categories.length === 0) {
        if (output?.aiError) return output; // Pass through AI error if any
        return { aiError: 'AI could not determine a budget structure from the image. Please try a clearer image or a different document.' };
      }
      return output;
    } catch (e: any) {
      console.error("Error in setupBudgetFlow:", e);
      return { aiError: e.message || 'An unexpected error occurred during AI budget setup.' };
    }
  }
);
