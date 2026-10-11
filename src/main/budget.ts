import type { ProviderId } from '@shared/types'
import { getSettings, priceFor } from './settings'
import { spendSince } from './store'
import type { LlmUsage } from './providers/types'

export function startOfToday(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

export function startOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

export function spend(): { todayUsd: number; monthUsd: number; todayTokens: number } {
  const today = spendSince(startOfToday())
  return { todayUsd: today.usd, monthUsd: spendSince(startOfMonth()).usd, todayTokens: today.tokens }
}

export function costOf(provider: ProviderId, model: string, u: LlmUsage): { usd: number; priced: boolean } {
  const p = priceFor(provider, model)
  if (!p) return { usd: 0, priced: false }
  const usd = (u.input * p.input + u.output * p.output + u.cacheRead * (p.cacheRead ?? p.input)) / 1_000_000
  return { usd, priced: true }
}

/**
 * Hard gate before every AI call. Uses a worst-case estimate (full input plus the
 * whole output allowance) so a single call can't push spend over a cap.
 */
export function checkBudget(provider: ProviderId, model: string, inputChars: number, maxOutput: number): string | null {
  const { budget } = getSettings()
  const s = spend()
  const estTokens = Math.ceil(inputChars / 3) + maxOutput
  const est = costOf(provider, model, { input: Math.ceil(inputChars / 3), output: maxOutput, cacheRead: 0 }).usd
  if (s.todayTokens + estTokens > budget.dailyTokens) return `Daily token cap reached (${budget.dailyTokens.toLocaleString()})`
  if (s.todayUsd + est > budget.dailyUsd) return `Daily budget reached ($${budget.dailyUsd.toFixed(2)})`
  if (s.monthUsd + est > budget.monthlyUsd) return `Monthly budget reached ($${budget.monthlyUsd.toFixed(2)})`
  return null
}
