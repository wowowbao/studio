
'use server';
/**
 * @fileOverview An AI agent to categorize expenses from receipt images.
 *
 * - categorizeExpenseFromImage - A function that handles expense categorization using an image.
 * - CategorizeExpenseInput - The input type for the categorizeExpenseFromImage function.
 * - CategorizeExpenseOutput - The return type for the categorizeExpenseFromImage function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CategoryInfoSchema = z.object({
  id: z.string().describe('The unique identifier of the category or subcategory.'),
  name: z.string().describe('The display name of the category or subcategory.'),
});

const CategorizeExpenseInputSchema = z.object({
  imageDataUri: z
    .string()
    .describe(
      "A photo of a receipt, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  availableCategories: z
    .array(CategoryInfoSchema)
    .describe('A list of available categories and subcategories the expense can be assigned to, including their IDs and names.'),
});
export type CategorizeExpenseInput = z.infer<typeof CategorizeExpenseInputSchema>;

const CategorizeExpenseOutputSchema = z.object({
  suggestedCategoryId: z.string().optional().describe('The ID of the suggested category or subcategory for the expense. MUST be one of the IDs from the availableCategories list.'),
  suggestedAmount: z.number().optional().describe('The total monetary amount of the expense extracted from the receipt.'),
  suggestedDescription: z.string().optional().describe('A very concise description for the expense (e.g., store name or main item purchased). Keep it short and to the point.'),
  aiError: z.string().optional().describe('Any error message if the AI failed to process the request.'),
});
export type CategorizeExpenseOutput = z.infer<typeof CategorizeExpenseOutputSchema>;

export async function categorizeExpenseFromImage(input: CategorizeExpenseInput): Promise<CategorizeExpenseOutput> {
  // Ensure there are categories to choose from
  if (!input.availableCategories || input.availableCategories.length === 0) {
    return {
      aiError: "No categories available to suggest from. Please add categories to your budget first."
    };
  }
  return categorizeExpenseFlow(input);
}

const prompt = ai.definePrompt({
  name: 'categorizeExpensePrompt',
  input: {schema: CategorizeExpenseInputSchema},
  output: {schema: CategorizeExpenseOutputSchema},
  prompt: `You are an intelligent expense categorization assistant.
Analyze the provided receipt image.
The user has the following available budget categories/subcategories (with their IDs and names):
{{{json availableCategories}}}

Based on the image content:
1.  Determine the most appropriate category/subcategory for this expense and set 'suggestedCategoryId'. You MUST select an ID from the 'availableCategories' list provided. Do not invent new categories or IDs. If no suitable category is found, leave this field blank.
2.  Extract the total monetary amount of the expense and set 'suggestedAmount'. If the amount cannot be clearly determined, leave this field blank.
3.  Create a very concise description for the expense (e.g., store name, or main item if clear, like "Starbucks" or "Groceries"). Keep it short and to the point, ideally 1-3 words. Set 'suggestedDescription'.

If you cannot confidently determine any of these, leave the respective field blank in the output.
If there's a clear error in processing (e.g., image is not a receipt), set 'aiError'.

Image of the receipt:
{{media url=imageDataUri}}`,
});

const categorizeExpenseFlow = ai.defineFlow(
  {
    name: 'categorizeExpenseFlow',
    inputSchema: CategorizeExpenseInputSchema,
    outputSchema: CategorizeExpenseOutputSchema,
  },
  async (input: CategorizeExpenseInput) => {
    // Basic validation
    if (!input.imageDataUri.startsWith('data:image/')) {
        return { aiError: 'Invalid image data URI format.' };
    }
    if (input.availableCategories.length === 0) {
        return { aiError: 'No categories provided for suggestion.' };
    }

    try {
      const {output} = await prompt(input);
      return output || { aiError: 'AI processing returned no output.' };
    } catch (e: any) {
      console.error("Error in categorizeExpenseFlow:", e);
      return { aiError: e.message || 'An unexpected error occurred during AI processing.' };
    }
  }
);

