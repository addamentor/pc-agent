import { powerMonitor } from 'electron'
import { getWakePlan, isRunning, planNextWake, runWake, setWakePlan } from './agent'
import { runReminders } from './notify'

const TICK_MS = 30_000
let timer: NodeJS.Timeout | null = null

/**
 * One cheap timer. Each tick does free work (reminders) and starts a check-in
 * when the planned wake time has passed. The AI decides the wake time; code
 * only enforces the limits around it.
 */
async function tick(): Promise<void> {
  try {
    runReminders()
    const plan = getWakePlan()
    if (!plan.at) {
      // First run: check in shortly after start-up.
      setWakePlan({ at: new Date(Date.now() + 60_000).toISOString(), why: 'first check', must: true })
      return
    }
    if (!isRunning() && Date.parse(plan.at) <= Date.now()) await runWake('schedule')
  } catch (e) {
    console.error('scheduler tick failed', e)
    setWakePlan({ at: planNextWake(undefined).toISOString(), why: 'retry after error', must: false })
  }
}

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(tick, TICK_MS)
  // Catch up right after the PC wakes from sleep instead of waiting for the next tick.
  powerMonitor.on('resume', () => setTimeout(tick, 5_000))
  setTimeout(tick, 3_000)
}
