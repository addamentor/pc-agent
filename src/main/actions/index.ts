import { shell } from 'electron'
import { z } from 'zod'
import { assertHttpUrl, runSteps, type BrowserStep } from '../browser'
import { getGoal, getProject, getTask, saveGoal, saveTask } from '../store'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { absPath, isRiskyCommand, openTarget, runCommand } from '../pc'
import { isAddonEnabled } from '../settings'

export type ActionResult = string | { result: string; artifact?: string }

/**
 * An action is something the agent may PROPOSE. Nothing here runs until the
 * user approves the proposal. Add-ons extend the agent by registering actions.
 */
export interface ActionDef<S extends z.ZodType = z.ZodType> {
  name: string
  /** Owning add-on; the action only exists while that add-on is enabled. */
  addon?: string
  /** Optional: rewrite the model's args before the proposal is stored (e.g. resolve short refs). */
  prepare?(args: z.infer<S>): Promise<z.infer<S>> | z.infer<S>
  /** One compact line for the system prompt: name + arg shape. Keep it short; it is sent on every call. */
  sig: string
  schema: S
  label(args: z.infer<S>): string
  execute(args: z.infer<S>): Promise<ActionResult> | ActionResult
}

const registry = new Map<string, ActionDef>()

/** Typed helper for add-ons that build action lists instead of registering directly. */
export function defineAction<S extends z.ZodType>(def: ActionDef<S>): ActionDef {
  return def as unknown as ActionDef
}

export function registerAction<S extends z.ZodType>(def: ActionDef<S>): void {
  registry.set(def.name, def as unknown as ActionDef)
}

const available = (a: ActionDef) => !a.addon || isAddonEnabled(a.addon)

export function getAction(name: string): ActionDef | undefined {
  const a = registry.get(name)
  return a && available(a) ? a : undefined
}

export function actionSignatures(): string {
  return [...registry.values()].filter(available).map((a) => a.sig).join('\n')
}

export function actionsOf(addon: string): string[] {
  return [...registry.values()].filter((a) => a.addon === addon).map((a) => a.name)
}

// ---- date helpers: the model writes local "YYYY-MM-DD[ HH:mm]" ----

export function parseLocalDate(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s.trim())
  if (!m) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const [, y, mo, d, h, mi] = m
  return new Date(+y, +mo - 1, +d, h ? +h : 9, mi ? +mi : 0).toISOString()
}

export function fmtLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---- built-in actions (phase 1: goals & tasks) ----

const due = z.string().nullable().optional()
const prio = z.number().int().min(1).max(4).optional()
const proj = z.number().int().optional()
const projName = (id: number | undefined) => (id ? ` @${getProject(id)?.name ?? 'p' + id}` : '')

registerAction({
  name: 'task.add',
  sig: 'task.add {title, due?, p?(1-4), goal?(id), proj?(id), notes?}',
  schema: z.object({ title: z.string().min(1), due, p: prio, goal: z.number().int().optional(), proj, notes: z.string().optional() }),
  label: (a) => `Add task "${a.title}"${a.due ? ` due ${a.due}` : ''}${a.p ? ` (P${a.p})` : ''}${projName(a.proj)}`,
  execute: (a) => {
    const t = saveTask({
      title: a.title,
      due_at: parseLocalDate(a.due),
      priority: a.p ?? 3,
      goal_id: a.goal ?? null,
      project_id: a.proj ?? null,
      notes: a.notes ?? ''
    })
    return `Created task #${t.id}`
  }
})

