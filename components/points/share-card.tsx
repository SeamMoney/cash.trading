"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { Share2, Download, Copy, Check, Trophy, Loader2, X } from "lucide-react"
import html2canvas from "html2canvas"

interface ShareCardProps {
  points: number
  rank?: number
  totalDeposited: string
  dlpBalance: string
}

export function ShareCard({ points, rank, totalDeposited, dlpBalance }: ShareCardProps) {
  const { account } = useWallet()
  const cardRef = useRef<HTMLDivElement>(null)
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const shortenAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(2)}`
  }

  const generateImage = useCallback(async () => {
    if (!cardRef.current) return null

    setGenerating(true)
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#000000',
        scale: 2,
        logging: false,
      })

      const url = canvas.toDataURL('image/png')
      setImageUrl(url)
      return url
    } catch (err) {
      console.error('Failed to generate image:', err)
      return null
    } finally {
      setGenerating(false)
    }
  }, [])

  const handleShare = async () => {
    setShowModal(true)
    await generateImage()
  }

  const handleDownload = () => {
    if (!imageUrl) return

    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `decibrrr-season0-${account?.address.slice(0, 8) || 'stats'}.png`
    link.click()
  }

  const handleCopyLink = () => {
    const shareText = `I'm ranked #${rank || '?'} in Decibel Season 0 with ${points.toLocaleString()} points! 🏆\n\nTrack your predeposit points: https://decibrrr.vercel.app/points`
    navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!account) return null

  return (
    <>
      {/* Share Button */}
      <button
        onClick={handleShare}
        className="flex items-center gap-2 px-4 py-2 bg-black/40 border border-white/10 hover:border-primary/50 transition-colors text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-primary"
      >
        <Share2 className="w-4 h-4" />
        Share Stats
      </button>

      {/* Share Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-md w-full bg-zinc-900 border border-white/10 p-6">
            {/* Close Button */}
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider mb-4">
              Share Your Stats
            </h3>

            {/* Card Preview */}
            <div
              ref={cardRef}
              className="bg-black p-6 mb-4"
              style={{ fontFamily: 'monospace' }}
            >
              {/* Card Content */}
              <div className="relative">
                {/* Corner decorations */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary" />

                <div className="p-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-2xl">🔊💵</span>
                    <span className="text-xl font-bold text-primary">DECIBRRR</span>
                    <span className="text-xs text-zinc-500 ml-auto">Season 0</span>
                  </div>

                  {/* Address */}
                  <div className="text-xs text-zinc-500 mb-4">
                    {shortenAddress(account.address.toString())}
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-[10px] uppercase text-zinc-600">Rank</div>
                      <div className="text-2xl font-bold text-primary">
                        #{rank || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-zinc-600">Points</div>
                      <div className="text-2xl font-bold text-purple-500">
                        {points.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-zinc-600">Deposited</div>
                      <div className="text-lg font-bold text-white">
                        {formatNumber(totalDeposited)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-zinc-600">DLP</div>
                      <div className="text-lg font-bold text-blue-500">
                        {formatNumber(dlpBalance)}
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="text-[10px] text-zinc-600 text-center pt-2 border-t border-white/10">
                    decibrrr.vercel.app
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            {generating ? (
              <div className="flex items-center justify-center gap-2 p-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm font-mono text-zinc-500">Generating image...</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  disabled={!imageUrl}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-black font-mono font-bold text-xs uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 border border-white/10 text-white font-mono text-xs uppercase tracking-wider hover:bg-zinc-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Text
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Share hint */}
            <p className="text-[10px] font-mono text-zinc-600 text-center mt-4">
              Share your Season 0 stats on Twitter/X
            </p>
          </div>
        </div>
      )}
    </>
  )
}
