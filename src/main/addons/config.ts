import { getSecret, getSettings } from '../settings'
import type { Addon } from './types'

/** An add-on's non-secret settings, with field defaults filled in. */
export function addonConfig<T extends Record<string, string | number | boolean>>(addon: Pick<Addon, 'id' | 'fields'>): T {
  const stored = getSettings().addons[addon.id]?.config ?? {}
  const out: Record<string, string | number | boolean> = {}
  for (const f of addon.fields) {
    if (f.type === 'secret') continue
    out[f.key] = stored[f.key] ?? f.default ?? (f.type === 'checkbox' ? false : f.type === 'number' ? 0 : '')
  }
  return out as T
}

export const addonSecret = (addon: Pick<Addon, 'id'>, key: string): string | null => getSecret(`addon:${addon.id}:${key}`)