registerAction({
  name: 'task.edit',
  sig: 'task.edit {id, title?, due?, p?, status?(todo|doing|done|dropped), proj?, notes?}',
  schema: z.object({
    id: z.number().int(),
    title: z.string().optional(),
    due,
    p: prio,
    status: z.enum(['todo', 'doing', 'done', 'dropped']).optional(),
    proj,
    notes: z.string().optional()
  }),
  label: (a) => {
    const t = getTask(a.id)
    const parts = [
      a.title && `title → "${a.title}"`,
      a.due !== undefined && `due → ${a.due ?? 'none'}`,
      a.p && `priority → P${a.p}`,
      a.status && `status → ${a.status}`,
      a.proj && `project →${projName(a.proj)}`,
      a.notes !== undefined && 'update notes'
    ].filter(Boolean)
    return `Task "${t?.title ?? '#' + a.id}": ${parts.join(', ') || 'no change'}`
  },
  execute: (a) => {
    const t = getTask(a.id)
    if (!t) throw new Error(`Task #${a.id} no longer exists`)
    saveTask({
      id: a.id,
      title: a.title ?? t.title,
      ...(a.due !== undefined ? { due_at: parseLocalDate(a.due) } : {}),
      ...(a.p ? { priority: a.p } : {}),
      ...(a.status ? { status: a.status } : {}),
      ...(a.proj ? { project_id: a.proj } : {}),
      ...(a.notes !== undefined ? { notes: a.notes } : {})
    })
    return `Updated task #${a.id}`
  }
})

registerAction({
  name: 'goal.add',
  sig: 'goal.add {title, horizon(short|long), due?, proj?(id), notes?}',
  schema: z.object({ title: z.string().min(1), horizon: z.enum(['short', 'long']), due, proj, notes: z.string().optional() }),
  label: (a) => `Add ${a.horizon}-term goal "${a.title}"${a.due ? ` by ${a.due}` : ''}${projName(a.proj)}`,
  execute: (a) => {
    const g = saveGoal({
      title: a.title,
      horizon: a.horizon,
      due_at: parseLocalDate(a.due),
      project_id: a.proj ?? null,
      notes: a.notes ?? ''
    })
    return `Created goal #${g.id}`
  }
})

registerAction({
  name: 'goal.edit',
  sig: 'goal.edit {id, title?, due?, status?(active|done|dropped), proj?, notes?}',
  schema: z.object({
    id: z.number().int(),
    title: z.string().optional(),
    due,
    status: z.enum(['active', 'done', 'dropped']).optional(),
    proj,
    notes: z.string().optional()
  }),
  label: (a) => {
    const g = getGoal(a.id)
    const parts = [
      a.title && `title → "${a.title}"`,
      a.due !== undefined && `due → ${a.due ?? 'none'}`,
      a.status && `status → ${a.status}`,
      a.notes !== undefined && 'update notes'
    ].filter(Boolean)
    return `Goal "${g?.title ?? '#' + a.id}": ${parts.join(', ') || 'no change'}`
  },
  execute: (a) => {
    const g = getGoal(a.id)
    if (!g) throw new Error(`Goal #${a.id} no longer exists`)
    saveGoal({
      id: a.id,
      title: a.title ?? g.title,
      ...(a.due !== undefined ? { due_at: parseLocalDate(a.due) } : {}),
      ...(a.status ? { status: a.status } : {}),
      ...(a.proj ? { project_id: a.proj } : {}),
      ...(a.notes !== undefined ? { notes: a.notes } : {})
    })
    return `Updated goal #${a.id}`
  }
})

// ---- browser (phase 2) ----

const step = z.union([
  z.object({ click: z.string().min(1) }),
  z.object({ fill: z.string().min(1), text: z.string() }),
  z.object({ press: z.string().min(1) }),
  z.object({ wait: z.number().min(0).max(10) })
])

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

function describeStep(s: BrowserStep): string {
  if ('click' in s) return `click "${s.click}"`
  if ('fill' in s) return `type "${s.text.length > 40 ? s.text.slice(0, 39) + '…' : s.text}" into "${s.fill}"`
  if ('press' in s) return `press ${s.press}`
  return `wait ${s.wait}s`
}

registerAction({
  name: 'browser.open',
  sig: "browser.open {url}  (opens in the user's own browser)",
  schema: z.object({ url: z.string().url() }),
  label: (a) => `Open ${a.url} in your browser`,
  execute: async (a) => {
    await shell.openExternal(assertHttpUrl(a.url).toString())
    return `Opened ${hostOf(a.url)}`
  }
})

