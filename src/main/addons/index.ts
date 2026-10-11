import type { AddonInfo } from '@shared/types'
import { actionsOf, registerAction } from '../actions'
import { getSettings, isAddonEnabled, saveSettings, setSecret } from '../settings'
import { addonConfig, addonSecret } from './config'
import { mailAddon } from './mail'
import type { Addon, Mode } from './types'

/** Every add-on that ships in the app. Add new ones here. */
const ADDONS: Addon[] = [mailAddon]

const byId = new Map(ADDONS.map((a) => [a.id, a]))

/** Register add-on actions once at start-up; they stay hidden until the add-on is enabled. */
export function initAddons(): void {
  for (const a of ADDONS) for (const act of a.actions ?? []) registerAction({ ...act, addon: a.id })
}

const enabled = (): Addon[] => ADDONS.filter((a) => isAddonEnabled(a.id))

// ---------- host hooks used by the agent ----------

/** Digest sections from enabled add-ons. A failing add-on reports one short line instead of breaking the check-in. */
export async function addonDigests(mode: Mode): Promise<string[]> {
  const parts = await Promise.all(
    enabled()
      .filter((a) => a.digest)
      .map((a) => a.digest!(mode).catch((e) => `${a.id}: unavailable (${e instanceof Error ? e.message : e})`))
  )
  return parts.filter((p): p is string => !!p)
}

export async function addonsHaveNews(): Promise<boolean> {
  const results = await Promise.all(enabled().filter((a) => a.hasNews).map((a) => a.hasNews!().catch(() => false)))
  return results.some(Boolean)
}

export function addonReadHints(): string[] {
  return enabled().filter((a) => a.reader).map((a) => a.reader!.hint)
}

/** Returns null when no add-on handles this item. */
export function addonReader(item: string): ((maxChars: number, mode: Mode) => Promise<string>) | null {
  for (const a of enabled()) {
    if (a.reader && item.startsWith(a.reader.prefix)) return (max, mode) => a.reader!.read(item.slice(a.reader!.prefix.length), max, mode)
  }
  return null
}

// ---------- settings UI ----------

function info(a: Addon): AddonInfo {
  const secretsSet: Record<string, boolean> = {}
  for (const f of a.fields) if (f.type === 'secret') secretsSet[f.key] = !!addonSecret(a, f.key)
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: isAddonEnabled(a.id),
    fields: a.fields,
    config: addonConfig(a),
    secretsSet,
    actions: actionsOf(a.id)
  }
}

export const listAddons = (): AddonInfo[] => ADDONS.map(info)

export function saveAddon(id: string, patch: { enabled?: boolean; config?: Record<string, string | number | boolean> }): AddonInfo {
  const a = byId.get(id)
  if (!a) throw new Error(`Unknown add-on ${id}`)
  const all = getSettings().addons
  const cur = all[id] ?? { enabled: false, config: {} }
  const allowed = new Set(a.fields.filter((f) => f.type !== 'secret').map((f) => f.key))
  const config = { ...cur.config }
  for (const [k, v] of Object.entries(patch.config ?? {})) if (allowed.has(k)) config[k] = v
  saveSettings({ addons: { ...all, [id]: { enabled: patch.enabled ?? cur.enabled, config } } })
  return info(a)
}

export function setAddonSecret(id: string, key: string, value: string): void {
  const a = byId.get(id)
  if (!a || !a.fields.some((f) => f.key === key && f.type === 'secret')) throw new Error('Unknown secret field')
  setSecret(`addon:${id}:${key}`, value)
}

export async function testAddon(id: string): Promise<{ ok: boolean; message: string }> {
  const a = byId.get(id)
  if (!a?.test) return { ok: false, message: 'Nothing to test' }
  try {
    return { ok: true, message: await a.test() }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
