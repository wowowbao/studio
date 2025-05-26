
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
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };
  
  useEffect(() => {
    if (isOpen && monthId && !budgetLoading) {
      resetFormFields(); // Call reset here to ensure state is clean on open

      const budgetData = getBudgetForMonth(monthId);
      const options: CategoryOption[] = [];
      if (budgetData) {
        budgetData.categories.forEach(cat => {
          if (cat.isSystemCategory) { // Always add system categories as direct targets
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          } else if (!cat.subcategories || cat.subcategories.length === 0) { // Non-system without subs
            options.push({ value: cat.id, label: cat.name, isSubcategory: false });
          }
          (cat.subcategories || []).forEach(sub => {
             if (!cat.isSystemCategory) { // Ensure parent is not system category for subcategories
                options.push({ value: sub.id, label: `${cat.name} > ${sub.name}`, isSubcategory: true, parentCategoryId: cat.id });
             }
          });
        });
      }
      // Sort options: System categories first, then others alphabetically
      options.sort((a, b) => {
        const aIsSystem = budgetData?.categories.find(c => c.id === a.value)?.isSystemCategory || false;
        const bIsSystem = budgetData?.categories.find(c => c.id === b.value)?.isSystemCategory || false;
        if (aIsSystem && !bIsSystem) return -1;
        if (!aIsSystem && bIsSystem) return 1;
        if (aIsSystem && bIsSystem) { // Specific order for system categories
            if (a.label === "Savings") return -1;
            if (b.label === "Savings") return 1;
            if (a.label === "Credit Card Payments") return -1; // After Savings
            if (b.label === "Credit Card Payments") return 1;
        }
        return a.label.localeCompare(b.label);
      });
      setCategoryOptions(options);
    } else if (!isOpen && cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, monthId, budgetLoading]); // Removed getBudgetForMonth from deps as it's stable from useBudget


  const getCameraPermissionAndStream = async (deviceId?: string): Promise<MediaStream | null> => {
    if (cameraStream && videoRef.current && videoRef.current.srcObject) {
      cameraStream.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    setCameraStream(null);

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
        await videoRef.current.play().catch(e => console.error("Video play failed:", e));
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);

      const currentStreamDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;

      if (!deviceId && videoDevices.length > 0) { 
        const rearCamera = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        if (rearCamera && currentStreamDeviceId !== rearCamera.deviceId) {
          stream.getTracks().forEach(track => track.stop()); 
          setSelectedCameraId(rearCamera.deviceId); 
          return getCameraPermissionAndStream(rearCamera.deviceId); 
        } else if (currentStreamDeviceId) {
          setSelectedCameraId(currentStreamDeviceId);
        } else { 
          setSelectedCameraId(videoDevices[0]?.deviceId);
        }
      } else if (deviceId) { 
        setSelectedCameraId(deviceId);
      }
      
      return stream;

    } catch (error) {
      console.error('Error accessing camera:', error);
      setHasCameraPermission(false);
      setCameraStream(null);
      return null; 
    }
  };

  const handleEnableCamera = async () => {
    setIsAiProcessing(true);
    const stream = await getCameraPermissionAndStream(selectedCameraId); 
    setIsAiProcessing(false);
    if (stream) {
      setMode('cameraView');
    } else {
      setMode('idle');
      toast({
        variant: 'destructive',
        title: 'Camera Access Failed',
        description: 'Could not access camera. Please check permissions and ensure no other app is using it.',
      });
    }
  };

  const handleSwitchCamera = async () => {
    if (availableCameras.length > 1 && selectedCameraId) {
      const currentIndex = availableCameras.findIndex(cam => cam.deviceId === selectedCameraId);
      const nextIndex = (currentIndex + 1) % availableCameras.length;
      const nextCameraId = availableCameras[nextIndex].deviceId;
      
      setIsAiProcessing(true);
      const stream = await getCameraPermissionAndStream(nextCameraId);
      setIsAiProcessing(false);

      if (stream) {
        setSelectedCameraId(nextCameraId); 
        setMode('cameraView');
      } else {
        toast({ variant: "destructive", title: "Camera Switch Failed", description: "Could not switch to the selected camera."});
      }
    }
  };
  
  useEffect(() => {
    const enumerateAndSetCameras = async () => {
      if (hasCameraPermission === true && availableCameras.length === 0) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === 'videoinput');
          setAvailableCameras(videoDevices);
          if (videoDevices.length > 0 && !selectedCameraId) {
            const rearCamera = videoDevices.find(d => 
              d.label.toLowerCase().includes('back') || 
              d.label.toLowerCase().includes('environment')
            );
            const initialCameraId = rearCamera ? rearCamera.deviceId : videoDevices[0].deviceId;
            setSelectedCameraId(initialCameraId);
          }
        } catch (err) {
          console.error("Error enumerating devices after permission grant:", err);
        }
      }
    };
    enumerateAndSetCameras();
  }, [hasCameraPermission, availableCameras.length, selectedCameraId]);


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
    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= videoRef.current.HAVE_METADATA) {
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
        if (cameraStream) {
          cameraStream.getTracks().forEach(track => track.stop());
          setCameraStream(null);
        }
      }
    } else {
        toast({ variant: "destructive", title: "Camera Error", description: "Camera not ready. Please try again."});
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
        if (result.suggestedAmount !== undefined && result.suggestedAmount !== null) {
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
        
        <video 
            ref={videoRef} 
            className={cn(
                "w-full rounded-md bg-muted", 
                mode === 'cameraView' ? 'block h-[70vh] max-h-[500px] object-contain' : 'hidden aspect-video'
            )} 
            autoPlay 
            muted 
            playsInline 
        />
        <canvas ref={canvasRef} className="hidden"></canvas>

        <div className="grid gap-4 py-4">
           {mode === 'idle' && (
             <div className="flex flex-col items-center space-y-3 py-4 border rounded-lg p-4 bg-muted/20">
                <p className="text-base font-medium">Add Receipt Image (Optional)</p>
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
                        <AlertTitle>Camera Access Denied</AlertTitle>
                        <AlertDescription>
                            Please enable camera permissions in your browser settings and try again. You might need to refresh the page after changing permissions.
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
                         if (cameraStream) {
                            cameraStream.getTracks().forEach(track => track.stop());
                            setCameraStream(null);
                          }
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
              <div className="flex items-center text-sm text-muted-foreground mt-2">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {imageDataUri ? "AI is analyzing your receipt..." : "Accessing camera..."}
              </div>
            )}
            {aiSuggestionError && (
              <Alert variant="destructive" className="mt-2">
                <LocalAlertTriangle className="h-4 w-4"/>
                <AlertTitle>AI Suggestion Error</AlertTitle>
                <AlertDescription>{aiSuggestionError}</AlertDescription>
              </Alert>
            )}
          
          {budgetLoading ? (
            <p>Loading categories...</p>
          ) : categoryOptions.length === 0 ? (
            <p className="text-muted-foreground py-4">No categories or subcategories available for this month. Please add them first in 'Manage Budget'.</p>
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
                  <SelectContent className="max-h-60"> {/* Added max-h-60 for scroll */}
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
               <Alert variant="default" className="mt-4 col-span-4">
                  <Info className="h-4 w-4" />
                  <AlertTitle className="font-semibold">Quick Tip!</AlertTitle>
                  <AlertDescription className="text-xs">
                    To record money transferred to savings, select the "Savings" category.
                    For credit card payments, select "Credit Card Payments". These are treated as expenses to these specific categories.
                  </AlertDescription>
                </Alert>
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
            {isAiProcessing && !imageDataUri && mode !== 'cameraView' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            {isAiProcessing && !imageDataUri && mode !== 'cameraView' ? "Processing..." : (isAiProcessing ? "Processing..." : "Add Expense")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
    

  

    
