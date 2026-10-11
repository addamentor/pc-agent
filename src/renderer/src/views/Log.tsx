import { useState } from 'react'
import { api, fmtTime, usd, useLive } from '../util'
import { Modal } from './Plan'

export function Log() {
  const { data: sessions } = useLive(() => api.listSessions(200))
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Log</h1>
        <span className="muted">Every check-in and chat, with what it cost.</span>
      </header>
      {!sessions?.length && <div className="empty">No activity yet.</div>}
      {!!sessions?.length && (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Summary</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} onClick={() => setOpen(s.id)} className="clickable">
                <td>{s.id}</td>
                <td>{fmtTime(s.started_at)}</td>
                <td>{s.trigger}</td>
                <td><span className={`st st-${s.status}`}>{s.status}</span></td>
                <td className="clip">{s.summary}</td>
                <td className="num">{s.tokens.toLocaleString()}</td>
                <td className="num">{usd(s.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <SessionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function SessionDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useLive(() => api.sessionDetail(id), [id])
  return (
    <Modal title={`Session #${id}`} onClose={onClose}>
      {!data ? (
        <div className="muted">Loading…</div>
      ) : (
        <div className="detail">
          <div className="muted">
            {data.session.trigger} · started {fmtTime(data.session.started_at)} · {data.session.status}
            {data.session.next_wake_at ? ` · next check ${fmtTime(data.session.next_wake_at)}` : ''}
          </div>
          <p>{data.session.summary}</p>

          {data.messages.length > 0 && (
            <>
              <h3>Messages</h3>
              {data.messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}><div className="bubble">{m.text}</div></div>
              ))}
            </>
          )}

          <h3>Proposals</h3>
          {!data.proposals.length && <div className="muted">None.</div>}
          {data.proposals.map((p) => (
            <div key={p.id} className="line">
              <span className={`badge u-${p.urgency}`}>{p.urgency}</span> {p.label}{' '}
              <span className={`st st-${p.status}`}>{p.status}</span>
            </div>
          ))}

          <h3>AI calls</h3>
          {data.calls.map((c) => (
            <div key={c.id} className="line">
              {c.provider}/{c.model} · in {c.input_tokens} · out {c.output_tokens}
              {c.cache_read_tokens ? ` · cached ${c.cache_read_tokens}` : ''} · {c.priced ? usd(c.cost_usd) : 'price not set'}
              {c.error && <div className="error">{c.error}</div>}
            </div>
          ))}
          <div className="modal-foot">
            <span />
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
