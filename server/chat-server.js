import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { WebSocket, WebSocketServer } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const dataDirectory = path.join(projectRoot, 'data')

const CHAT_HOST = process.env.CHAT_HOST ?? '127.0.0.1'
const CHAT_PORT = Number.parseInt(process.env.CHAT_PORT ?? '3031', 10)
const PUBLIC_ROOM = { id: 'public', name: '公共聊天室' }
const MAX_HISTORY_LIMIT = 80
const MAX_MESSAGE_LENGTH = 500
const MAX_NICKNAME_LENGTH = 24

fs.mkdirSync(dataDirectory, { recursive: true })

const database = new Database(path.join(dataDirectory, 'chat.sqlite'))
database.pragma('journal_mode = WAL')
database.pragma('foreign_keys = ON')
database.pragma('busy_timeout = 5000')

database.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    session_id TEXT,
    nickname TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_sequence ON messages(room_id, sequence);
`)

const statementInsertRoom = database.prepare(`
  INSERT INTO rooms (id, name, created_at)
  VALUES (@id, @name, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name
`)

const statementSelectRoom = database.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM rooms
  WHERE id = ?
`)

const statementUpsertSession = database.prepare(`
  INSERT INTO sessions (id, nickname, created_at, updated_at)
  VALUES (@id, @nickname, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    nickname = excluded.nickname,
    updated_at = excluded.updated_at
`)

const statementInsertMessage = database.prepare(`
  INSERT INTO messages (id, room_id, session_id, nickname, kind, body, created_at)
  VALUES (@id, @roomId, @sessionId, @nickname, @kind, @body, @createdAt)
`)

const statementSelectMessagesSince = database.prepare(`
  SELECT
    sequence,
    id,
    room_id AS roomId,
    session_id AS sessionId,
    nickname,
    kind,
    body,
    created_at AS createdAt
  FROM messages
  WHERE room_id = ? AND kind != 'system' AND sequence > ?
  ORDER BY sequence ASC
  LIMIT ?
`)

const statementSelectRecentMessages = database.prepare(`
  SELECT
    sequence,
    id,
    room_id AS roomId,
    session_id AS sessionId,
    nickname,
    kind,
    body,
    created_at AS createdAt
  FROM (
    SELECT
      sequence,
      id,
      room_id,
      session_id,
      nickname,
      kind,
      body,
      created_at
    FROM messages
    WHERE room_id = ? AND kind != 'system'
    ORDER BY sequence DESC
    LIMIT ?
  )
  ORDER BY sequence ASC
`)

statementInsertRoom.run({
  id: PUBLIC_ROOM.id,
  name: PUBLIC_ROOM.name,
  createdAt: Date.now(),
})

const roomConnections = new Map()

function createRoomConnectionMap(roomId) {
  let connections = roomConnections.get(roomId)

  if (!connections) {
    connections = new Map()
    roomConnections.set(roomId, connections)
  }

  return connections
}

function sanitiseNickname(value) {
  const nickname = String(value ?? '').replace(/\s+/g, ' ').trim()
  return nickname.slice(0, MAX_NICKNAME_LENGTH)
}

function sanitiseMessageBody(value) {
  const body = String(value ?? '').trim()
  return body.slice(0, MAX_MESSAGE_LENGTH)
}

function normaliseSequence(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function serialiseMessage(row) {
  return {
    body: row.body,
    createdAt: row.createdAt,
    id: row.id,
    kind: row.kind,
    nickname: row.nickname,
    roomId: row.roomId,
    sequence: row.sequence,
    sessionId: row.sessionId ?? null,
  }
}

function getHistory(roomId, afterSequence = 0) {
  if (afterSequence > 0) {
    return statementSelectMessagesSince
      .all(roomId, afterSequence, MAX_HISTORY_LIMIT)
      .map(serialiseMessage)
  }

  return statementSelectRecentMessages.all(roomId, MAX_HISTORY_LIMIT).map(serialiseMessage)
}

function persistSession(sessionId, nickname) {
  const now = Date.now()

  statementUpsertSession.run({
    id: sessionId,
    nickname,
    createdAt: now,
    updatedAt: now,
  })
}

function persistMessage({ roomId, sessionId = null, nickname, kind, body }) {
  const messageId = crypto.randomUUID()
  const createdAt = Date.now()

  const result = statementInsertMessage.run({
    id: messageId,
    roomId,
    sessionId,
    nickname,
    kind,
    body,
    createdAt,
  })

  return {
    body,
    createdAt,
    id: messageId,
    kind,
    nickname,
    roomId,
    sequence: Number(result.lastInsertRowid),
    sessionId,
  }
}

function getRoomMembers(roomId) {
  const roomSessions = createRoomConnectionMap(roomId)

  return [...roomSessions.values()]
    .sort((left, right) => left.connectedAt - right.connectedAt || left.nickname.localeCompare(right.nickname, 'zh-Hans-CN'))
    .map((member) => ({
      connectedAt: member.connectedAt,
      nickname: member.nickname,
      roomId,
      sessionId: member.sessionId,
    }))
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }

  socket.send(JSON.stringify(payload))
}

function broadcastToRoom(roomId, payload) {
  const roomSessions = createRoomConnectionMap(roomId)

  for (const member of roomSessions.values()) {
    sendJson(member.socket, payload)
  }
}

