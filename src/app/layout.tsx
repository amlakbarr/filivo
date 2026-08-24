import type {
  Metadata,
} from "next";

import {
  connection,
} from "next/server";

import "./globals.css";

export const metadata:
  Metadata = {
  title:
    "دستیار هوشمند کارشناسان",

  description:
    "سامانه هوشمند پاسخ‌گویی به کارشناسان",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children:
    React.ReactNode;
}>) {
  /*
   * CSP Nonce نیاز دارد صفحه برای هر Request
   * به‌صورت Dynamic Render شود.
   */
  await connection();

  return (
    <html
      lang="fa"
      dir="rtl"
    >
      <body>
        {children}
      </body>
    </html>
  );
}