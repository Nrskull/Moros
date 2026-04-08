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
const ADMIN_USER = {
  displayName: '管理员',
  handle: 'admin',
  id: 'user_admin',
  role: 'admin',
  status: 'active',
}
const AUTH_COOKIE_NAME = 'timeline_chat_auth'
const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const AUTH_SESSION_RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7
const AUTH_MAX_ACCESS_KEY_LENGTH = 128
const AUTH_RATE_LIMIT_WINDOW_MS = 1000 * 60 * 10
const AUTH_RATE_LIMIT_BLOCK_MS = 1000 * 60 * 15
const AUTH_RATE_LIMIT_MAX_FAILURES = 6
const ADMIN_ACCESS_KEY_FILE = path.join(dataDirectory, 'admin-access-key.txt')
const ADMIN_ACCESS_KEY_ENV = String(process.env.CHAT_ADMIN_ACCESS_KEY ?? '').trim()
const MAX_HISTORY_LIMIT = 80
const MAX_MESSAGE_LENGTH = 500
const MAX_NICKNAME_LENGTH = 24
const MAX_ROOM_NAME_LENGTH = 32
const MAX_CHARACTER_NAME_LENGTH = 32
const MAX_ATTRIBUTE_VALUE = 100

const ATTRIBUTE_DEFINITIONS = [
  { key: 'strength', label: '力量' },
  { key: 'dexterity', label: '敏捷' },
  { key: 'intelligence', label: '智力' },
  { key: 'luck', label: '幸运' },
  { key: 'size', label: '体型' },
  { key: 'constitution', label: '体质' },
  { key: 'education', label: '教育' },
  { key: 'appearance', label: '外貌' },
  { key: 'willpower', label: '意志' },
]

const ATTRIBUTE_LABEL_TO_KEY = new Map(
  ATTRIBUTE_DEFINITIONS.map((entry) => [entry.label, entry.key]),
)

fs.mkdirSync(dataDirectory, { recursive: true })

const database = new Database(path.join(dataDirectory, 'chat.sqlite'))
database.pragma('journal_mode = WAL')
database.pragma('foreign_keys = ON')
database.pragma('busy_timeout = 5000')

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    expires_at INTEGER,
    last_used_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_access_keys_user_id ON access_keys(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    user_id TEXT,
    active_character_id TEXT,
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

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_key_id TEXT,
    session_token_hash TEXT NOT NULL UNIQUE,
    client_name TEXT,
    client_ip TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (access_key_id) REFERENCES access_keys(id)
  );

  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS character_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    is_default INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_character_cards_user_id ON character_cards(user_id);

  CREATE TABLE IF NOT EXISTS character_attributes (
    character_id TEXT PRIMARY KEY,
    strength INTEGER NOT NULL,
    dexterity INTEGER NOT NULL,
    intelligence INTEGER NOT NULL,
    luck INTEGER NOT NULL,
    size INTEGER NOT NULL,
    constitution INTEGER NOT NULL,
    education INTEGER NOT NULL,
    appearance INTEGER NOT NULL,
    willpower INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (character_id) REFERENCES character_cards(id) ON DELETE CASCADE
  );
`)

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all()

  if (columns.some((column) => column.name === columnName)) {
    return
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`)
}

ensureColumn('sessions', 'user_id', 'user_id TEXT')
ensureColumn('sessions', 'active_character_id', 'active_character_id TEXT')

const statementInsertRoom = database.prepare(`
  INSERT INTO rooms (id, name, created_at)
  VALUES (@id, @name, @createdAt)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name
`)

const statementUpsertUser = database.prepare(`
  INSERT INTO users (id, handle, display_name, role, status, created_at, updated_at)
  VALUES (@id, @handle, @displayName, @role, @status, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    handle = excluded.handle,
    display_name = excluded.display_name,
    role = excluded.role,
    status = excluded.status,
    updated_at = excluded.updated_at
`)

const statementSelectUser = database.prepare(`
  SELECT
    id,
    handle,
    display_name AS displayName,
    role,
    status
  FROM users
  WHERE id = ?
`)

const statementSelectAnyActiveAccessKeyForUser = database.prepare(`
  SELECT
    id,
    label,
    created_at AS createdAt
  FROM access_keys
  WHERE user_id = ?
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > ?)
  ORDER BY created_at ASC
  LIMIT 1
`)

const statementSelectAccessKeyByHash = database.prepare(`
  SELECT
    access_keys.id AS accessKeyId,
    access_keys.user_id AS userId,
    access_keys.label,
    access_keys.expires_at AS expiresAt,
    access_keys.revoked_at AS revokedAt,
    users.id AS id,
    users.handle,
    users.display_name AS displayName,
    users.role,
    users.status
  FROM access_keys
  JOIN users ON users.id = access_keys.user_id
  WHERE access_keys.key_hash = ?
  LIMIT 1
`)

const statementInsertAccessKey = database.prepare(`
  INSERT INTO access_keys (
    id,
    user_id,
    key_hash,
    label,
    expires_at,
    last_used_at,
    revoked_at,
    created_at
  )
  VALUES (
    @id,
    @userId,
    @keyHash,
    @label,
    @expiresAt,
    @lastUsedAt,
    @revokedAt,
    @createdAt
  )
`)

const statementUpdateAccessKeyLastUsedAt = database.prepare(`
  UPDATE access_keys
  SET last_used_at = @lastUsedAt
  WHERE id = @id
`)

