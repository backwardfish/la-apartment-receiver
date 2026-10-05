import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LA Apartment Receiver",
  description: "A visual research inbox for a smarter Los Angeles rental search.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased"
      >
        {children}
      </body>
    </html>
  );
}
