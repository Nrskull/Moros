export const CHAT_MAX_MESSAGE_LENGTH = 1000
export const CHAT_NICKNAME_MAX_LENGTH = 24
export const CHAT_ROOM_NAME_MAX_LENGTH = 32
export const CHAT_CHARACTER_NAME_MAX_LENGTH = 32
export const CHAT_STORAGE_SESSION_KEY = 'timeline-chat-session-id'
export const CHAT_STORAGE_NICKNAME_KEY = 'timeline-chat-nickname'
export const CHAT_STORAGE_ROOM_KEY = 'timeline-chat-room-id'
export const DEFAULT_CHAT_PORT = '3031'
export const PUBLIC_CHAT_ROOM_ID = 'public'

export type ChatMessageKind = 'system' | 'user' | 'dice'
export type ChatConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
export type ChatPresentationMode = 'bubble' | 'kp-narration'

export interface ChatUser {
  displayName: string
  handle: string
  id: string
  role: string
  status: string
}

export interface ChatCharacterAttributes {
  appearance: number
  constitution: number
  dexterity: number
  education: number
  intelligence: number
  luck: number
  size: number
  strength: number
  willpower: number
}

export interface ChatCharacterCard {
  attributes: ChatCharacterAttributes
  avatarDataUrl: string | null
  color: string
  id: string
  isDefault: boolean
  name: string
  presentationMode: ChatPresentationMode
  status: string
  userId?: string | null
  worldview: string
}

export interface ChatMessage {
  body: string
  createdAt: number
  deletedAt: number | null
  deletedByUserId: string | null
  id: string
  kind: ChatMessageKind
  nickname: string
  replyToBody: string | null
  replyToMessageId: string | null
  replyToSpeakerName: string | null
  roomId: string
  sequence: number
  sessionId: string | null
  userId: string | null
  speakerAvatarDataUrl: string | null
  speakerCharacterId: string | null
  speakerDisplayMode: ChatPresentationMode
  speakerName: string
}

export interface ChatMember {
  connectedAt: number
  nickname: string
  roomId: string
  sessionId: string
}

export interface ChatRoom {
  createdAt: number
  id: string
  latestMessageAt: number | null
  memberCount: number
  name: string
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

export function buildChatHttpUrl(pathname: string): string {
  const safePathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  const apiPathname = safePathname.startsWith('/api/') ? safePathname : `/api${safePathname}`
  const explicitBase = import.meta.env.VITE_CHAT_HTTP_URL?.trim()

  if (explicitBase) {
    const normalizedBase = explicitBase.replace(/\/+$/, '')
    const requestPath = /\/api$/i.test(normalizedBase) ? safePathname : apiPathname
    return `${normalizedBase}${requestPath}`
  }

  const protocol = window.location.protocol
  const host = window.location.hostname

  if (import.meta.env.DEV) {
    const port = import.meta.env.VITE_CHAT_PORT?.trim() || DEFAULT_CHAT_PORT
    return `${protocol}//${host}:${port}${apiPathname}`
  }

  return `${window.location.origin}${apiPathname}`
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
