import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, streamChat } from '../api'
import type { Citation, AiInfo } from '../types'
import { ErrorState } from '../components/States'

interface AssistantMessage {
  id: number
  kind: 'assistant'
  answer: string
  confidence: number | null
  citations: Citation[]
  ai: AiInfo
  streamingRaw?: string
  pending?: boolean
}

interface UserMessage {
  id: number
  kind: 'user'
  text: string
}

type Message = UserMessage | AssistantMessage

const LOW_CONFIDENCE = 0.3
let nextId = 1

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    return () => abortRef.current?.abort()
  }, [messages])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setStreamError(null)
    setLastQuestion(trimmed)
    setInput('')

    const userMsg: UserMessage = { id: nextId++, kind: 'user', text: trimmed }
    const assistantMsg: AssistantMessage = {
      id: nextId++,
      kind: 'assistant',
      answer: '',
      confidence: null,
      citations: [],
      ai: { modelId: '', promptVersion: '', retrievedChunkIds: [], confidence: null, promptTokens: 0, completionTokens: 0, latencyMs: 0 },
      streamingRaw: '',
      pending: true,
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const event of streamChat({ question: trimmed, conversationId }, controller.signal)) {
        if (event.type === 'status') {
          // "thinking" state is implied by pending + empty raw buffer
        } else if (event.type === 'delta') {
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === 'assistant' && m.id === assistantMsg.id
                ? { ...m, streamingRaw: (m.streamingRaw ?? '') + event.text }
                : m,
            ),
          )
        } else if (event.type === 'done') {
          setConversationId(event.conversationId)
          setMessages((prev) =>
            prev.map((m) =>
              m.kind === 'assistant' && m.id === assistantMsg.id
                ? {
                    ...m,
                    answer: event.output.answer,
                    confidence: event.output.confidence,
                    citations: event.output.citations,
                    ai: event.output.ai,
                    streamingRaw: undefined,
                    pending: false,
                  }
                : m,
            ),
          )
        } else if (event.type === 'error') {
          setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id))
          setStreamError(event.message)
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id))
        setStreamError(err instanceof ApiError ? err.message : 'Connection lost while streaming')
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void ask(input)
  }

  return (
    <div className="page chat-page">
      <h1>Document Assistant</h1>

      {messages.length === 0 && !busy && (
        <div className="card empty-chat">
          <p className="empty-title">Ask a question about your uploaded documents</p>
          <p className="empty-hint">
            Answers are grounded in your documents and include citations. If nothing relevant is
            found, the assistant will tell you instead of guessing.
          </p>
        </div>
      )}

      <div className="chat-log">
        {messages.map((m) =>
          m.kind === 'user' ? (
            <div key={m.id} className="msg msg-user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="msg msg-assistant">
              <div className="bubble">
                {m.pending && !m.streamingRaw && (
                  <span className="thinking" role="status">
                    <span className="spinner" aria-hidden="true" /> thinking…
                  </span>
                )}
                {m.pending && m.streamingRaw && (
                  <pre className="stream-raw">{m.streamingRaw}</pre>
                )}
                {!m.pending && (
                  <>
                    {m.confidence !== null && m.confidence < LOW_CONFIDENCE && (
                      <div className="low-confidence" role="note">
                        ⚠️ Low confidence ({(m.confidence * 100).toFixed(0)}%) — this answer may not
                        be grounded in your documents. Verify before relying on it.
                      </div>
                    )}
                    <p className="answer">{m.answer}</p>
                    {m.citations.length > 0 && (
                      <details className="citations">
                        <summary>Sources ({m.citations.length})</summary>
                        <ul>
                          {m.citations.map((c, i) => (
                            <li key={`${c.chunkId}-${i}`}>
                              <code>{c.chunkId.slice(0, 8)}</code>
                              <blockquote>{c.quote}</blockquote>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="meta">
                      <span title="Model used">model: {m.ai.modelId || '—'}</span>
                      <span title="Prompt template version">prompt: {m.ai.promptVersion || '—'}</span>
                      <span title="Token usage">
                        tokens: {m.ai.promptTokens}+{m.ai.completionTokens}
                      </span>
                      <span title="End-to-end latency">{m.ai.latencyMs} ms</span>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => lastQuestion && void ask(lastQuestion)}
                        disabled={busy || !lastQuestion}
                        title="Send the same question again"
                      >
                        ↻ Re-ask
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => setInput(`${lastQuestion ?? ''} — more specifically: `)}
                        disabled={busy}
                        title="Refine the question"
                      >
                        ✎ Refine
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {streamError && <ErrorState message={streamError} onRetry={() => lastQuestion && void ask(lastQuestion)} />}

      <form onSubmit={handleSubmit} className="chat-input card">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your documents…"
          maxLength={4000}
          disabled={busy}
          aria-label="Question"
        />
        <button type="submit" className="btn primary" disabled={busy || input.trim().length === 0}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  )
}
