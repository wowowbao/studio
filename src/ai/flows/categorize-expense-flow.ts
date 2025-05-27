
'use server';
/**
 * @fileOverview An AI agent to categorize expenses from receipt or bank transaction images.
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
      "A photo of a receipt or bank transaction statement, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  availableCategories: z
    .array(CategoryInfoSchema)
    .describe('A list of available categories and subcategories the expense can be assigned to, including their IDs and names.'),
});
export type CategorizeExpenseInput = z.infer<typeof CategorizeExpenseInputSchema>;

const SuggestedExpenseItemSchema = z.object({
    suggestedCategoryId: z.string().optional().describe("The ID of the suggested category or subcategory for this expense item. MUST be one of the IDs from the availableCategories list. If no suitable category is found, leave this field blank."),
    suggestedAmount: z.number().optional().describe("The monetary amount for this specific expense item extracted from the image. Focus on the final total paid if it's a receipt. If unsure, leave blank."),
    suggestedDescription: z.string().optional().describe("A very concise description (1-3 words) for this expense item (e.g., store name if it's the main item, or a specific product). Keep it short and to the point. If unsure, leave blank."),
});

const CategorizeExpenseOutputSchema = z.object({
  suggestedExpenses: z.array(SuggestedExpenseItemSchema).optional().describe("An array of suggested expense items found on the receipt or statement. If the document contains multiple distinct items that should be categorized separately, list them here. If it's a single total expense, provide one item. If no items can be clearly identified, this can be empty or undefined."),
  aiError: z.string().optional().describe('Any error message if the AI failed to process the request or if the document is not suitable.'),
});
export type CategorizeExpenseOutput = z.infer<typeof CategorizeExpenseOutputSchema>;

export async function categorizeExpenseFromImage(input: CategorizeExpenseInput): Promise<CategorizeExpenseOutput> {
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
Analyze the provided image, which could be a receipt or a bank transaction statement.
The user has the following available budget categories/subcategories (with their IDs and names):
{{{json availableCategories}}}

Based on the image content, identify one or more expense items. For each item:
1.  Determine the most appropriate category/subcategory for this expense item and set 'suggestedCategoryId'. You MUST select an ID from the 'availableCategories' list provided. Do not invent new categories or IDs. If no suitable category is found for an item, leave this field blank for that item.
2.  Identify and extract the monetary amount for this specific expense item. If the document shows a single total (like on a receipt), prioritize that as the 'suggestedAmount'. If it shows multiple line items (like on a statement), try to extract individual item amounts if they are clear and distinct. Set 'suggestedAmount' to this numeric value. If the amount for an item cannot be confidently determined from the image, leave this field blank for that item.
3.  Create a very concise description for this expense item (e.g., store name, or main product if clear, like "Starbucks" or "Monthly Fee"). Keep it short and to the point, ideally 1-3 words. Set 'suggestedDescription'.

Return a list of these suggested expense items in the 'suggestedExpenses' array.
If you identify a single overall expense (e.g., a restaurant bill with one total), return a single item in the array.
If the document clearly lists multiple distinct items that could be categorized differently (e.g., a supermarket receipt or bank statement line items), return multiple items in the array.
If you cannot confidently determine any of these details for an item, leave the respective field blank for that item.
If no expense items can be clearly identified, you can return an empty 'suggestedExpenses' array.
If there's a clear error in processing (e.g., image is not a receipt or statement), set 'aiError'.

Image of the receipt or bank transaction:
{{media url=imageDataUri}}`,
});

const categorizeExpenseFlow = ai.defineFlow(
  {
    name: 'categorizeExpenseFlow',
    inputSchema: CategorizeExpenseInputSchema,
    outputSchema: CategorizeExpenseOutputSchema,
  },
  async (input: CategorizeExpenseInput) => {
    if (!input.imageDataUri.startsWith('data:image/')) { // Basic check, could be more robust for other data types if needed
        return { aiError: 'Invalid image data URI format.' };
    }
    if (input.availableCategories.length === 0) {
        return { aiError: 'No categories provided for suggestion.' };
    }

    try {
      const {output} = await prompt(input);
      // Ensure output is structured, even if AI returns null/undefined for suggestedExpenses
      const finalOutput: CategorizeExpenseOutput = {
        suggestedExpenses: output?.suggestedExpenses || [],
        aiError: output?.aiError
      };
      if (!finalOutput.suggestedExpenses && !finalOutput.aiError) {
         finalOutput.aiError = 'AI processing returned no meaningful output or identifiable expense items.';
      }
      return finalOutput;
    } catch (e: any) {
      console.error("Error in categorizeExpenseFlow:", e);
      return { aiError: e.message || 'An unexpected error occurred during AI processing.' };
    }
  }
);
