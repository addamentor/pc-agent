import { useEffect, useState } from 'react'
import type { AddonField, AddonInfo } from '@shared/types'
import { api, useLive } from '../util'

export function Addons() {
  const { data: addons } = useLive(() => api.listAddons())
  return (
    <div className="page">
      <header className="page-head">
        <h1>Add-ons</h1>
      </header>
      <p className="muted">
        Add-ons give the agent more to look at and more it can propose. They are built into the app; nothing outside it is
        loaded. Every action an add-on adds still waits for your approval.
      </p>
      {addons?.map((a) => <AddonCard key={a.id} addon={a} />)}
    </div>
  )
}

type Values = Record<string, string | number | boolean>

function AddonCard({ addon }: { addon: AddonInfo }) {
  const [values, setValues] = useState<Values>(addon.config)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setValues(addon.config)
  }, [JSON.stringify(addon.config)])

  const dirty = JSON.stringify(values) !== JSON.stringify(addon.config) || Object.values(secrets).some((v) => v.trim())

  async function save() {
    setBusy(true)
    try {
      for (const [k, v] of Object.entries(secrets)) if (v.trim()) await api.setAddonSecret(addon.id, k, v)
      setSecrets({})
      await api.saveAddon(addon.id, { config: values })
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setStatus(null)
    try {
      if (dirty) await save()
      setStatus(await api.testAddon(addon.id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`card addon ${addon.enabled ? '' : 'off'}`}>
      <div className="addon-head">
        <div>
          <h2>{addon.name}</h2>
          <p className="muted">{addon.description}</p>
        </div>
        <label className="check switch">
          <input type="checkbox" checked={addon.enabled} onChange={(e) => api.saveAddon(addon.id, { enabled: e.target.checked })} />
          {addon.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <div className="grid2">
        {addon.fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={values[f.key]}
            secretSet={addon.secretsSet[f.key]}
            secretValue={secrets[f.key] ?? ''}
            onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))}
            onSecret={(v) => setSecrets((cur) => ({ ...cur, [f.key]: v }))}
            onClearSecret={() => api.setAddonSecret(addon.id, f.key, '')}
          />
        ))}
      </div>

      <div className="row addon-foot">
        <span className="muted">Can propose: {addon.actions.join(', ')}</span>
        <span className="row">
          {status && <span className={status.ok ? 'ok' : 'error'}>{status.message}</span>}
          <button className="btn" disabled={busy} onClick={test}>Test connection</button>
          <button className="btn primary" disabled={busy || !dirty} onClick={save}>Save</button>
        </span>
      </div>
    </section>
  )
}

function Field(p: {
  field: AddonField
  value: string | number | boolean | undefined
  secretSet: boolean
  secretValue: string
  onChange: (v: string | number | boolean) => void
  onSecret: (v: string) => void
  onClearSecret: () => void
}) {
  const { field: f } = p
  if (f.type === 'checkbox') {
    return (
      <div className="field-wide">
        <label className="check">
          <input type="checkbox" checked={!!p.value} onChange={(e) => p.onChange(e.target.checked)} /> {f.label}
        </label>
        {f.help && <div className="muted small">{f.help}</div>}
      </div>
    )
  }
  if (f.type === 'secret') {
    return (
      <label>
        {f.label} {p.secretSet ? <span className="ok">· saved</span> : <span>· not set</span>}
        <span className="row">
          <input type="password" placeholder={p.secretSet ? 'Replace…' : ''} value={p.secretValue} onChange={(e) => p.onSecret(e.target.value)} />
          {p.secretSet && <button className="btn sm danger" onClick={p.onClearSecret}>Remove</button>}
        </span>
      </label>
    )
  }
  return (
    <label>
      {f.label}
      <input
        type={f.type === 'number' ? 'number' : 'text'}
        value={p.value === undefined ? '' : String(p.value)}
        onChange={(e) => p.onChange(f.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
      {f.help && <span className="small">{f.help}</span>}
    </label>
  )
}