const statementSelectRoom = database.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM rooms
  WHERE id = ?
`)

const statementSelectRoomByName = database.prepare(`
  SELECT id, name, created_at AS createdAt
  FROM rooms
  WHERE lower(name) = lower(?)
  LIMIT 1
`)

const statementSelectRooms = database.prepare(`
  SELECT
    rooms.id,
    rooms.name,
    rooms.created_at AS createdAt,
    latest.latest_message_at AS latestMessageAt
  FROM rooms
  LEFT JOIN (
    SELECT room_id, MAX(created_at) AS latest_message_at
    FROM messages
    WHERE kind != 'system'
    GROUP BY room_id
  ) latest ON latest.room_id = rooms.id
  ORDER BY
    CASE WHEN rooms.id = ? THEN 0 ELSE 1 END ASC,
    COALESCE(latest.latest_message_at, rooms.created_at) DESC,
    rooms.created_at ASC
`)

const statementCountRooms = database.prepare(`
  SELECT COUNT(*) AS count
  FROM rooms
`)

const statementUpsertSession = database.prepare(`
  INSERT INTO sessions (id, nickname, user_id, created_at, updated_at)
  VALUES (@id, @nickname, @userId, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    nickname = excluded.nickname,
    user_id = excluded.user_id,
    updated_at = excluded.updated_at
`)

const statementSelectSession = database.prepare(`
  SELECT
    id,
    nickname,
    user_id AS userId,
    active_character_id AS activeCharacterId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM sessions
  WHERE id = ?
`)

const statementInsertAuthSession = database.prepare(`
  INSERT INTO auth_sessions (
    id,
    user_id,
    access_key_id,
    session_token_hash,
    client_name,
    client_ip,
    created_at,
    expires_at,
    last_seen_at,
    revoked_at
  )
  VALUES (
    @id,
    @userId,
    @accessKeyId,
    @sessionTokenHash,
    @clientName,
    @clientIp,
    @createdAt,
    @expiresAt,
    @lastSeenAt,
    @revokedAt
  )
`)

const statementSelectAuthSessionByTokenHash = database.prepare(`
  SELECT
    auth_sessions.id AS authSessionId,
    auth_sessions.user_id AS userId,
    auth_sessions.access_key_id AS accessKeyId,
    auth_sessions.client_name AS clientName,
    auth_sessions.client_ip AS clientIp,
    auth_sessions.created_at AS createdAt,
    auth_sessions.expires_at AS expiresAt,
    auth_sessions.last_seen_at AS lastSeenAt,
    auth_sessions.revoked_at AS revokedAt,
    users.id AS id,
    users.handle,
    users.display_name AS displayName,
    users.role,
    users.status
  FROM auth_sessions
  JOIN users ON users.id = auth_sessions.user_id
  WHERE auth_sessions.session_token_hash = ?
  LIMIT 1
`)

const statementUpdateAuthSessionActivity = database.prepare(`
  UPDATE auth_sessions
  SET expires_at = @expiresAt,
      last_seen_at = @lastSeenAt
  WHERE id = @id
`)

const statementRevokeAuthSessionByTokenHash = database.prepare(`
  UPDATE auth_sessions
  SET revoked_at = @revokedAt
  WHERE session_token_hash = @sessionTokenHash
    AND revoked_at IS NULL
`)

const statementDeleteExpiredAuthSessions = database.prepare(`
  DELETE FROM auth_sessions
  WHERE revoked_at IS NOT NULL OR expires_at <= ?
`)

const statementUpdateSessionActiveCharacter = database.prepare(`
  UPDATE sessions
  SET active_character_id = @activeCharacterId,
      updated_at = @updatedAt
  WHERE id = @sessionId
`)

const statementInsertMessage = database.prepare(`
  INSERT INTO messages (id, room_id, session_id, nickname, kind, body, created_at)
  VALUES (@id, @roomId, @sessionId, @nickname, @kind, @body, @createdAt)
`)

const statementInsertCharacterCard = database.prepare(`
  INSERT INTO character_cards (id, user_id, name, status, is_default, created_at, updated_at)
  VALUES (@id, @userId, @name, @status, @isDefault, @createdAt, @updatedAt)
`)

const statementInsertCharacterAttributes = database.prepare(`
  INSERT INTO character_attributes (
    character_id,
    strength,
    dexterity,
    intelligence,
    luck,
    size,
    constitution,
    education,
    appearance,
    willpower,
    created_at,
    updated_at
  )
  VALUES (
    @characterId,
    @strength,
    @dexterity,
    @intelligence,
    @luck,
    @size,
    @constitution,
    @education,
    @appearance,
    @willpower,
    @createdAt,
    @updatedAt
  )
`)

const statementUpdateCharacterCard = database.prepare(`
  UPDATE character_cards
  SET name = @name,
      updated_at = @updatedAt
  WHERE id = @id AND user_id = @userId
`)

const statementUpdateCharacterAttributes = database.prepare(`
  UPDATE character_attributes
  SET strength = @strength,
      dexterity = @dexterity,
      intelligence = @intelligence,
      luck = @luck,
      size = @size,
      constitution = @constitution,
      education = @education,
      appearance = @appearance,
      willpower = @willpower,
      updated_at = @updatedAt
  WHERE character_id = @characterId
`)

const statementSelectCharacterCardsForUser = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.name,
    character_cards.status,
    character_cards.is_default AS isDefault,
    character_attributes.strength,
    character_attributes.dexterity,
    character_attributes.intelligence,
    character_attributes.luck,
    character_attributes.size,
    character_attributes.constitution,
    character_attributes.education,
    character_attributes.appearance,
    character_attributes.willpower
  FROM character_cards
  JOIN character_attributes ON character_attributes.character_id = character_cards.id
  WHERE character_cards.user_id = ? AND character_cards.status != 'archived'
  ORDER BY character_cards.is_default DESC, character_cards.created_at ASC
`)