registerAction({
  name: 'browser.do',
  sig: 'browser.do {url, steps:[{click:"button/link text"}|{fill:"field label",text}|{press:"Enter"}|{wait:sec}]}  (agent browser, visible; use names from CONTROLS)',
  schema: z.object({ url: z.string().url(), steps: z.array(step).min(1).max(15) }),
  label: (a) => `In browser at ${hostOf(a.url)}: ${a.steps.map(describeStep).join(' → ')}`,
  execute: (a) => runSteps(a.url, a.steps)
})

// ---- PC (phase 3) ----

registerAction({
  name: 'pc.run',
  sig: 'pc.run {cmd, cwd?}  (PowerShell; output comes back to you after it runs)',
  schema: z.object({ cmd: z.string().min(1).max(2000), cwd: z.string().optional() }),
  label: (a) => `${isRiskyCommand(a.cmd) ? '⚠ ' : ''}Run: ${a.cmd}${a.cwd ? `  (in ${a.cwd})` : ''}`,
  execute: (a) => runCommand(a.cmd, a.cwd)
})

registerAction({
  name: 'pc.open',
  sig: 'pc.open {target}  (full path of a file/folder, or an app name like "notepad")',
  schema: z.object({ target: z.string().min(1) }),
  label: (a) => `Open ${a.target}`,
  execute: (a) => openTarget(a.target)
})

registerAction({
  name: 'file.write',
  sig: 'file.write {path, text, mode?(create|overwrite|append)}',
  schema: z.object({ path: z.string().min(1), text: z.string().max(200_000), mode: z.enum(['create', 'overwrite', 'append']).optional() }),
  label: (a) => {
    const verb = a.mode === 'append' ? 'Append to' : a.mode === 'overwrite' ? 'Overwrite' : 'Create'
    return `${verb} file ${a.path} (${a.text.length.toLocaleString()} chars)`
  },
  execute: async (a) => {
    const p = absPath(a.path)
    await mkdir(dirname(p), { recursive: true })
    if (a.mode === 'append') await appendFile(p, a.text, 'utf8')
    else await writeFile(p, a.text, { encoding: 'utf8', flag: a.mode === 'overwrite' ? 'w' : 'wx' })
    return `Wrote ${p}`
  }
})

registerAction({
  name: 'file.mkdir',
  sig: 'file.mkdir {path}',
  schema: z.object({ path: z.string().min(1) }),
  label: (a) => `Create folder ${a.path}`,
  execute: async (a) => {
    const p = absPath(a.path)
    await mkdir(p, { recursive: true })
    return `Folder ready: ${p}`
  }
})

registerAction({
  name: 'file.move',
  sig: 'file.move {from, to}  (also renames; fails if "to" exists)',
  schema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
  label: (a) => `Move ${a.from} → ${a.to}`,
  execute: async (a) => {
    const from = absPath(a.from)
    const to = absPath(a.to)
    if (existsSync(to)) throw new Error(`Already exists: ${to}`)
    await mkdir(dirname(to), { recursive: true })
    try {
      await rename(from, to)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      // Different drive: copy, then send the original to the Recycle Bin.
      await cp(from, to, { recursive: true, errorOnExist: true })
      await shell.trashItem(from)
    }
    return `Moved to ${to}`
  }
})

registerAction({
  name: 'file.copy',
  sig: 'file.copy {from, to}  (fails if "to" exists)',
  schema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
  label: (a) => `Copy ${a.from} → ${a.to}`,
  execute: async (a) => {
    const from = absPath(a.from)
    const to = absPath(a.to)
    if (existsSync(to)) throw new Error(`Already exists: ${to}`)
    await mkdir(dirname(to), { recursive: true })
    await cp(from, to, { recursive: true, errorOnExist: true })
    return `Copied to ${to}`
  }
})

registerAction({
  name: 'file.trash',
  sig: 'file.trash {path}  (moves to the Recycle Bin; never deletes permanently)',
  schema: z.object({ path: z.string().min(1) }),
  label: (a) => `Move ${a.path} to the Recycle Bin`,
  execute: async (a) => {
    const p = absPath(a.path)
    if (!existsSync(p)) throw new Error(`Not found: ${p}`)
    await shell.trashItem(p)
    return `Moved ${p} to the Recycle Bin`
  }
})
