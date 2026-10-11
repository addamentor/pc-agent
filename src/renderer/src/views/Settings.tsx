import { useEffect, useState } from 'react'
import type { ModelSlot, ProviderId, Settings } from '@shared/types'
import { PROVIDERS } from '@shared/types'
import { api } from '../util'

export function SettingsView() {
  const [s, setS] = useState<Settings>()
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getSettings().then(setS)
  }, [])
  if (!s) return null

  async function save(patch: Partial<Settings>) {
    setS(await api.saveSettings(patch))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const priceKey = (slot: ModelSlot) => `${slot.provider}:${slot.model}`
  const slots = [s.wake, s.chat].filter((sl, i, arr) => sl.provider !== 'ollama' && arr.findIndex((x) => priceKey(x) === priceKey(sl)) === i)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        {saved && <span className="ok">Saved</span>}
      </header>

      <section className="card">
        <h2>AI providers</h2>
        <p className="muted">Keys are encrypted with Windows' built-in protection and never leave this PC except to call that provider.</p>
        {PROVIDERS.map((p) => (
          <ProviderRow
            key={p.id}
            id={p.id}
            label={p.label}
            needsKey={p.needsKey}
            settings={s}
            onSave={save}
            onModels={(list) => setModels((m) => ({ ...m, [p.id]: list }))}
          />
        ))}
      </section>

      <section className="card">
        <h2>Models</h2>
        <p className="muted">
          The wake-up model runs the routine check-ins: pick something cheap. The chat model answers when you talk to it.
          Max output caps every reply.
        </p>
        <SlotEditor label="Wake-up model" slot={s.wake} models={models} providers={s.providers} onChange={(wake) => save({ wake })} />
        <SlotEditor label="Chat model" slot={s.chat} models={models} providers={s.providers} onChange={(chat) => save({ chat })} />
      </section>

      <section className="card">
        <h2>Prices (USD per 1M tokens)</h2>
        <p className="muted">Used for the cost meter and budget caps. Claude prices are pre-filled; enter others from your provider's pricing page.</p>
        {slots.map((sl) => {
          const k = priceKey(sl)
          const p = s.prices[k]
          const setPrice = (patch: Partial<NonNullable<typeof p>>) =>
            save({ prices: { ...s.prices, [k]: { ...(p ?? { input: 0, output: 0 }), ...patch } } })
          return (
            <div key={k} className="price-row">
              <span className="mono">{k}</span>
              {!p && <span className="error">not set: dollar caps can't protect this model</span>}
              <NumField label="Input" value={p?.input} onCommit={(v) => setPrice({ input: v })} />
              <NumField label="Output" value={p?.output} onCommit={(v) => setPrice({ output: v })} />
              <NumField label="Cached input" value={p?.cacheRead} onCommit={(v) => setPrice({ cacheRead: v })} />
            </div>
          )
        })}
      </section>

      <section className="card">
        <h2>Budget caps</h2>
        <p className="muted">When a cap is reached, AI calls stop until the next day or month (or until you raise it). Reminders keep working.</p>
        <div className="grid3">
          <NumField label="Daily (USD)" value={s.budget.dailyUsd} onCommit={(v) => save({ budget: { ...s.budget, dailyUsd: v } })} />
          <NumField label="Monthly (USD)" value={s.budget.monthlyUsd} onCommit={(v) => save({ budget: { ...s.budget, monthlyUsd: v } })} />
          <NumField label="Daily tokens" value={s.budget.dailyTokens} onCommit={(v) => save({ budget: { ...s.budget, dailyTokens: Math.round(v) } })} />
        </div>
      </section>

      <section className="card">
        <h2>Check-in schedule</h2>
        <p className="muted">The AI chooses when to check back. These limits bound its choice. Nothing runs during quiet hours.</p>
        <div className="grid3">
          <NumField label="Shortest gap (min)" value={s.schedule.minGapMin} onCommit={(v) => save({ schedule: { ...s.schedule, minGapMin: Math.max(1, Math.round(v)) } })} />
          <NumField label="Longest gap (min)" value={s.schedule.maxGapMin} onCommit={(v) => save({ schedule: { ...s.schedule, maxGapMin: Math.max(s.schedule.minGapMin, Math.round(v)) } })} />
          <NumField label="Daily review hour (0-23)" value={s.schedule.digestHour} onCommit={(v) => save({ schedule: { ...s.schedule, digestHour: Math.min(23, Math.max(0, Math.round(v))) } })} />
          <label>Quiet from<input type="time" value={s.schedule.quietStart} onChange={(e) => save({ schedule: { ...s.schedule, quietStart: e.target.value } })} /></label>
          <label>Quiet until<input type="time" value={s.schedule.quietEnd} onChange={(e) => save({ schedule: { ...s.schedule, quietEnd: e.target.value } })} /></label>
        </div>
      </section>

      <section className="card">
        <h2>Browser</h2>
        <p className="muted">
          The agent has its own browser profile (separate from yours). It may read pages on its own; clicking and typing
          always wait for your approval and run in a visible window.
        </p>
        <div className="grid3">
          <label>
            Browser
            <select value={s.browser.channel} onChange={(e) => save({ browser: { ...s.browser, channel: e.target.value as 'chrome' | 'msedge' } })}>
              <option value="chrome">Google Chrome</option>
              <option value="msedge">Microsoft Edge</option>
            </select>
          </label>
          <NumField label="Pages per read" value={s.browser.maxPagesPerRound} onCommit={(v) => save({ browser: { ...s.browser, maxPagesPerRound: Math.min(5, Math.max(1, Math.round(v))) } })} />
          <NumField label="Read rounds per turn" value={s.browser.maxReadRounds} onCommit={(v) => save({ browser: { ...s.browser, maxReadRounds: Math.min(3, Math.max(0, Math.round(v))) } })} />
          <NumField label="Max characters per page" value={s.browser.maxReadChars} onCommit={(v) => save({ browser: { ...s.browser, maxReadChars: Math.min(8000, Math.max(300, Math.round(v))) } })} />
        </div>
        <p className="muted">Each page costs about {Math.ceil(s.browser.maxReadChars / 4) + 100} input tokens.</p>
        <label className="check">
          <input type="checkbox" checked={s.browser.readInCheckins} onChange={(e) => save({ browser: { ...s.browser, readInCheckins: e.target.checked } })} />
          Allow automatic check-ins to read pages (otherwise only when you chat)
        </label>
      </section>

      <section className="card">
        <h2>PC access</h2>
        <p className="muted">
          Running commands, opening apps and changing files always wait for your approval. Deleting only ever moves things to
          the Recycle Bin. The agent may <b>read</b> files on its own only inside these folders (their contents are sent to
          your AI provider).
        </p>
        {s.pc.readFolders.length === 0 && <div className="muted">No readable folders.</div>}
        {s.pc.readFolders.map((f) => (
          <div key={f} className="row folder-row">
            <span className="mono">{f}</span>
            <button className="btn sm danger" onClick={() => save({ pc: { ...s.pc, readFolders: s.pc.readFolders.filter((x) => x !== f) } })}>
              Remove
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn"
            onClick={async () => {
              const f = await api.pickFolder()
              if (f && !s.pc.readFolders.includes(f)) save({ pc: { ...s.pc, readFolders: [...s.pc.readFolders, f] } })
            }}
          >
            Add readable folder…
          </button>
        </div>
        <div className="grid3" style={{ marginTop: 10 }}>
          <NumField
            label="Command timeout (seconds)"
            value={s.pc.commandTimeoutSec}
            onCommit={(v) => save({ pc: { ...s.pc, commandTimeoutSec: Math.min(1800, Math.max(5, Math.round(v))) } })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Startup</h2>
        <label className="check">
          <input type="checkbox" checked={s.openAtLogin} onChange={(e) => save({ openAtLogin: e.target.checked })} /> Start PC Agent when I sign in to Windows
        </label>
        <label className="check">
          <input type="checkbox" checked={s.paused} onChange={(e) => save({ paused: e.target.checked })} /> Pause automatic check-ins
        </label>
      </section>
    </div>
  )
}

function ProviderRow(props: {
  id: ProviderId
  label: string
  needsKey: boolean
  settings: Settings
  onSave: (patch: Partial<Settings>) => Promise<void>
  onModels: (models: string[]) => void
}) {
  const cfg = props.settings.providers[props.id]
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl ?? '')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const setCfg = (patch: Partial<typeof cfg>) =>
    props.onSave({ providers: { ...props.settings.providers, [props.id]: { ...cfg, ...patch } } })

  async function saveKey() {
    await api.setApiKey(props.id, key)
    setKey('')
    await props.onSave({})
  }

  async function test() {
    setTesting(true)
    const r = await api.testProvider(props.id)
    setStatus(r)
    if (r.ok) props.onModels(r.models)
    setTesting(false)
  }

  return (
    <div className="provider">
      <label className="check provider-name">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ enabled: e.target.checked })} />
        {props.label}
        {props.needsKey && <span className={cfg.hasKey ? 'ok' : 'muted'}>{cfg.hasKey ? '· key saved' : '· no key'}</span>}
      </label>
      {cfg.enabled && (
        <div className="provider-body">
          {props.needsKey && (
            <div className="row">
              <input type="password" placeholder={cfg.hasKey ? 'Replace key…' : 'Paste API key'} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn" disabled={!key.trim()} onClick={saveKey}>Save key</button>
              {cfg.hasKey && <button className="btn danger" onClick={async () => { await api.setApiKey(props.id, ''); await props.onSave({}) }}>Remove</button>}
            </div>
          )}
          {(props.id === 'openrouter' || props.id === 'ollama' || props.id === 'openai') && (
            <div className="row">
              <input placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={() => setCfg({ baseUrl: baseUrl || undefined })} />
            </div>
          )}
          <div className="row">
            <button className="btn" disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test & load models'}</button>
            {status && <span className={status.ok ? 'ok' : 'error'}>{status.message}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function SlotEditor(props: {
  label: string
  slot: ModelSlot
  models: Partial<Record<ProviderId, string[]>>
  providers: Settings['providers']
  onChange: (slot: ModelSlot) => void
}) {
  const [model, setModel] = useState(props.slot.model)
  useEffect(() => {
    setModel(props.slot.model)
  }, [props.slot.model])
  const listId = `models-${props.label}`
  return (
    <div className="slot">
      <div className="slot-label">{props.label}</div>
      <select value={props.slot.provider} onChange={(e) => props.onChange({ ...props.slot, provider: e.target.value as ProviderId })}>
        {PROVIDERS.filter((p) => props.providers[p.id].enabled || p.id === props.slot.provider).map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <input
        list={listId}
        value={model}
        placeholder="model id"
        onChange={(e) => setModel(e.target.value)}
        onBlur={() => model.trim() && model !== props.slot.model && props.onChange({ ...props.slot, model: model.trim() })}
      />
      <datalist id={listId}>
        {(props.models[props.slot.provider] ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <NumField
        label="Max output tokens"
        value={props.slot.maxOutputTokens}
        onCommit={(v) => props.onChange({ ...props.slot, maxOutputTokens: Math.max(50, Math.round(v)) })}
      />
    </div>
  )
}

function NumField({ label, value, onCommit }: { label: string; value: number | undefined; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    setV(value === undefined ? '' : String(value))
  }, [value])
  return (
    <label>
      {label}
      <input
        type="number"
        step="any"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v)
          if (v !== '' && Number.isFinite(n) && n >= 0 && n !== value) onCommit(n)
        }}
      />
    </label>
  )
}