const statementSelectCharacterCardByIdForUser = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.name,
    character_cards.status,
    character_cards.is_default AS isDefault,
    character_attributes.strength,
    character_attributes.dexterity,
    character_attributes.intelligence,
    character_attributes.luck,
    character_attributes.size,
    character_attributes.constitution,
    character_attributes.education,
    character_attributes.appearance,
    character_attributes.willpower
  FROM character_cards
  JOIN character_attributes ON character_attributes.character_id = character_cards.id
  WHERE character_cards.id = ? AND character_cards.user_id = ?
  LIMIT 1
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

statementUpsertUser.run({
  ...ADMIN_USER,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

statementDeleteExpiredAuthSessions.run(Date.now())
const adminAccessKeySeed = ensureAdminAccessKey()

const roomConnections = new Map()
const sessionConnections = new Map()
const authAttemptTracker = new Map()

function createAccessKeyId() {
  return `key_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function createAuthSessionId() {
  return `auth_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function createAuthSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function createAdminAccessKeyValue() {
  return `timeline-admin-${crypto.randomBytes(12).toString('hex')}`
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseCookies(rawCookie) {
  const source = String(rawCookie ?? '')

  if (source === '') {
    return {}
  }

  return source.split(';').reduce((result, part) => {
    const separatorIndex = part.indexOf('=')

    if (separatorIndex <= 0) {
      return result
    }

    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()

    if (key !== '') {
      result[key] = decodeURIComponent(value)
    }

    return result
  }, {})
}

function getRequestHost(request) {
  return String(request.headers.host ?? `127.0.0.1:${CHAT_PORT}`).trim()
}

function isSecureRequest(request) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  return request.socket.encrypted === true || forwardedProto === 'https'
}

function buildSetCookieHeader(request, token, maxAgeSeconds) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]

  if (isSecureRequest(request)) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

function buildClearCookieHeader(request) {
  return buildSetCookieHeader(request, '', 0)
}

function getAllowedOrigin(request) {
  const rawOrigin = String(request.headers.origin ?? '').trim()

  if (rawOrigin === '') {
    return ''
  }

  try {
    const originUrl = new URL(rawOrigin)
    const requestHost = getRequestHost(request)
    const requestHostName = requestHost.split(':')[0]

    if (
      originUrl.hostname === requestHostName ||
      originUrl.hostname === 'localhost' ||
      originUrl.hostname === '127.0.0.1'
    ) {
      return rawOrigin
    }
  } catch {
    return ''
  }

  return ''
}

function writeJson(response, statusCode, payload, options = {}) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...options.headers,
  }

  response.writeHead(statusCode, headers)
  response.end(JSON.stringify(payload))
}

function writeEmpty(response, statusCode, options = {}) {
  const headers = {
    'Cache-Control': 'no-store',
    ...options.headers,
  }

  response.writeHead(statusCode, headers)
  response.end()
}

function appendCorsHeaders(request, headers = {}) {
  const allowedOrigin = getAllowedOrigin(request)

  if (allowedOrigin === '') {
    return headers
  }

  return {
    ...headers,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  }
}

function readJsonBody(request, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []

    request.on('data', (chunk) => {
      size += chunk.length

      if (size > maxBytes) {
        reject(new Error('BODY_TOO_LARGE'))
        request.destroy()
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('INVALID_JSON'))
      }
    })

    request.on('error', () => {
      reject(new Error('REQUEST_ERROR'))
    })
  })
}

function resolveClientIp(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] ?? '').trim()

  if (forwardedFor !== '') {
    return forwardedFor.split(',')[0].trim()
  }

  return request.socket.remoteAddress ?? 'unknown'
}

function resolveClientName(request) {
  const userAgent = String(request.headers['user-agent'] ?? '').trim()
  return userAgent.slice(0, 160)
}

function pruneExpiredAuthRateLimitEntries(now = Date.now()) {
  for (const [key, record] of authAttemptTracker.entries()) {
    if (record.blockedUntil <= now && now - record.windowStartedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
      authAttemptTracker.delete(key)
    }
  }
}

function getAuthRateLimitState(clientKey, now = Date.now()) {
  pruneExpiredAuthRateLimitEntries(now)
  const record = authAttemptTracker.get(clientKey)

  if (!record) {
    return {
      blockedUntil: 0,
      failureCount: 0,
      retryAfterMs: 0,
    }
  }

  if (record.blockedUntil > now) {
    return {
      blockedUntil: record.blockedUntil,
      failureCount: record.failureCount,
      retryAfterMs: record.blockedUntil - now,
    }
  }

  if (now - record.windowStartedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
    authAttemptTracker.delete(clientKey)
    return {
      blockedUntil: 0,
      failureCount: 0,
      retryAfterMs: 0,
    }
  }

  return {
    blockedUntil: 0,
    failureCount: record.failureCount,
    retryAfterMs: 0,
  }
}

