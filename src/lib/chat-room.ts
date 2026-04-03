export const CHAT_MAX_MESSAGE_LENGTH = 500
export const CHAT_NICKNAME_MAX_LENGTH = 24
export const CHAT_STORAGE_SESSION_KEY = 'timeline-chat-session-id'
export const CHAT_STORAGE_NICKNAME_KEY = 'timeline-chat-nickname'
export const DEFAULT_CHAT_PORT = '3031'
export const PUBLIC_CHAT_ROOM_ID = 'public'

export type ChatMessageKind = 'system' | 'user'
export type ChatConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export interface ChatMessage {
  body: string
  createdAt: number
  id: string
  kind: ChatMessageKind
  nickname: string
  roomId: string
  sequence: number
  sessionId: string | null
}

export interface ChatMember {
  connectedAt: number
  nickname: string
  roomId: string
  sessionId: string
}

export function buildChatWebSocketUrl(): string {
  const explicitUrl = import.meta.env.VITE_CHAT_WS_URL?.trim()

  if (explicitUrl) {
    return explicitUrl
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname
  if (import.meta.env.DEV) {
      const port = import.meta.env.VITE_CHAT_PORT?.trim() || DEFAULT_CHAT_PORT
      return `${protocol}://${host}:${port}/ws`
    }
  return `${protocol}://${host}/ws`
}

export function createChatSessionId(): string {
  const cryptoObject = globalThis.crypto

  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID()
  }

  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint8Array(16)
    cryptoObject.getRandomValues(bytes)

    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80

    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export function formatChatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}
