
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
import { CheckCircle, XCircle, Calendar as CalendarIcon, UploadCloud, FileImage, Trash2, Loader2, Camera, AlertCircle, RefreshCcw, Info } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import Image from 'next/image';
import { categorizeExpenseFromImage, type CategorizeExpenseInput, type CategorizeExpenseOutput } from '@/ai/flows/categorize-expense-flow';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { parseYearMonth } from "@/hooks/useBudgetCore";


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

// Using a local SVG for AlertTriangle to avoid potential issues with lucide-react in some environments
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

  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [aiSuggestionError, setAiSuggestionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<'idle' | 'cameraView' | 'preview'>('idle');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(undefined);


  const resetFormFields = (keepCameraState = false) => {
    setSelectedTargetId("");
    setIsTargetSubcategory(false);
    setAmount("");
    setDescription("");
    setDate(new Date());
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setImageDataUri(null);
    setAiSuggestionError(null);
    // setIsAiProcessing(false); // Don't reset this here, let operations manage it.

    if (!keepCameraState) {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            setCameraStream(null);
        }
        setMode('idle');
        setHasCameraPermission(null); 
        setAvailableCameras([]);
        setSelectedCameraId(undefined);
    } else if (mode !== 'cameraView') { // If keeping camera state, but not in camera view, reset to idle
        setMode('idle');
    }
  };
  
  useEffect(() => {
    if (isOpen && monthId && !budgetLoading) {
      resetFormFields(); 

      const budgetData = getBudgetForMonth(monthId);
      const options: CategoryOption[] = [];
      if (budgetData) {
        budgetData.categories.forEach(cat => {
          if (cat.isSystemCategory) { 
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          } else if (!cat.subcategories || cat.subcategories.length === 0) { 
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          }
          (cat.subcategories || []).forEach(sub => {
             if (!cat.isSystemCategory) { 
                options.push({ value: sub.id, label: `${cat.name} > ${sub.name}`, isSubcategory: true, parentCategoryId: cat.id });
             }
          });
        });
      }
      
      options.sort((a, b) => {
        const aIsSystem = budgetData?.categories.find(c => c.id === (a.parentCategoryId || a.value))?.isSystemCategory || budgetData?.categories.find(c => c.id === a.value)?.isSystemCategory || false;
        const bIsSystem = budgetData?.categories.find(c => c.id === (b.parentCategoryId || b.value))?.isSystemCategory || budgetData?.categories.find(c => c.id === b.value)?.isSystemCategory || false;

        if (aIsSystem && !bIsSystem) return -1;
        if (!aIsSystem && bIsSystem) return 1;
        if (aIsSystem && bIsSystem) { 
            if (a.label.toLowerCase().includes("savings")) return -1;
            if (b.label.toLowerCase().includes("savings")) return 1;
            if (a.label.toLowerCase().includes("credit card payments")) return -1; 
            if (b.label.toLowerCase().includes("credit card payments")) return 1;
        }
        return a.label.localeCompare(b.label);
      });
      setCategoryOptions(options);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, monthId, budgetLoading, getBudgetForMonth]);

  useEffect(() => {
    // Cleanup camera stream on unmount or when modal closes
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);


  const stopCurrentStream = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startStream = async (deviceId?: string) => {
    stopCurrentStream(); 

    try {
      const constraints: MediaStreamConstraints = { video: {} };
      if (deviceId) {
        (constraints.video as MediaTrackConstraints).deviceId = { exact: deviceId };
      } else {
        (constraints.video as MediaTrackConstraints).facingMode = { ideal: "environment" };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setHasCameraPermission(true);
      setCameraStream(stream);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(e => {
          console.error("Video play failed:", e);
          toast({
            variant: 'destructive',
            title: 'Camera Playback Error',
            description: `Could not start camera preview. Error: ${e.message || 'Please try again.'}`,
          });
          stopCurrentStream(); 
          setHasCameraPermission(false);
          throw e; 
        });
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);

      const currentStreamDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (currentStreamDeviceId) {
        setSelectedCameraId(currentStreamDeviceId);
      } else if (videoDevices.length > 0) {
        setSelectedCameraId(videoDevices[0].deviceId); 
      }

      setMode('cameraView');
      return stream;

    } catch (error: any) {
      console.error('Error accessing camera:', error);
      setHasCameraPermission(false);
      stopCurrentStream();
      let description = `Failed to initialize camera. ${error.name || 'Error'}: ${error.message || 'Please check browser permissions and ensure no other app is using it.'}`;
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        description = 'No camera found on this device. Please connect a camera or try another device.';
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        description = 'Camera access was denied. Please enable camera permissions in your browser settings.';
      }
      toast({
        variant: 'destructive',
        title: 'Camera Access Error',
        description: description,
      });
      setMode('idle'); 
      return null; 
    }
  };


  const handleEnableCamera = async () => {
    setIsAiProcessing(true);
    let targetDeviceId = selectedCameraId;

    if (!targetDeviceId && availableCameras.length === 0) { 
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            setAvailableCameras(videoDevices);
            if (videoDevices.length > 0) {
                const rearCamera = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
                targetDeviceId = rearCamera ? rearCamera.deviceId : videoDevices[0].deviceId;
                setSelectedCameraId(targetDeviceId);
            }
        } catch (err) {
            console.error("Error enumerating devices:", err);
            toast({ variant: "destructive", title: "Device Error", description: "Could not list camera devices." });
            setIsAiProcessing(false);
            return;
        }
    }
    await startStream(targetDeviceId);
    setIsAiProcessing(false);
  };


  const handleSwitchCamera = async () => {
    if (availableCameras.length > 1 && selectedCameraId) {
      const currentIndex = availableCameras.findIndex(cam => cam.deviceId === selectedCameraId);
      const nextIndex = (currentIndex + 1) % availableCameras.length;
      const nextCameraId = availableCameras[nextIndex].deviceId;
      
      setIsAiProcessing(true);
      await startStream(nextCameraId); 
      setIsAiProcessing(false);
    } else if (availableCameras.length <= 1) {
        toast({ title: "Camera Info", description: "No other cameras available to switch to." });
    }
  };

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
  
  const handleCapturePhoto = () => {
    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= videoRef.current.HAVE_METADATA && videoRef.current.videoWidth > 0) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUri = canvas.toDataURL('image/jpeg', 0.9); 
        setImagePreviewUrl(dataUri);
        setImageDataUri(dataUri);
        setSelectedImageFile(null); 
        setMode('preview');
        stopCurrentStream(); 
      }
    } else {
        toast({ variant: "destructive", title: "Camera Error", description: "Camera not ready or video dimensions not available. Please try again."});
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
      } else if (result.suggestedExpenses && result.suggestedExpenses.length > 0) {
        const firstSuggestion = result.suggestedExpenses[0];
        if (firstSuggestion.suggestedCategoryId) {
          const foundOption = categoryOptions.find(opt => opt.value === firstSuggestion.suggestedCategoryId);
          if (foundOption) {
            setSelectedTargetId(foundOption.value);
            setIsTargetSubcategory(foundOption.isSubcategory);
          } else {
             setAiSuggestionError(`AI suggested category ID '${firstSuggestion.suggestedCategoryId}' not found for the first item.`);
          }
        }
        if (firstSuggestion.suggestedAmount !== undefined && firstSuggestion.suggestedAmount !== null) {
          setAmount(String(firstSuggestion.suggestedAmount.toFixed(2)));
        }
        if (firstSuggestion.suggestedDescription) {
          setDescription(firstSuggestion.suggestedDescription);
        }
        
        let toastMessage = "AI suggestions applied for the first item found.";
        if (result.suggestedExpenses.length > 1) {
            toastMessage += ` AI found ${result.suggestedExpenses.length} items in total. Full multiple-item support coming soon!`;
        }
        toast({ title: "AI Suggestions Applied", description: toastMessage, duration: 7000, action: <CheckCircle className="text-green-500"/> });

      } else {
        toast({ title: "AI Suggestion", description: "AI could not find any specific expense items in the image.", variant: "default" });
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
    if (imageDataUri && categoryOptions.length > 0 && mode === 'preview' && !isAiProcessing && !aiSuggestionError) { 
      handleAiCategorize();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUri, mode]); 

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
    resetFormFields(mode === 'cameraView'); // Keep camera state if it was active, otherwise full reset
    if (mode === 'cameraView') {
      stopCurrentStream(); // Ensure stream stops if modal closes from camera view
      setMode('idle'); 
    }
    onClose();
  };

  const handleSelectionChange = (value: string) => {
    const selectedOption = categoryOptions.find(opt => opt.value === value);
    if (selectedOption) {
      setSelectedTargetId(selectedOption.value);
      setIsTargetSubcategory(selectedOption.isSubcategory);
    }
  };

  const getFormattedMonthTitle = () => {
    if (!monthId) return "";
    const dateObj = parseYearMonth(monthId);
    return dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCloseModal()}>
      <DialogContent className="sm:max-w-lg w-[90vw] max-w-[576px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">Add Expense for {getFormattedMonthTitle()}</DialogTitle>
        </DialogHeader>
        
        <video 
            ref={videoRef} 
            className={cn(
                "w-full rounded-md bg-muted", 
                mode === 'cameraView' ? 'block h-[70vh] max-h-[500px] object-contain' : 'hidden'
            )} 
            autoPlay 
            muted 
            playsInline 
        />
        <canvas ref={canvasRef} className="hidden"></canvas>

        <ScrollArea className="max-h-[70vh] pr-4"> 
          <div className="grid gap-4 py-4"> 
            {/* Manual Expense Entry Fields First */}
            {budgetLoading ? (
              <p>Loading categories...</p>
            ) : categoryOptions.length === 0 ? (
              <Alert variant="destructive">
                <LocalAlertTriangle className="h-4 w-4" />
                <AlertTitle>No Categories Available</AlertTitle>
                <AlertDescription>
                  No categories or subcategories available for this month. Please add them first in 'Manage Budget'.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4"> 
                <div className="space-y-1"> 
                  <Label htmlFor="category">Category</Label>
                  <Select value={selectedTargetId} onValueChange={handleSelectionChange} disabled={isAiProcessing}>
                    <SelectTrigger id="category" className="w-full"> 
                      <SelectValue placeholder="Select target" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {categoryOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full"
                    disabled={isAiProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Weekly groceries"
                    className="w-full"
                    rows={2}
                    disabled={isAiProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="date">Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
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
                <Alert variant="default" className="mt-4">
                    <Info className="h-4 w-4" />
                    <AlertTitle className="font-semibold">Quick Tip!</AlertTitle>
                    <AlertDescription className="text-xs">
                      To record money transferred to savings, select the "Savings" category.
                      For credit card payments, select "Credit Card Payments". These are treated as expenses to these specific categories.
                    </AlertDescription>
                </Alert>
              </div>
            )}

            <Separator className="my-6"/>

            {/* Optional AI Assistance Section */}
            <div className="space-y-3">
                <h3 className="text-base font-medium text-center text-muted-foreground">Optional: AI Assistance with Image</h3>
                {mode === 'idle' && (
                <div className="flex flex-col items-center space-y-3 py-4 border rounded-lg p-4 bg-muted/20">
                    <p className="text-xs text-muted-foreground text-center px-2">
                        Upload a receipt or bank transaction image/photo for AI-powered suggestions.
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
                            disabled={isAiProcessing || hasCameraPermission === false}
                            className="w-full"
                        >
                            <Camera className="mr-2 h-4 w-4" />
                            Take Picture
                        </Button>
                    </div>
                    {hasCameraPermission === false && ( 
                        <Alert variant="destructive" className="mt-2 w-full">
                            <LocalAlertTriangle className="h-4 w-4" />
                            <AlertTitle>Camera Access Issue</AlertTitle>
                            <AlertDescription>
                                Camera access was denied or is unavailable. Please check browser permissions and ensure a camera is connected. You might need to refresh the page after changing permissions.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
                )}

                {mode === 'cameraView' && (
                <div className="space-y-3 p-2 border rounded-lg">
                    <Label className="text-base font-medium">Camera View</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button onClick={handleCapturePhoto} className="flex-1" disabled={isAiProcessing || !cameraStream}>
                            <Camera className="mr-2 h-4 w-4" /> Capture Photo
                        </Button>
                        {availableCameras.length > 1 && (
                            <Button variant="outline" onClick={handleSwitchCamera} className="flex-1" disabled={isAiProcessing || !cameraStream}>
                                <RefreshCcw className="mr-2 h-4 w-4" /> Switch Camera
                            </Button>
                        )}
                    </div>
                    <Button variant="outline" onClick={() => {
                            stopCurrentStream();
                            setMode('idle');
                        }} className="w-full" disabled={isAiProcessing}>
                            <XCircle className="mr-2 h-4 w-4" /> Back to Options
                        </Button>
                </div>
                )}

                {mode === 'preview' && imagePreviewUrl && (
                    <div className="space-y-3 p-2 border rounded-lg">
                        <Label className="text-base font-medium">Image Preview</Label>
                        <div className="relative w-full aspect-video border rounded-md overflow-hidden bg-muted">
                            <Image src={imagePreviewUrl} alt="Receipt preview" layout="fill" objectFit="contain" data-ai-hint="receipt payment"/>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Button variant="outline" onClick={handleEnableCamera} className="w-full sm:w-auto flex-1" disabled={isAiProcessing}>
                                <Camera className="mr-2 h-4 w-4" /> {selectedImageFile ? "Take New" : "Retake"}
                            </Button>
                            <Button variant="outline" onClick={handleClearImage} className="w-full sm:w-auto flex-1" disabled={isAiProcessing}>
                                <FileImage className="mr-2 h-4 w-4" />
                                Upload Different
                            </Button>
                        </div>
                    </div>
                )}

                {isAiProcessing && (
                    <div className="flex items-center justify-center text-sm text-muted-foreground mt-2 py-3">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {imageDataUri ? "AI is analyzing your image..." : (mode === 'cameraView' ? "Initializing camera..." : "Processing...")}
                    </div>
                )}
                {aiSuggestionError && (
                    <Alert variant="destructive" className="mt-2">
                    <LocalAlertTriangle className="h-4 w-4"/>
                    <AlertTitle>AI Suggestion Error</AlertTitle>
                    <AlertDescription>{aiSuggestionError}</AlertDescription>
                    </Alert>
                )}
            </div>

          </div>
        </ScrollArea>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-0 pt-4 border-t"> 
          <DialogClose asChild>
            <Button variant="outline" onClick={onCloseModal} disabled={isAiProcessing && mode !== 'cameraView'} className="w-full sm:w-auto">
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={budgetLoading || categoryOptions.length === 0 || (isAiProcessing && mode !== 'cameraView')} className="w-full sm:w-auto">
            {(isAiProcessing && mode !== 'cameraView') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            {(isAiProcessing && mode !== 'cameraView') ? "Processing..." : "Add Expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
