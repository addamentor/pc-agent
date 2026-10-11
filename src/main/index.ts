import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'node:path'
import { getWakePlan, runWake } from './agent'
import { openDb } from './db'
import { initAddons } from './addons'
import { bus } from './events'
import { applyLoginItem, registerIpc } from './ipc'
import { setNotificationHandler } from './notify'
import { startScheduler } from './scheduler'
import { getSettings, saveSettings } from './settings'
import { listProposals } from './store'

const APP_ID = 'com.hsntechlabs.pcagent'
const resources = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked', 'resources') : join(__dirname, '../../resources')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(boot)
}

function boot(): void {
  app.setAppUserModelId(APP_ID) // required for Windows toasts
  openDb()
  initAddons()
  registerIpc()
  applyLoginItem(getSettings().openAtLogin)
  setNotificationHandler((view) => showWindow(view))
  createTray()
  if (!process.argv.includes('--hidden')) showWindow()
  bus.on('changed', onChanged)
  startScheduler()
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'PC Agent',
    icon: join(resources, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  // Closing hides to the tray; the agent keeps running.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

function showWindow(view?: string): void {
  if (!win || win.isDestroyed()) win = createWindow()
  const w = win
  const reveal = () => {
    if (view) w.webContents.send('push:navigate', view)
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', reveal)
  else reveal()
}

function trayImage(alert: boolean) {
  return nativeImage.createFromPath(join(resources, alert ? 'tray-alert.png' : 'tray.png')).resize({ width: 16, height: 16 })
}

function createTray(): void {
  tray = new Tray(trayImage(false))
  tray.on('click', () => showWindow())
  refreshTray()
}

function refreshTray(): void {
  if (!tray) return
  const pending = listProposals('pending').length
  const { paused } = getSettings()
  const plan = getWakePlan()
  const next = plan.at ? new Date(plan.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
  tray.setImage(trayImage(pending > 0))
  tray.setToolTip(`PC Agent${paused ? ' (paused)' : ''}\n${pending} to review · next check ${next}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open PC Agent', click: () => showWindow() },
      { label: `Review queue (${pending})`, click: () => showWindow('review') },
      { label: 'Chat', click: () => showWindow('chat') },
      { type: 'separator' },
      { label: 'Check in now', click: () => void runWake('manual') },
      {
        label: paused ? 'Resume agent' : 'Pause agent',
        click: () => {
          saveSettings({ paused: !paused })
          onChanged()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

let pushPending = false
function onChanged(): void {
  // Coalesce bursts of changes into one UI refresh.
  if (pushPending) return
  pushPending = true
  setTimeout(() => {
    pushPending = false
    refreshTray()
    if (win && !win.isDestroyed()) win.webContents.send('push:changed')
  }, 150)
}

app.on('before-quit', () => {
  quitting = true
})
// Keep running in the tray with no windows open.
app.on('window-all-closed', () => undefined)
