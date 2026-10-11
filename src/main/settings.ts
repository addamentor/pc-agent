import { safeStorage } from 'electron'
import { kvGet, kvSet } from './db'
import type { ModelPrice, ProviderId, Settings } from '@shared/types'
import { PROVIDERS } from '@shared/types'

// Anthropic first-party list prices (USD per 1M tokens). Other providers' prices
// are entered by the user in Settings; Ollama is free.
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'anthropic:claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'anthropic:claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'anthropic:claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'anthropic:claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'anthropic:claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 }
}

const DEFAULTS: Omit<Settings, 'providers'> = {
  wake: { provider: 'anthropic', model: 'claude-haiku-5-5', maxOutputTokens: 400 },
  chat: { provider: 'anthropic', model: 'claude-sonnet-5-5', maxOutputTokens: 1200 },
  prices: DEFAULT_PRICES,
  budget: { dailyUsd: 0.25, monthlyUsd: 3, dailyTokens: 100_000 },
  schedule: { minGapMin: 15, maxGapMin: 720, quietStart: '23:00', quietEnd: '07:00', digestHour: 9 },
  profile: '',
  onboarded: false,
  pc: { readFolders: [], commandTimeoutSec: 120 },
  addons: {},
  browser: { channel: 'chrome', readInCheckins: false, maxPagesPerRound: 2, maxReadChars: 2000, maxReadRounds: 2 },
  openAtLogin: true,
  paused: false
}

type StoredSettings = Omit<Settings, 'providers'> & {
  providers: Record<ProviderId, { enabled: boolean; baseUrl?: string }>
}

function defaultProviders(): StoredSettings['providers'] {
  const out = {} as StoredSettings['providers']
  for (const p of PROVIDERS) out[p.id] = { enabled: p.id === 'anthropic', baseUrl: p.defaultBaseUrl }
  return out
}

function stored(): StoredSettings {
  const s = kvGet<Partial<StoredSettings>>('settings', {})
  return {
    ...DEFAULTS,
    ...s,
    providers: { ...defaultProviders(), ...(s.providers ?? {}) },
    prices: { ...DEFAULT_PRICES, ...(s.prices ?? {}) },
    budget: { ...DEFAULTS.budget, ...(s.budget ?? {}) },
    schedule: { ...DEFAULTS.schedule, ...(s.schedule ?? {}) },
    browser: { ...DEFAULTS.browser, ...(s.browser ?? {}) },
    pc: { ...DEFAULTS.pc, ...(s.pc ?? {}) },
    addons: { ...(s.addons ?? {}) }
  }
}

/** Settings as the renderer sees them: key presence only, never the key. */
export function getSettings(): Settings {
  const s = stored()
  const providers = {} as Settings['providers']
  for (const p of PROVIDERS) providers[p.id] = { ...s.providers[p.id], hasKey: !!getApiKey(p.id) }
  return { ...s, providers }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = stored()
  const next: StoredSettings = { ...cur, ...patch, providers: cur.providers } as StoredSettings
  if (patch.providers) {
    for (const p of PROVIDERS) {
      const incoming = patch.providers[p.id]
      if (incoming) next.providers[p.id] = { enabled: incoming.enabled, baseUrl: incoming.baseUrl }
    }
  }
  kvSet('settings', next)
  return getSettings()
}

export function setApiKey(provider: ProviderId, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    kvSet(`secret:${provider}`, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available; key not saved.')
  kvSet(`secret:${provider}`, safeStorage.encryptString(trimmed).toString('base64'))
}

export function getApiKey(provider: ProviderId): string | null {
  const enc = kvGet<string | null>(`secret:${provider}`, null)
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export function priceFor(provider: ProviderId, model: string): ModelPrice | null {
  if (provider === 'ollama') return { input: 0, output: 0 }
  return stored().prices[`${provider}:${model}`] ?? null
}

// ---- generic encrypted secrets (add-ons) ----

export function setSecret(name: string, value: string): void {
  const v = value.trim()
  if (!v) {
    kvSet(`secret:${name}`, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available; not saved.')
  kvSet(`secret:${name}`, safeStorage.encryptString(v).toString('base64'))
}

export function getSecret(name: string): string | null {
  const enc = kvGet<string | null>(`secret:${name}`, null)
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

export const isAddonEnabled = (id: string): boolean => !!getSettings().addons[id]?.enabled
