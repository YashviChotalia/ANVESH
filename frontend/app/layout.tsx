import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Anvesh",
  description: "Turns cybercrime calls into evidence-linked case files and links them into fraud rings.",
  icons: { icon: "/favicon.png", apple: "/brand/anvesh-mark.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
