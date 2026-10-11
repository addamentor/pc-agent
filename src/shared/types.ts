// Types shared by the main process (agent) and the renderer (UI).

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama'

export const PROVIDERS: { id: ProviderId; label: string; needsKey: boolean; defaultBaseUrl?: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', needsKey: true },
  { id: 'openai', label: 'OpenAI', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', label: 'Ollama (local)', needsKey: false, defaultBaseUrl: 'http://localhost:11434/v1' }
]

export interface ModelSlot {
  provider: ProviderId
  model: string
  maxOutputTokens: number
}

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number
  output: number
  cacheRead?: number
}

export interface ProviderSettings {
  enabled: boolean
  hasKey: boolean // renderer only ever sees this, never the key
  baseUrl?: string
}

export interface Settings {
  providers: Record<ProviderId, ProviderSettings>
  wake: ModelSlot
  chat: ModelSlot
  /** Key: "provider:model". */
  prices: Record<string, ModelPrice>
  budget: {
    dailyUsd: number
    monthlyUsd: number
    dailyTokens: number
  }
  schedule: {
    minGapMin: number
    maxGapMin: number
    quietStart: string // "23:00"
    quietEnd: string // "07:00"
    digestHour: number // hour for the daily review digest
  }
  /** Short "about me". Sent with every AI call, so keep it brief. */
  profile: string
  /** First-run setup finished (or skipped). */
  onboarded: boolean
  pc: {
    /** Folders the agent may read without asking. Writes always need approval. */
    readFolders: string[]
    commandTimeoutSec: number
  }
  browser: {
    channel: 'chrome' | 'msedge'
    /** Allow check-ins (not just chat) to read web pages. */
    readInCheckins: boolean
    maxPagesPerRound: number
    maxReadChars: number
    maxReadRounds: number
  }
  /** Per add-on state. Secrets are stored separately, encrypted. */
  addons: Record<string, { enabled: boolean; config: Record<string, string | number | boolean> }>
  openAtLogin: boolean
  paused: boolean
}

export interface AddonField {
  key: string
  label: string
  type: 'text' | 'url' | 'number' | 'checkbox' | 'secret'
  default?: string | number | boolean
  help?: string
}

export interface AddonInfo {
  id: string
  name: string
  description: string
  enabled: boolean
  fields: AddonField[]
  config: Record<string, string | number | boolean>
  /** Which secret fields have a stored value (values never leave the main process). */
  secretsSet: Record<string, boolean>
  actions: string[]
}

export interface Project {
  id: number
  name: string
  notes: string
  active: number // 1 | 0
  created_at: string
  updated_at: string
}

export type Horizon = 'short' | 'long'
export type GoalStatus = 'active' | 'done' | 'dropped'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped'
export type Urgency = 'low' | 'normal' | 'high' | 'urgent'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'

export interface Goal {
  id: number
  title: string
  notes: string
  horizon: Horizon
  status: GoalStatus
  project_id: number | null
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: number
  title: string
  notes: string
  goal_id: number | null
  project_id: number | null
  status: TaskStatus
  priority: number // 1 = highest, 4 = lowest
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface Session {
  id: number
  trigger: 'schedule' | 'user' | 'chat' | 'manual'
  started_at: string
  ended_at: string | null
  status: 'running' | 'done' | 'skipped' | 'error'
  summary: string
  next_wake_at: string | null
  cost_usd: number
  tokens: number
}

export interface Proposal {
  id: number
  session_id: number
  action: string
  args: Record<string, unknown>
  label: string // human-readable description of the action
  reason: string
  urgency: Urgency
  status: ProposalStatus
  result: string | null
  artifact: string | null // e.g. screenshot path after a browser action
  created_at: string
  decided_at: string | null
}

export interface CallLog {
  id: number
  session_id: number | null
  purpose: 'wake' | 'chat'
  provider: ProviderId
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cost_usd: number
  priced: number // 0 when no price was configured for the model
  error: string | null
  created_at: string
}

export interface ChatMessage {
  id: number
  role: 'user' | 'agent'
  text: string
  session_id: number | null
  created_at: string
}

export interface Overview {
  nextWakeAt: string | null
  nextWakeReason: string
  paused: boolean
  pending: number
  pendingUrgent: number
  spend: { todayUsd: number; monthUsd: number; todayTokens: number }
  budget: Settings['budget']
  openTasks: number
  dueTasks: number
  running: boolean
  lastSession: Session | null
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  models: string[]
}

/** Everything the renderer can call. Each maps to one ipcMain.handle channel. */
export interface AgentApi {
  overview(): Promise<Overview>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  setApiKey(provider: ProviderId, key: string): Promise<void>
  testProvider(provider: ProviderId): Promise<ProviderTestResult>

  listProjects(): Promise<Project[]>
  saveProject(p: Partial<Project> & { name: string }): Promise<Project>
  deleteProject(id: number): Promise<void>

  listGoals(): Promise<Goal[]>
  saveGoal(goal: Partial<Goal> & { title: string }): Promise<Goal>
  deleteGoal(id: number): Promise<void>
  listTasks(): Promise<Task[]>
  saveTask(task: Partial<Task> & { title: string }): Promise<Task>
  deleteTask(id: number): Promise<void>

  listProposals(status?: ProposalStatus | 'all'): Promise<Proposal[]>
  decide(ids: number[], decision: 'approve' | 'reject'): Promise<Proposal[]>
  updateProposalArgs(id: number, args: Record<string, unknown>): Promise<Proposal>
  openArtifact(proposalId: number): Promise<void>
  exportAboutMe(): Promise<string | null>
  importAboutMe(): Promise<{ added: number; updated: number } | null>
  pickFolder(): Promise<string | null>
  listAddons(): Promise<AddonInfo[]>
  saveAddon(id: string, patch: { enabled?: boolean; config?: Record<string, string | number | boolean> }): Promise<AddonInfo>
  setAddonSecret(id: string, key: string, value: string): Promise<void>
  testAddon(id: string): Promise<{ ok: boolean; message: string }>

  listSessions(limit?: number): Promise<Session[]>
  sessionDetail(id: number): Promise<{ session: Session; proposals: Proposal[]; calls: CallLog[]; messages: ChatMessage[] }>
  listCalls(limit?: number): Promise<CallLog[]>

  chatHistory(limit?: number): Promise<ChatMessage[]>
  sendChat(text: string): Promise<ChatMessage | null>
  wakeNow(): Promise<void>
}

export type PushEvent = 'changed' | 'navigate'
