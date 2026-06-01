import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";
import { TopNav } from "@/components/layout/Nav";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import "./globals.css";

// Inter is the only product family — DESIGN.md typography section.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Geist Mono retained for code samples / debug surfaces only.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DUBR — Badminton Rating",
  description: "Casual-friendly badminton rating system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ClerkProvider
          appearance={{
            variables: {
              colorPrimary: "#15803D",
              colorBackground: "#FFFFFF",
              borderRadius: "10px",
            },
            elements: {
              card: "shadow-2xl border border-[#DCE5DC]",
            },
          }}
        >
          <Providers>
            <TopNav />
            <div className="flex-1 pb-20 md:pb-0">{children}</div>
            <MobileTabBar />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
