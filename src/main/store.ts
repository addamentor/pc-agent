import type { SQLInputValue } from 'node:sqlite'
import { getDb, nowIso } from './db'
import type {
  CallLog,
  Project,
  ChatMessage,
  Goal,
  Proposal,
  ProposalStatus,
  Session,
  Task,
  Urgency
} from '@shared/types'

const db = () => getDb()

// ---------- projects ----------

export function listProjects(): Project[] {
  return db().prepare('SELECT * FROM projects ORDER BY active DESC, name').all() as unknown as Project[]
}

export function getProject(id: number): Project | undefined {
  return db().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined
}

export function saveProject(p: Partial<Project> & { name: string }): Project {
  const now = nowIso()
  if (p.id) {
    const cur = getProject(p.id)
    if (!cur) throw new Error(`Project ${p.id} not found`)
    const next = { ...cur, ...p }
    db()
      .prepare('UPDATE projects SET name=?, notes=?, active=?, updated_at=? WHERE id=?')
      .run(next.name, next.notes, next.active ? 1 : 0, now, p.id)
    return getProject(p.id)!
  }
  const info = db()
    .prepare('INSERT INTO projects (name, notes, active, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(p.name, p.notes ?? '', p.active === 0 ? 0 : 1, now, now)
  return getProject(Number(info.lastInsertRowid))!
}

export function deleteProject(id: number): void {
  db().prepare('DELETE FROM projects WHERE id = ?').run(id)
}

// ---------- goals ----------

export function listGoals(): Goal[] {
  return db().prepare(`SELECT * FROM goals ORDER BY status = 'active' DESC, horizon, COALESCE(due_at, '9999'), id`).all() as unknown as Goal[]
}

export function getGoal(id: number): Goal | undefined {
  return db().prepare('SELECT * FROM goals WHERE id = ?').get(id) as Goal | undefined
}

export function saveGoal(g: Partial<Goal> & { title: string }): Goal {
  const now = nowIso()
  if (g.id) {
    const cur = getGoal(g.id)
    if (!cur) throw new Error(`Goal ${g.id} not found`)
    const next = { ...cur, ...g, updated_at: now }
    db()
      .prepare('UPDATE goals SET title=?, notes=?, horizon=?, status=?, project_id=?, due_at=?, updated_at=? WHERE id=?')
      .run(next.title, next.notes, next.horizon, next.status, next.project_id ?? null, next.due_at, now, g.id)
    return getGoal(g.id)!
  }
  const info = db()
    .prepare(
      'INSERT INTO goals (title, notes, horizon, status, project_id, due_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(g.title, g.notes ?? '', g.horizon ?? 'short', g.status ?? 'active', g.project_id ?? null, g.due_at ?? null, now, now)
  return getGoal(Number(info.lastInsertRowid))!
}

export function deleteGoal(id: number): void {
  db().prepare('DELETE FROM goals WHERE id = ?').run(id)
}

// ---------- tasks ----------

export function listTasks(): Task[] {
  return db()
    .prepare(
      `SELECT * FROM tasks ORDER BY status IN ('todo','doing') DESC, COALESCE(due_at, '9999'), priority, id`
    )
    .all() as unknown as Task[]
}

export function getTask(id: number): Task | undefined {
  return db().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined
}

export function saveTask(t: Partial<Task> & { title: string }): Task {
  const now = nowIso()
  if (t.id) {
    const cur = getTask(t.id)
    if (!cur) throw new Error(`Task ${t.id} not found`)
    const next = { ...cur, ...t }
    // A new or changed due date should notify again.
    const resetNotified = next.due_at !== cur.due_at ? 0 : undefined
    db()
      .prepare(
        `UPDATE tasks SET title=?, notes=?, goal_id=?, project_id=?, status=?, priority=?, due_at=?, updated_at=?,
         due_notified = COALESCE(?, due_notified) WHERE id=?`
      )
      .run(
        next.title,
        next.notes,
        next.goal_id,
        next.project_id ?? null,
        next.status,
        next.priority,
        next.due_at,
        now,
        resetNotified ?? null,
        t.id
      )
    return getTask(t.id)!
  }
  const info = db()
    .prepare(
      'INSERT INTO tasks (title, notes, goal_id, project_id, status, priority, due_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      t.title,
      t.notes ?? '',
      t.goal_id ?? null,
      t.project_id ?? null,
      t.status ?? 'todo',
      t.priority ?? 3,
      t.due_at ?? null,
      now,
      now
    )
  return getTask(Number(info.lastInsertRowid))!
}

export function deleteTask(id: number): void {
  db().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

/** Open tasks whose due time has passed and that haven't been toasted yet. */
export function takeNewlyDueTasks(): Task[] {
  const rows = db()
    .prepare(`SELECT * FROM tasks WHERE status IN ('todo','doing') AND due_at IS NOT NULL AND due_at <= ? AND due_notified = 0`)
    .all(nowIso()) as unknown as Task[]
  const mark = db().prepare('UPDATE tasks SET due_notified = 1 WHERE id = ?')
  for (const t of rows) mark.run(t.id)
  return rows
}

export function nextDueAt(): string | null {
  const row = db()
    .prepare(`SELECT MIN(due_at) AS d FROM tasks WHERE status IN ('todo','doing') AND due_at > ? AND due_notified = 0`)
    .get(nowIso()) as { d: string | null }
  return row.d
}

// ---------- sessions ----------

export function startSession(trigger: Session['trigger']): Session {
  const info = db().prepare('INSERT INTO sessions (trigger, started_at) VALUES (?, ?)').run(trigger, nowIso())
  return getSession(Number(info.lastInsertRowid))!
}

export function finishSession(
  id: number,
  patch: { status: Session['status']; summary: string; next_wake_at?: string | null }
): void {
  db()
    .prepare(
      `UPDATE sessions SET status=?, summary=?, next_wake_at=?, ended_at=?,
       cost_usd = (SELECT COALESCE(SUM(cost_usd),0) FROM calls WHERE session_id = ?),
       tokens = (SELECT COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens),0) FROM calls WHERE session_id = ?)
       WHERE id=?`
    )
    .run(patch.status, patch.summary, patch.next_wake_at ?? null, nowIso(), id, id, id)
}

export function getSession(id: number): Session | undefined {
  return db().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
}

export function listSessions(limit = 100): Session[] {
  return db().prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT ?').all(limit) as unknown as Session[]
}

export function lastAiSession(): Session | undefined {
  return db()
    .prepare(`SELECT * FROM sessions WHERE status = 'done' ORDER BY id DESC LIMIT 1`)
    .get() as Session | undefined
}

// ---------- proposals ----------

type ProposalRow = Omit<Proposal, 'args'> & { args: string }
const parseProposal = (r: ProposalRow): Proposal => ({ ...r, args: JSON.parse(r.args) })

export function addProposal(p: {
  session_id: number
  action: string
  args: Record<string, unknown>
  label: string
  reason: string
  urgency: Urgency
}): Proposal {
  const info = db()
    .prepare(
      'INSERT INTO proposals (session_id, action, args, label, reason, urgency, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(p.session_id, p.action, JSON.stringify(p.args), p.label, p.reason, p.urgency, nowIso())
  return getProposal(Number(info.lastInsertRowid))!
}

export function getProposal(id: number): Proposal | undefined {
  const r = db().prepare('SELECT * FROM proposals WHERE id = ?').get(id) as ProposalRow | undefined
  return r && parseProposal(r)
}

export function listProposals(status: ProposalStatus | 'all' = 'pending', sessionId?: number): Proposal[] {
  const where: string[] = []
  const params: SQLInputValue[] = []
  if (status !== 'all') {
    where.push('status = ?')
    params.push(status)
  }
  if (sessionId) {
    where.push('session_id = ?')
    params.push(sessionId)
  }
  const sql = `SELECT * FROM proposals ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, id DESC LIMIT 500`
  return (db().prepare(sql).all(...params) as ProposalRow[]).map(parseProposal)
}

export function updateProposal(
  id: number,
  patch: Partial<Pick<Proposal, 'status' | 'result' | 'args' | 'label' | 'decided_at' | 'artifact'>> & {
    last_reminded_at?: string
  }
): Proposal {
  const cur = db().prepare('SELECT * FROM proposals WHERE id = ?').get(id) as ProposalRow | undefined
  if (!cur) throw new Error(`Proposal ${id} not found`)
  const next = {
    ...cur,
    ...patch,
    args: patch.args ? JSON.stringify(patch.args) : cur.args
  } as ProposalRow & { last_reminded_at: string | null }
  db()
    .prepare('UPDATE proposals SET status=?, result=?, args=?, label=?, decided_at=?, last_reminded_at=?, artifact=? WHERE id=?')
    .run(next.status, next.result, next.args, next.label, next.decided_at, next.last_reminded_at ?? null, next.artifact ?? null, id)
  return getProposal(id)!
}

export function pendingForReminder(): (Proposal & { last_reminded_at: string | null })[] {
  return (db().prepare(`SELECT * FROM proposals WHERE status = 'pending'`).all() as (ProposalRow & {
    last_reminded_at: string | null
  })[]).map((r) => ({ ...parseProposal(r), last_reminded_at: r.last_reminded_at }))
}

/** True if the same action+args is already pending or was rejected in the last week. */
export function isDuplicateProposal(action: string, args: Record<string, unknown>): boolean {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
  const row = db()
    .prepare(
      `SELECT 1 FROM proposals WHERE action = ? AND args = ?
       AND (status = 'pending' OR (status = 'rejected' AND decided_at > ?)) LIMIT 1`
    )
    .get(action, JSON.stringify(args), weekAgo)
  return !!row
}

/** Proposals decided since a point in time, so the agent can learn what was accepted. */
export function decidedSince(iso: string): Proposal[] {
  return (db()
    .prepare(`SELECT * FROM proposals WHERE decided_at > ? AND status != 'pending' ORDER BY decided_at`)
    .all(iso) as ProposalRow[]).map(parseProposal)
}

// ---------- calls ----------

export function logCall(c: Omit<CallLog, 'id' | 'created_at'>): void {
  db()
    .prepare(
      `INSERT INTO calls (session_id, purpose, provider, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, priced, error, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      c.session_id,
      c.purpose,
      c.provider,
      c.model,
      c.input_tokens,
      c.output_tokens,
      c.cache_read_tokens,
      c.cost_usd,
      c.priced,
      c.error,
      nowIso()
    )
}

export function listCalls(limit = 200, sessionId?: number): CallLog[] {
  if (sessionId) return db().prepare('SELECT * FROM calls WHERE session_id = ? ORDER BY id').all(sessionId) as unknown as CallLog[]
  return db().prepare('SELECT * FROM calls ORDER BY id DESC LIMIT ?').all(limit) as unknown as CallLog[]
}

export function spendSince(iso: string): { usd: number; tokens: number } {
  const r = db()
    .prepare(
      'SELECT COALESCE(SUM(cost_usd),0) AS usd, COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens),0) AS tokens FROM calls WHERE created_at >= ?'
    )
    .get(iso) as { usd: number; tokens: number }
  return r
}

// ---------- chat messages ----------

export function addMessage(role: ChatMessage['role'], text: string, sessionId: number | null, seen = false): ChatMessage {
  const info = db()
    .prepare('INSERT INTO messages (role, text, session_id, seen_by_agent, created_at) VALUES (?,?,?,?,?)')
    .run(role, text, sessionId, seen ? 1 : 0, nowIso())
  return db().prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as ChatMessage
}

export function chatHistory(limit = 100, sessionId?: number): ChatMessage[] {
  if (sessionId) return db().prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id').all(sessionId) as unknown as ChatMessage[]
  return (db().prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(limit) as unknown as ChatMessage[]).reverse()
}

export function markMessagesSeen(): void {
  db().prepare('UPDATE messages SET seen_by_agent = 1 WHERE seen_by_agent = 0').run()
}

export function lastUpdateSince(iso: string): boolean {
  const r = db()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM tasks WHERE updated_at > ?) + (SELECT COUNT(*) FROM goals WHERE updated_at > ?) AS n`
    )
    .get(iso, iso) as { n: number }
  return r.n > 0
}
