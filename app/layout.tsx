import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bein Harim Talking Bot",
  description: "WhatsApp-to-voice automation service",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
