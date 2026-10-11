import type { Project } from '@shared/types'
import { fmtLocal } from './actions'
import { decidedSince, listGoals, listProjects, listProposals, listTasks } from './store'
import { getDb } from './db'

const MAX_TASKS = 20
const MAX_PENDING = 10
const clip = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/**
 * The whole world state the model sees, as compact text. Kept to a few hundred
 * tokens: titles only, open items only, capped lists.
 *
 * Project notes cost tokens, so check-ins include notes only for projects whose
 * tasks are due within a day; chat includes notes for every active project.
 */
export function buildDigest(sinceIso: string | null, lastNote: string, mode: 'checkin' | 'chat'): string {
  const now = new Date()
  const nowIso = now.toISOString()
  const soon = new Date(now.getTime() + 24 * 3600_000).toISOString()
  const lines: string[] = []
  lines.push(`now ${now.toLocaleDateString('en-US', { weekday: 'short' })} ${fmtLocal(nowIso)}`)

  const projects = listProjects().filter((p) => p.active)
  const byId = new Map<number, Project>(projects.map((p) => [p.id, p]))
  const tag = (id: number | null) => (id && byId.has(id) ? ` @${byId.get(id)!.name}` : '')
  if (projects.length) lines.push(`projects ${projects.map((p) => `p${p.id} ${p.name}`).join(', ')}`)

  const goals = listGoals().filter((g) => g.status === 'active')
  const goalProject = new Map(goals.map((g) => [g.id, g.project_id]))
  lines.push(`goals${goals.length ? '' : ': none'}`)
  for (const g of goals)
    lines.push(`g${g.id} ${g.horizon === 'long' ? 'L' : 'S'} ${clip(g.title)}${tag(g.project_id)}${g.due_at ? ` | due ${fmtLocal(g.due_at)}` : ''}`)

  const open = listTasks().filter((t) => t.status === 'todo' || t.status === 'doing')
  // Overdue and due-soon first, then by priority; the store already sorts by due date.
  open.sort((a, b) => {
    const ua = a.due_at && a.due_at <= soon ? 0 : 1
    const ub = b.due_at && b.due_at <= soon ? 0 : 1
    return ua - ub || a.priority - b.priority
  })
  const projectOf = (t: (typeof open)[number]) => t.project_id ?? (t.goal_id ? goalProject.get(t.goal_id) ?? null : null)
  lines.push(`tasks open ${open.length}${open.length > MAX_TASKS ? ` (top ${MAX_TASKS})` : ''}`)
  for (const t of open.slice(0, MAX_TASKS)) {
    const flags = [
      `P${t.priority}`,
      t.status === 'doing' ? 'doing' : '',
      t.due_at ? `due ${fmtLocal(t.due_at)}${t.due_at <= nowIso ? ' OVERDUE' : ''}` : '',
      t.goal_id ? `g${t.goal_id}` : ''
    ].filter(Boolean)
    lines.push(`t${t.id} ${clip(t.title)}${tag(projectOf(t))} | ${flags.join(' ')}`)
  }

  const noteIds =
    mode === 'chat'
      ? projects.map((p) => p.id)
      : [...new Set(open.filter((t) => t.due_at && t.due_at <= soon).map(projectOf).filter((id): id is number => !!id))]
  const notes = noteIds.map((id) => byId.get(id)).filter((p): p is Project => !!p && !!p.notes.trim())
  if (notes.length) {
    lines.push('project notes')
    for (const p of notes) lines.push(`@${p.name}: ${clip(p.notes.replace(/\s+/g, ' '), 300)}`)
  }

  const pending = listProposals('pending')
  if (pending.length) {
    lines.push(`awaiting user review ${pending.length} (do not re-propose)`)
    for (const p of pending.slice(0, MAX_PENDING)) lines.push(`- ${clip(p.label, 90)}`)
  }

  if (sinceIso) {
    const changes: string[] = []
    const touched = new Set<string>()
    for (const p of decidedSince(sinceIso)) {
      const verb = p.status === 'rejected' ? 'rejected' : p.status === 'failed' ? 'approved, failed' : 'approved'
      // Command output matters to the next decision, so give it more room.
      const room = p.action === 'pc.run' ? 400 : 80
      const result = p.status === 'executed' || p.status === 'failed' ? ` → ${clip((p.result ?? '').replace(/\s+/g, ' '), room)}` : ''
      changes.push(`- user ${verb}: ${clip(p.label, 80)}${result}`)
      if (typeof p.args.id === 'number') touched.add(`${p.action.split('.')[0][0]}${p.args.id}`)
    }
    const edited = getDb()
      .prepare(
        `SELECT 't' || id AS ref, title, status FROM tasks WHERE updated_at > ?
         UNION ALL SELECT 'g' || id, title, status FROM goals WHERE updated_at > ? LIMIT 15`
      )
      .all(sinceIso, sinceIso) as { ref: string; title: string; status: string }[]
    // Skip edits already explained by an approved proposal above.
    for (const e of edited) if (!touched.has(e.ref)) changes.push(`- changed ${e.ref} ${clip(e.title, 50)} (${e.status})`)
    if (changes.length) lines.push('since last check', ...changes)
  }

  if (lastNote) lines.push(`your last note: ${clip(lastNote, 160)}`)
  return lines.join('\n')
}
