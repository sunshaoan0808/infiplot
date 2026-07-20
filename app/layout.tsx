import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Analytics } from "@/components/Analytics";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { localePath } from "@/lib/i18n/navigation";
import { stripLocalePrefix } from "@/lib/i18n/navigation";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";

// Editorial fonts: --font-serif / --font-sans 在 globals.css 里定义（系统字体栈），
// 避免构建时联网取 Google Fonts（构建环境无法访问外网字体 CDN）。

export const metadata: Metadata = {
  title: "InfiPlot — AI 实时交互剧情游戏",
  description: "InfiPlot 是一款用 AI 实时生成图片、语音与剧情分支的交互式剧情游戏 Demo。",
};

// viewportFit:cover lets the immersive /play portrait layout extend under the
// iOS notch / home-indicator and exposes env(safe-area-inset-*) to the
// floating controls. device-width + initialScale keep mobile rendering 1:1.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const locale = headersList.get("x-locale") || "zh-CN";

  const origin =
    process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "https://infiplot.com");
  const pathname = headersList.get("x-pathname") || "/";
  const barePath = stripLocalePrefix(pathname);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
    >
      <head>
        {LOCALES.map((l) => (
          <link
            key={l}
            rel="alternate"
            hrefLang={l}
            href={`${origin}${localePath(barePath, l)}`}
          />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${origin}${barePath}`} />
      </head>
      <body className="bg-cream-50 text-clay-900 font-sans antialiased min-h-screen overflow-x-hidden">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
