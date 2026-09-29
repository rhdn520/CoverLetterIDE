import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoverLetterIDE — 자소서 작성 워크스페이스",
  description: "대학생을 위한 자소서 작성과 지원 자료 관리 워크스페이스",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
