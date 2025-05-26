
"use client";
import { useState, useEffect, useRef } from "react";
import type { BudgetCategory, SubCategory } from "@/types/budget";
import { useBudget } from "@/hooks/useBudget";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Calendar as CalendarIcon, UploadCloud, FileImage, Trash2, Loader2, Camera, AlertCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import Image from 'next/image';
import { categorizeExpenseFromImage, type CategorizeExpenseInput, type CategorizeExpenseOutput } from '@/ai/flows/categorize-expense-flow';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthId: string;
}

interface CategoryOption {
  value: string; // ID of category or subcategory
  label: string; // Display name
  isSubcategory: boolean;
  parentCategoryId?: string;
}

// Using a local definition for AlertTriangle as it's specific to this modal's error states for now.
const LocalAlertTriangle = ({ className }: { className?: string }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("lucide lucide-alert-triangle", className)}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );


export function AddExpenseModal({ isOpen, onClose, monthId }: AddExpenseModalProps) {
  const { getBudgetForMonth, addExpense, isLoading: budgetLoading } = useBudget();
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [isTargetSubcategory, setIsTargetSubcategory] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const { toast } = useToast();

  // Image and AI state
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [aiSuggestionError, setAiSuggestionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // For capturing frame
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null); // null: not checked, true: granted, false: denied
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'idle' | 'cameraView' | 'preview'>('idle'); // 'idle', 'cameraView', 'preview'


  const resetFormFields = () => {
    setSelectedTargetId("");
    setIsTargetSubcategory(false);
    setAmount("");
    setDescription("");
    setDate(new Date());
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageDataUri(null);
    setAiSuggestionError(null);
    setIsAiProcessing(false);
    setMode('idle');
    // Don't reset camera permission, but stop stream if active
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };
  
  useEffect(() => {
    if (isOpen && monthId && !budgetLoading) {
      resetFormFields(); 

      const budgetData = getBudgetForMonth(monthId);
      const options: CategoryOption[] = [];
      if (budgetData) {
        budgetData.categories.forEach(cat => {
          if (!cat.subcategories || cat.subcategories.length === 0) {
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          }
          (cat.subcategories || []).forEach(sub => {
            options.push({ value: sub.id, label: `${cat.name} > ${sub.name}`, isSubcategory: true, parentCategoryId: cat.id });
          });
        });
      }
      setCategoryOptions(options);
    } else if (!isOpen && cameraStream) {
      // Cleanup camera stream when modal is closed externally
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [isOpen, monthId, getBudgetForMonth, budgetLoading, cameraStream]);


  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedImageFile(file);
      setAiSuggestionError(null); 
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviewUrl(reader.result as string);
        setImageDataUri(reader.result as string); 
        setMode('preview');
      };
      reader.readAsDataURL(file);
    }
    event.target.value = ''; 
  };

  const handleClearImage = () => {
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageDataUri(null);
    setAiSuggestionError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ""; 
    }
    setMode('idle'); 
  };

  const getCameraPermissionAndStream = async () => {
    if (cameraStream) return true; // Already have a stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setHasCameraPermission(true);
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      return true;
    } catch (error) {
      console.error('Error accessing camera:', error);
      setHasCameraPermission(false);
      setCameraStream(null);
      toast({
        variant: 'destructive',
        title: 'Camera Access Denied',
        description: 'Please enable camera permissions in your browser settings.',
      });
      return false;
    }
  };

  const handleEnableCamera = async () => {
    setIsAiProcessing(true); // To disable buttons while camera initializes
    const permissionGranted = await getCameraPermissionAndStream();
    setIsAiProcessing(false);
    if (permissionGranted) {
      setMode('cameraView');
    } else {
      setMode('idle'); // Stay in idle if permission denied or error
    }
  };
  
  const handleCapturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUri = canvas.toDataURL('image/jpeg'); // Or image/png
        setImagePreviewUrl(dataUri);
        setImageDataUri(dataUri);
        setSelectedImageFile(null); // Clear any uploaded file
        setMode('preview');
        // Stop camera stream after capture
        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
          setCameraStream(null);
        }
      }
    }
  };


  const handleAiCategorize = async () => {
    if (!imageDataUri || categoryOptions.length === 0) {
      setAiSuggestionError("Please select an image and ensure categories are loaded.");
      return;
    }
    setIsAiProcessing(true);
    setAiSuggestionError(null);

    const aiInputCategories = categoryOptions.map(opt => ({ id: opt.value, name: opt.label }));

    try {
      const result: CategorizeExpenseOutput = await categorizeExpenseFromImage({
        imageDataUri,
        availableCategories: aiInputCategories,
      });

      if (result.aiError) {
        setAiSuggestionError(result.aiError);
        toast({ title: "AI Suggestion Error", description: result.aiError, variant: "destructive" });
      } else {
        if (result.suggestedCategoryId) {
          const foundOption = categoryOptions.find(opt => opt.value === result.suggestedCategoryId);
          if (foundOption) {
            setSelectedTargetId(foundOption.value);
            setIsTargetSubcategory(foundOption.isSubcategory);
          } else {
             setAiSuggestionError(`AI suggested category ID '${result.suggestedCategoryId}' not found.`);
          }
        }
        if (result.suggestedAmount !== undefined) {
          setAmount(String(result.suggestedAmount.toFixed(2)));
        }
        if (result.suggestedDescription) {
          setDescription(result.suggestedDescription);
        }
        toast({ title: "AI Suggestions Applied", description: "Review and confirm the expense details.", action: <CheckCircle className="text-green-500"/> });
      }
    } catch (error: any) {
      console.error("Error calling AI flow:", error);
      const message = error.message || "An unexpected error occurred while getting AI suggestions.";
      setAiSuggestionError(message);
      toast({ title: "AI Error", description: message, variant: "destructive" });
    } finally {
      setIsAiProcessing(false);
    }
  };
  
  useEffect(() => {
    if (imageDataUri && categoryOptions.length > 0 && mode === 'preview' && !isAiProcessing) { 
      handleAiCategorize();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUri, mode]); // Run when imageDataUri changes or mode becomes 'preview'

  const handleSubmit = () => {
    const numericAmount = parseFloat(amount);
    if (!selectedTargetId) {
      toast({ title: "Error", description: "Please select a category or subcategory.", variant: "destructive" });
      return;
    }
    if (isNaN(numericAmount) || numericAmount <= 0) {
      toast({ title: "Error", description: "Please enter a valid positive amount.", variant: "destructive" });
      return;
    }
    if (description.trim() === "") {
      toast({ title: "Error", description: "Please enter a description for the expense.", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "Error", description: "Please select a date for the expense.", variant: "destructive" });
      return;
    }

    addExpense(monthId, selectedTargetId, numericAmount, description, date.toISOString(), isTargetSubcategory);
    toast({
      title: "Expense Added",
      description: `${description}: $${numericAmount.toFixed(2)} added on ${format(date, "PPP")}.`,
      action: <CheckCircle className="text-green-500" />,
    });
    onCloseModal();
  };
  
  const onCloseModal = () => {
    resetFormFields();
    onClose();
  };

  const handleSelectionChange = (value: string) => {
    const selectedOption = categoryOptions.find(opt => opt.value === value);
    if (selectedOption) {
      setSelectedTargetId(selectedOption.value);
      setIsTargetSubcategory(selectedOption.isSubcategory);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Add Expense for {monthId}</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
           {/* Image Upload / Camera Section */}
           {mode === 'idle' && (
             <div className="flex flex-col items-center space-y-3 py-4 border rounded-lg p-4 bg-muted/20">
                <p className="text-base font-medium">Add Receipt Image</p>
                <p className="text-xs text-muted-foreground text-center px-2">
                    Upload an existing image or take a new picture with your camera for AI-powered suggestions.
                </p>
                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isAiProcessing}
                        className="w-full"
                    >
                        <UploadCloud className="mr-2 h-4 w-4" />
                        Upload Image
                    </Button>
                    <Input
                        id="receipt-upload"
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleImageFileChange}
                        className="hidden"
                        disabled={isAiProcessing}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleEnableCamera}
                        disabled={isAiProcessing}
                        className="w-full"
                    >
                        <Camera className="mr-2 h-4 w-4" />
                        Take Picture
                    </Button>
                </div>
                {hasCameraPermission === false && ( // Show if explicitly denied
                    <Alert variant="destructive" className="mt-2 w-full">
                        <LocalAlertTriangle className="h-4 w-4" />
                        <AlertTitle>Camera Access Denied</AlertTitle>
                        <AlertDescription>
                            Please enable camera permissions in your browser settings and try again.
                        </AlertDescription>
                    </Alert>
                )}
             </div>
           )}

           {mode === 'cameraView' && (
             <div className="space-y-3 p-2 border rounded-lg">
                <Label className="text-base font-medium">Camera View</Label>
                <div className="relative w-full aspect-video bg-muted rounded-md overflow-hidden">
                    <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
                </div>
                <canvas ref={canvasRef} className="hidden"></canvas> {/* Hidden canvas for capture */}
                <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={handleCapturePhoto} className="flex-1">
                        <Camera className="mr-2 h-4 w-4" /> Capture Photo
                    </Button>
                    <Button variant="outline" onClick={() => {
                         if (cameraStream) {
                            cameraStream.getTracks().forEach(track => track.stop());
                            setCameraStream(null);
                          }
                        setMode('idle');
                        setHasCameraPermission(null); // Allow re-prompt or re-check
                    }} className="flex-1">
                        <XCircle className="mr-2 h-4 w-4" /> Back to Options
                    </Button>
                </div>
             </div>
           )}

            {mode === 'preview' && imagePreviewUrl && (
                <div className="space-y-3 p-2 border rounded-lg">
                    <Label className="text-base font-medium">Image Preview</Label>
                    <div className="relative w-full aspect-video border rounded-md overflow-hidden bg-muted">
                        <Image src={imagePreviewUrl} alt="Receipt preview" layout="fill" objectFit="contain" />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button variant="outline" onClick={handleClearImage} className="w-full">
                            <FileImage className="mr-2 h-4 w-4" />
                            Use Different Image
                        </Button>
                    </div>
                </div>
            )}

            {isAiProcessing && (
              <div className="flex items-center text-sm text-muted-foreground mt-2">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                AI is analyzing your receipt...
              </div>
            )}
            {aiSuggestionError && (
              <Alert variant="destructive" className="mt-2">
                <LocalAlertTriangle className="h-4 w-4"/>
                <AlertTitle>AI Suggestion Error</AlertTitle>
                <AlertDescription>{aiSuggestionError}</AlertDescription>
              </Alert>
            )}
          

          {/* Form Fields */}
          {budgetLoading ? (
            <p>Loading categories...</p>
          ) : categoryOptions.length === 0 ? (
            <p className="text-muted-foreground py-4">No categories or subcategories available for this month. Please add them first in 'Edit Budget'.</p>
          ) : (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="category" className="text-right col-span-1">
                  Category
                </Label>
                <Select value={selectedTargetId} onValueChange={handleSelectionChange} disabled={isAiProcessing}>
                  <SelectTrigger id="category" className="col-span-3">
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="amount" className="text-right col-span-1">
                  Amount
                </Label>
                <Input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="col-span-3"
                  disabled={isAiProcessing}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="description" className="text-right col-span-1">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Weekly groceries"
                  className="col-span-3"
                  rows={2}
                  disabled={isAiProcessing}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="date" className="text-right col-span-1">
                  Date
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "col-span-3 justify-start text-left font-normal",
                        !date && "text-muted-foreground"
                      )}
                      disabled={isAiProcessing}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, "PPP") : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose asChild>
            <Button variant="outline" onClick={onCloseModal} disabled={isAiProcessing}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={budgetLoading || categoryOptions.length === 0 || isAiProcessing}>
            {isAiProcessing && !imageDataUri ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            {isAiProcessing && !imageDataUri ? "Initializing..." : (isAiProcessing ? "Processing..." : "Add Expense")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    