function registerAuthFailure(clientKey, now = Date.now()) {
  const existing = authAttemptTracker.get(clientKey)

  if (!existing || now - existing.windowStartedAt >= AUTH_RATE_LIMIT_WINDOW_MS) {
    authAttemptTracker.set(clientKey, {
      blockedUntil: 0,
      failureCount: 1,
      windowStartedAt: now,
    })
    return
  }

  existing.failureCount += 1

  if (existing.failureCount >= AUTH_RATE_LIMIT_MAX_FAILURES) {
    existing.blockedUntil = now + AUTH_RATE_LIMIT_BLOCK_MS
  }

  authAttemptTracker.set(clientKey, existing)
}

function clearAuthFailures(clientKey) {
  authAttemptTracker.delete(clientKey)
}

function sanitiseAccessKey(value) {
  return String(value ?? '').trim().slice(0, AUTH_MAX_ACCESS_KEY_LENGTH)
}

function ensureAccessKeyForUser(userId, accessKeyValue, label) {
  const safeAccessKey = sanitiseAccessKey(accessKeyValue)

  if (safeAccessKey === '') {
    return null
  }

  const keyHash = hashSecret(safeAccessKey)
  const existing = statementSelectAccessKeyByHash.get(keyHash)

  if (existing) {
    return existing.accessKeyId
  }

  const now = Date.now()
  const keyId = createAccessKeyId()

  statementInsertAccessKey.run({
    createdAt: now,
    expiresAt: null,
    id: keyId,
    keyHash,
    label,
    lastUsedAt: null,
    revokedAt: null,
    userId,
  })

  return keyId
}

function ensureAdminAccessKey() {
  if (ADMIN_ACCESS_KEY_ENV !== '') {
    ensureAccessKeyForUser(ADMIN_USER.id, ADMIN_ACCESS_KEY_ENV, 'env：admin默认密钥')
    return {
      filePath: null,
      source: 'env',
    }
  }

  const existing = statementSelectAnyActiveAccessKeyForUser.get(ADMIN_USER.id, Date.now())

  if (existing) {
    return {
      filePath: fs.existsSync(ADMIN_ACCESS_KEY_FILE) ? ADMIN_ACCESS_KEY_FILE : null,
      source: 'database',
    }
  }

  const adminAccessKey = createAdminAccessKeyValue()
  ensureAccessKeyForUser(ADMIN_USER.id, adminAccessKey, '自动生成：admin默认密钥')
  fs.writeFileSync(
    ADMIN_ACCESS_KEY_FILE,
    [
      'timeline 聊天室管理员访问密钥',
      `生成时间：${new Date().toISOString()}`,
      `账号：${ADMIN_USER.handle}`,
      `密钥：${adminAccessKey}`,
      '',
      '说明：该文件只在首次自动生成密钥时写入一次；后续如需重置，可设置环境变量 CHAT_ADMIN_ACCESS_KEY 后重启服务。',
      '',
    ].join('\n'),
    'utf8',
  )

  return {
    filePath: ADMIN_ACCESS_KEY_FILE,
    source: 'generated',
  }
}

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

function sanitiseRoomName(value) {
  const roomName = String(value ?? '').replace(/\s+/g, ' ').trim()
  return roomName.slice(0, MAX_ROOM_NAME_LENGTH)
}

function sanitiseCharacterName(value) {
  const characterName = String(value ?? '').replace(/\s+/g, ' ').trim()
  return characterName.slice(0, MAX_CHARACTER_NAME_LENGTH)
}

function sanitiseAttributeValue(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)

  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.min(MAX_ATTRIBUTE_VALUE, Math.max(0, parsed))
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

function serialiseUser(row) {
  return {
    displayName: row.displayName,
    handle: row.handle,
    id: row.id,
    role: row.role,
    status: row.status,
  }
}

function serialiseCharacter(row) {
  return {
    attributes: {
      appearance: row.appearance,
      constitution: row.constitution,
      dexterity: row.dexterity,
      education: row.education,
      intelligence: row.intelligence,
      luck: row.luck,
      size: row.size,
      strength: row.strength,
      willpower: row.willpower,
    },
    id: row.id,
    isDefault: row.isDefault === 1,
    name: row.name,
    status: row.status,
  }
}

function serialiseRoom(row) {
  return {
    createdAt: row.createdAt,
    id: row.id,
    latestMessageAt: row.latestMessageAt ?? null,
    memberCount: roomConnections.get(row.id)?.size ?? 0,
    name: row.name,
  }
}

function getRoomList() {
  return statementSelectRooms.all(PUBLIC_ROOM.id).map(serialiseRoom)
}

function createRoomId() {
  return `room_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function createCharacterId() {
  return `character_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function getCurrentUser(userId) {
  if (String(userId ?? '').trim() === '') {
    return null
  }

  const user = statementSelectUser.get(userId)
  return user ? serialiseUser(user) : null
}

function getCharacterCardsForUser(userId) {
  return statementSelectCharacterCardsForUser.all(userId).map(serialiseCharacter)
}

function createAuthSessionForUser(userId, accessKeyId, request) {
  const now = Date.now()
  const sessionToken = createAuthSessionToken()
  const authSessionId = createAuthSessionId()

  statementInsertAuthSession.run({
    accessKeyId,
    clientIp: resolveClientIp(request),
    clientName: resolveClientName(request),
    createdAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
    id: authSessionId,
    lastSeenAt: now,
    revokedAt: null,
    sessionTokenHash: hashSecret(sessionToken),
    userId,
  })

  return {
    authSessionId,
    expiresAt: now + AUTH_SESSION_TTL_MS,
    sessionToken,
  }
}

function getAuthTokenFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie)
  return sanitiseAccessKey(cookies[AUTH_COOKIE_NAME] ?? '')
}

