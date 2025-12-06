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
  metadataBase: new URL("https://decibrrr.vercel.app"),
  title: "Decibrrr - Farm Decibel Points on Aptos",
  description:
    "Farm points on Decibel perp DEX. Automated volume generation bot for Decibel perpetual futures on Aptos blockchain.",
  keywords: [
    "Decibel",
    "Decibrrr",
    "points farming",
    "Aptos",
    "perpetual futures",
    "perp DEX",
    "TWAP",
    "automated trading",
    "DeFi",
    "perpetuals",
    "volume farming",
  ],
  authors: [{ name: "Decibrrr" }],
  creator: "Decibrrr",
  publisher: "Decibrrr",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://decibrrr.vercel.app",
    title: "Decibrrr - Farm Decibel Points on Aptos",
    description:
      "Farm points on Decibel perp DEX. Automated volume generation bot for Decibel perpetual futures on Aptos blockchain.",
    siteName: "Decibrrr",
  },
  twitter: {
    card: "summary_large_image",
    title: "Decibrrr - Farm Decibel Points on Aptos",
    description:
      "Farm points on Decibel perp DEX. Automated volume generation bot for Decibel perpetual futures on Aptos blockchain.",
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
