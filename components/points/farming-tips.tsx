"use client"

import { Lightbulb, ExternalLink, Zap, Clock, TrendingUp, Gift } from "lucide-react"

const FARMING_STRATEGIES = [
  {
    id: 'consistent-trading',
    title: 'Trade Consistently',
    description: 'Season 1 rewards sustained, organic trading activity rather than raw churn.',
    icon: Clock,
    priority: 'high',
  },
  {
    id: 'provide-liquidity',
    title: 'Provide Liquidity',
    description: 'DLP and user-managed vault contributions can earn dedicated vault AMPs.',
    icon: TrendingUp,
    priority: 'high',
  },
  {
    id: 'streaks',
    title: 'Maintain Streaks',
    description: 'Qualifying trading days build streak AMPs and consistency bonuses.',
    icon: Zap,
    priority: 'medium',
  },
  {
    id: 'referrals',
    title: 'Refer Friends',
    description: 'Earn referral AMPs when the traders you invite become active participants.',
    icon: Gift,
    priority: 'medium',
  },
]

const QUICK_LINKS = [
  { label: 'Decibel Points', url: 'https://app.decibel.trade/points' },
  { label: 'AMPs Guide', url: 'https://docs.decibel.trade/rewards/amps' },
  { label: 'Discord', url: 'https://discord.gg/decibel' },
]

export function FarmingTips() {
  return (
    <div className="bg-black/40 border border-white/10 px-3 py-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[11px] sm:text-xs font-mono font-bold text-white uppercase tracking-wider">
          Earning AMPs
        </span>
      </div>

      {/* Strategies */}
      <div className="space-y-1.5 mb-3">
        {FARMING_STRATEGIES.map((strategy) => {
          const Icon = strategy.icon
          return (
            <div
              key={strategy.id}
              className="flex items-start gap-2 px-2 py-1.5 bg-black/40 border border-white/5 group"
            >
              <Icon className="w-3 h-3 text-zinc-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-mono text-white">{strategy.title}</span>
                  {strategy.priority === 'high' && (
                    <span className="text-[8px] font-mono uppercase px-1 py-px bg-primary/10 text-primary border border-primary/20 leading-tight">
                      High
                    </span>
                  )}
                </div>
                <p className="text-[9px] sm:text-[10px] font-mono text-zinc-500 mt-px leading-snug">
                  {strategy.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Links */}
      <div className="border-t border-white/10 pt-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 bg-black/40 border border-white/10 hover:border-primary/30 text-[9px] sm:text-[10px] font-mono text-zinc-400 hover:text-primary transition-colors"
            >
              {link.label}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