function resolveAuthContextFromRequest(request, options = {}) {
  const sessionToken = getAuthTokenFromRequest(request)

  if (sessionToken === '') {
    return null
  }

  const row = statementSelectAuthSessionByTokenHash.get(hashSecret(sessionToken))

  if (!row) {
    return null
  }

  const now = Date.now()

  if (row.revokedAt !== null || row.expiresAt <= now || row.status !== 'active') {
    return null
  }

  const nextExpiresAt = now + AUTH_SESSION_TTL_MS
  statementUpdateAuthSessionActivity.run({
    expiresAt: nextExpiresAt,
    id: row.authSessionId,
    lastSeenAt: now,
  })

  const shouldRefreshCookie = options.forceCookieRefresh === true || row.expiresAt - now <= AUTH_SESSION_RENEW_THRESHOLD_MS

  return {
    accessKeyId: row.accessKeyId ?? null,
    authSessionId: row.authSessionId,
    expiresAt: nextExpiresAt,
    sessionToken,
    shouldRefreshCookie,
    user: serialiseUser(row),
  }
}

function setSessionActiveCharacter(sessionId, activeCharacterId) {
  statementUpdateSessionActiveCharacter.run({
    activeCharacterId,
    sessionId,
    updatedAt: Date.now(),
  })
}

function resolveCharacterState(sessionId, userId) {
  const session = statementSelectSession.get(sessionId)
  const characterCards = getCharacterCardsForUser(userId)

  if (characterCards.length === 0) {
    setSessionActiveCharacter(sessionId, null)
    return {
      activeCharacterId: null,
      characterCards,
    }
  }

  const requestedCharacterId = session?.activeCharacterId ?? null
  const activeCharacterId = characterCards.some((entry) => entry.id === requestedCharacterId)
    ? requestedCharacterId
    : characterCards.find((entry) => entry.isDefault)?.id ?? characterCards[0].id

  if (requestedCharacterId !== activeCharacterId) {
    setSessionActiveCharacter(sessionId, activeCharacterId)
  }

  return {
    activeCharacterId,
    characterCards,
  }
}

function normaliseCharacterAttributes(input) {
  return {
    appearance: sanitiseAttributeValue(input?.appearance),
    constitution: sanitiseAttributeValue(input?.constitution),
    dexterity: sanitiseAttributeValue(input?.dexterity),
    education: sanitiseAttributeValue(input?.education),
    intelligence: sanitiseAttributeValue(input?.intelligence),
    luck: sanitiseAttributeValue(input?.luck),
    size: sanitiseAttributeValue(input?.size),
    strength: sanitiseAttributeValue(input?.strength),
    willpower: sanitiseAttributeValue(input?.willpower),
  }
}

function createCharacterCardForUser(userId, payload) {
  const name = sanitiseCharacterName(payload?.name)

  if (name === '') {
    return {
      error: '角色卡名称不能为空。',
    }
  }

  const existingCharacters = getCharacterCardsForUser(userId)
  const attributes = normaliseCharacterAttributes(payload?.attributes)
  const characterId = createCharacterId()
  const now = Date.now()

  statementInsertCharacterCard.run({
    createdAt: now,
    id: characterId,
    isDefault: existingCharacters.length === 0 ? 1 : 0,
    name,
    status: 'active',
    updatedAt: now,
    userId,
  })

  statementInsertCharacterAttributes.run({
    ...attributes,
    characterId,
    createdAt: now,
    updatedAt: now,
  })

  return {
    characterId,
  }
}

function updateCharacterCardForUser(userId, payload) {
  const characterId = String(payload?.characterId ?? '').trim()
  const name = sanitiseCharacterName(payload?.name)

  if (characterId === '') {
    return {
      error: '目标角色卡不存在。',
    }
  }

  if (name === '') {
    return {
      error: '角色卡名称不能为空。',
    }
  }

  const existingCharacter = statementSelectCharacterCardByIdForUser.get(characterId, userId)

  if (!existingCharacter) {
    return {
      error: '目标角色卡不存在或不属于当前账号。',
    }
  }

  const attributes = normaliseCharacterAttributes(payload?.attributes)
  const updatedAt = Date.now()

  statementUpdateCharacterCard.run({
    id: characterId,
    name,
    updatedAt,
    userId,
  })

  statementUpdateCharacterAttributes.run({
    ...attributes,
    characterId,
    updatedAt,
  })

  return {
    characterId,
  }
}

function parseDiceCommand(body) {
  const matched = /^\.ra\s*(力量|敏捷|智力|幸运|体型|体质|教育|外貌|意志)\s*$/u.exec(body)

  if (!matched) {
    return null
  }

  const attributeLabel = matched[1]
  const attributeKey = ATTRIBUTE_LABEL_TO_KEY.get(attributeLabel)

  if (!attributeKey) {
    return null
  }

  return {
    attributeKey,
    attributeLabel,
  }
}

function resolveCheckRank(rollValue, targetValue) {
  if (rollValue === 1) {
    return '大成功'
  }

  if (rollValue === 100) {
    return '大失败'
  }

  if (rollValue <= Math.floor(targetValue / 5)) {
    return '极难成功'
  }

  if (rollValue <= Math.floor(targetValue / 2)) {
    return '困难成功'
  }

  if (rollValue <= targetValue) {
    return '成功'
  }

  return '失败'
}

