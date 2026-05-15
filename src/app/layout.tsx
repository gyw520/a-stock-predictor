import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A股智能预测系统",
  description: "实时行情 · 技术分析 · 板块预测",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
