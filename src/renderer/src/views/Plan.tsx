import { useState } from 'react'
import type { Goal, Horizon, Project, Task } from '@shared/types'
import { api, fmtTime, fromLocalInput, toLocalInput, useLive } from '../util'

export function Plan() {
  const { data: goals } = useLive(() => api.listGoals())
  const { data: tasks } = useLive(() => api.listTasks())
  const { data: projects } = useLive(() => api.listProjects())
  const [showDone, setShowDone] = useState(false)
  const [editTask, setEditTask] = useState<Partial<Task> | null>(null)
  const [editGoal, setEditGoal] = useState<Partial<Goal> | null>(null)

  const activeGoals = (goals ?? []).filter((g) => showDone || g.status === 'active')
  const visibleTasks = (tasks ?? []).filter((t) => showDone || t.status === 'todo' || t.status === 'doing')
  const goalName = (id: number | null) => goals?.find((g) => g.id === id)?.title
  const projectName = (id: number | null) => projects?.find((p) => p.id === id)?.name
  const now = new Date().toISOString()

  return (
    <div className="page">
      <header className="page-head">
        <h1>Goals & Tasks</h1>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show finished
          </label>
          <button className="btn" onClick={() => setEditGoal({ horizon: 'short', title: '' })}>New goal</button>
          <button className="btn primary" onClick={() => setEditTask({ title: '', priority: 3 })}>New task</button>
        </div>
      </header>

      <div className="split">
        <section>
          {(['long', 'short'] as Horizon[]).map((h) => (
            <div key={h} className="card">
              <h2>{h === 'long' ? 'Long-term goals' : 'Short-term goals'}</h2>
              {activeGoals.filter((g) => g.horizon === h).length === 0 && <div className="muted">None yet.</div>}
              {activeGoals
                .filter((g) => g.horizon === h)
                .map((g) => (
                  <button key={g.id} className={`item ${g.status !== 'active' ? 'dim' : ''}`} onClick={() => setEditGoal(g)}>
                    <span className="ref">g{g.id}</span>
                    <span className="item-title">{g.title}</span>
                    {projectName(g.project_id) && <span className="tag">{projectName(g.project_id)}</span>}
                    {g.due_at && <span className="muted">by {fmtTime(g.due_at)}</span>}
                  </button>
                ))}
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Tasks</h2>
          {!visibleTasks.length && <div className="muted">No open tasks.</div>}
          {visibleTasks.map((t) => {
            const overdue = t.due_at && t.due_at <= now && (t.status === 'todo' || t.status === 'doing')
            const done = t.status === 'done' || t.status === 'dropped'
            return (
              <div key={t.id} className={`task ${done ? 'dim' : ''}`}>
                <input
                  type="checkbox"
                  title="Mark done"
                  checked={t.status === 'done'}
                  onChange={(e) => api.saveTask({ id: t.id, title: t.title, status: e.target.checked ? 'done' : 'todo' })}
                />
                <button className="task-main" onClick={() => setEditTask(t)}>
                  <span className={`prio p${t.priority}`}>P{t.priority}</span>
                  <span className="ref">t{t.id}</span>
                  <span className="item-title">{t.title}</span>
                  {projectName(t.project_id) && <span className="tag">{projectName(t.project_id)}</span>}
                  {t.status === 'doing' && <span className="badge u-normal">doing</span>}
                  {goalName(t.goal_id) && <span className="muted">· {goalName(t.goal_id)}</span>}
                </button>
                {t.due_at && <span className={overdue ? 'error' : 'muted'}>{fmtTime(t.due_at)}</span>}
              </div>
            )
          })}
        </section>
      </div>

      {editTask && <TaskEditor task={editTask} goals={goals ?? []} projects={projects ?? []} onClose={() => setEditTask(null)} />}
      {editGoal && <GoalEditor goal={editGoal} projects={projects ?? []} onClose={() => setEditGoal(null)} />}
    </div>
  )
}

function TaskEditor(props: { task: Partial<Task>; goals: Goal[]; projects: Project[]; onClose: () => void }) {
  const { task, goals, projects, onClose } = props
  const [t, setT] = useState<Partial<Task>>(task)
  const set = (patch: Partial<Task>) => setT((cur) => ({ ...cur, ...patch }))
  async function save() {
    if (!t.title?.trim()) return
    await api.saveTask({ ...t, title: t.title.trim() })
    onClose()
  }
  return (
    <Modal title={t.id ? `Task t${t.id}` : 'New task'} onClose={onClose}>
      <label>Title<input autoFocus value={t.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></label>
      <div className="grid2">
        <label>Due<input type="datetime-local" value={toLocalInput(t.due_at)} onChange={(e) => set({ due_at: fromLocalInput(e.target.value) })} /></label>
        <label>
          Priority
          <select value={t.priority ?? 3} onChange={(e) => set({ priority: Number(e.target.value) })}>
            <option value={1}>P1 — critical</option>
            <option value={2}>P2 — high</option>
            <option value={3}>P3 — normal</option>
            <option value={4}>P4 — low</option>
          </select>
        </label>
        <label>
          Status
          <select value={t.status ?? 'todo'} onChange={(e) => set({ status: e.target.value as Task['status'] })}>
            <option value="todo">To do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
            <option value="dropped">Dropped</option>
          </select>
        </label>
        <label>
          Goal
          <select value={t.goal_id ?? ''} onChange={(e) => set({ goal_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {goals.filter((g) => g.status === 'active').map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </label>
        <ProjectSelect projects={projects} value={t.project_id ?? null} onChange={(project_id) => set({ project_id })} />
      </div>
      <label>Notes<textarea rows={4} value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="modal-foot">
        {t.id ? (
          <button className="btn danger" onClick={async () => { await api.deleteTask(t.id!); onClose() }}>Delete</button>
        ) : <span />}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function GoalEditor({ goal, projects, onClose }: { goal: Partial<Goal>; projects: Project[]; onClose: () => void }) {
  const [g, setG] = useState<Partial<Goal>>(goal)
  const set = (patch: Partial<Goal>) => setG((cur) => ({ ...cur, ...patch }))
  async function save() {
    if (!g.title?.trim()) return
    await api.saveGoal({ ...g, title: g.title.trim() })
    onClose()
  }
  return (
    <Modal title={g.id ? `Goal g${g.id}` : 'New goal'} onClose={onClose}>
      <label>Title<input autoFocus value={g.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></label>
      <div className="grid2">
        <label>
          Horizon
          <select value={g.horizon ?? 'short'} onChange={(e) => set({ horizon: e.target.value as Horizon })}>
            <option value="short">Short-term</option>
            <option value="long">Long-term</option>
          </select>
        </label>
        <label>Target date<input type="datetime-local" value={toLocalInput(g.due_at)} onChange={(e) => set({ due_at: fromLocalInput(e.target.value) })} /></label>
        <label>
          Status
          <select value={g.status ?? 'active'} onChange={(e) => set({ status: e.target.value as Goal['status'] })}>
            <option value="active">Active</option>
            <option value="done">Done</option>
            <option value="dropped">Dropped</option>
          </select>
        </label>
        <ProjectSelect projects={projects} value={g.project_id ?? null} onChange={(project_id) => set({ project_id })} />
      </div>
      <label>Notes<textarea rows={4} value={g.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="modal-foot">
        {g.id ? (
          <button className="btn danger" onClick={async () => { await api.deleteGoal(g.id!); onClose() }}>Delete</button>
        ) : <span />}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function ProjectSelect(p: { projects: Project[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <label>
      Project
      <select value={p.value ?? ''} onChange={(e) => p.onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {p.projects.filter((x) => x.active || x.id === p.value).map((x) => (
          <option key={x.id} value={x.id}>{x.name}</option>
        ))}
      </select>
    </label>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
