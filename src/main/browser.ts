import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core'
import { getSettings } from './settings'

/**
 * The agent's own browser: a separate Chrome/Edge profile driven by Playwright.
 * Reading pages runs headless; approved actions run in a visible window so the
 * user can watch. Logins made in that window persist in the agent's profile only.
 */

let ctx: BrowserContext | null = null
let headed = false
let idleTimer: NodeJS.Timeout | null = null
const IDLE_HEADLESS_MS = 2 * 60_000
const IDLE_HEADED_MS = 15 * 60_000

export function assertHttpUrl(raw: string): URL {
  const u = new URL(raw)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Only http(s) URLs are allowed: ${raw}`)
  return u
}

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void closeBrowser(), headed ? IDLE_HEADED_MS : IDLE_HEADLESS_MS)
}

export async function closeBrowser(): Promise<void> {
  const c = ctx
  ctx = null
  if (c) await c.close().catch(() => undefined)
}

async function context(needHeaded: boolean): Promise<BrowserContext> {
  // A persistent profile can only be open once, so reuse a headed window for reads,
  // but relaunch visibly when an action needs to be watched.
  if (ctx && (headed || !needHeaded)) {
    touch()
    return ctx
  }
  await closeBrowser()
  const dir = join(app.getPath('userData'), 'browser-profile')
  mkdirSync(dir, { recursive: true })
  const c = await chromium.launchPersistentContext(dir, {
    channel: getSettings().browser.channel,
    headless: !needHeaded,
    viewport: needHeaded ? null : { width: 1280, height: 900 },
    args: needHeaded ? ['--start-maximized'] : []
  })
  c.on('close', () => {
    if (ctx === c) ctx = null
  })
  ctx = c
  headed = needHeaded
  touch()
  return c
}

// Runs inside the page. A string so the main-process tsconfig needn't include DOM types.
const EXTRACT = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim()
  const root = document.querySelector('main, article, [role=main]') || document.body
  const text = clean(root ? root.innerText : '')
  const seen = new Set()
  const controls = []
  const nameOf = (el) => clean(el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder ||
    (el.labels && el.labels[0] && el.labels[0].innerText) || el.name || el.title)
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button]')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const tag = el.tagName.toLowerCase()
    const kind = tag === 'a' ? 'link' : tag === 'button' || el.getAttribute('role') === 'button' ? 'button' : 'field'
    const name = nameOf(el).slice(0, 60)
    if (!name) continue
    const key = kind + name
    if (seen.has(key)) continue
    seen.add(key)
    controls.push(kind + ' "' + name + '"')
    if (controls.length >= 30) break
  }
  return { title: clean(document.title), text, controls }
})()`

/** Fetch a page as compact text for the model. Read-only: no clicks, no typing. */
export async function readPage(rawUrl: string, maxChars: number): Promise<string> {
  const url = assertHttpUrl(rawUrl)
  const c = await context(false)
  const page = await c.newPage()
  try {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined)
    const r = (await page.evaluate(EXTRACT)) as { title: string; text: string; controls: string[] }
    const text = r.text.length > maxChars ? r.text.slice(0, maxChars) + ' …[cut]' : r.text
    return `URL ${page.url()}\nTITLE ${r.title}\nTEXT ${text}\nCONTROLS ${r.controls.join(', ')}`
  } finally {
    if (!headed) await page.close().catch(() => undefined)
    touch()
  }
}

export type BrowserStep =
  | { click: string }
  | { fill: string; text: string }
  | { press: string }
  | { wait: number }

async function firstVisible(candidates: Locator[]): Promise<Locator> {
  for (const l of candidates) {
    const first = l.first()
    if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) return first
  }
  throw new Error('not found')
}

async function runStep(page: Page, step: BrowserStep): Promise<string> {
  if ('click' in step) {
    const name = step.click
    const target = await firstVisible([
      page.getByRole('button', { name }),
      page.getByRole('link', { name }),
      page.getByRole('menuitem', { name }),
      page.getByText(name, { exact: false })
    ]).catch(() => {
      throw new Error(`Couldn't find "${name}" to click`)
    })
    await target.click({ timeout: 10_000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    return `clicked "${name}"`
  }
  if ('fill' in step) {
    const field = step.fill
    const target = await firstVisible([
      page.getByLabel(field),
      page.getByPlaceholder(field),
      page.getByRole('textbox', { name: field }),
      page.getByRole('searchbox', { name: field }),
      page.getByRole('combobox', { name: field })
    ]).catch(() => {
      throw new Error(`Couldn't find field "${field}"`)
    })
    await target.fill(step.text, { timeout: 10_000 })
    return `filled "${field}"`
  }
  if ('press' in step) {
    await page.keyboard.press(step.press)
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    return `pressed ${step.press}`
  }
  await page.waitForTimeout(Math.min(Math.max(step.wait, 0), 10) * 1000)
  return `waited ${step.wait}s`
}

/** Run approved steps in a visible window. Leaves the page open for the user and saves a screenshot. */
export async function runSteps(rawUrl: string, steps: BrowserStep[]): Promise<{ result: string; artifact: string }> {
  const url = assertHttpUrl(rawUrl)
  const c = await context(true)
  const page = await c.newPage()
  await page.bringToFront()
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const done: string[] = []
  let failure: string | null = null
  for (const step of steps) {
    try {
      done.push(await runStep(page, step))
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e)
      break
    }
  }
  const shots = join(app.getPath('userData'), 'shots')
  mkdirSync(shots, { recursive: true })
  const artifact = join(shots, `${Date.now()}.png`)
  await page.screenshot({ path: artifact }).catch(() => undefined)
  touch()
  const where = `now at "${await page.title().catch(() => '')}" (${page.url()})`
  if (failure) throw Object.assign(new Error(`${failure} after ${done.length}/${steps.length} steps; ${where}`), { artifact })
  return { result: `${done.length} step${done.length === 1 ? '' : 's'} done; ${where}`, artifact }
}

app.on('before-quit', () => {
  void closeBrowser()
})
