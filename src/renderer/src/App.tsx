import { useEffect, useState } from 'react'
import { api, subscribe, useLive } from './util'
import { Home } from './views/Home'
import { Review } from './views/Review'
import { Chat } from './views/Chat'
import { Plan } from './views/Plan'
import { Log } from './views/Log'
import { SettingsView } from './views/Settings'
import { About } from './views/About'
import { Welcome } from './views/Welcome'
import { Addons } from './views/Addons'

export type View = 'home' | 'review' | 'chat' | 'tasks' | 'about' | 'addons' | 'log' | 'settings'

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '◉' },
  { id: 'review', label: 'Review', icon: '✓' },
  { id: 'chat', label: 'Chat', icon: '✎' },
  { id: 'tasks', label: 'Goals & Tasks', icon: '☰' },
  { id: 'about', label: 'About me', icon: '☺' },
  { id: 'addons', label: 'Add-ons', icon: '⊕' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

export function App() {
  const [view, setView] = useState<View>('home')
  const { data: ov } = useLive(() => api.overview())
  const { data: settings } = useLive(() => api.getSettings())

  useEffect(() => subscribe('navigate', (v) => v && setView(v as View)), [])

  if (!settings) return null
  if (!settings.onboarded) return <Welcome onDone={(goSettings) => setView(goSettings ? 'settings' : 'home')} />

  return (
    <div className="app">
      <nav className="side">
        <div className="brand">
          <span className="logo" />
          PC Agent
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav ${view === n.id ? 'on' : ''}`} onClick={() => setView(n.id)}>
            <span className="ico">{n.icon}</span>
            {n.label}
            {n.id === 'review' && ov && ov.pending > 0 && (
              <span className={`count ${ov.pendingUrgent ? 'hot' : ''}`}>{ov.pending}</span>
            )}
          </button>
        ))}
        <div className="side-foot">
          {ov?.running ? <span className="pulse">Working…</span> : ov?.paused ? 'Paused' : 'Running'}
        </div>
      </nav>
      <main className="main">
        {view === 'home' && <Home go={setView} />}
        {view === 'review' && <Review />}
        {view === 'chat' && <Chat />}
        {view === 'tasks' && <Plan />}
        {view === 'about' && <About />}
        {view === 'addons' && <Addons />}
        {view === 'log' && <Log />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}
