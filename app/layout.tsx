import type React from "react"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Suspense } from "react"
import { Analytics } from "@vercel/analytics/react"
import { Toaster } from "@/components/ui/sonner"
import { ClientProviders } from "@/components/client-providers"
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
  title: "Decibel Market Making Bot",
  description:
    "Automated market making bot for Decibel. Execute TWAP orders and manage trading strategies on Aptos.",
  keywords: [
    "Decibel",
    "market making",
    "trading bot",
    "Aptos",
    "perpetual futures",
    "TWAP",
    "automated trading",
    "DeFi",
    "perpetuals",
  ],
  authors: [{ name: "Decibel" }],
  creator: "Decibel",
  publisher: "Decibel",
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Decibel Market Making Bot",
    description:
      "Automated market making bot for Decibel. Execute TWAP orders and manage trading strategies on Aptos.",
    siteName: "Decibel Market Making Bot",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Decibel Market Making Bot",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Decibel Market Making Bot",
    description:
      "Automated market making bot for Decibel. Execute TWAP orders and manage trading strategies on Aptos.",
    images: ["/og-image.jpg"],
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
        <ClientProviders>
          <Suspense fallback={null}>{children}</Suspense>
        </ClientProviders>
        <Toaster
          position="bottom-center"
          duration={2000}
          toastOptions={{
            style: {
              background: '#000',
              border: '1px solid #fff600',
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
