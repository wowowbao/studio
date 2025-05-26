
"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider // Make sure this is imported if used directly
} from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase'; // Ensure googleProvider is exported from firebase.ts
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle, LogIn, ExternalLink } from 'lucide-react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningUp, setIsSigningUp] = useState(false); // To toggle between Sign In and Sign Up
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleEmailPasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (isSigningUp) {
        await createUserWithEmailAndPassword(auth, email, password);
        toast({ title: "Account Created", description: "Successfully signed up! Redirecting...", action: <CheckCircle className="text-green-500" /> });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast({ title: "Signed In", description: "Successfully signed in! Redirecting...", action: <CheckCircle className="text-green-500" /> });
      }
      router.push('/'); // Redirect to home page after successful auth
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      toast({ title: "Authentication Error", description: err.message, variant: "destructive", action: <AlertTriangle/> });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      toast({ title: "Signed In with Google", description: "Successfully signed in! Redirecting...", action: <CheckCircle className="text-green-500" /> });
      router.push('/');
    } catch (err: any) {
      setError(err.message || "Failed to sign in with Google.");
      toast({ title: "Google Sign-In Error", description: err.message, variant: "destructive", action: <AlertTriangle/> });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">{isSigningUp ? 'Create Account' : 'Welcome Back!'}</CardTitle>
          <CardDescription>{isSigningUp ? 'Enter your details to create a new account.' : 'Sign in to access your budget.'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleEmailPasswordAuth} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="mt-1"
              />
            </div>
            {error && <p className="text-sm text-destructive flex items-center"><AlertTriangle className="w-4 h-4 mr-1" /> {error}</p>}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (isSigningUp ? 'Creating Account...' : 'Signing In...') : (isSigningUp ? 'Sign Up' : 'Sign In')}
            </Button>
          </form>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={handleGoogleSignIn} disabled={isLoading}>
            {/* Placeholder for Google Icon, you can use lucide or a proper Google icon */}
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 381.7 512 244 512 112.8 512 0 398.9 0 256S112.8 0 244 0c69.8 0 130.8 28.5 173.4 74.9L345 149.7C314.5 124.3 282.7 112 244 112c-67.9 0-124.2 54.2-124.2 121.3s56.2 121.3 124.2 121.3c76.3 0 104.4-54.7 108.1-82.7H244v-68.6h239.3c4.3 23.2 6.7 46.7 6.7 72.6z"></path></svg>
            Sign in with Google
          </Button>
        </CardContent>
        <CardFooter className="flex flex-col items-center space-y-2">
          <Button variant="link" onClick={() => { setIsSigningUp(!isSigningUp); setError(null); }} className="text-sm">
            {isSigningUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
          </Button>
           <Link href="/" legacyBehavior>
              <a className="text-sm text-muted-foreground hover:text-primary flex items-center">
                <ExternalLink className="w-3 h-3 mr-1" /> Go back to Home (Guest)
              </a>
            </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
