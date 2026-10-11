import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { exportAboutMe, importAboutMe } from './aboutme'
import { listAddons, saveAddon, setAddonSecret, testAddon } from './addons'
import { join, relative } from 'node:path'
import type { AgentApi, Overview, ProviderTestResult } from '@shared/types'
import { PROVIDERS } from '@shared/types'
import { chat, getWakePlan, isRunning, runWake } from './agent'
import { decide, editProposalArgs } from './approvals'
import { spend } from './budget'
import { emitChanged } from './events'
import { makeProvider } from './providers'
import { getSettings, saveSettings, setApiKey } from './settings'
import * as store from './store'

/** Dialogs attach to the app window when there is one, so they stay on top of it. */
function parentWindow(): BrowserWindow {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!w) throw new Error('Open the PC Agent window first')
  return w
}

function overview(): Overview {
  const s = getSettings()
  const plan = getWakePlan()
  const pending = store.listProposals('pending')
  const open = store.listTasks().filter((t) => t.status === 'todo' || t.status === 'doing')
  const now = new Date().toISOString()
  return {
    nextWakeAt: plan.at,
    nextWakeReason: plan.why,
    paused: s.paused,
    pending: pending.length,
    pendingUrgent: pending.filter((p) => p.urgency === 'urgent' || p.urgency === 'high').length,
    spend: spend(),
    budget: s.budget,
    openTasks: open.length,
    dueTasks: open.filter((t) => t.due_at && t.due_at <= now).length,
    running: isRunning(),
    lastSession: store.listSessions(1)[0] ?? null
  }
}

async function testProvider(id: Parameters<AgentApi['testProvider']>[0]): Promise<ProviderTestResult> {
  try {
    const models = await makeProvider(id).listModels()
    return { ok: true, message: `Connected. ${models.length} models available.`, models }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), models: [] }
  }
}

const handlers: AgentApi = {
  overview: async () => overview(),
  getSettings: async () => getSettings(),
  saveSettings: async (patch) => {
    const next = saveSettings(patch)
    if (patch.openAtLogin !== undefined) applyLoginItem(next.openAtLogin)
    emitChanged()
    return next
  },
  setApiKey: async (provider, key) => {
    if (!PROVIDERS.some((p) => p.id === provider)) throw new Error('Unknown provider')
    setApiKey(provider, key)
    emitChanged()
  },
  testProvider,

  listProjects: async () => store.listProjects(),
  saveProject: async (p) => {
    const r = store.saveProject(p)
    emitChanged()
    return r
  },
  deleteProject: async (id) => {
    store.deleteProject(id)
    emitChanged()
  },

  listGoals: async () => store.listGoals(),
  saveGoal: async (g) => {
    const r = store.saveGoal(g)
    emitChanged()
    return r
  },
  deleteGoal: async (id) => {
    store.deleteGoal(id)
    emitChanged()
  },
  listTasks: async () => store.listTasks(),
  saveTask: async (t) => {
    const r = store.saveTask(t)
    emitChanged()
    return r
  },
  deleteTask: async (id) => {
    store.deleteTask(id)
    emitChanged()
  },

  listProposals: async (status) => store.listProposals(status ?? 'pending'),
  decide: (ids, decision) => decide(ids, decision),
  updateProposalArgs: async (id, args) => editProposalArgs(id, args),
  openArtifact: async (id) => {
    const p = store.getProposal(id)
    if (!p?.artifact) throw new Error('No screenshot for this action')
    // Only ever open files the agent itself saved.
    const rel = relative(join(app.getPath('userData'), 'shots'), p.artifact)
    if (rel.startsWith('..') || rel.includes(':')) throw new Error('Refusing to open a file outside the screenshots folder')
    await shell.openPath(p.artifact)
  },

  exportAboutMe: async () => {
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: 'Export About me',
      defaultPath: join(app.getPath('documents'), 'about-me.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, exportAboutMe(), 'utf8')
    return r.filePath
  },
  importAboutMe: async () => {
    const r = await dialog.showOpenDialog(parentWindow(), {
      title: 'Import About me',
      defaultPath: app.getPath('documents'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const result = importAboutMe(await readFile(r.filePaths[0], 'utf8'))
    emitChanged()
    return { added: result.added, updated: result.updated }
  },
  pickFolder: async () => {
    const r = await dialog.showOpenDialog(parentWindow(), { properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  },

  listAddons: async () => listAddons(),
  saveAddon: async (id, patch) => {
    const r = saveAddon(id, patch)
    emitChanged()
    return r
  },
  setAddonSecret: async (id, key, value) => {
    setAddonSecret(id, key, value)
    emitChanged()
  },
  testAddon: (id) => testAddon(id),

  listSessions: async (limit) => store.listSessions(limit),
  sessionDetail: async (id) => {
    const session = store.getSession(id)
    if (!session) throw new Error('Session not found')
    return {
      session,
      proposals: store.listProposals('all', id),
      calls: store.listCalls(0, id),
      messages: store.chatHistory(0, id)
    }
  },
  listCalls: async (limit) => store.listCalls(limit),

  chatHistory: async (limit) => store.chatHistory(limit),
  sendChat: (text) => chat(text),
  wakeNow: async () => {
    await runWake('manual')
  }
}

export function registerIpc(): void {
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`agent:${name}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  }
}

export function applyLoginItem(open: boolean): void {
  if (!app.isPackaged) return // don't register the dev Electron binary at login
  app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] })
}
