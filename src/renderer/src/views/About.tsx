import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { api, useLive } from '../util'

const tokens = (s: string) => Math.ceil(s.length / 4)

export function About() {
  const { data: settings } = useLive(() => api.getSettings())
  const { data: projects } = useLive(() => api.listProjects())
  const [profile, setProfile] = useState('')
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')

  async function doExport() {
    const path = await api.exportAboutMe()
    if (path) setNotice(`Exported to ${path}`)
  }

  async function doImport() {
    try {
      const r = await api.importAboutMe()
      if (r) setNotice(`Imported: profile replaced, ${r.added} project${r.added === 1 ? '' : 's'} added, ${r.updated} updated.`)
    } catch (e) {
      setNotice(`Import failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  useEffect(() => {
    if (settings) setProfile(settings.profile)
  }, [settings?.profile])

  async function saveProfile() {
    await api.saveSettings({ profile })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!settings) return null
  const dirty = profile !== settings.profile

  return (
    <div className="page">
      <header className="page-head">
        <h1>About me</h1>
        <div className="row">
          {saved && <span className="ok">Saved</span>}
          <button className="btn" onClick={doImport}>Import…</button>
          <button className="btn" onClick={doExport}>Export…</button>
        </div>
      </header>

      {notice && <div className="banner">{notice}</div>}
      <p className="muted">
        This app ships with no personal data. Export keeps your profile and projects in a file so you can import them on
        another install.
      </p>

      <section className="card">
        <h2>Profile</h2>
        <p className="muted">
          Sent with <b>every</b> AI call, so keep it to two or three lines. ~{tokens(profile)} tokens per call.
        </p>
        <textarea rows={4} value={profile} onChange={(e) => setProfile(e.target.value)} />
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={!dirty} onClick={() => setProfile(settings.profile)}>Discard</button>
          <button className="btn primary" disabled={!dirty} onClick={saveProfile}>Save profile</button>
        </div>
      </section>

      <section className="card">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Projects</h2>
          <button className="btn" onClick={() => setAdding(true)}>Add project</button>
        </div>
        <p className="muted">
          Notes go to the chat model every time, and to check-ins only for projects that have tasks due within a day.
          Link goals and tasks to a project in Goals &amp; Tasks.
        </p>
        {adding && <ProjectRow project={{ name: '', notes: '', active: 1 }} onDone={() => setAdding(false)} />}
        {projects?.map((p) => <ProjectRow key={p.id} project={p} />)}
      </section>
    </div>
  )
}

function ProjectRow({ project, onDone }: { project: Partial<Project>; onDone?: () => void }) {
  const [p, setP] = useState(project)
  useEffect(() => setP(project), [project.id, project.updated_at])
  const dirty = p.name !== project.name || p.notes !== project.notes || p.active !== project.active
  const isNew = !project.id

  async function save() {
    if (!p.name?.trim()) return
    await api.saveProject({ ...p, name: p.name.trim() })
    onDone?.()
  }

  return (
    <div className={`project ${p.active ? '' : 'dim'}`}>
      <div className="row">
        {!isNew && <span className="ref">p{project.id}</span>}
        <input className="project-name" placeholder="Project name" value={p.name ?? ''} onChange={(e) => setP({ ...p, name: e.target.value })} />
        <label className="check">
          <input type="checkbox" checked={!!p.active} onChange={(e) => setP({ ...p, active: e.target.checked ? 1 : 0 })} /> Active
        </label>
      </div>
      <textarea
        rows={3}
        placeholder="Two lines: what it is, and what the agent should always keep in mind"
        value={p.notes ?? ''}
        onChange={(e) => setP({ ...p, notes: e.target.value })}
      />
      <div className="row project-foot">
        <span className="muted">~{tokens(p.notes ?? '')} tokens</span>
        <span className="row">
          {isNew ? (
            <button className="btn sm" onClick={onDone}>Cancel</button>
          ) : (
            <button
              className="btn sm danger"
              onClick={() => confirm(`Delete project "${project.name}"? Linked goals and tasks are kept.`) && api.deleteProject(project.id!)}
            >
              Delete
            </button>
          )}
          <button className="btn sm primary" disabled={!dirty || !p.name?.trim()} onClick={save}>Save</button>
        </span>
      </div>
    </div>
  )
}
