import type { View } from '../App'
import { api, fmtRelative, fmtTime, usd, useLive } from '../util'

export function Home({ go }: { go: (v: View) => void }) {
  const { data: ov } = useLive(() => api.overview())
  const { data: settings } = useLive(() => api.getSettings())
  if (!ov || !settings) return null

  const noKey = !settings.providers[settings.wake.provider]?.hasKey && settings.wake.provider !== 'ollama'
  const pct = (a: number, b: number) => (b > 0 ? Math.min(100, (a / b) * 100) : 0)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Home</h1>
        <div className="row">
          <button className="btn" onClick={() => api.saveSettings({ paused: !ov.paused })}>
            {ov.paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn primary" disabled={ov.running} onClick={() => api.wakeNow()}>
            {ov.running ? 'Checking…' : 'Check in now'}
          </button>
        </div>
      </header>

      {noKey && (
        <div className="banner warn">
          No API key for the wake-up model yet. <button className="link" onClick={() => go('settings')}>Open Settings</button>
        </div>
      )}

      <div className="tiles">
        <button className="tile" onClick={() => go('review')}>
          <div className="tile-label">Waiting for review</div>
          <div className={`tile-value ${ov.pendingUrgent ? 'hot' : ''}`}>{ov.pending}</div>
          <div className="tile-sub">{ov.pendingUrgent ? `${ov.pendingUrgent} high / urgent` : 'nothing urgent'}</div>
        </button>
        <button className="tile" onClick={() => go('tasks')}>
          <div className="tile-label">Open tasks</div>
          <div className="tile-value">{ov.openTasks}</div>
          <div className="tile-sub">{ov.dueTasks ? `${ov.dueTasks} due or overdue` : 'none overdue'}</div>
        </button>
        <div className="tile">
          <div className="tile-label">Next check-in</div>
          <div className="tile-value sm">{ov.paused ? 'Paused' : fmtRelative(ov.nextWakeAt)}</div>
          <div className="tile-sub">
            {fmtTime(ov.nextWakeAt)}
            {ov.nextWakeReason ? ` · ${ov.nextWakeReason}` : ''}
          </div>
        </div>
      </div>

      <section className="card">
        <h2>Spend</h2>
        <Meter label="Today" value={ov.spend.todayUsd} max={ov.budget.dailyUsd} pct={pct(ov.spend.todayUsd, ov.budget.dailyUsd)} fmt={usd} />
        <Meter label="This month" value={ov.spend.monthUsd} max={ov.budget.monthlyUsd} pct={pct(ov.spend.monthUsd, ov.budget.monthlyUsd)} fmt={usd} />
        <Meter
          label="Tokens today"
          value={ov.spend.todayTokens}
          max={ov.budget.dailyTokens}
          pct={pct(ov.spend.todayTokens, ov.budget.dailyTokens)}
          fmt={(n) => n.toLocaleString()}
        />
      </section>

      {ov.lastSession && (
        <section className="card">
          <h2>Last activity</h2>
          <div className="muted">
            {fmtTime(ov.lastSession.started_at)} · {ov.lastSession.trigger} · {ov.lastSession.status} ·{' '}
            {ov.lastSession.tokens.toLocaleString()} tokens · {usd(ov.lastSession.cost_usd)}
          </div>
          <p>{ov.lastSession.summary || '—'}</p>
        </section>
      )}
    </div>
  )
}

function Meter(p: { label: string; value: number; max: number; pct: number; fmt: (n: number) => string }) {
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{p.label}</span>
        <span className="muted">
          {p.fmt(p.value)} / {p.fmt(p.max)}
        </span>
      </div>
      <div className="bar">
        <div className={`fill ${p.pct >= 90 ? 'hot' : p.pct >= 70 ? 'warm' : ''}`} style={{ width: `${p.pct}%` }} />
      </div>
    </div>
  )
}
