
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { BudgetProvider } from '@/components/providers/BudgetProvider';
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from '@/context/AuthContext'; // New import

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'BudgetFlow',
  description: 'Manage your monthly budget with ease.',
  manifest: '/manifest.json', // You might need to create this if you want PWA features
  appleWebAppCapable: 'yes',
  appleWebAppStatusBarStyle: 'default',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider> {/* Added AuthProvider */}
            <BudgetProvider>
              <div className="flex flex-col min-h-screen">
                {children}
              </div>
              <Toaster />
            </BudgetProvider>
          </AuthProvider> {/* Added AuthProvider */}
        </ThemeProvider>
      </body>
    </html>
  );
}
