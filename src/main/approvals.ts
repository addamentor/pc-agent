import type { Proposal } from '@shared/types'
import { getAction } from './actions'
import { nowIso } from './db'
import { emitChanged } from './events'
import { getProposal, updateProposal } from './store'

/** The only place proposed actions are executed, and only after the user approves them. */
export async function decide(ids: number[], decision: 'approve' | 'reject'): Promise<Proposal[]> {
  const out: Proposal[] = []
  for (const id of ids) {
    const p = getProposal(id)
    if (!p || p.status !== 'pending') continue
    if (decision === 'reject') {
      out.push(updateProposal(id, { status: 'rejected', decided_at: nowIso() }))
      continue
    }
    updateProposal(id, { status: 'approved', decided_at: nowIso() })
    const def = getAction(p.action)
    try {
      if (!def) throw new Error(`Action ${p.action} is not available`)
      const args = def.schema.parse(p.args)
      const r = await def.execute(args)
      const { result, artifact } = typeof r === 'string' ? { result: r, artifact: undefined } : r
      out.push(updateProposal(id, { status: 'executed', result, artifact: artifact ?? null }))
    } catch (e) {
      // Browser actions attach a screenshot even when a step fails.
      const artifact = (e as { artifact?: string }).artifact ?? null
      out.push(updateProposal(id, { status: 'failed', result: e instanceof Error ? e.message : String(e), artifact }))
    }
  }
  emitChanged()
  return out
}

/** Let the user tweak a proposal before approving it. */
export function editProposalArgs(id: number, args: Record<string, unknown>): Proposal {
  const p = getProposal(id)
  if (!p || p.status !== 'pending') throw new Error('Only pending proposals can be edited')
  const def = getAction(p.action)
  if (!def) throw new Error(`Action ${p.action} is not available`)
  const parsed = def.schema.parse(args)
  const next = updateProposal(id, { args: parsed as Record<string, unknown>, label: def.label(parsed) })
  emitChanged()
  return next
}
