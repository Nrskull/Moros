export interface SealDiceLogItem {
  GroupID?: string
  IMUserId?: string
  channel?: string
  commandId?: number
  commandInfo?: Record<string, unknown> | null
  id?: number | string
  isDice?: boolean
  message?: string
  nickname?: string
  rawMsgId?: string | null
  time?: number
  uniformId?: string
  [key: string]: unknown
}

export interface SealDiceStandardLog {
  items: SealDiceLogItem[]
  version?: number
  [key: string]: unknown
}

export interface EditableLogEntry {
  entryId: string
  hasCqImage: boolean
  hasSticker: boolean
  isOoc: boolean
  isDice: boolean
  keep: boolean
  message: string
  nickname: string
  sourceNickname: string
  sourceIndex: number
  speakerKey: string
  time: number
}

export const DEFAULT_NICKNAME = '未命名角色'
export const DEFAULT_MESSAGE = ''
export const CHARACTER_COLOR_POOL = [
  '#8ca0b3',
  '#7ea3a1',
  '#a497c3',
  '#a7b48a',
  '#b198b3',
  '#8898a8',
  '#8ba8c0',
  '#9eb3a4',
]

export function isSealDiceStandardLog(value: unknown): value is SealDiceStandardLog {
  return typeof value === 'object' && value !== null && Array.isArray((value as SealDiceStandardLog).items)
}

export function normaliseLogNickname(value: string): string {
  const trimmed = value.trim()
  return trimmed === '' ? DEFAULT_NICKNAME : trimmed
}

export function stripReplyPrefixFromLogMessage(message: string): string {
  return message.replace(/^(?:\s*\[CQ:reply,[^\]]*\]\s*)+/i, '')
}

export function detectOocMessage(message: string): boolean {
  const text = message.trim()

  if (text.length < 2) {
    return false
  }

  return (
    (text.startsWith('（') && text.endsWith('）')) ||
    (text.startsWith('(') && text.endsWith(')'))
  )
}

export function detectCqImageMessage(message: string): boolean {
  return /\[CQ:image[^\]]*\]/i.test(message)
}

export function detectStickerPlaceholderMessage(message: string): boolean {
  return /^\[表情:[^\]]+\]$/u.test(message.trim())
}

export function createSpeakerKey(item: SealDiceLogItem, fallbackNickname: string, index: number): string {
  const uniformId = typeof item.uniformId === 'string' ? item.uniformId.trim() : ''
  if (uniformId !== '') {
    return `uniform:${uniformId}`
  }

  const imUserId = typeof item.IMUserId === 'string' ? item.IMUserId.trim() : ''
  if (imUserId !== '') {
    return `im:${imUserId}`
  }

  const rawNickname = typeof item.nickname === 'string' ? item.nickname.trim() : ''
  if (rawNickname !== '') {
    return `nickname:${rawNickname}`
  }

  return `fallback:${fallbackNickname}:${index}`
}

export function parseSealDiceStandardLog(text: string): {
  entries: EditableLogEntry[]
  source: SealDiceStandardLog
} {
  const parsed = JSON.parse(text) as unknown

  if (!isSealDiceStandardLog(parsed)) {
    throw new Error('日志文件格式不正确，缺少 items 数组。')
  }

  return {
    source: parsed,
    entries: parsed.items.map((item, index) => {
      const rawMessage = typeof item.message === 'string' ? item.message : DEFAULT_MESSAGE
      const message = stripReplyPrefixFromLogMessage(rawMessage)
      const nickname =
        typeof item.nickname === 'string' ? normaliseLogNickname(item.nickname) : DEFAULT_NICKNAME
      const isOoc = detectOocMessage(message)
      const hasCqImage = detectCqImageMessage(message)
      const hasSticker = detectStickerPlaceholderMessage(message)

      return {
        entryId: String(item.id ?? `entry_${index}`),
        hasCqImage,
        hasSticker,
        isDice: item.isDice ?? false,
        isOoc,
        keep: !isOoc && !hasCqImage && !hasSticker,
        message,
        nickname,
        sourceIndex: index,
        sourceNickname: nickname,
        speakerKey: createSpeakerKey(item, nickname, index),
        time: typeof item.time === 'number' ? item.time : 0,
      }
    }),
  }
}

export function serialiseSealDiceStandardLog(
  source: SealDiceStandardLog,
  entries: EditableLogEntry[],
): SealDiceStandardLog {
  const keptEntries = entries.filter((entry) => entry.keep)
  const entryMap = new Map(keptEntries.map((entry) => [entry.sourceIndex, entry]))

  return {
    ...source,
    items: source.items.flatMap((item, index) => {
      const entry = entryMap.get(index)

      if (!entry) {
        return []
      }

      return [{
        ...item,
        isDice: entry.isDice,
        message: entry.message,
        nickname: entry.nickname,
        time: entry.time,
      }]
    }),
  }
}

export function formatLogTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '未设置时间'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp * 1000))
}

export function toDatetimeLocalValue(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return ''
  }

  const date = new Date(timestamp * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function parseDatetimeLocalValue(value: string, fallback: number): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback
}

export function createEditedLogFilename(filename: string): string {
  const trimmed = filename.trim()

  if (trimmed === '') {
    return 'log-edited.json'
  }

  const dotIndex = trimmed.lastIndexOf('.')

  if (dotIndex === -1) {
    return `${trimmed}-edited.json`
  }

  return `${trimmed.slice(0, dotIndex)}-edited${trimmed.slice(dotIndex)}`
}

export function ensureCharacterColors(
  names: string[],
  current: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {}
  let colorIndex = 0

  for (const name of names) {
    const safeName = normaliseLogNickname(name)
    next[safeName] = current[safeName] ?? CHARACTER_COLOR_POOL[colorIndex % CHARACTER_COLOR_POOL.length]
    colorIndex += 1
  }

  return next
}
