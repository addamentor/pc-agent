import { useState } from 'react'
import { api } from '../util'

/** First-run setup. The app ships with no personal data; this is where a new user adds theirs. */
export function Welcome({ onDone }: { onDone: (goSettings: boolean) => void }) {
  const [profile, setProfile] = useState('')
  const [imported, setImported] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function importFile() {
    setError('')
    try {
      const r = await api.importAboutMe()
      if (!r) return
      const s = await api.getSettings()
      setProfile(s.profile)
      setImported(`Imported your profile and ${r.added + r.updated} project${r.added + r.updated === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function finish(goSettings: boolean) {
    setBusy(true)
    await api.saveSettings({ profile: profile.trim(), onboarded: true })
    onDone(goSettings)
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand big">
          <span className="logo" /> PC Agent
        </div>
        <p>
          A background assistant for your goals and tasks. It checks in on its own schedule and <b>proposes</b> changes.
          Nothing on your PC changes until you approve it.
        </p>

        <h2>About you</h2>
        <p className="muted">
          Two or three lines the agent should always keep in mind: who you are, what you work on, how you like to work.
          Sent with every AI call, so keep it short.
        </p>
        <textarea
          rows={4}
          autoFocus
          placeholder="e.g. Freelance designer juggling three client projects. Prefer short summaries; never contact clients without asking me."
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={importFile}>Import an About me file…</button>
          {imported && <span className="ok">{imported}</span>}
          {error && <span className="error">{error}</span>}
        </div>

        <div className="welcome-foot">
          <button className="btn" disabled={busy} onClick={() => finish(false)}>Skip for now</button>
          <button className="btn primary" disabled={busy} onClick={() => finish(true)}>Continue: add an AI key</button>
        </div>
      </div>
    </div>
  )
}
