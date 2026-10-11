import { useCallback, useEffect, useState } from 'react'

export const api = window.agent

export function subscribe(event: 'changed' | 'navigate', cb: (payload?: string) => void): () => void {
  const token = window.agentEvents.on(event, cb)
  return () => window.agentEvents.off(token)
}

/** Fetch data and refetch whenever the main process reports a change. */
export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void } {
  const [data, setData] = useState<T>()
  const load = useCallback(() => {
    fetcher().then(setData).catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    load()
    return subscribe('changed', load)
  }, [load])
  return { data, reload: load }
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.parse(iso) - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  const str = mins < 1 ? 'now' : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
  if (str === 'now') return 'now'
  return diff > 0 ? `in ${str}` : `${str} ago`
}

export const usd = (n: number): string => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

/** ISO → value for <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null)
