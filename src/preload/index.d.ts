import type { AgentApi, PushEvent } from '../shared/types'

declare global {
  interface Window {
    agent: AgentApi
    agentEvents: {
      on(event: PushEvent, cb: (payload?: string) => void): number
      off(token: number): void
    }
  }
}

export {}