function broadcastPresence(roomId) {
  broadcastToRoom(roomId, {
    members: getRoomMembers(roomId),
    roomId,
    type: 'presence',
  })
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw.toString())
  } catch {
    return null
  }
}

function resolveLanAddresses(port) {
  const interfaces = os.networkInterfaces()
  const urls = []

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue
    }

    for (const address of addresses) {
      if (address.family !== 'IPv4' || address.internal) {
        continue
      }

      urls.push(`http://${address.address}:${port}`)
    }
  }

  return urls
}

function closeExistingSession(roomId, sessionId, nextSocket) {
  const roomSessions = createRoomConnectionMap(roomId)
  const existing = roomSessions.get(sessionId)

  if (!existing || existing.socket === nextSocket) {
    return
  }

  sendJson(existing.socket, {
    message: '该昵称会话已在另一处重新连接，当前连接将关闭。',
    type: 'error',
  })
  existing.socket.close(4001, 'Session replaced')
}

function attachSessionToRoom(state, socket, payload) {
  const nickname = sanitiseNickname(payload.nickname)
  const sessionId = String(payload.sessionId ?? '').trim()
  const roomId = payload.roomId === PUBLIC_ROOM.id ? PUBLIC_ROOM.id : PUBLIC_ROOM.id

  if (nickname === '' || sessionId === '') {
    sendJson(socket, {
      message: '加入聊天室前需要提供昵称和会话标识。',
      type: 'error',
    })
    return
  }

  const room = statementSelectRoom.get(roomId)

  if (!room) {
    sendJson(socket, {
      message: '目标聊天室不存在。',
      type: 'error',
    })
    return
  }

  persistSession(sessionId, nickname)
  closeExistingSession(roomId, sessionId, socket)

  const roomSessions = createRoomConnectionMap(roomId)
  roomSessions.set(sessionId, {
    connectedAt: Date.now(),
    nickname,
    roomId,
    sessionId,
    socket,
  })

  state.joined = true
  state.nickname = nickname
  state.roomId = roomId
  state.sessionId = sessionId

  sendJson(socket, {
    members: getRoomMembers(roomId),
    messages: getHistory(roomId, normaliseSequence(payload.afterSequence)),
    room: {
      id: room.id,
      name: room.name,
    },
    sessionId,
    type: 'joined',
  })

  broadcastPresence(roomId)
}

function handleChatMessage(state, socket, payload) {
  if (!state.joined) {
    sendJson(socket, {
      message: '请先加入聊天室。',
      type: 'error',
    })
    return
  }

  const body = sanitiseMessageBody(payload.body)

  if (body === '') {
    sendJson(socket, {
      message: '消息不能为空。',
      type: 'error',
    })
    return
  }

  const message = persistMessage({
    body,
    kind: 'user',
    nickname: state.nickname,
    roomId: state.roomId,
    sessionId: state.sessionId,
  })

  broadcastToRoom(state.roomId, {
    message,
    type: 'message',
  })
}

function handleDisconnect(state, socket) {
  if (!state.joined || state.roomId === '' || state.sessionId === '') {
    return
  }

  const roomSessions = createRoomConnectionMap(state.roomId)
  const activeMember = roomSessions.get(state.sessionId)

  if (!activeMember || activeMember.socket !== socket) {
    return
  }

  roomSessions.delete(state.sessionId)

  if (roomSessions.size === 0) {
    roomConnections.delete(state.roomId)
  }

  broadcastPresence(state.roomId)
}

const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        endpoints: {
          health: '/health',
          websocket: '/ws',
        },
        message: '聊天室服务正在运行。请通过前端页面访问聊天室，或用 /health 检查服务状态。',
        ok: true,
        roomId: PUBLIC_ROOM.id,
      }),
    )
    return
  }

  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(
      JSON.stringify({
        ok: true,
        roomCount: roomConnections.size,
        roomId: PUBLIC_ROOM.id,
      }),
    )
    return
  }

  response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ ok: false, message: 'Not found' }))
})

const websocketServer = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy()
    return
  }

  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit('connection', websocket, request)
  })
})

websocketServer.on('connection', (socket) => {
  const state = {
    joined: false,
    nickname: '',
    roomId: '',
    sessionId: '',
  }

  socket.on('message', (raw) => {
    const payload = safeParseJson(raw)

    if (!payload || typeof payload.type !== 'string') {
      sendJson(socket, {
        message: '无法识别的消息格式。',
        type: 'error',
      })
      return
    }

    if (payload.type === 'join') {
      attachSessionToRoom(state, socket, payload)
      return
    }

    if (payload.type === 'send_message') {
      handleChatMessage(state, socket, payload)
      return
    }

    sendJson(socket, {
      message: `暂不支持的事件类型：${payload.type}`,
      type: 'error',
    })
  })

  socket.on('close', () => {
    handleDisconnect(state, socket)
  })

  socket.on('error', () => {
    handleDisconnect(state, socket)
  })
})

server.listen(CHAT_PORT, CHAT_HOST, () => {
  const origin = CHAT_HOST === '0.0.0.0' ? 'localhost' : CHAT_HOST

  console.log(`聊天室服务已启动: http://${origin}:${CHAT_PORT}`)

  if (CHAT_HOST === '0.0.0.0') {
    const lanAddresses = resolveLanAddresses(CHAT_PORT)

    if (lanAddresses.length > 0) {
      console.log('局域网访问地址:')
      for (const address of lanAddresses) {
        console.log(`- ${address}`)
      }
    }
  }
})
