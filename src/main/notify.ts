import { Notification } from 'electron'
import type { Urgency } from '@shared/types'
import { kvGet, kvSet, nowIso } from './db'
import { getSettings } from './settings'
import { pendingForReminder, takeNewlyDueTasks, updateProposal } from './store'

let onClick: (view: string) => void = () => undefined
export function setNotificationHandler(fn: (view: string) => void): void {
  onClick = fn
}

export function toast(title: string, body: string, view = 'review', urgent = false): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, urgency: urgent ? 'critical' : 'normal', silent: !urgent })
  n.on('click', () => onClick(view))
  n.show()
}

// How often a still-pending proposal re-reminds, by urgency. normal goes in the
// daily digest; low never pings.
const REMIND_EVERY_MIN: Record<Urgency, number | null> = { urgent: 15, high: 60, normal: null, low: null }

/** Runs every scheduler tick. Pure code: no AI calls. */
export function runReminders(): void {
  // Tasks that just hit their due time.
  for (const t of takeNewlyDueTasks()) toast('Task due', t.title, 'tasks', t.priority <= 1)

  const now = Date.now()
  const pending = pendingForReminder()
  const nag = pending.filter((p) => {
    const every = REMIND_EVERY_MIN[p.urgency]
    if (!every) return false
    const last = p.last_reminded_at ? Date.parse(p.last_reminded_at) : 0
    return now - last >= every * 60_000
  })
  if (nag.length) {
    const urgent = nag.some((p) => p.urgency === 'urgent')
    const title = nag.length === 1 ? `Review: ${nag[0].urgency}` : `${nag.length} actions need review`
    const body = nag.length === 1 ? nag[0].label : nag.slice(0, 3).map((p) => `• ${p.label}`).join('\n')
    toast(title, body, 'review', urgent)
    for (const p of nag) updateProposal(p.id, { last_reminded_at: nowIso() })
  }

  // Once-a-day digest of everything waiting, at the configured hour.
  const { digestHour } = getSettings().schedule
  const d = new Date()
  const today = d.toDateString()
  if (d.getHours() >= digestHour && kvGet('digestDay', '') !== today) {
    kvSet('digestDay', today)
    if (pending.length) toast('Daily review', `${pending.length} proposed action${pending.length > 1 ? 's' : ''} waiting for you`, 'review')
  }
}
