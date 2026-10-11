import type { AddonField } from '@shared/types'
import type { ActionDef } from '../actions'

export type Mode = 'checkin' | 'chat'

/**
 * A built-in add-on. Everything is optional except identity; the host only calls
 * these while the add-on is enabled.
 */
export interface Addon {
  id: string
  name: string
  description: string
  fields: AddonField[]
  /** Proposal-only actions. Name them "<id>.<verb>". */
  actions?: ActionDef[]
  /** A few compact lines for the state summary. Return null when there's nothing to say. */
  digest?(mode: Mode): Promise<string | null>
  /** Cheap check: did something change since the last AI call? Lets check-ins stay free when idle. */
  hasNews?(): Promise<boolean>
  /** Items the agent may read without approval, e.g. "mail:m3". */
  reader?: {
    prefix: string
    /** One line for the system prompt describing what can be read. */
    hint: string
    read(ref: string, maxChars: number, mode: Mode): Promise<string>
  }
  /** "Test connection" in the Add-ons page. */
  test?(): Promise<string>
}
