import { shell } from 'electron'
import { z } from 'zod'
import { defineAction, parseLocalDate } from '../actions'
import { kvGet, kvSet } from '../db'
import { saveTask } from '../store'
import { addonConfig, addonSecret } from './config'
import type { Addon } from './types'

/**
 * Mail reader add-on. Talks to the user's own mail reader backend (Gmail + IMAP
 * aggregator). The agent sees sender + subject of "to react" mail in check-ins,
 * may open a full email only in chat, and can propose marking mail handled,
 * turning mail into tasks, opening the app, or syncing.
 */

const ID = 'mail'

interface Msg {
  id: string
  account: string
  source: string
  from: string
  subject: string
  snippet?: string
  date: string
  unread?: boolean
  handled: boolean
}

interface Ref {
  id: string
  from: string
  subject: string
}

type Config = { baseUrl: string; appUrl: string; username: string; maxInDigest: number; syncBeforeCheckin: boolean }

const fields: Addon['fields'] = [
  { key: 'baseUrl', label: 'Mail reader API URL', type: 'url', default: 'https://readapi.aihunar.com' },
  { key: 'appUrl', label: 'Mail reader app URL', type: 'url', default: 'https://read.aihunar.com' },
  { key: 'username', label: 'Username', type: 'text' },
  { key: 'password', label: 'Password', type: 'secret' },
  { key: 'maxInDigest', label: 'Emails shown per check-in', type: 'number', default: 8, help: 'About 20 tokens each.' },
  {
    key: 'syncBeforeCheckin',
    label: 'Fetch new mail before each check-in',
    type: 'checkbox',
    default: false,
    help: 'Otherwise the agent only sees mail fetched by the mail reader itself (or by an approved "Sync now").'
  }
]

const cfg = () => addonConfig<Config>({ id: ID, fields })

// ---------- API client ----------

let token: string | null = null

function apiBase(): string {
  const base = String(cfg().baseUrl || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('Set the mail reader API URL in Add-ons')
  return base.endsWith('/api') ? base : `${base}/api`
}

async function login(): Promise<string> {
  const { username } = cfg()
  const password = addonSecret({ id: ID }, 'password')
  if (!username || !password) throw new Error('Add your mail reader username and password in Add-ons')
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(15_000)
  })
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!res.ok || !data.token) throw new Error(data.error || `Login failed (${res.status})`)
  token = data.token
  return token
}

async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const t = token ?? (await login())
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000)
  })
  if (res.status === 401 && !retried) {
    token = null // expired: log in again once
    return api<T>(path, init, true)
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `Mail reader error ${res.status}`)
  return data
}

async function toReact(): Promise<Msg[]> {
  const data = await api<{ messages: Msg[] }>('/mail')
  return data.messages.filter((m) => !m.handled)
}

let lastSyncAt = 0
async function sync(): Promise<string> {
  const r = await api<{ newCount?: number; errors?: unknown[] }>('/mail/sync', { method: 'POST', body: JSON.stringify({ limit: 50 }) })
  lastSyncAt = Date.now()
  const errs = r.errors?.length ? `; ${r.errors.length} mailbox error${r.errors.length > 1 ? 's' : ''}` : ''
  return `Synced: ${r.newCount ?? 0} new${errs}`
}

// ---------- short refs (m1, m2, …) so the model doesn't spend tokens on long ids ----------

const getRefs = (): Record<string, Ref> => kvGet('mail:refs', {})

function resolve(ref: string): Ref {
  const key = ref.trim().toLowerCase()
  const r = getRefs()[key] ?? Object.values(getRefs()).find((x) => x.id === ref)
  if (!r) throw new Error(`Unknown email ${ref}; it may have scrolled out of the latest list`)
  return r
}

const senderName = (from: string) => (from.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from).slice(0, 40)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function shortDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- add-on hooks ----------

async function digest(): Promise<string | null> {
  const { maxInDigest } = cfg()
  const list = await toReact()
  const shown = list.slice(0, Math.max(0, Math.min(30, Number(maxInDigest) || 8)))
  const refs: Record<string, Ref> = {}
  const lines = shown.map((m, i) => {
    const key = `m${i + 1}`
    refs[key] = { id: m.id, from: senderName(m.from), subject: m.subject }
    return `${key}${m.unread ? ' •' : ''} ${senderName(m.from)} | ${clip(m.subject, 70)} | ${shortDate(m.date)}`
  })
  kvSet('mail:refs', refs)
  kvSet('mail:seen', list.map((m) => m.id))
  if (!list.length) return 'mail to react: none'
  return [`mail to react ${list.length}${list.length > shown.length ? ` (newest ${shown.length})` : ''}`, ...lines].join('\n')
}

