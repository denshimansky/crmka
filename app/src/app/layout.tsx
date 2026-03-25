import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Умная CRM",
  description: "CRM-система для детских центров и сферы услуг",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
