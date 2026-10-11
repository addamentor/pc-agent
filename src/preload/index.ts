import { contextBridge, ipcRenderer } from 'electron'
import type { AgentApi, PushEvent } from '../shared/types'

const METHODS: (keyof AgentApi)[] = [
  'overview',
  'getSettings',
  'saveSettings',
  'setApiKey',
  'testProvider',
  'listProjects',
  'saveProject',
  'deleteProject',
  'listGoals',
  'saveGoal',
  'deleteGoal',
  'listTasks',
  'saveTask',
  'deleteTask',
  'listProposals',
  'decide',
  'updateProposalArgs',
  'openArtifact',
  'exportAboutMe',
  'importAboutMe',
  'pickFolder',
  'listAddons',
  'saveAddon',
  'setAddonSecret',
  'testAddon',
  'listSessions',
  'sessionDetail',
  'listCalls',
  'chatHistory',
  'sendChat',
  'wakeNow'
]

const api = Object.fromEntries(
  METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`agent:${m}`, ...args)])
) as unknown as AgentApi

contextBridge.exposeInMainWorld('agent', api)
// Functions returned across the context bridge aren't callable, so subscriptions
// hand back a numeric token for off() instead of an unsubscribe closure.
const listeners = new Map<number, { channel: string; fn: (...args: unknown[]) => void }>()
let nextToken = 1
contextBridge.exposeInMainWorld('agentEvents', {
  on(event: PushEvent, cb: (payload?: string) => void): number {
    const channel = `push:${event}`
    const fn = (_e: unknown, payload?: unknown) => cb(payload as string | undefined)
    ipcRenderer.on(channel, fn)
    const token = nextToken++
    listeners.set(token, { channel, fn })
    return token
  },
  off(token: number): void {
    const l = listeners.get(token)
    if (!l) return
    ipcRenderer.removeListener(l.channel, l.fn)
    listeners.delete(token)
  }
})