async function hasNews(): Promise<boolean> {
  if (cfg().syncBeforeCheckin && Date.now() - lastSyncAt > 60_000) await sync().catch(() => undefined)
  const seen = new Set(kvGet<string[]>('mail:seen', []))
  return (await toReact()).some((m) => !seen.has(m.id))
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
}

async function readMail(ref: string, maxChars: number, mode: 'checkin' | 'chat'): Promise<string> {
  if (mode !== 'chat') throw new Error('Email bodies can only be read in chat')
  const r = resolve(ref)
  const body = await api<{ text?: string; html?: string }>(`/mail/body?id=${encodeURIComponent(r.id)}`)
  const text = (body.text?.trim() ? body.text : htmlToText(body.html ?? '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return `EMAIL ${ref} from ${r.from} | ${r.subject}\n${text.length > maxChars ? text.slice(0, maxChars) + ' …[cut]' : text}`
}

// ---------- actions (all proposal-only) ----------

const mailArgs = { mail: z.string().min(1), from: z.string().optional(), subject: z.string().optional() }

/** Freeze the sender/subject into the proposal so it still reads right after the list changes. */
async function freeze<T extends { mail: string }>(a: T): Promise<T & { from: string; subject: string }> {
  const r = resolve(a.mail)
  return { ...a, mail: r.id, from: r.from, subject: r.subject }
}

const handled = defineAction({
  name: 'mail.handled',
  sig: 'mail.handled {mail:"m3"}  (local "handled" flag in the mail reader; never touches the mailbox)',
  schema: z.object(mailArgs),
  prepare: freeze,
  label: (a) => `Mark handled: "${clip(a.subject ?? a.mail, 70)}"${a.from ? ` from ${a.from}` : ''}`,
  execute: async (a) => {
    await api('/mail/handled', { method: 'POST', body: JSON.stringify({ id: a.mail, handled: true }) })
    return 'Marked handled'
  }
})

const toTask = defineAction({
  name: 'mail.task',
  sig: 'mail.task {mail:"m3", title, due?, p?, proj?}  (task linked to that email)',
  schema: z.object({ ...mailArgs, title: z.string().min(1), due: z.string().nullable().optional(), p: z.number().int().min(1).max(4).optional(), proj: z.number().int().optional() }),
  prepare: freeze,
  label: (a) => `Add task "${a.title}"${a.due ? ` due ${a.due}` : ''} from email "${clip(a.subject ?? a.mail, 50)}"`,
  execute: (a) => {
    const t = saveTask({
      title: a.title,
      due_at: parseLocalDate(a.due),
      priority: a.p ?? 3,
      project_id: a.proj ?? null,
      notes: `From email: ${a.from ?? ''} — "${a.subject ?? ''}"\nmail id: ${a.mail}`
    })
    return `Created task #${t.id}`
  }
})

const open = defineAction({
  name: 'mail.open',
  sig: 'mail.open {}  (opens the mail reader app in the browser)',
  schema: z.object({}),
  label: () => 'Open the mail reader',
  execute: async () => {
    const url = String(cfg().appUrl || '')
    if (!/^https?:\/\//i.test(url)) throw new Error('Set the mail reader app URL in Add-ons')
    await shell.openExternal(url)
    return 'Opened'
  }
})

const syncNow = defineAction({
  name: 'mail.sync',
  sig: 'mail.sync {}  (fetch new mail from the providers)',
  schema: z.object({}),
  label: () => 'Fetch new mail now',
  execute: () => sync()
})

export const mailAddon: Addon = {
  id: ID,
  name: 'Mail reader',
  description: 'Your Gmail + IMAP inboxes via your mail reader. Check-ins see sender and subject of mail to react to; full emails are opened only in chat.',
  fields,
  actions: [handled, toTask, open, syncNow],
  digest,
  hasNews,
  reader: { prefix: 'mail:', hint: 'mail:m3 = full text of that email (chat only)', read: readMail },
  test: async () => {
    token = null
    const list = await toReact()
    return `Connected. ${list.length} email${list.length === 1 ? '' : 's'} to react to.`
  }
}
