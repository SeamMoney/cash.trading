/**
 * Cloud Status API
 *
 * Returns whether cloud mode (Vercel Cron) is properly configured.
 * This helps users understand if their bot will run when browser is closed.
 */

import { NextResponse } from 'next/server'
import { legacyBotAutomationEnabled } from '@/lib/legacy-bot-guard'

export const runtime = 'nodejs'

export async function GET() {
  const automationEnabled = legacyBotAutomationEnabled()

  if (!automationEnabled) {
    return NextResponse.json({
      automationEnabled: false,
      cloudModeEnabled: false,
      cronInterval: null,
      message: 'Automated bot execution is temporarily unavailable. Manual trading is unaffected.',
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    })
  }

  const cronSecretConfigured = !!process.env.CRON_SECRET
  const databaseConfigured = !!process.env.DATABASE_URL
  const botOperatorConfigured = !!process.env.BOT_OPERATOR_PRIVATE_KEY

  const cloudModeEnabled = cronSecretConfigured && databaseConfigured && botOperatorConfigured

  return NextResponse.json({
    automationEnabled: true,
    cloudModeEnabled,
    cronInterval: '1 minute',
    checks: {
      cronSecret: cronSecretConfigured,
      database: databaseConfigured,
      botOperator: botOperatorConfigured,
    },
    message: cloudModeEnabled
      ? 'Cloud mode active. Bot will run every minute even when browser is closed.'
      : 'Cloud mode not configured. Bot requires browser tab to be open.',
    setupGuide: !cloudModeEnabled ? {
      missing: [
        !cronSecretConfigured && 'CRON_SECRET - Required for Vercel Cron authentication',
        !databaseConfigured && 'DATABASE_URL - Required for bot state persistence',
        !botOperatorConfigured && 'BOT_OPERATOR_PRIVATE_KEY - Required for executing trades',
      ].filter(Boolean),
      instructions: 'Set these environment variables in Vercel Dashboard > Settings > Environment Variables',
    } : null,
  }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  })
}
