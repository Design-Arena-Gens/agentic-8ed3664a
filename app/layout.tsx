import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Scene Composer",
  description: "Assemble 15-20 second videos from scene images directly in the browser.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
