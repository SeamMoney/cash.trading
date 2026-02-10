"use client"

import { useState, useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import {
  Wallet,
  DollarSign,
  ArrowRight,
  Loader2,
  AlertCircle,
  Check,
  ExternalLink,
  Info
} from "lucide-react"
import { DECIBEL_PACKAGE, PREDEPOSIT_OBJECT, PREDEPOSIT_MIN_AMOUNT, PREDEPOSIT_MAX_AMOUNT, USDC_DECIMALS } from "@/lib/decibel-client"

interface DepositWidgetProps {
  onDepositSuccess?: () => void
}

export function DepositWidget({ onDepositSuccess }: DepositWidgetProps) {
  const { account, connected, signAndSubmitTransaction } = useWallet()
  const [amount, setAmount] = useState<string>("")
  const [referralCode, setReferralCode] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [allocationType, setAllocationType] = useState<'dlp' | 'ua'>('dlp')

  // Parse amount as number
  const amountNum = parseFloat(amount) || 0

  // Validation
  const isValidAmount = amountNum >= PREDEPOSIT_MIN_AMOUNT && amountNum <= PREDEPOSIT_MAX_AMOUNT
  const canDeposit = connected && isValidAmount && !loading

  const handleDeposit = async () => {
    if (!canDeposit || !signAndSubmitTransaction || !account?.address) return

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // Convert amount to smallest unit (USDC has 6 decimals)
      const amountInSmallestUnit = Math.floor(amountNum * Math.pow(10, USDC_DECIMALS))

      // Build the deposit transaction payload
      const payload = {
        function: `${DECIBEL_PACKAGE}::predeposit::deposit`,
        typeArguments: [],
        functionArguments: [
          PREDEPOSIT_OBJECT, // predeposit state object (derived from package + "predeposit" seed)
          amountInSmallestUnit.toString(),
          referralCode.trim() || undefined, // Optional referral code (undefined = Option::none)
        ],
      }

      console.log("📤 Submitting predeposit transaction:", payload)

      const response = await signAndSubmitTransaction({
        data: payload,
      })

      console.log("✅ Predeposit transaction:", response.hash)
      setSuccess(`Deposit successful! TX: ${response.hash.slice(0, 10)}...`)
      setAmount("")

      if (onDepositSuccess) {
        onDepositSuccess()
      }
    } catch (err: any) {
      console.error("Deposit failed:", err)
      setError(err.message || "Failed to submit deposit transaction")
    } finally {
      setLoading(false)
    }
  }

  const quickAmounts = [100, 500, 1000, 5000]

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative animate-in fade-in duration-500">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500/30 to-transparent" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-green-500/10 border border-green-500/30">
          <Wallet className="w-5 h-5 text-green-500" />
        </div>
        <div>
          <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
            Make Predeposit
          </h3>
          <p className="text-[10px] font-mono text-zinc-500">
            Deposit to earn Season 0 points
          </p>
        </div>
      </div>

      {!connected ? (
        <div className="text-center py-8">
          <Wallet className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <p className="text-zinc-500 font-mono text-sm">Connect wallet to deposit</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Amount Input */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
              Deposit Amount (USDC)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min={PREDEPOSIT_MIN_AMOUNT}
                max={PREDEPOSIT_MAX_AMOUNT}
                className="w-full pl-10 pr-4 py-3 bg-black/40 border border-white/10 text-white text-lg font-mono focus:border-green-500/50 focus:outline-none"
              />
            </div>

            {/* Quick Amount Buttons */}
            <div className="flex gap-2 mt-2">
              {quickAmounts.map((qa) => (
                <button
                  key={qa}
                  onClick={() => setAmount(qa.toString())}
                  className={`flex-1 px-2 py-1.5 text-xs font-mono border transition-colors ${
                    amountNum === qa
                      ? 'bg-green-500/20 text-green-500 border-green-500/30'
                      : 'text-zinc-500 border-white/10 hover:border-white/20'
                  }`}
                >
                  ${qa.toLocaleString()}
                </button>
              ))}
            </div>

            {/* Validation Message */}
            {amount && !isValidAmount && (
              <p className="text-[10px] font-mono text-red-500 mt-2">
                {amountNum < PREDEPOSIT_MIN_AMOUNT
                  ? `Minimum deposit is $${PREDEPOSIT_MIN_AMOUNT}`
                  : `Maximum deposit is $${PREDEPOSIT_MAX_AMOUNT.toLocaleString()}`
                }
              </p>
            )}
          </div>

          {/* Allocation Type */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
              Allocation Type
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setAllocationType('dlp')}
                className={`flex-1 px-4 py-2.5 text-xs font-mono uppercase tracking-wider border transition-colors ${
                  allocationType === 'dlp'
                    ? 'bg-blue-500/20 text-blue-500 border-blue-500/30'
                    : 'text-zinc-500 border-white/10 hover:border-white/20'
                }`}
              >
                DLP (1.5x Points)
              </button>
              <button
                onClick={() => setAllocationType('ua')}
                className={`flex-1 px-4 py-2.5 text-xs font-mono uppercase tracking-wider border transition-colors ${
                  allocationType === 'ua'
                    ? 'bg-orange-500/20 text-orange-500 border-orange-500/30'
                    : 'text-zinc-500 border-white/10 hover:border-white/20'
                }`}
              >
                Unallocated (1x)
              </button>
            </div>
          </div>

          {/* Referral Code (Optional) */}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
              Referral Code (Optional)
            </label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder="Enter referral code..."
              className="w-full px-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-green-500/50 focus:outline-none"
            />
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 text-red-500">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 text-green-500">
              <Check className="w-4 h-4 shrink-0" />
              <p className="text-xs font-mono">{success}</p>
            </div>
          )}

          {/* Deposit Button */}
          <button
            onClick={handleDeposit}
            disabled={!canDeposit}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-black font-mono font-bold text-sm uppercase tracking-wider hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Wallet className="w-5 h-5" />
                Deposit {amountNum > 0 ? `$${amountNum.toLocaleString()}` : ''}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {/* Info Box */}
          <div className="flex items-start gap-2 p-3 bg-zinc-900/50 border border-white/5">
            <Info className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
            <div className="text-[10px] font-mono text-zinc-500 leading-relaxed">
              <p className="mb-1">
                Deposits go directly to Decibel's predeposit contract.
                DLP allocation earns 1.5x more points than unallocated funds.
              </p>
              <a
                href="https://app.decibel.trade/predeposit"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                View on Decibel
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
