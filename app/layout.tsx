import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Starmap",
  description: "지금 이 시간, 이 위치의 하늘에 보이는 별자리 지도",
};

// 안드로이드 앱은 화면 끝까지(edge-to-edge) 그리므로 viewport-fit=cover 로 safe-area 값을 받는다.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0b1020",
};

// 안드로이드 앱(android/)은 user agent 끝에 StarmapAndroid/ 를 붙인다. 첫 화면을 그리기 전에
// <html data-shell="app"> 을 달아, 화면 폭과 상관없이 지도가 화면 전체를 쓰게 한다(globals.css 의 fullscreen).
const APP_SHELL_SCRIPT = `(function(){if(navigator.userAgent.indexOf("StarmapAndroid/")>=0)document.documentElement.setAttribute("data-shell","app")})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APP_SHELL_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
