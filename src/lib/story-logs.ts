import { buildChatHttpUrl } from './chat-room'
import type { EditableLogEntry, SealDiceStandardLog } from './log-workbench'

export interface StoredLogRecord {
  characterColors: Record<string, string>
  characterVisibility: Record<string, boolean>
  createdAt: number
  entries: EditableLogEntry[]
  id: string
  primaryCharacter: string
  sequenceNumber: number
  sourceFilename: string
  sourceLabel: string
  sourceLog: SealDiceStandardLog
  title: string
  updatedAt: number
  worldview: string
}

interface StoryLogResponse {
  message?: string
  ok: boolean
  record?: StoredLogRecord
  records?: StoredLogRecord[]
}

async function requestStoryLogApi(pathname: string, init?: RequestInit): Promise<StoryLogResponse> {
  const headers = new Headers(init?.headers ?? {})

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(buildChatHttpUrl(pathname), {
    ...init,
    credentials: 'include',
    headers,
  })

  let payload: StoryLogResponse = { ok: response.ok }

  try {
    payload = (await response.json()) as StoryLogResponse
  } catch {
    payload = {
      message: '故事日志服务返回了无法解析的响应。',
      ok: false,
    }
  }

  return {
    ...payload,
    ok: response.ok && payload.ok !== false,
  }
}

export async function fetchStoryLogRecords(): Promise<StoredLogRecord[]> {
  const payload = await requestStoryLogApi('/story-logs', { method: 'GET' })

  if (!payload.ok) {
    throw new Error(payload.message ?? '故事日志读取失败。')
  }

  return payload.records ?? []
}

export async function createStoryLogRecord(record: StoredLogRecord): Promise<StoredLogRecord> {
  const payload = await requestStoryLogApi('/story-logs', {
    body: JSON.stringify({ record }),
    method: 'POST',
  })

  if (!payload.ok || !payload.record) {
    throw new Error(payload.message ?? '故事日志上传失败。')
  }

  return payload.record
}

export async function updateStoryLogRecord(record: StoredLogRecord): Promise<StoredLogRecord> {
  const payload = await requestStoryLogApi(`/story-logs/${encodeURIComponent(record.id)}`, {
    body: JSON.stringify({ record }),
    method: 'PUT',
  })

  if (!payload.ok || !payload.record) {
    throw new Error(payload.message ?? '故事日志保存失败。')
  }

  return payload.record
}

export async function deleteStoryLogRecord(recordId: string): Promise<void> {
  const payload = await requestStoryLogApi(`/story-logs/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  })

  if (!payload.ok) {
    throw new Error(payload.message ?? '故事日志删除失败。')
  }
}
