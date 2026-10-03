import type { ApiErrorBody, ChatStreamEvent } from './types'

const BASE = '/api/v1'
const TOKEN_KEY = 'fc.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** JSON fetch wrapper: attaches JWT, normalizes backend error shape. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  if (response.status === 401 && !path.startsWith('/auth')) {
    setToken(null)
    window.location.assign('/login')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const err = body as ApiErrorBody | null
    throw new ApiError(
      err?.error?.code ?? 'unknown',
      err?.error?.message ?? `Request failed (${response.status})`,
      response.status,
    )
  }
  return body as T
}

export async function* streamChat(
  payload: { question: string; conversationId?: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const token = getToken()
  const response = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(
      body?.error?.code ?? 'stream_failed',
      body?.error?.message ?? `Stream failed (${response.status})`,
      response.status,
    )
  }

  // Parse SSE frames ("data: {...}\n\n") from the byte stream.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice('data: '.length)) as ChatStreamEvent
      } catch {
        // ignore malformed frame
      }
    }
  }
}
