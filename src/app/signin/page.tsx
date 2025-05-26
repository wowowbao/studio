
"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, type UserCredential } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, LogIn, UserPlus, KeyRound } from 'lucide-react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      router.push('/'); // Redirect to home if already logged in
    }
  }, [user, authLoading, router]);

  const handleAuthAction = async (action: 'signIn' | 'signUp') => {
    setIsLoading(true);
    setError(null);
    try {
      let userCredential: UserCredential;
      if (action === 'signIn') {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      } else {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      }
      if (userCredential.user) {
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      console.error("Auth error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in with Google.');
       if (err.code === 'auth/popup-closed-by-user') {
        setError('Google Sign-In cancelled. Please try again.');
      } else if (err.code === 'auth/cancelled-popup-request') {
        // Handle multiple popups scenario if necessary, or just show generic error
         setError('Google Sign-In process interrupted. Please try again.');
      } else {
        console.error("Google Sign-In error:", err);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  if (authLoading || (!authLoading && user)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
        <KeyRound className="h-16 w-16 text-primary mb-4 animate-pulse" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }


  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <KeyRound className="mx-auto h-12 w-12 text-primary mb-3" />
          <CardTitle className="text-2xl">BudgetFlow Access</CardTitle>
          <CardDescription>Sign in or create an account to manage your budget.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={(e) => { e.preventDefault(); handleAuthAction('signIn'); }} className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="signin-email">Email</Label>
                  <Input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
                <div>
                  <Label htmlFor="signin-password">Password</Label>
                  <Input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
                </div>
                {error && <p className="text-sm text-destructive flex items-center"><AlertTriangle className="w-4 h-4 mr-1" /> {error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing In...' : <><LogIn className="mr-2 h-4 w-4" />Sign In</>}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={(e) => { e.preventDefault(); handleAuthAction('signUp'); }} className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
                <div>
                  <Label htmlFor="signup-password">Password</Label>
                  <Input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password (min. 6 characters)" required />
                </div>
                {error && <p className="text-sm text-destructive flex items-center"><AlertTriangle className="w-4 h-4 mr-1" /> {error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Creating Account...' : <><UserPlus className="mr-2 h-4 w-4" />Sign Up</>}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          <div className="mt-6">
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
            <Button variant="outline" className="w-full mt-4" onClick={handleGoogleSignIn} disabled={isLoading}>
              {isLoading ? 'Processing...' : (
                <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                  <path fill="currentColor" d="M488 261.8C488 403.3 381.5 512 244 512 110.3 512 0 398.8 0 256S110.3 0 244 0c69.8 0 130.8 28.2 174.2 74.2L372.5 128.2C339.7 99.8 294.8 84 244 84c-80.9 0-146.5 65.5-146.5 146.5s65.5 146.5 146.5 146.5c72.4 0 127.2-45.3 139.5-103.5H244V261.8h244z"></path>
                </svg>
              )}
              Sign in with Google
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

