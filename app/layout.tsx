import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "JoySearch — Wikipedia Search",
  description: "Search Wikipedia with JoySearch. Find articles, summaries, and images in a simple, responsive search app.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