function getHistory(roomId, afterSequence = 0) {
  if (afterSequence > 0) {
    return statementSelectMessagesSince
      .all(roomId, afterSequence, MAX_HISTORY_LIMIT)
      .map(serialiseMessage)
  }

  return statementSelectRecentMessages.all(roomId, MAX_HISTORY_LIMIT).map(serialiseMessage)
}

function persistSession(sessionId, nickname, userId) {
  const now = Date.now()

  statementUpsertSession.run({
    id: sessionId,
    nickname,
    userId,
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

function broadcastRooms() {
  const payload = {
    rooms: getRoomList(),
    type: 'rooms',
  }

  const sockets = new Set()

  for (const connection of sessionConnections.values()) {
    sockets.add(connection.socket)
  }

  for (const socket of sockets) {
    sendJson(socket, payload)
  }
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

function closeExistingSession(sessionId, nextSocket) {
  const existing = sessionConnections.get(sessionId)

  if (!existing || existing.socket === nextSocket) {
    return
  }

  sendJson(existing.socket, {
    message: '该昵称会话已在另一处重新连接，当前连接将关闭。',
    type: 'error',
  })
  existing.socket.close(4001, 'Session replaced')
}

function detachSessionFromRoom(state, socket) {
  if (!state.joined || state.roomId === '' || state.sessionId === '') {
    return ''
  }

  const previousRoomId = state.roomId
  const roomSessions = createRoomConnectionMap(previousRoomId)
  const activeMember = roomSessions.get(state.sessionId)

  if (activeMember && activeMember.socket === socket) {
    roomSessions.delete(state.sessionId)

    if (roomSessions.size === 0) {
      roomConnections.delete(previousRoomId)
    }
  }

  const activeSession = sessionConnections.get(state.sessionId)

  if (activeSession?.socket === socket) {
    sessionConnections.delete(state.sessionId)
  }

  state.joined = false
  state.roomId = ''
  state.activeCharacterId = ''

  return previousRoomId
}

function attachSessionToRoom(state, socket, payload) {
  const nickname = sanitiseNickname(payload.nickname)
  const sessionId = String(payload.sessionId ?? '').trim()
  const roomId = String(payload.roomId ?? '').trim() || PUBLIC_ROOM.id

  if (state.userId === '') {
    sendJson(socket, {
      message: '当前访问密钥未通过验证，请先重新输入密钥。',
      type: 'auth_required',
    })
    return
  }

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

  persistSession(sessionId, nickname, state.userId)
  closeExistingSession(sessionId, socket)

  const previousRoomId = detachSessionFromRoom(state, socket)

  const roomSessions = createRoomConnectionMap(roomId)
  roomSessions.set(sessionId, {
    connectedAt: Date.now(),
    nickname,
    roomId,
    sessionId,
    socket,
  })
  sessionConnections.set(sessionId, {
    roomId,
    socket,
  })

  state.joined = true
  state.nickname = nickname
  state.roomId = roomId
  state.sessionId = sessionId

  const currentUser = getCurrentUser(state.userId)

  if (!currentUser) {
    sendJson(socket, {
      message: '当前账号不存在或已失效，请重新输入密钥。',
      type: 'auth_required',
    })
    return
  }

  const { activeCharacterId, characterCards } = resolveCharacterState(sessionId, state.userId)
  state.activeCharacterId = activeCharacterId ?? ''

  const rooms = getRoomList()
  const activeRoom = rooms.find((entry) => entry.id === roomId) ?? serialiseRoom(room)

  sendJson(socket, {
    activeCharacterId,
    characterCards,
    currentUser,
    members: getRoomMembers(roomId),
    messages: getHistory(roomId, normaliseSequence(payload.afterSequence)),
    room: activeRoom,
    rooms,
    sessionId,
    type: 'joined',
  })

  if (previousRoomId !== '' && previousRoomId !== roomId) {
    broadcastPresence(previousRoomId)
  }

  broadcastPresence(roomId)
  broadcastRooms()
}

function handleCreateRoom(state, socket, payload) {
  if (!state.joined) {
    sendJson(socket, {
      message: '请先进入聊天室，再创建房间。',
      type: 'error',
    })
    return
  }

  const roomName = sanitiseRoomName(payload.name)

  if (roomName === '') {
    sendJson(socket, {
      message: '房间名称不能为空。',
      type: 'error',
    })
    return
  }

  if (statementSelectRoomByName.get(roomName)) {
    sendJson(socket, {
      message: '已存在同名聊天室，请换一个名称。',
      type: 'error',
    })
    return
  }

  const createdAt = Date.now()
  const roomId = createRoomId()

  statementInsertRoom.run({
    createdAt,
    id: roomId,
    name: roomName,
  })

  attachSessionToRoom(state, socket, {
    afterSequence: 0,
    nickname: state.nickname,
    roomId,
    sessionId: state.sessionId,
  })
}

function sendCharacterState(socket, sessionId, userId) {
  const currentUser = getCurrentUser(userId)

  if (!currentUser) {
    sendJson(socket, {
      message: '当前账号不存在或已失效，请重新输入密钥。',
      type: 'auth_required',
    })
    return null
  }

  const { activeCharacterId, characterCards } = resolveCharacterState(sessionId, userId)

  sendJson(socket, {
    activeCharacterId,
    characterCards,
    currentUser,
    type: 'character_state',
  })

  return {
    activeCharacterId,
    characterCards,
    currentUser,
  }
}

function handleCreateCharacterCard(state, socket, payload) {
  if (!state.joined || state.sessionId === '' || state.userId === '') {
    sendJson(socket, {
      message: '请先进入聊天室，再创建角色卡。',
      type: 'error',
    })
    return
  }

  const result = createCharacterCardForUser(state.userId, payload)

  if (result.error) {
    sendJson(socket, {
      message: result.error,
      type: 'error',
    })
    return
  }

  setSessionActiveCharacter(state.sessionId, result.characterId)
  state.activeCharacterId = result.characterId
  sendCharacterState(socket, state.sessionId, state.userId)
}

function handleUpdateCharacterCard(state, socket, payload) {
  if (!state.joined || state.sessionId === '' || state.userId === '') {
    sendJson(socket, {
      message: '请先进入聊天室，再编辑角色卡。',
      type: 'error',
    })
    return
  }

  const result = updateCharacterCardForUser(state.userId, payload)

  if (result.error) {
    sendJson(socket, {
      message: result.error,
      type: 'error',
    })
    return
  }

  sendCharacterState(socket, state.sessionId, state.userId)
}

function handleSwitchCharacter(state, socket, payload) {
  if (!state.joined || state.sessionId === '' || state.userId === '') {
    sendJson(socket, {
      message: '请先进入聊天室，再切换角色。',
      type: 'error',
    })
    return
  }

  const characterId = String(payload.characterId ?? '').trim()

  if (characterId === '') {
    sendJson(socket, {
      message: '请选择要切换的角色卡。',
      type: 'error',
    })
    return
  }

  const character = statementSelectCharacterCardByIdForUser.get(characterId, state.userId)

  if (!character) {
    sendJson(socket, {
      message: '目标角色卡不存在或不属于当前账号。',
      type: 'error',
    })
    return
  }

  setSessionActiveCharacter(state.sessionId, characterId)
  state.activeCharacterId = characterId
  sendCharacterState(socket, state.sessionId, state.userId)
}

function handleDiceCommand(state, socket, body) {
  const command = parseDiceCommand(body)

  if (!command) {
    sendJson(socket, {
      message: '暂不支持这个骰子指令。当前仅支持 .ra力量 / .ra敏捷 / .ra智力 等属性检定。',
      type: 'error',
    })
    return
  }

  if (state.userId === '' || state.activeCharacterId === '') {
    sendJson(socket, {
      message: `当前账号还没有可用角色卡，无法进行 ${command.attributeLabel} 检定。`,
      type: 'error',
    })
    return
  }

  const character = statementSelectCharacterCardByIdForUser.get(state.activeCharacterId, state.userId)

  if (!character) {
    sendJson(socket, {
      message: `当前账号还没有可用角色卡，无法进行 ${command.attributeLabel} 检定。`,
      type: 'error',
    })
    return
  }

  const targetValue = character[command.attributeKey]
  const rollValue = crypto.randomInt(1, 101)
  const resultRank = resolveCheckRank(rollValue, targetValue)

  const message = persistMessage({
    body: `${character.name} 进行了 ${command.attributeLabel} 检定：1d100=${rollValue} / ${targetValue}\n结果：${resultRank}`,
    kind: 'dice',
    nickname: state.nickname,
    roomId: state.roomId,
    sessionId: state.sessionId,
  })

  broadcastToRoom(state.roomId, {
    message,
    type: 'message',
  })
  broadcastRooms()
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

  if (body.startsWith('.ra')) {
    handleDiceCommand(state, socket, body)
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
  broadcastRooms()
}

function handleDisconnect(state, socket) {
  const previousRoomId = detachSessionFromRoom(state, socket)

  if (previousRoomId === '') {
    return
  }

  broadcastPresence(previousRoomId)
  broadcastRooms()
}

async function handleAccessKeyLogin(request, response) {
  const headers = appendCorsHeaders(request)
  const clientIp = resolveClientIp(request)
  const rateLimitKey = `auth:${clientIp}`
  const rateLimitState = getAuthRateLimitState(rateLimitKey)

  if (rateLimitState.retryAfterMs > 0) {
    writeJson(
      response,
      429,
      {
        message: '密钥验证次数过多，请稍后再试。',
        ok: false,
        retryAfterMs: rateLimitState.retryAfterMs,
      },
      {
        headers: {
          ...headers,
          'Retry-After': String(Math.max(1, Math.ceil(rateLimitState.retryAfterMs / 1000))),
        },
      },
    )
    return
  }

  let body

  try {
    body = await readJsonBody(request)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '请求内容过大。'
        : '请求格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const accessKeyValue = sanitiseAccessKey(body?.accessKey)

  if (accessKeyValue === '') {
    writeJson(response, 400, { message: '请输入访问密钥。', ok: false }, { headers })
    return
  }

  const row = statementSelectAccessKeyByHash.get(hashSecret(accessKeyValue))
  const now = Date.now()
  const isValid =
    row &&
    row.status === 'active' &&
    row.revokedAt === null &&
    (row.expiresAt === null || row.expiresAt > now)

  if (!isValid) {
    registerAuthFailure(rateLimitKey, now)
    const nextRateLimitState = getAuthRateLimitState(rateLimitKey, now)

    writeJson(
      response,
      nextRateLimitState.retryAfterMs > 0 ? 429 : 401,
      {
        message:
          nextRateLimitState.retryAfterMs > 0
            ? '密钥验证次数过多，请稍后再试。'
            : '访问密钥无效或已失效。',
        ok: false,
        retryAfterMs: nextRateLimitState.retryAfterMs,
      },
      {
        headers:
          nextRateLimitState.retryAfterMs > 0
            ? {
                ...headers,
                'Retry-After': String(Math.max(1, Math.ceil(nextRateLimitState.retryAfterMs / 1000))),
              }
            : headers,
      },
    )
    return
  }

  const authSession = createAuthSessionForUser(row.userId, row.accessKeyId, request)
  statementUpdateAccessKeyLastUsedAt.run({
    id: row.accessKeyId,
    lastUsedAt: now,
  })
  clearAuthFailures(rateLimitKey)

  writeJson(
    response,
    200,
    {
      currentUser: serialiseUser(row),
      expiresAt: authSession.expiresAt,
      ok: true,
    },
    {
      headers: {
        ...headers,
        'Set-Cookie': buildSetCookieHeader(
          request,
          authSession.sessionToken,
          Math.floor(AUTH_SESSION_TTL_MS / 1000),
        ),
      },
    },
  )
}

function handleAuthMe(request, response) {
  const headers = appendCorsHeaders(request)
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })

  if (!authContext) {
    writeJson(response, 401, { authenticated: false, ok: false }, { headers })
    return
  }

  writeJson(
    response,
    200,
    {
      authenticated: true,
      currentUser: authContext.user,
      expiresAt: authContext.expiresAt,
      ok: true,
    },
    {
      headers: authContext.shouldRefreshCookie
        ? {
            ...headers,
            'Set-Cookie': buildSetCookieHeader(
              request,
              authContext.sessionToken,
              Math.floor(AUTH_SESSION_TTL_MS / 1000),
            ),
          }
        : headers,
    },
  )
}

function handleLogout(request, response) {
  const headers = appendCorsHeaders(request)
  const sessionToken = getAuthTokenFromRequest(request)

  if (sessionToken !== '') {
    statementRevokeAuthSessionByTokenHash.run({
      revokedAt: Date.now(),
      sessionTokenHash: hashSecret(sessionToken),
    })
  }

  writeJson(
    response,
    200,
    { ok: true },
    {
      headers: {
        ...headers,
        'Set-Cookie': buildClearCookieHeader(request),
      },
    },
  )
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${getRequestHost(request)}`)

  if (request.method === 'OPTIONS' && requestUrl.pathname.startsWith('/auth/')) {
    writeEmpty(response, 204, { headers: appendCorsHeaders(request) })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/auth/access-key') {
    void handleAccessKeyLogin(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/auth/me') {
    handleAuthMe(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/auth/logout') {
    handleLogout(request, response)
    return
  }

  if (requestUrl.pathname === '/') {
    writeJson(response, 200, {
      endpoints: {
        authAccessKey: '/auth/access-key',
        authMe: '/auth/me',
        health: '/health',
        websocket: '/ws',
      },
      message: '聊天室服务正在运行。请通过前端页面访问聊天室，或用 /health 检查服务状态。',
      ok: true,
      roomId: PUBLIC_ROOM.id,
      roomCount: statementCountRooms.get().count,
    })
    return
  }

  if (requestUrl.pathname === '/health') {
    writeJson(response, 200, {
      ok: true,
      roomCount: statementCountRooms.get().count,
      roomId: PUBLIC_ROOM.id,
    })
    return
  }

  writeJson(response, 404, { ok: false, message: 'Not found' })
})

const websocketServer = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url ?? '/', `http://${getRequestHost(request)}`)

  if (requestUrl.pathname !== '/ws') {
    socket.destroy()
    return
  }

  request.authContext = resolveAuthContextFromRequest(request)

  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit('connection', websocket, request)
  })
})

websocketServer.on('connection', (socket, request) => {
  const state = {
    activeCharacterId: '',
    authSessionId: request.authContext?.authSessionId ?? '',
    joined: false,
    nickname: '',
    roomId: '',
    sessionId: '',
    userId: request.authContext?.user.id ?? '',
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
      const nextAuthContext = resolveAuthContextFromRequest(request)
      state.authSessionId = nextAuthContext?.authSessionId ?? ''
      state.userId = nextAuthContext?.user.id ?? ''
      attachSessionToRoom(state, socket, payload)
      return
    }

    if (payload.type === 'send_message') {
      handleChatMessage(state, socket, payload)
      return
    }

    if (payload.type === 'create_room') {
      handleCreateRoom(state, socket, payload)
      return
    }

    if (payload.type === 'create_character_card') {
      handleCreateCharacterCard(state, socket, payload)
      return
    }

    if (payload.type === 'update_character_card') {
      handleUpdateCharacterCard(state, socket, payload)
      return
    }

    if (payload.type === 'switch_character') {
      handleSwitchCharacter(state, socket, payload)
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
  console.log(`管理员账号: ${ADMIN_USER.handle}`)

  if (adminAccessKeySeed.source === 'env') {
    console.log('管理员访问密钥来源: 环境变量 CHAT_ADMIN_ACCESS_KEY')
  } else if (adminAccessKeySeed.filePath) {
    console.log(`管理员访问密钥文件: ${adminAccessKeySeed.filePath}`)
  } else {
    console.log('管理员访问密钥已存在于数据库中；如需重置，请设置 CHAT_ADMIN_ACCESS_KEY 后重启服务。')
  }

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
