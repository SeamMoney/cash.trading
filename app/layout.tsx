import type React from "react"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Suspense } from "react"
import { Analytics } from "@vercel/analytics/react"
import { Toaster } from "@/components/ui/sonner"
import { ClientProviders } from "@/components/client-providers"
import { ChunkReload } from "@/components/chunk-reload"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://cash.trading"),
  title: "cash.trading - Aptos Perps and CASH Rewards",
  description:
    "Aptos perp trading, analytics, indicator strategies, automated trading, and direct CASH rewards.",
  keywords: [
    "cash.trading",
    "CASH",
    "Aptos",
    "Decibel",
    "trading",
    "perpetual futures",
    "perp DEX",
    "analytics",
    "automated trading",
    "DeFi",
  ],
  authors: [{ name: "cash.trading" }],
  creator: "cash.trading",
  publisher: "cash.trading",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://cash.trading",
    title: "cash.trading - Aptos Perps and CASH Rewards",
    description:
      "Aptos perp trading, analytics, indicator strategies, automated trading, and direct CASH rewards.",
    siteName: "cash.trading",
  },
  twitter: {
    card: "summary_large_image",
    title: "cash.trading - Aptos Perps and CASH Rewards",
    description:
      "Aptos perp trading, analytics, indicator strategies, automated trading, and direct CASH rewards.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  manifest: "/manifest.json",
}

export const viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
      style={{ backgroundColor: "#000000" }}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-mono antialiased" style={{ backgroundColor: "#000000" }}>
        <ChunkReload />
        <ClientProviders>
          <Suspense fallback={null}>{children}</Suspense>
        </ClientProviders>
        <Toaster
          position="bottom-center"
          duration={2000}
          toastOptions={{
            style: {
              background: '#000',
              border: '1px solid #39ff14',
              color: '#fff',
              fontWeight: 500,
            },
            className: 'font-mono',
          }}
        />
        <Analytics />
      </body>
    </html>
  )
}
