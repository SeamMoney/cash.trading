"use client"

import { Lightbulb, Check, ArrowRight, ExternalLink, Zap, Clock, TrendingUp, Gift } from "lucide-react"
import Link from "next/link"

const FARMING_STRATEGIES = [
  {
    id: 'early-deposit',
    title: 'Deposit Early',
    description: 'First week deposits get 2x points multiplier. First month gets 1.5x.',
    icon: Clock,
    color: 'text-green-500',
    priority: 'high',
  },
  {
    id: 'max-dlp',
    title: 'Maximize DLP Allocation',
    description: 'DLP earns 1.5x more points than Unallocated (UA) funds.',
    icon: TrendingUp,
    color: 'text-blue-500',
    priority: 'high',
  },
  {
    id: 'use-bot',
    title: 'Use Decibrrr Bot',
    description: 'Automated volume generation helps you earn more trading points on top of predeposit points.',
    icon: Zap,
    color: 'text-primary',
    priority: 'medium',
    link: '/',
  },
  {
    id: 'referrals',
    title: 'Refer Friends',
    description: 'Earn bonus points for each friend that deposits using your referral code.',
    icon: Gift,
    color: 'text-purple-500',
    priority: 'medium',
  },
]

const QUICK_LINKS = [
  {
    label: 'Decibel Predeposit',
    url: 'https://app.decibel.trade/predeposit',
    description: 'Make your predeposit directly',
  },
  {
    label: 'Season 0 FAQ',
    url: 'https://docs.decibel.trade/points/season-0',
    description: 'Learn about the points program',
  },
  {
    label: 'Discord',
    url: 'https://discord.gg/decibel',
    description: 'Join the community',
  },
]

export function FarmingTips() {
  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative animate-in fade-in duration-500">
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
          Points Farming Tips
        </h3>
      </div>

      {/* Strategies */}
      <div className="space-y-3 mb-6">
        {FARMING_STRATEGIES.map((strategy) => {
          const Icon = strategy.icon
          return (
            <div
              key={strategy.id}
              className="flex items-start gap-3 p-3 bg-black/40 border border-white/5 hover:border-white/10 transition-colors group"
            >
              <div className={`p-1.5 bg-black/40 border border-white/10 ${strategy.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium text-white">
                    {strategy.title}
                  </span>
                  {strategy.priority === 'high' && (
                    <span className="text-[8px] font-mono uppercase px-1.5 py-0.5 bg-green-500/20 text-green-500 border border-green-500/30">
                      High Impact
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-mono text-zinc-500 mt-1">
                  {strategy.description}
                </p>
              </div>
              {strategy.link && (
                <Link
                  href={strategy.link}
                  className="text-zinc-500 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                >
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          )
        })}
      </div>

      {/* Quick Links */}
      <div className="border-t border-white/10 pt-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
          Quick Links
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 border border-white/10 hover:border-primary/30 text-xs font-mono text-zinc-400 hover:text-primary transition-colors"
            >
              {link.label}
              <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-4 p-4 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-mono font-bold text-primary">
              Ready to start farming?
            </div>
            <div className="text-[10px] font-mono text-zinc-500 mt-1">
              Use Decibrrr to automate your trading volume
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-mono font-bold text-xs uppercase tracking-wider hover:bg-primary/90 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Start Bot
          </Link>
        </div>
      </div>
    </div>
  )
}
