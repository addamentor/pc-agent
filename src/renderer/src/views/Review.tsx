import { useMemo, useState } from 'react'
import type { Proposal, ProposalStatus } from '@shared/types'
import { api, fmtTime, useLive } from '../util'

type Filter = 'pending' | 'history'

export function Review() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [bySession, setBySession] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const { data } = useLive(() => api.listProposals(filter === 'pending' ? 'pending' : 'all'), [filter])

  const items = useMemo(() => (filter === 'history' ? (data ?? []).filter((p) => p.status !== 'pending') : data ?? []), [data, filter])
  const groups = useMemo(() => {
    const m = new Map<number, Proposal[]>()
    for (const p of items) m.set(p.session_id, [...(m.get(p.session_id) ?? []), p])
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [items])

  async function decide(ids: number[], d: 'approve' | 'reject') {
    if (!ids.length) return
    setBusy(true)
    try {
      await api.decide(ids, d)
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const pendingIds = items.filter((p) => p.status === 'pending').map((p) => p.id)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Review</h1>
        <div className="row">
          <div className="seg">
            <button className={filter === 'pending' ? 'on' : ''} onClick={() => setFilter('pending')}>Pending</button>
            <button className={filter === 'history' ? 'on' : ''} onClick={() => setFilter('history')}>History</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={bySession} onChange={(e) => setBySession(e.target.checked)} /> Group by session
          </label>
        </div>
      </header>

      {filter === 'pending' && pendingIds.length > 0 && (
        <div className="bulk">
          <span>{selected.size ? `${selected.size} selected` : `${pendingIds.length} waiting`}</span>
          <button className="btn" disabled={busy} onClick={() => setSelected(selected.size ? new Set() : new Set(pendingIds))}>
            {selected.size ? 'Clear' : 'Select all'}
          </button>
          <button className="btn danger" disabled={busy || !selected.size} onClick={() => decide([...selected], 'reject')}>
            Reject selected
          </button>
          <button className="btn primary" disabled={busy || !selected.size} onClick={() => decide([...selected], 'approve')}>
            Approve selected
          </button>
        </div>
      )}

      {!items.length && <div className="empty">{filter === 'pending' ? 'Nothing waiting for review.' : 'No decisions yet.'}</div>}

      {bySession
        ? groups.map(([sid, ps]) => {
            const pend = ps.filter((p) => p.status === 'pending').map((p) => p.id)
            return (
              <section key={sid} className="group">
                <div className="group-head">
                  <span>
                    Session #{sid} · {fmtTime(ps[ps.length - 1].created_at)} · {ps.length} action{ps.length > 1 ? 's' : ''}
                  </span>
                  {pend.length > 0 && (
                    <span className="row">
                      <button className="btn sm danger" disabled={busy} onClick={() => decide(pend, 'reject')}>Reject all</button>
                      <button className="btn sm primary" disabled={busy} onClick={() => decide(pend, 'approve')}>Approve session</button>
                    </span>
                  )}
                </div>
                {ps.map((p) => (
                  <ProposalCard key={p.id} p={p} selected={selected.has(p.id)} onToggle={toggle} onDecide={decide} busy={busy} />
                ))}
              </section>
            )
          })
        : items.map((p) => (
            <ProposalCard key={p.id} p={p} selected={selected.has(p.id)} onToggle={toggle} onDecide={decide} busy={busy} />
          ))}
    </div>
  )
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  executed: 'Done',
  failed: 'Failed'
}

function ProposalCard(props: {
  p: Proposal
  selected: boolean
  busy: boolean
  onToggle: (id: number) => void
  onDecide: (ids: number[], d: 'approve' | 'reject') => void
}) {
  const { p } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')

  async function save() {
    try {
      await api.updateProposalArgs(p.id, JSON.parse(draft))
      setEditing(false)
      setErr('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={`proposal u-${p.urgency}`}>
      {p.status === 'pending' && <input type="checkbox" checked={props.selected} onChange={() => props.onToggle(p.id)} />}
      <div className="proposal-body">
        <div className="proposal-top">
          <span className={`badge u-${p.urgency}`}>{p.urgency}</span>
          <span className="proposal-label">{p.label}</span>
        </div>
        {p.reason && <div className="muted">{p.reason}</div>}
        <details className="args">
          <summary>Details</summary>
          {Object.entries(p.args).map(([k, v]) => (
            <div key={k} className="arg">
              <span className="arg-key">{k}</span>
              <pre>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
          {p.result && p.result.length > 120 && <pre>{p.result}</pre>}
        </details>
        <div className="meta">
          {p.action} · {fmtTime(p.created_at)}
          {p.status !== 'pending' && (
            <>
              {' '}· <span className={`st st-${p.status}`}>{STATUS_LABEL[p.status]}</span>
              {p.result ? ` · ${p.result.length > 120 ? p.result.slice(0, 119) + '…' : p.result}` : ''}
              {p.artifact && (
                <>
                  {' '}· <button className="link" onClick={() => api.openArtifact(p.id)}>Screenshot</button>
                </>
              )}
            </>
          )}
        </div>
        {editing && (
          <div className="edit">
            <textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            {err && <div className="error">{err}</div>}
            <div className="row">
              <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn sm primary" onClick={save}>Save changes</button>
            </div>
          </div>
        )}
      </div>
      {p.status === 'pending' && !editing && (
        <div className="proposal-actions">
          <button
            className="btn sm"
            onClick={() => {
              setDraft(JSON.stringify(p.args, null, 2))
              setEditing(true)
            }}
          >
            Edit
          </button>
          <button className="btn sm danger" disabled={props.busy} onClick={() => props.onDecide([p.id], 'reject')}>Reject</button>
          <button className="btn sm primary" disabled={props.busy} onClick={() => props.onDecide([p.id], 'approve')}>Approve</button>
        </div>
      )}
    </div>
  )
}
