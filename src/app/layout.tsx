import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "استودیوی ضبط و تدوین زندهٔ نریشن",
  description: "ضبط و میکس زندهٔ نریشن با پشتیبانی از قطع اینترنت",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className="dark">
      <body className="bg-bg text-white min-h-screen antialiased">{children}</body>
    </html>
  );
}
