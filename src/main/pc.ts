import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { getSettings } from './settings'

/**
 * PC access. Everything that changes something (commands, opening apps, file
 * writes) is only reached through an approved proposal. The one thing the agent
 * may do on its own is read files inside folders the user explicitly allowed.
 */

export function absPath(p: string): string {
  const expanded = p.replace(/^~(?=[\\/]|$)/, homedir()).replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`)
  if (!isAbsolute(expanded)) throw new Error(`Use a full path (e.g. C:\\Users\\...): ${p}`)
  return normalize(expanded)
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function allowedToRead(p: string): boolean {
  return getSettings().pc.readFolders.some((f) => isInside(p, f))
}

// ---------- commands ----------

/** Patterns that make a command worth an extra warning in the review queue. */
const RISKY = /\b(remove-item|rm|rmdir|del|erase|format|diskpart|reg\s+(add|delete)|set-itemproperty|shutdown|restart-computer|stop-computer|bcdedit|cipher|takeown|icacls|net\s+user|schtasks|invoke-webrequest|iwr|curl|wget|start-bitstransfer)\b|>\s*[a-z]:\\/i

export const isRiskyCommand = (cmd: string): boolean => RISKY.test(cmd)

/** Run a PowerShell command, hidden, with a timeout. Output is clipped for the log and the model. */
export function runCommand(cmd: string, cwd?: string): Promise<string> {
  const { commandTimeoutSec } = getSettings().pc
  const dir = cwd ? absPath(cwd) : homedir()
  if (!existsSync(dir)) return Promise.reject(new Error(`Folder not found: ${dir}`))
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      cwd: dir,
      windowsHide: true
    })
    let out = ''
    const add = (b: Buffer) => {
      if (out.length < 20_000) out += b.toString()
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out after ${commandTimeoutSec}s. Output so far: ${clip(out)}`))
    }, commandTimeoutSec * 1000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = clip(out.trim()) || '(no output)'
      if (code === 0) resolvePromise(`exit 0\n${text}`)
      else reject(new Error(`exit ${code}\n${text}`))
    })
  })
}

const clip = (s: string, n = 1500) => (s.length > n ? s.slice(0, n) + ' …[cut]' : s)

// ---------- opening things ----------

/** Open a file/folder with its default app, or launch an app by name (e.g. "notepad", "code"). */
export async function openTarget(target: string): Promise<string> {
  const looksLikePath = /^[a-z]:[\\/]|^~|^%|^\\\\/i.test(target)
  if (looksLikePath) {
    const p = absPath(target)
    if (!existsSync(p)) throw new Error(`Not found: ${p}`)
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
    return `Opened ${p}`
  }
  if (!/^[\w.\- ]+$/.test(target)) throw new Error(`Not a simple app name: ${target}`)
  // `start` resolves App Paths (e.g. "chrome", "winword") the same way the Run dialog does.
  await new Promise<void>((ok, fail) => {
    // target is restricted to [\w.\- ] above, so it is safe to place inside the quoted command line.
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${target}"`], { windowsHide: true, windowsVerbatimArguments: true })
    child.on('error', fail)
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`Couldn't start "${target}"`))))
  })
  return `Started ${target}`
}

// ---------- reading (no approval, allowed folders only) ----------

const TEXT_EXT = new Set([
  '.txt', '.md', '.json', '.csv', '.log', '.ini', '.yml', '.yaml', '.toml', '.xml', '.html', '.css',
  '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.go', '.rs', '.cs', '.php', '.rb',
  '.sql', '.sh', '.ps1', '.bat', '.env.example'
])

/** Read a file or list a folder as compact text for the model. */
export async function readLocal(raw: string, maxChars: number): Promise<string> {
  const p = absPath(raw)
  if (!allowedToRead(p)) throw new Error(`Not in an allowed folder (Settings → PC access): ${p}`)
  if (/[\\/]\.env($|\.)|id_rsa|\.pem$|\.key$|\.pfx$/i.test(p) && !p.endsWith('.env.example')) {
    throw new Error('Refusing to read files that usually hold secrets')
  }
  const st = await stat(p)
  if (st.isDirectory()) {
    const entries = await readdir(p, { withFileTypes: true })
    const shown = entries.slice(0, 100)
    const lines = await Promise.all(
      shown.map(async (e) => {
        if (e.isDirectory()) return `${e.name}/`
        const s = await stat(join(p, e.name)).catch(() => null)
        return `${e.name}${s ? ` (${Math.ceil(s.size / 1024)} KB)` : ''}`
      })
    )
    return `FOLDER ${p}\n${lines.join('\n')}${entries.length > 100 ? `\n…and ${entries.length - 100} more` : ''}`
  }
  if (!TEXT_EXT.has(extname(p).toLowerCase())) return `FILE ${p} (${Math.ceil(st.size / 1024)} KB, not a text file; not read)`
  if (st.size > 2_000_000) return `FILE ${p} (${Math.ceil(st.size / 1024)} KB, too large to read)`
  const text = await readFile(p, 'utf8')
  return `FILE ${p}\n${text.length > maxChars ? text.slice(0, maxChars) + ' …[cut]' : text}`
}
