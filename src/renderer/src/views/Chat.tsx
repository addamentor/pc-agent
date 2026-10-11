import { useEffect, useRef, useState } from 'react'
import { api, fmtTime, useLive } from '../util'

export function Chat() {
  const { data: messages } = useLive(() => api.chatHistory(200))
  const { data: settings } = useLive(() => api.getSettings())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length, sending])

  async function send() {
    const t = text.trim()
    if (!t || sending) return
    setText('')
    setSending(true)
    try {
      await api.sendChat(t)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page chat">
      <header className="page-head">
        <h1>Chat</h1>
        {settings && <span className="muted">{settings.chat.provider} · {settings.chat.model}</span>}
      </header>
      <div className="thread">
        {!messages?.length && (
          <div className="empty">
            Tell the agent about your goals, ask what's next, or ask it to plan something. Anything it wants to change goes to
            Review first.
          </div>
        )}
        {messages?.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="bubble">{m.text}</div>
            <div className="meta">{fmtTime(m.created_at)}</div>
          </div>
        ))}
        {sending && (
          <div className="msg agent">
            <div className="bubble pulse">…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          rows={2}
          placeholder="Message the agent (Enter to send, Shift+Enter for a new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="btn primary" disabled={sending || !text.trim()} onClick={send}>Send</button>
      </div>
    </div>
  )
}
