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
const PUBLIC_ROOM = { id: 'public', name: '公共群聊' }
const ADMIN_USER = {
  displayName: '管理员',
  handle: 'admin',
  id: 'user_admin',
  role: 'admin',
  status: 'active',
}
const SEEDED_CHAT_USERS = [
  {
    accessKey: 'morosonder-edie-b689feec9a57cd66',
    displayName: 'edie',
    handle: 'edie',
    id: 'user_edie',
    role: 'member',
    status: 'active',
  },
  {
    accessKey: 'morosonder-lateraven-aaf9bb2e29039771',
    displayName: 'lateraven',
    handle: 'lateraven',
    id: 'user_lateraven',
    role: 'member',
    status: 'active',
  },
  {
    accessKey: 'morosonder-sakin-a5fd5d7b9e61eca2',
    displayName: 'sakin',
    handle: 'sakin',
    id: 'user_sakin',
    role: 'member',
    status: 'active',
  },
  {
    accessKey: 'morosonder-chen-6f9ff9edec5cbabb',
    displayName: 'chen',
    handle: 'chen',
    id: 'user_chen',
    role: 'member',
    status: 'active',
  },
  {
    accessKey: 'morosonder-eshis-23e25fa8b1d4970a',
    displayName: 'eshis',
    handle: 'eshis',
    id: 'user_eshis',
    role: 'member',
    status: 'active',
  },
  {
    accessKey: 'morosonder-lotka-1864819d10348545',
    displayName: 'Lotka',
    handle: 'lotka',
    id: 'user_lotka',
    role: 'member',
    status: 'active',
  },
]
const AUTH_COOKIE_NAME = 'timeline_chat_auth'
const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const AUTH_SESSION_RENEW_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7
const AUTH_MAX_ACCESS_KEY_LENGTH = 128
const AUTH_RATE_LIMIT_WINDOW_MS = 1000 * 60 * 10
const AUTH_RATE_LIMIT_BLOCK_MS = 1000 * 60 * 5
const AUTH_RATE_LIMIT_MAX_FAILURES = 6
const ADMIN_ACCESS_KEY_FILE = path.join(dataDirectory, 'admin-access-key.txt')
const SEEDED_USER_ACCESS_KEY_FILE = path.join(dataDirectory, 'seeded-user-access-keys.txt')
const ADMIN_ACCESS_KEY_ENV = String(process.env.CHAT_ADMIN_ACCESS_KEY ?? '').trim()
const MAX_HISTORY_LIMIT = 80
const MAX_MESSAGE_LENGTH = 1000
const MAX_REPLY_PREVIEW_LENGTH = 140
const MAX_NICKNAME_LENGTH = 24
const MAX_ROOM_NAME_LENGTH = 32
const MAX_CHARACTER_NAME_LENGTH = 32
const MAX_ATTRIBUTE_VALUE = 100
const MAX_AVATAR_DATA_URL_LENGTH = 400000
const AGE_CHRONICLE_MAX_WORLDVIEW_LENGTH = 80
const AGE_CHRONICLE_MAX_CHRONICLE_COUNT = 400
const AGE_CHRONICLE_MAX_CHARACTER_COUNT = 200
const AGE_CHRONICLE_MAX_LABEL_LENGTH = 80
const AGE_CHRONICLE_MAX_NOTE_LENGTH = 4000
const AGE_CHRONICLE_MAX_CHARACTER_DISPLAY_NAME_LENGTH = 64
const AGE_CHRONICLE_MAX_COLOR_LENGTH = 24
const AGE_CHRONICLE_MAX_CELL_DESCRIPTION_LENGTH = 4000
const AGE_CHRONICLE_VISIBILITY_PRIVATE = 'private'
const AGE_CHRONICLE_VISIBILITY_PUBLIC = 'public'
const VERTICAL_TIMELINE_MAX_WORLDVIEW_LENGTH = 80
const VERTICAL_TIMELINE_MAX_LANE_COUNT = 40
const VERTICAL_TIMELINE_MAX_EVENT_COUNT = 1200
const VERTICAL_TIMELINE_MAX_YEAR_COUNT = 240
const VERTICAL_TIMELINE_MAX_MONTH_COUNT = 1200
const VERTICAL_TIMELINE_MAX_DAY_COUNT = 2400
const VERTICAL_TIMELINE_MAX_LABEL_LENGTH = 80
const VERTICAL_TIMELINE_MAX_SUMMARY_LENGTH = 240
const VERTICAL_TIMELINE_MAX_BODY_LENGTH = 12000
const VERTICAL_TIMELINE_MAX_TAG_COUNT = 24
const VERTICAL_TIMELINE_MAX_TAG_LENGTH = 32
const VERTICAL_TIMELINE_MAX_COLOR_LENGTH = 24
const WORLDVIEW_MAX_NAME_LENGTH = 80
const WORLDVIEW_MAX_DESCRIPTION_LENGTH = 2000
const WORLDVIEW_MAX_COVER_IMAGE_LENGTH = 400
const CHAT_PRESENTATION_BUBBLE = 'bubble'
const CHAT_PRESENTATION_KP_NARRATION = 'kp-narration'
const ADMIN_KP_CHARACTER_NAME = 'KP'

const DEFAULT_MANAGED_WORLDVIEWS = [
  {
    coverImage: '',
    description: '旧城调查线围绕档案、河道与教堂遗址展开，阅读重点是线索回环和多线并进。',
    name: '莫名其妙',
    tags: ['旧城', '档案', '河道'],
  },
  {
    coverImage: '/background.jpg',
    description: '盐港怪谈线更偏海岸异闻与潮汐仪式，节奏应该显得更冷、更潮、更有雾感。',
    name: '铛铛铛铛',
    tags: ['海岸', '灯塔', '潮汐'],
  },
]

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

const DEFAULT_AGE_CHRONICLE_ENTRIES = [
  {
    id: 'chronicle_177',
    label: '新纪年 177',
    note: '负层夹缝、硕鼠粮仓。',
    year: 177,
  },
  {
    id: 'chronicle_180',
    label: '新纪年 180',
    note: '竞选年、慈善领养。',
    year: 180,
  },
  {
    id: 'chronicle_184',
    label: '新纪年 184',
    note: '作为后续节点，用来验证自定义编年扩展后年龄是否持续自动推算。',
    year: 184,
  },
]

const DEFAULT_AGE_CHARACTER_PROFILES = [
  {
    anchorAge: 11,
    anchorYear: 177,
    color: '#a46245',
    id: 'char_liuzhizhou',
    name: '柳之舟',
  },
  {
    anchorAge: 10,
    anchorYear: 177,
    color: '#2a9a8b',
    id: 'char_liuzhiqing',
    name: '柳之清',
  },
  {
    anchorAge: 14,
    anchorYear: 180,
    color: '#42a2de',
    id: 'char_yaoguang',
    name: '爻光',
  },
  {
    anchorAge: 5,
    anchorYear: 177,
    color: '#dcde42',
    id: 'char_bangyi',
    name: '邦伊',
  },
]

const DEFAULT_VERTICAL_TIMELINE_LANES = [
  {
    color: '#d97706',
    id: 'bangyi',
    name: '邦伊',
  },
  {
    color: '#57534e',
    id: 'liuzhizhou',
    name: '柳之舟',
  },
  {
    color: '#475569',
    id: 'liuzhixing',
    name: '柳之行',
  },
]

const DEFAULT_VERTICAL_TIMELINE_YEARS = [
  {
    id: 'year-165',
    label: '165',
    bubblesByLane: {
      bangyi: { id: 'b-165-entry', title: '第一次踏进偏馆' },
      liuzhizhou: null,
      liuzhixing: { id: 'x-165-entry', title: '替人抄完那本旧账册' },
    },
    months: [],
  },
  {
    id: 'year-171',
    label: '171',
    bubblesByLane: {
      bangyi: { id: 'b-171-entry', title: '从东码头收回一封湿信' },
      liuzhizhou: null,
      liuzhixing: null,
    },
    months: [
      {
        id: 'month-171-2',
        label: '171.2',
        bubblesByLane: {
          bangyi: null,
          liuzhizhou: { id: 'z-171-2-entry', title: '在灰塔楼下看见同一盏灯' },
          liuzhixing: { id: 'x-171-2-entry', title: '替馆中长辈送一纸回帖' },
        },
        days: [],
      },
      {
        id: 'month-171-12',
        label: '171.12',
        bubblesByLane: {
          bangyi: null,
          liuzhizhou: null,
          liuzhixing: { id: 'x-171-12-entry', title: '在偏廊把灯芯重新剪短' },
        },
        days: [
          {
            id: 'day-171-12-8-a',
            label: '171.12.8',
            bubblesByLane: {
              bangyi: { id: 'b-171-12-8-a', title: '半夜把伞忘在回廊' },
              liuzhizhou: { id: 'z-171-12-8-a', title: '抄录墙上只剩半句的题记' },
              liuzhixing: { id: 'x-171-12-8-a', title: '雨里把门闩重新换过' },
            },
          },
          {
            id: 'day-171-12-8-b',
            label: '171.12.8',
            bubblesByLane: {
              bangyi: { id: 'b-171-12-8-b', title: '把藏在袖中的铜钥匙交出去' },
              liuzhizhou: { id: 'z-171-12-8-b', title: '对着蓝灯照出纸页暗纹' },
              liuzhixing: null,
            },
          },
          {
            id: 'day-171-12-11',
            label: '171.12.11',
            bubblesByLane: {
              bangyi: null,
              liuzhizhou: { id: 'z-171-12-11', title: '在塔顶记下第三次钟声延迟' },
              liuzhixing: { id: 'x-171-12-11', title: '从风里听见有人叫旧名' },
            },
          },
        ],
      },
    ],
  },
]

const DEFAULT_VERTICAL_TIMELINE_EVENTS = [
  {
    body: '那天偏馆的窗纸被雨水打得发软，邦伊站在门口听了很久，才意识到里头并没有人翻书，却一直有纸页被掀动的声音。',
    endTime: 165,
    id: 'b-165-entry',
    laneId: 'bangyi',
    nodeId: 'year-165',
    startTime: 165,
    summary: '邦伊第一次踏进偏馆时，听见了不属于任何人的翻页声。',
    tags: ['#偏馆', '#初访'],
    title: '第一次踏进偏馆',
  },
  {
    body: '柳之行把那本旧账册抄到最后一页时，才发现原件比抄本多出一行极浅的红字，像被谁刻意藏进纸纹里。',
    endTime: 165,
    id: 'x-165-entry',
    laneId: 'liuzhixing',
    nodeId: 'year-165',
    startTime: 165,
    summary: '旧账册最后一页多出了一行只在特定角度下才能看到的红字。',
    tags: ['#旧账册', '#柳之行'],
    title: '替人抄完那本旧账册',
  },
  {
    body: '信封的边角全被海水泡开了，只有蜡封还勉强维持原样。邦伊把它带回来的时候，袖口也全是湿的。',
    endTime: 171,
    id: 'b-171-entry',
    laneId: 'bangyi',
    nodeId: 'year-171',
    startTime: 171,
    summary: '邦伊从东码头收回一封被海水浸透的旧信，蜡封上还沾着盐粒。',
    tags: ['#东码头', '#湿信'],
    title: '从东码头收回一封湿信',
  },
  {
    body: '灰塔楼下的灯原本该在子夜后熄灭，可柳之舟连续三晚经过时都看见它亮着，像故意在等谁回来。',
    endTime: 1712,
    id: 'z-171-2-entry',
    laneId: 'liuzhizhou',
    nodeId: 'month-171-2',
    startTime: 1712,
    summary: '灰塔楼下那盏本应熄灭的灯，连续几夜都在同一时刻亮着。',
    tags: ['#灰塔楼', '#夜灯'],
    title: '在灰塔楼下看见同一盏灯',
  },
  {
    body: '那封回帖写得极克制，只在结尾多添了一句“风大，勿夜行”。送到时，柳之行注意到门内的人看见这句时明显停了一下。',
    endTime: 1712,
    id: 'x-171-2-entry',
    laneId: 'liuzhixing',
    nodeId: 'month-171-2',
    startTime: 1712,
    summary: '一纸回帖在结尾多添了一句劝阻夜行的话，像在暗示什么。',
    tags: ['#回帖', '#偏馆'],
    title: '替馆中长辈送一纸回帖',
  },
  {
    body: '偏廊尽头的蓝灯总烧得太急，柳之行把灯芯剪短后，那束光终于不再一阵明一阵暗，像暂时安静了下来。',
    endTime: 17112,
    id: 'x-171-12-entry',
    laneId: 'liuzhixing',
    nodeId: 'month-171-12',
    startTime: 17112,
    summary: '柳之行重新修整偏廊蓝灯的灯芯，让忽明忽暗的火终于稳定下来。',
    tags: ['#蓝灯', '#偏廊'],
    title: '在偏廊把灯芯重新剪短',
  },
  {
    body: '那把伞原本只是临时搁在回廊，等邦伊回去取的时候，伞骨上却多了一根不属于它的银丝。',
    endTime: 1711208,
    id: 'b-171-12-8-a',
    laneId: 'bangyi',
    nodeId: 'day-171-12-8-a',
    startTime: 1711208,
    summary: '邦伊半夜回廊落伞，折返时发现伞骨上多出一根细银丝。',
    tags: ['#回廊', '#夜雨'],
    title: '半夜把伞忘在回廊',
  },
  {
    body: '墙上的题记只剩半句，前半句像被人用湿布擦掉了。柳之舟照着抄时，笔尖三次在同一处打滑。',
    endTime: 1711208,
    id: 'z-171-12-8-a',
    laneId: 'liuzhizhou',
    nodeId: 'day-171-12-8-a',
    startTime: 1711208,
    summary: '柳之舟抄录回廊墙上的残句题记，却总在同一位置打滑。',
    tags: ['#题记', '#抄录'],
    title: '抄录墙上只剩半句的题记',
  },
  {
    body: '那天的雨太横，门闩老是卡不稳。柳之行索性把旧门闩拆了重装，结果在木槽里撬出一小片刻着年份的铜牌。',
    endTime: 1711208,
    id: 'x-171-12-8-a',
    laneId: 'liuzhixing',
    nodeId: 'day-171-12-8-a',
    startTime: 1711208,
    summary: '柳之行雨夜重装门闩时，从木槽里撬出一片刻着旧年份的铜牌。',
    tags: ['#门闩', '#铜牌'],
    title: '雨里把门闩重新换过',
  },
  {
    body: '铜钥匙一直藏在袖中，直到真正交出去那一刻，邦伊才意识到它比看上去要冷得多，像刚从井水里拿出来。',
    endTime: 1711208,
    id: 'b-171-12-8-b',
    laneId: 'bangyi',
    nodeId: 'day-171-12-8-b',
    startTime: 1711208,
    summary: '邦伊把藏在袖中的铜钥匙交出时，才发现它冷得不合常理。',
    tags: ['#铜钥匙', '#交付'],
    title: '把藏在袖中的铜钥匙交出去',
  },
  {
    body: '蓝灯斜照在纸页边缘，暗纹像潮水一样慢慢浮起。柳之舟认出那不是普通水印，而是一张被重新缝进纸里的旧地图。',
    endTime: 1711208,
    id: 'z-171-12-8-b',
    laneId: 'liuzhizhou',
    nodeId: 'day-171-12-8-b',
    startTime: 1711208,
    summary: '柳之舟借蓝灯照出纸页暗纹，发现纸里藏着一张旧地图。',
    tags: ['#暗纹', '#旧地图'],
    title: '对着蓝灯照出纸页暗纹',
  },
  {
    body: '那夜的第三次钟声比往常慢了半拍。柳之舟记下时间后，抬头看见塔檐下原本静止的铜铃全都朝同一个方向轻轻转过去。',
    endTime: 1711211,
    id: 'z-171-12-11',
    laneId: 'liuzhizhou',
    nodeId: 'day-171-12-11',
    startTime: 1711211,
    summary: '塔顶第三次钟声延迟半拍，铜铃也在无风中齐齐转向。',
    tags: ['#塔顶', '#钟声'],
    title: '在塔顶记下第三次钟声延迟',
  },
  {
    body: '风里那声旧名像是贴着耳后吹过来的，轻得几乎以为是错觉。可柳之行停下脚步后，回廊尽头那盏灯也跟着暗了一瞬。',
    endTime: 1711211,
    id: 'x-171-12-11',
    laneId: 'liuzhixing',
    nodeId: 'day-171-12-11',
    startTime: 1711211,
    summary: '柳之行在风里听见有人唤旧名，而回廊尽头的灯随之暗了一瞬。',
    tags: ['#旧名', '#回廊'],
    title: '从风里听见有人叫旧名',
  },
]

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
    user_id TEXT,
    nickname TEXT NOT NULL,
    speaker_name TEXT,
    speaker_character_id TEXT,
    speaker_avatar_data_url TEXT,
    speaker_display_mode TEXT NOT NULL,
    reply_to_message_id TEXT,
    reply_to_speaker_name TEXT,
    reply_to_body TEXT,
    deleted_at INTEGER,
    deleted_by_user_id TEXT,
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

  CREATE TABLE IF NOT EXISTS room_memberships (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_room_memberships_user_id ON room_memberships(user_id);

  CREATE TABLE IF NOT EXISTS worldviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL,
    cover_image TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by_user_id TEXT,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_worldviews_name ON worldviews(name);

  CREATE TABLE IF NOT EXISTS character_cards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    worldview TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    avatar_data_url TEXT,
    presentation_mode TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS age_chronicle_states (
    worldview_name TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by_user_id TEXT,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS age_chronicle_entries (
    worldview_name TEXT NOT NULL,
    id TEXT NOT NULL,
    label TEXT NOT NULL,
    year INTEGER NOT NULL,
    note TEXT NOT NULL,
    visibility TEXT NOT NULL,
    created_by_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (worldview_name, id),
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_age_chronicle_entries_worldview_year
    ON age_chronicle_entries(worldview_name, year, created_at);

  CREATE TABLE IF NOT EXISTS age_chronicle_structures (
    worldview_name TEXT PRIMARY KEY,
    structure_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by_user_id TEXT,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS age_chronicle_cell_notes (
    worldview_name TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (worldview_name, profile_id, entry_id, author_user_id),
    FOREIGN KEY (author_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_age_chronicle_cell_notes_worldview_entry
    ON age_chronicle_cell_notes(worldview_name, entry_id, profile_id, updated_at);

  CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    worldview TEXT NOT NULL,
    lane_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    detail_image TEXT,
    detail_html TEXT,
    created_by_user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_timeline_events_worldview_lane
    ON timeline_events(worldview, lane_id, start_time);

  CREATE TABLE IF NOT EXISTS vertical_timeline_states (
    worldview_name TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by_user_id TEXT,
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS vertical_timeline_lane_permissions (
    worldview_name TEXT NOT NULL,
    lane_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (worldview_name, lane_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_vertical_timeline_lane_permissions_worldview
    ON vertical_timeline_lane_permissions(worldview_name, lane_id);

  CREATE INDEX IF NOT EXISTS idx_vertical_timeline_lane_permissions_user
    ON vertical_timeline_lane_permissions(user_id, worldview_name);
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
ensureColumn('character_cards', 'worldview', "worldview TEXT NOT NULL DEFAULT ''")
ensureColumn('character_cards', 'color', "color TEXT NOT NULL DEFAULT '#64748b'")
ensureColumn('character_cards', 'avatar_data_url', 'avatar_data_url TEXT')
ensureColumn('character_cards', 'presentation_mode', `presentation_mode TEXT NOT NULL DEFAULT '${CHAT_PRESENTATION_BUBBLE}'`)
database.exec('CREATE INDEX IF NOT EXISTS idx_character_cards_worldview ON character_cards(worldview)')
ensureColumn('messages', 'user_id', 'user_id TEXT')
ensureColumn('messages', 'speaker_name', 'speaker_name TEXT')
ensureColumn('messages', 'speaker_character_id', 'speaker_character_id TEXT')
ensureColumn('messages', 'speaker_avatar_data_url', 'speaker_avatar_data_url TEXT')
ensureColumn('messages', 'speaker_display_mode', `speaker_display_mode TEXT NOT NULL DEFAULT '${CHAT_PRESENTATION_BUBBLE}'`)
ensureColumn('messages', 'reply_to_message_id', 'reply_to_message_id TEXT')
ensureColumn('messages', 'reply_to_speaker_name', 'reply_to_speaker_name TEXT')
ensureColumn('messages', 'reply_to_body', 'reply_to_body TEXT')
ensureColumn('messages', 'deleted_at', 'deleted_at INTEGER')
ensureColumn('messages', 'deleted_by_user_id', 'deleted_by_user_id TEXT')

database.exec(`
  UPDATE messages
  SET user_id = (
    SELECT sessions.user_id
    FROM sessions
    WHERE sessions.id = messages.session_id
    LIMIT 1
  )
  WHERE user_id IS NULL
    AND session_id IS NOT NULL
`)

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

const statementSelectAccessKeyForUserByHash = database.prepare(`
  SELECT
    id,
    expires_at AS expiresAt,
    revoked_at AS revokedAt
  FROM access_keys
  WHERE user_id = ?
    AND key_hash = ?
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

const statementActivateAccessKey = database.prepare(`
  UPDATE access_keys
  SET
    label = @label,
    expires_at = NULL,
    revoked_at = NULL
  WHERE id = @id
`)

const statementUpdateAccessKeyLastUsedAt = database.prepare(`
  UPDATE access_keys
  SET last_used_at = @lastUsedAt
  WHERE id = @id
`)

const statementRevokeOtherAccessKeysForUser = database.prepare(`
  UPDATE access_keys
  SET revoked_at = @revokedAt
  WHERE user_id = @userId
    AND key_hash != @keyHash
    AND revoked_at IS NULL
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

const statementSelectRoomsForUser = database.prepare(`
  SELECT
    rooms.id,
    rooms.name,
    rooms.created_at AS createdAt,
    latest.latest_message_at AS latestMessageAt
  FROM room_memberships
  JOIN rooms ON rooms.id = room_memberships.room_id
  LEFT JOIN (
    SELECT room_id, MAX(created_at) AS latest_message_at
    FROM messages
    WHERE kind != 'system'
    GROUP BY room_id
  ) latest ON latest.room_id = rooms.id
  WHERE room_memberships.user_id = ?
  ORDER BY
    CASE WHEN rooms.id = ? THEN 0 ELSE 1 END ASC,
    COALESCE(latest.latest_message_at, rooms.created_at) DESC,
    rooms.created_at ASC
`)

const statementSelectManageableUsers = database.prepare(`
  SELECT
    id,
    handle,
    display_name AS displayName,
    role,
    status
  FROM users
  WHERE role != 'admin'
    AND status = 'active'
  ORDER BY display_name COLLATE NOCASE ASC, handle COLLATE NOCASE ASC
`)

const statementSelectWorldviews = database.prepare(`
  SELECT
    id,
    name,
    description,
    cover_image AS coverImage,
    tags_json AS tagsJson,
    created_at AS createdAt,
    updated_at AS updatedAt,
    created_by_user_id AS createdByUserId
  FROM worldviews
  ORDER BY updated_at DESC, created_at DESC, name COLLATE NOCASE ASC
`)

const statementSelectWorldviewById = database.prepare(`
  SELECT
    id,
    name,
    description,
    cover_image AS coverImage,
    tags_json AS tagsJson,
    created_at AS createdAt,
    updated_at AS updatedAt,
    created_by_user_id AS createdByUserId
  FROM worldviews
  WHERE id = ?
  LIMIT 1
`)

const statementSelectWorldviewByName = database.prepare(`
  SELECT
    id,
    name,
    description,
    cover_image AS coverImage,
    tags_json AS tagsJson,
    created_at AS createdAt,
    updated_at AS updatedAt,
    created_by_user_id AS createdByUserId
  FROM worldviews
  WHERE lower(name) = lower(?)
  LIMIT 1
`)

const statementInsertWorldview = database.prepare(`
  INSERT INTO worldviews (
    id,
    name,
    description,
    cover_image,
    tags_json,
    created_at,
    updated_at,
    created_by_user_id
  )
  VALUES (
    @id,
    @name,
    @description,
    @coverImage,
    @tagsJson,
    @createdAt,
    @updatedAt,
    @createdByUserId
  )
`)

const statementUpdateWorldviewMetadata = database.prepare(`
  UPDATE worldviews
  SET name = @name,
      description = @description,
      cover_image = @coverImage,
      tags_json = @tagsJson,
      updated_at = @updatedAt
  WHERE id = @id
`)

const statementSelectDistinctWorldviewNamesFromData = database.prepare(`
  SELECT name
  FROM (
    SELECT worldview AS name
    FROM character_cards
    WHERE worldview != ''

    UNION

    SELECT worldview_name AS name
    FROM age_chronicle_states

    UNION

    SELECT worldview_name AS name
    FROM age_chronicle_entries

    UNION

    SELECT worldview_name AS name
    FROM age_chronicle_structures

    UNION

    SELECT worldview_name AS name
    FROM age_chronicle_cell_notes

    UNION

    SELECT worldview_name AS name
    FROM vertical_timeline_states

    UNION

    SELECT worldview_name AS name
    FROM vertical_timeline_lane_permissions

    UNION

    SELECT worldview AS name
    FROM timeline_events
    WHERE worldview != ''
  )
  WHERE name != ''
  ORDER BY name COLLATE NOCASE ASC
`)

const statementSelectRoomMembershipsForPermissions = database.prepare(`
  SELECT
    room_memberships.room_id AS roomId,
    room_memberships.user_id AS userId,
    room_memberships.role
  FROM room_memberships
  JOIN users ON users.id = room_memberships.user_id
  WHERE users.role != 'admin'
    AND users.status = 'active'
  ORDER BY room_memberships.room_id ASC, room_memberships.created_at ASC
`)

const statementSelectAccessibleRoomForUser = database.prepare(`
  SELECT
    rooms.id,
    rooms.name,
    rooms.created_at AS createdAt
  FROM room_memberships
  JOIN rooms ON rooms.id = room_memberships.room_id
  WHERE room_memberships.user_id = ?
    AND room_memberships.room_id = ?
  LIMIT 1
`)

const statementSelectRoomMembershipsForRoom = database.prepare(`
  SELECT
    room_memberships.user_id AS userId,
    room_memberships.role
  FROM room_memberships
  JOIN users ON users.id = room_memberships.user_id
  WHERE room_memberships.room_id = ?
    AND users.role != 'admin'
`)

const statementCountRooms = database.prepare(`
  SELECT COUNT(*) AS count
  FROM rooms
`)

const statementSelectAgeChronicleState = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    state_json AS stateJson,
    updated_at AS updatedAt,
    updated_by_user_id AS updatedByUserId
  FROM age_chronicle_states
  WHERE worldview_name = ?
  LIMIT 1
`)

const statementUpsertAgeChronicleState = database.prepare(`
  INSERT INTO age_chronicle_states (worldview_name, state_json, updated_at, updated_by_user_id)
  VALUES (@worldviewName, @stateJson, @updatedAt, @updatedByUserId)
  ON CONFLICT(worldview_name) DO UPDATE SET
    state_json = excluded.state_json,
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id
`)

const statementSelectAgeChronicleEntriesForWorldview = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    id,
    label,
    year,
    note,
    visibility,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM age_chronicle_entries
  WHERE worldview_name = ?
  ORDER BY year ASC, created_at ASC, id ASC
`)

const statementSelectAgeChronicleEntry = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    id,
    label,
    year,
    note,
    visibility,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM age_chronicle_entries
  WHERE worldview_name = ?
    AND id = ?
  LIMIT 1
`)

const statementInsertAgeChronicleEntry = database.prepare(`
  INSERT INTO age_chronicle_entries (
    worldview_name,
    id,
    label,
    year,
    note,
    visibility,
    created_by_user_id,
    created_at,
    updated_at
  )
  VALUES (
    @worldviewName,
    @id,
    @label,
    @year,
    @note,
    @visibility,
    @createdByUserId,
    @createdAt,
    @updatedAt
  )
`)

const statementUpdateAgeChronicleEntry = database.prepare(`
  UPDATE age_chronicle_entries
  SET label = @label,
      year = @year,
      note = @note,
      visibility = @visibility,
      updated_at = @updatedAt
  WHERE worldview_name = @worldviewName
    AND id = @id
`)

const statementDeleteAgeChronicleEntry = database.prepare(`
  DELETE FROM age_chronicle_entries
  WHERE worldview_name = ?
    AND id = ?
`)

const statementCountAgeChronicleEntriesForWorldview = database.prepare(`
  SELECT COUNT(*) AS count
  FROM age_chronicle_entries
  WHERE worldview_name = ?
`)

const statementSelectAgeChronicleStructure = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    structure_json AS structureJson,
    updated_at AS updatedAt,
    updated_by_user_id AS updatedByUserId
  FROM age_chronicle_structures
  WHERE worldview_name = ?
  LIMIT 1
`)

const statementUpsertAgeChronicleStructure = database.prepare(`
  INSERT INTO age_chronicle_structures (worldview_name, structure_json, updated_at, updated_by_user_id)
  VALUES (@worldviewName, @structureJson, @updatedAt, @updatedByUserId)
  ON CONFLICT(worldview_name) DO UPDATE SET
    structure_json = excluded.structure_json,
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id
`)

const statementSelectAgeChronicleCellNotesForWorldview = database.prepare(`
  SELECT
    age_chronicle_cell_notes.worldview_name AS worldviewName,
    age_chronicle_cell_notes.profile_id AS profileId,
    age_chronicle_cell_notes.entry_id AS entryId,
    age_chronicle_cell_notes.author_user_id AS authorUserId,
    age_chronicle_cell_notes.body,
    age_chronicle_cell_notes.created_at AS createdAt,
    age_chronicle_cell_notes.updated_at AS updatedAt,
    users.display_name AS authorDisplayName,
    users.handle AS authorHandle
  FROM age_chronicle_cell_notes
  LEFT JOIN users ON users.id = age_chronicle_cell_notes.author_user_id
  WHERE age_chronicle_cell_notes.worldview_name = ?
  ORDER BY age_chronicle_cell_notes.updated_at DESC, age_chronicle_cell_notes.author_user_id ASC
`)

const statementSelectAgeChronicleCellNote = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    profile_id AS profileId,
    entry_id AS entryId,
    author_user_id AS authorUserId,
    body,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM age_chronicle_cell_notes
  WHERE worldview_name = ?
    AND profile_id = ?
    AND entry_id = ?
    AND author_user_id = ?
  LIMIT 1
`)

const statementUpsertAgeChronicleCellNote = database.prepare(`
  INSERT INTO age_chronicle_cell_notes (
    worldview_name,
    profile_id,
    entry_id,
    author_user_id,
    body,
    created_at,
    updated_at
  )
  VALUES (
    @worldviewName,
    @profileId,
    @entryId,
    @authorUserId,
    @body,
    @createdAt,
    @updatedAt
  )
  ON CONFLICT(worldview_name, profile_id, entry_id, author_user_id) DO UPDATE SET
    body = excluded.body,
    updated_at = excluded.updated_at
`)

const statementDeleteAgeChronicleCellNote = database.prepare(`
  DELETE FROM age_chronicle_cell_notes
  WHERE worldview_name = ?
    AND profile_id = ?
    AND entry_id = ?
    AND author_user_id = ?
`)

const statementDeleteAgeChronicleCellNotesForEntry = database.prepare(`
  DELETE FROM age_chronicle_cell_notes
  WHERE worldview_name = ?
    AND entry_id = ?
`)

const statementSelectVerticalTimelineState = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    state_json AS stateJson,
    updated_at AS updatedAt,
    updated_by_user_id AS updatedByUserId
  FROM vertical_timeline_states
  WHERE worldview_name = ?
  LIMIT 1
`)

const statementUpsertVerticalTimelineState = database.prepare(`
  INSERT INTO vertical_timeline_states (worldview_name, state_json, updated_at, updated_by_user_id)
  VALUES (@worldviewName, @stateJson, @updatedAt, @updatedByUserId)
  ON CONFLICT(worldview_name) DO UPDATE SET
    state_json = excluded.state_json,
    updated_at = excluded.updated_at,
    updated_by_user_id = excluded.updated_by_user_id
`)

const statementSelectVerticalTimelineLanePermissionsForWorldview = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    lane_id AS laneId,
    user_id AS userId,
    created_at AS createdAt
  FROM vertical_timeline_lane_permissions
  WHERE worldview_name = ?
  ORDER BY lane_id ASC, created_at ASC, user_id ASC
`)

const statementSelectVerticalTimelineLanePermissionsForLane = database.prepare(`
  SELECT
    worldview_name AS worldviewName,
    lane_id AS laneId,
    user_id AS userId,
    created_at AS createdAt
  FROM vertical_timeline_lane_permissions
  WHERE worldview_name = ?
    AND lane_id = ?
  ORDER BY created_at ASC, user_id ASC
`)

const statementInsertVerticalTimelineLanePermission = database.prepare(`
  INSERT INTO vertical_timeline_lane_permissions (worldview_name, lane_id, user_id, created_at)
  VALUES (@worldviewName, @laneId, @userId, @createdAt)
  ON CONFLICT(worldview_name, lane_id, user_id) DO NOTHING
`)

const statementDeleteVerticalTimelineLanePermissionsForLane = database.prepare(`
  DELETE FROM vertical_timeline_lane_permissions
  WHERE worldview_name = ?
    AND lane_id = ?
`)

const statementDeleteVerticalTimelineLanePermission = database.prepare(`
  DELETE FROM vertical_timeline_lane_permissions
  WHERE worldview_name = @worldviewName
    AND lane_id = @laneId
    AND user_id = @userId
`)

const statementUpdateCharacterCardsWorldview = database.prepare(`
  UPDATE character_cards
  SET worldview = @newWorldviewName
  WHERE worldview = @oldWorldviewName
`)

const statementUpdateTimelineEventsWorldview = database.prepare(`
  UPDATE timeline_events
  SET worldview = @newWorldviewName
  WHERE worldview = @oldWorldviewName
`)

const statementUpdateAgeChronicleStatesWorldview = database.prepare(`
  UPDATE age_chronicle_states
  SET worldview_name = @newWorldviewName
  WHERE worldview_name = @oldWorldviewName
`)

const statementUpdateAgeChronicleEntriesWorldview = database.prepare(`
  UPDATE age_chronicle_entries
  SET worldview_name = @newWorldviewName
  WHERE worldview_name = @oldWorldviewName
`)

const statementUpdateAgeChronicleStructuresWorldview = database.prepare(`
  UPDATE age_chronicle_structures
  SET worldview_name = @newWorldviewName
  WHERE worldview_name = @oldWorldviewName
`)

const statementUpdateAgeChronicleCellNotesWorldview = database.prepare(`
  UPDATE age_chronicle_cell_notes
  SET worldview_name = @newWorldviewName
  WHERE worldview_name = @oldWorldviewName
`)

const statementUpdateVerticalTimelineStateWorldview = database.prepare(`
  UPDATE vertical_timeline_states
  SET worldview_name = @newWorldviewName,
      state_json = @stateJson,
      updated_at = @updatedAt,
      updated_by_user_id = @updatedByUserId
  WHERE worldview_name = @oldWorldviewName
`)

const statementUpdateVerticalTimelineLanePermissionsWorldview = database.prepare(`
  UPDATE vertical_timeline_lane_permissions
  SET worldview_name = @newWorldviewName
  WHERE worldview_name = @oldWorldviewName
`)

const statementInsertRoomMembership = database.prepare(`
  INSERT INTO room_memberships (room_id, user_id, role, created_at)
  VALUES (@roomId, @userId, @role, @createdAt)
  ON CONFLICT(room_id, user_id) DO NOTHING
`)

const statementDeleteRoomMembership = database.prepare(`
  DELETE FROM room_memberships
  WHERE room_id = @roomId
    AND user_id = @userId
`)

const statementDeleteMessagesForRoom = database.prepare(`
  DELETE FROM messages
  WHERE room_id = @roomId
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
  INSERT INTO messages (
    id,
    room_id,
    session_id,
    user_id,
    nickname,
    speaker_name,
    speaker_character_id,
    speaker_avatar_data_url,
    speaker_display_mode,
    reply_to_message_id,
    reply_to_speaker_name,
    reply_to_body,
    deleted_at,
    deleted_by_user_id,
    kind,
    body,
    created_at
  )
  VALUES (
    @id,
    @roomId,
    @sessionId,
    @userId,
    @nickname,
    @speakerName,
    @speakerCharacterId,
    @speakerAvatarDataUrl,
    @speakerDisplayMode,
    @replyToMessageId,
    @replyToSpeakerName,
    @replyToBody,
    @deletedAt,
    @deletedByUserId,
    @kind,
    @body,
    @createdAt
  )
`)

const statementInsertCharacterCard = database.prepare(`
  INSERT INTO character_cards (
    id,
    user_id,
    worldview,
    name,
    color,
    avatar_data_url,
    presentation_mode,
    status,
    is_default,
    created_at,
    updated_at
  )
  VALUES (
    @id,
    @userId,
    @worldview,
    @name,
    @color,
    @avatarDataUrl,
    @presentationMode,
    @status,
    @isDefault,
    @createdAt,
    @updatedAt
  )
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
  SET worldview = @worldview,
      name = @name,
      color = @color,
      avatar_data_url = @avatarDataUrl,
      presentation_mode = @presentationMode,
      updated_at = @updatedAt
  WHERE id = @id AND user_id = @userId
`)

const statementAdminUpdateCharacterCard = database.prepare(`
  UPDATE character_cards
  SET user_id = @userId,
      worldview = @worldview,
      name = @name,
      color = @color,
      avatar_data_url = @avatarDataUrl,
      presentation_mode = @presentationMode,
      status = @status,
      updated_at = @updatedAt
  WHERE id = @id
`)

const statementUpdateCharacterPresentationMode = database.prepare(`
  UPDATE character_cards
  SET presentation_mode = @presentationMode,
      updated_at = @updatedAt
  WHERE id = @id
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
    character_cards.user_id AS userId,
    character_cards.worldview,
    character_cards.name,
    character_cards.color,
    character_cards.avatar_data_url AS avatarDataUrl,
    character_cards.presentation_mode AS presentationMode,
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
    character_cards.user_id AS userId,
    character_cards.worldview,
    character_cards.name,
    character_cards.color,
    character_cards.avatar_data_url AS avatarDataUrl,
    character_cards.presentation_mode AS presentationMode,
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

const statementSelectCharacterCardById = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.user_id AS userId,
    character_cards.worldview,
    character_cards.name,
    character_cards.color,
    character_cards.avatar_data_url AS avatarDataUrl,
    character_cards.presentation_mode AS presentationMode,
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
  WHERE character_cards.id = ?
  LIMIT 1
`)

const statementSelectCharacterCardsForWorldview = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.user_id AS userId,
    character_cards.worldview,
    character_cards.name,
    character_cards.color,
    character_cards.avatar_data_url AS avatarDataUrl,
    character_cards.presentation_mode AS presentationMode,
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
  WHERE character_cards.worldview = ?
    AND character_cards.status != 'archived'
  ORDER BY character_cards.created_at ASC, character_cards.id ASC
`)

const statementSelectAllCharacterCardsForAdmin = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.user_id AS userId,
    character_cards.worldview,
    character_cards.name,
    character_cards.color,
    character_cards.avatar_data_url AS avatarDataUrl,
    character_cards.presentation_mode AS presentationMode,
    character_cards.status,
    character_cards.is_default AS isDefault,
    character_cards.created_at AS createdAt,
    character_cards.updated_at AS updatedAt,
    character_attributes.strength,
    character_attributes.dexterity,
    character_attributes.intelligence,
    character_attributes.luck,
    character_attributes.size,
    character_attributes.constitution,
    character_attributes.education,
    character_attributes.appearance,
    character_attributes.willpower,
    users.handle AS userHandle,
    users.display_name AS userDisplayName,
    users.role AS userRole,
    users.status AS userStatus
  FROM character_cards
  JOIN character_attributes ON character_attributes.character_id = character_cards.id
  JOIN users ON users.id = character_cards.user_id
  WHERE character_cards.status != 'archived'
  ORDER BY character_cards.updated_at DESC, character_cards.created_at DESC
`)

const statementSelectAllActiveUsersForAdmin = database.prepare(`
  SELECT
    id,
    handle,
    display_name AS displayName,
    role,
    status
  FROM users
  WHERE status = 'active'
  ORDER BY display_name COLLATE NOCASE ASC, handle COLLATE NOCASE ASC
`)

const statementCountActiveCharacterCardsForUser = database.prepare(`
  SELECT COUNT(*) AS count
  FROM character_cards
  WHERE user_id = ?
    AND status != 'archived'
`)

const statementSelectDefaultCharacterCardForUser = database.prepare(`
  SELECT id
  FROM character_cards
  WHERE user_id = ?
    AND status != 'archived'
    AND is_default = 1
  LIMIT 1
`)

const statementSelectFirstActiveCharacterCardForUser = database.prepare(`
  SELECT id
  FROM character_cards
  WHERE user_id = ?
    AND status != 'archived'
  ORDER BY created_at ASC, id ASC
  LIMIT 1
`)

const statementClearDefaultCharacterCardsForUser = database.prepare(`
  UPDATE character_cards
  SET is_default = 0,
      updated_at = @updatedAt
  WHERE user_id = @userId
`)

const statementSetDefaultCharacterCard = database.prepare(`
  UPDATE character_cards
  SET is_default = 1,
      updated_at = @updatedAt
  WHERE id = @id
`)

const statementArchiveCharacterCard = database.prepare(`
  UPDATE character_cards
  SET status = 'archived',
      is_default = 0,
      updated_at = @updatedAt
  WHERE id = @id
`)

const statementSelectNarrationCharacterForUser = database.prepare(`
  SELECT
    character_cards.id,
    character_cards.name,
    character_cards.is_default AS isDefault
  FROM character_cards
  WHERE character_cards.user_id = ?
    AND character_cards.status != 'archived'
    AND (
      character_cards.presentation_mode = ?
      OR lower(character_cards.name) = lower(?)
    )
  ORDER BY
    CASE WHEN character_cards.presentation_mode = ? THEN 0 ELSE 1 END ASC,
    character_cards.created_at ASC
  LIMIT 1
`)

const statementSelectMessagesSince = database.prepare(`
  SELECT
    messages.sequence,
    messages.id,
    messages.room_id AS roomId,
    messages.session_id AS sessionId,
    COALESCE(messages.user_id, sessions.user_id) AS userId,
    messages.nickname,
    messages.speaker_name AS speakerName,
    messages.speaker_character_id AS speakerCharacterId,
    messages.speaker_avatar_data_url AS speakerAvatarDataUrl,
    messages.speaker_display_mode AS speakerDisplayMode,
    messages.reply_to_message_id AS replyToMessageId,
    messages.reply_to_speaker_name AS replyToSpeakerName,
    messages.reply_to_body AS replyToBody,
    messages.deleted_at AS deletedAt,
    messages.deleted_by_user_id AS deletedByUserId,
    messages.kind,
    messages.body,
    messages.created_at AS createdAt
  FROM messages
  LEFT JOIN sessions ON sessions.id = messages.session_id
  WHERE messages.room_id = ? AND messages.kind != 'system' AND messages.sequence > ?
  ORDER BY sequence ASC
  LIMIT ?
`)

const statementSelectRecentMessages = database.prepare(`
  SELECT
    recent.sequence,
    recent.id,
    recent.room_id AS roomId,
    recent.session_id AS sessionId,
    COALESCE(recent.user_id, sessions.user_id) AS userId,
    recent.nickname,
    recent.speaker_name AS speakerName,
    recent.speaker_character_id AS speakerCharacterId,
    recent.speaker_avatar_data_url AS speakerAvatarDataUrl,
    recent.speaker_display_mode AS speakerDisplayMode,
    recent.reply_to_message_id AS replyToMessageId,
    recent.reply_to_speaker_name AS replyToSpeakerName,
    recent.reply_to_body AS replyToBody,
    recent.deleted_at AS deletedAt,
    recent.deleted_by_user_id AS deletedByUserId,
    recent.kind,
    recent.body,
    recent.created_at AS createdAt
  FROM (
    SELECT
      sequence,
      id,
      room_id,
      session_id,
      user_id,
      nickname,
      speaker_name,
      speaker_character_id,
      speaker_avatar_data_url,
      speaker_display_mode,
      reply_to_message_id,
      reply_to_speaker_name,
      reply_to_body,
      deleted_at,
      deleted_by_user_id,
      kind,
      body,
      created_at
    FROM messages
    WHERE room_id = ? AND kind != 'system'
    ORDER BY sequence DESC
    LIMIT ?
  ) recent
  LEFT JOIN sessions ON sessions.id = recent.session_id
  ORDER BY sequence ASC
`)

const statementSelectMessageById = database.prepare(`
  SELECT
    messages.sequence,
    messages.id,
    messages.room_id AS roomId,
    messages.session_id AS sessionId,
    COALESCE(messages.user_id, sessions.user_id) AS userId,
    messages.nickname,
    messages.speaker_name AS speakerName,
    messages.speaker_character_id AS speakerCharacterId,
    messages.speaker_avatar_data_url AS speakerAvatarDataUrl,
    messages.speaker_display_mode AS speakerDisplayMode,
    messages.reply_to_message_id AS replyToMessageId,
    messages.reply_to_speaker_name AS replyToSpeakerName,
    messages.reply_to_body AS replyToBody,
    messages.deleted_at AS deletedAt,
    messages.deleted_by_user_id AS deletedByUserId,
    messages.kind,
    messages.body,
    messages.created_at AS createdAt
  FROM messages
  LEFT JOIN sessions ON sessions.id = messages.session_id
  WHERE messages.id = ?
  LIMIT 1
`)

const statementRevokeMessage = database.prepare(`
  UPDATE messages
  SET deleted_at = @deletedAt,
      deleted_by_user_id = @deletedByUserId
  WHERE id = @id
    AND deleted_at IS NULL
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

ensureRoomMembership(PUBLIC_ROOM.id, ADMIN_USER.id, 'owner')
statementDeleteExpiredAuthSessions.run(Date.now())
const adminAccessKeySeed = ensureAdminAccessKey()
const seededUserAccessKeys = ensureSeededUsers()
ensureDefaultManagedWorldviews()
syncWorldviewRecordsFromData()
ensureAdminKpCharacter()

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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
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

function ensureFixedAccessKeyForUser(userId, accessKeyValue, label) {
  const safeAccessKey = sanitiseAccessKey(accessKeyValue)

  if (safeAccessKey === '') {
    return null
  }

  const keyHash = hashSecret(safeAccessKey)
  const existingByHash = statementSelectAccessKeyByHash.get(keyHash)

  if (existingByHash && existingByHash.userId !== userId) {
    throw new Error(`固定密钥冲突：${label} 已被其他账号占用。`)
  }

  const now = Date.now()
  const existingForUser = statementSelectAccessKeyForUserByHash.get(userId, keyHash)
  let accessKeyId = existingForUser?.id ?? null

  if (accessKeyId) {
    statementActivateAccessKey.run({
      id: accessKeyId,
      label,
    })
  } else {
    accessKeyId = createAccessKeyId()
    statementInsertAccessKey.run({
      createdAt: now,
      expiresAt: null,
      id: accessKeyId,
      keyHash,
      label,
      lastUsedAt: null,
      revokedAt: null,
      userId,
    })
  }

  statementRevokeOtherAccessKeysForUser.run({
    keyHash,
    revokedAt: now,
    userId,
  })

  return accessKeyId
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
      'timeline 群聊管理员访问密钥',
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

function ensureRoomMembership(roomId, userId, role = 'member') {
  statementInsertRoomMembership.run({
    createdAt: Date.now(),
    role,
    roomId,
    userId,
  })
}

function createWorldviewId() {
  return `worldview_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function sanitiseWorldviewName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, WORLDVIEW_MAX_NAME_LENGTH)
}

function sanitiseWorldviewDescription(value) {
  return String(value ?? '').trim().slice(0, WORLDVIEW_MAX_DESCRIPTION_LENGTH)
}

function sanitiseWorldviewCoverImage(value) {
  return String(value ?? '').trim().slice(0, WORLDVIEW_MAX_COVER_IMAGE_LENGTH)
}

function sanitiseWorldviewTags(value) {
  const source = Array.isArray(value) ? value : []
  const seenTags = new Set()
  const tags = []

  for (const entry of source) {
    const tag = sanitiseVerticalTimelineShortText(entry, VERTICAL_TIMELINE_MAX_TAG_LENGTH)

    if (tag === '' || seenTags.has(tag)) {
      continue
    }

    seenTags.add(tag)
    tags.push(tag)

    if (tags.length >= VERTICAL_TIMELINE_MAX_TAG_COUNT) {
      break
    }
  }

  return tags
}

function parseWorldviewTags(rawTagsJson) {
  if (typeof rawTagsJson !== 'string' || rawTagsJson.trim() === '') {
    return []
  }

  try {
    return sanitiseWorldviewTags(JSON.parse(rawTagsJson))
  } catch {
    return []
  }
}

function serialiseWorldview(row) {
  return {
    coverImage: sanitiseWorldviewCoverImage(row.coverImage),
    createdAt: Number(row.createdAt ?? 0),
    createdByUserId: String(row.createdByUserId ?? '').trim() || null,
    description: sanitiseWorldviewDescription(row.description),
    id: String(row.id ?? '').trim(),
    name: sanitiseWorldviewName(row.name),
    tags: parseWorldviewTags(row.tagsJson),
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

function hasManagedWorldview(name) {
  const safeName = sanitiseWorldviewName(name)
  return safeName !== '' && Boolean(statementSelectWorldviewByName.get(safeName))
}

function writeManagedWorldviewNotFound(response, headers, worldviewName) {
  writeJson(response, 404, {
    message: `世界观“${sanitiseWorldviewName(worldviewName)}”不存在。`,
    ok: false,
  }, { headers })
}

function ensureWorldviewRecord(name, options = {}) {
  const safeName = sanitiseWorldviewName(name)

  if (safeName === '') {
    return null
  }

  const existing = statementSelectWorldviewByName.get(safeName)

  if (existing) {
    return serialiseWorldview(existing)
  }

  const now = Number.isFinite(Number(options.updatedAt)) ? Number(options.updatedAt) : Date.now()

  statementInsertWorldview.run({
    coverImage: sanitiseWorldviewCoverImage(options.coverImage),
    createdAt: now,
    createdByUserId: String(options.createdByUserId ?? '').trim() || ADMIN_USER.id,
    description: sanitiseWorldviewDescription(options.description) || '当前世界观简介尚待补充。',
    id: createWorldviewId(),
    name: safeName,
    tagsJson: JSON.stringify(sanitiseWorldviewTags(options.tags)),
    updatedAt: now,
  })

  return serialiseWorldview(statementSelectWorldviewByName.get(safeName))
}

function ensureDefaultManagedWorldviews() {
  const now = Date.now()

  for (const worldview of DEFAULT_MANAGED_WORLDVIEWS) {
    ensureWorldviewRecord(worldview.name, {
      coverImage: worldview.coverImage,
      createdByUserId: ADMIN_USER.id,
      description: worldview.description,
      tags: worldview.tags,
      updatedAt: now,
    })
  }
}

function syncWorldviewRecordsFromData() {
  for (const row of statementSelectDistinctWorldviewNamesFromData.all()) {
    ensureWorldviewRecord(row.name, { createdByUserId: ADMIN_USER.id })
  }
}

function rewriteVerticalTimelineStateJsonWorldview(rawStateJson, nextWorldviewName) {
  try {
    const parsed = JSON.parse(rawStateJson)
    const safeState = sanitiseVerticalTimelineState(parsed, nextWorldviewName)
      ?? createDefaultVerticalTimelineState(nextWorldviewName)
    return JSON.stringify(safeState)
  } catch {
    return JSON.stringify(createDefaultVerticalTimelineState(nextWorldviewName))
  }
}

const renameWorldviewReferences = database.transaction((worldviewId, payload, updatedByUserId) => {
  const existingRow = statementSelectWorldviewById.get(worldviewId)

  if (!existingRow) {
    return {
      error: '目标世界观不存在。',
      status: 404,
    }
  }

  const existing = serialiseWorldview(existingRow)
  const nextName = sanitiseWorldviewName(payload?.name)

  if (nextName === '') {
    return {
      error: '世界观名称不能为空。',
      status: 400,
    }
  }

  const conflicting = statementSelectWorldviewByName.get(nextName)

  if (conflicting && conflicting.id !== existing.id) {
    return {
      error: `世界观“${nextName}”已经存在。`,
      status: 409,
    }
  }

  const updatedAt = Date.now()
  const description = sanitiseWorldviewDescription(payload?.description) || '当前世界观简介尚待补充。'
  const coverImage = sanitiseWorldviewCoverImage(payload?.coverImage)
  const tags = sanitiseWorldviewTags(payload?.tags)

  if (existing.name !== nextName) {
    const verticalTimelineRow = statementSelectVerticalTimelineState.get(existing.name)
    const nextStateJson = verticalTimelineRow
      ? rewriteVerticalTimelineStateJsonWorldview(verticalTimelineRow.stateJson, nextName)
      : null

    statementUpdateCharacterCardsWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
    statementUpdateTimelineEventsWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
    statementUpdateAgeChronicleStatesWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
    statementUpdateAgeChronicleEntriesWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
    statementUpdateAgeChronicleStructuresWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
    statementUpdateAgeChronicleCellNotesWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })

    if (nextStateJson !== null) {
      statementUpdateVerticalTimelineStateWorldview.run({
        newWorldviewName: nextName,
        oldWorldviewName: existing.name,
        stateJson: nextStateJson,
        updatedAt,
        updatedByUserId,
      })
    }

    statementUpdateVerticalTimelineLanePermissionsWorldview.run({
      newWorldviewName: nextName,
      oldWorldviewName: existing.name,
    })
  }

  statementUpdateWorldviewMetadata.run({
    coverImage,
    description,
    id: existing.id,
    name: nextName,
    tagsJson: JSON.stringify(tags),
    updatedAt,
  })

  return {
    previousName: existing.name,
    worldview: serialiseWorldview(statementSelectWorldviewById.get(existing.id)),
  }
})

function ensureSeededUsers() {
  const now = Date.now()

  for (const user of SEEDED_CHAT_USERS) {
    const existingUser = statementSelectUser.get(user.id)

    if (!existingUser) {
      statementUpsertUser.run({
        ...user,
        createdAt: now,
        updatedAt: now,
      })

      // 只在首次落库时给种子用户默认开放公共群聊，避免重启后覆盖管理员手动调整的公共房间权限。
      ensureRoomMembership(PUBLIC_ROOM.id, user.id)
    }

    ensureFixedAccessKeyForUser(user.id, user.accessKey, `seeded-fixed：${user.handle}`)
  }

  const sections = [
    'Morosonder 群聊固定种子用户访问密钥',
    `生成时间：${new Date().toISOString()}`,
    '',
  ]

  for (const user of SEEDED_CHAT_USERS) {
    sections.push(`${user.handle} (${user.displayName})：${user.accessKey}`)
  }

  sections.push('')
  sections.push('说明：这些普通用户密钥为固定值；服务启动时会强制写入数据库，并撤销同账号下的其他旧密钥。')
  sections.push('说明：admin 密钥仍沿用原有逻辑，不受这里的强制同步影响。')
  sections.push('')

  fs.writeFileSync(SEEDED_USER_ACCESS_KEY_FILE, sections.join('\n'), 'utf8')

  return {
    filePath: SEEDED_USER_ACCESS_KEY_FILE,
    synchronisedCount: SEEDED_CHAT_USERS.length,
  }
}

function ensureAdminKpCharacter() {
  const existingCharacter = statementSelectNarrationCharacterForUser.get(
    ADMIN_USER.id,
    CHAT_PRESENTATION_KP_NARRATION,
    ADMIN_KP_CHARACTER_NAME,
    CHAT_PRESENTATION_KP_NARRATION,
  )

  if (existingCharacter) {
    statementUpdateCharacterPresentationMode.run({
      id: existingCharacter.id,
      presentationMode: CHAT_PRESENTATION_KP_NARRATION,
      updatedAt: Date.now(),
    })
    return existingCharacter.id
  }

  const existingCharacters = getCharacterCardsForUser(ADMIN_USER.id)
  const characterId = createCharacterId()
  const now = Date.now()

  statementInsertCharacterCard.run({
    createdAt: now,
    id: characterId,
    isDefault: existingCharacters.length === 0 ? 1 : 0,
    name: ADMIN_KP_CHARACTER_NAME,
    avatarDataUrl: null,
    presentationMode: CHAT_PRESENTATION_KP_NARRATION,
    status: 'active',
    updatedAt: now,
    userId: ADMIN_USER.id,
  })

  statementInsertCharacterAttributes.run({
    appearance: 0,
    characterId,
    constitution: 0,
    createdAt: now,
    dexterity: 0,
    education: 0,
    intelligence: 0,
    luck: 0,
    size: 0,
    strength: 0,
    updatedAt: now,
    willpower: 0,
  })

  return characterId
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

function buildReplyPreviewBody(value) {
  const compact = String(value ?? '').replace(/\s+/g, ' ').trim()
  return compact.slice(0, MAX_REPLY_PREVIEW_LENGTH)
}

function sanitiseRoomName(value) {
  const roomName = String(value ?? '').replace(/\s+/g, ' ').trim()
  return roomName.slice(0, MAX_ROOM_NAME_LENGTH)
}

function sanitiseCharacterName(value) {
  const characterName = String(value ?? '').replace(/\s+/g, ' ').trim()
  return characterName.slice(0, MAX_CHARACTER_NAME_LENGTH)
}

function sanitiseAgeChronicleWorldview(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, AGE_CHRONICLE_MAX_WORLDVIEW_LENGTH)
}

function sanitiseAgeChronicleShortText(value, maxLength, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const safeText = text.slice(0, maxLength)
  return safeText === '' ? fallback : safeText
}

function sanitiseAgeChronicleLongText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function sanitiseVerticalTimelineWorldview(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, VERTICAL_TIMELINE_MAX_WORLDVIEW_LENGTH)
}

function sanitiseVerticalTimelineShortText(value, maxLength, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  const safeText = text.slice(0, maxLength)
  return safeText === '' ? fallback : safeText
}

function sanitiseVerticalTimelineLongText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function sanitiseVerticalTimelineColor(value, fallback = '#64748b') {
  const color = sanitiseVerticalTimelineShortText(
    value,
    VERTICAL_TIMELINE_MAX_COLOR_LENGTH,
    fallback,
  )

  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.test(color) ? color : fallback
}

function sanitiseVerticalTimelineTags(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const uniqueTags = []
  const seenTags = new Set()

  for (const entry of value) {
    const tag = sanitiseVerticalTimelineShortText(entry, VERTICAL_TIMELINE_MAX_TAG_LENGTH)

    if (tag === '') {
      continue
    }

    const dedupeKey = tag.toLocaleLowerCase('zh-CN')

    if (seenTags.has(dedupeKey)) {
      continue
    }

    seenTags.add(dedupeKey)
    uniqueTags.push(tag)

    if (uniqueTags.length >= VERTICAL_TIMELINE_MAX_TAG_COUNT) {
      break
    }
  }

  return uniqueTags
}

function normaliseAgeChronicleNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveAgeChronicleNextIndex(value, prefix, ids, fallback) {
  const customIndex = ids.reduce((maxValue, id) => {
    if (!id.startsWith(prefix)) {
      return maxValue
    }

    const parsed = Number.parseInt(id.slice(prefix.length), 10)
    return Number.isFinite(parsed) ? Math.max(maxValue, parsed) : maxValue
  }, fallback)

  const candidate = Number(value)
  return Number.isFinite(candidate) ? Math.max(customIndex, candidate) : customIndex
}

function sanitiseAgeChronicleState(input) {
  if (!input || typeof input !== 'object') {
    return null
  }

  const chronicleEntriesSource = Array.isArray(input.chronicleEntries)
    ? input.chronicleEntries.slice(0, AGE_CHRONICLE_MAX_CHRONICLE_COUNT)
    : []
  const characterProfilesSource = Array.isArray(input.characterProfiles)
    ? input.characterProfiles.slice(0, AGE_CHRONICLE_MAX_CHARACTER_COUNT)
    : []

  const chronicleEntries = chronicleEntriesSource.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const year = normaliseAgeChronicleNumber(entry.year, index)
    const id = sanitiseAgeChronicleShortText(entry.id, 96, `chronicle_${index + 1}`)
    const label = sanitiseAgeChronicleShortText(
      entry.label,
      AGE_CHRONICLE_MAX_LABEL_LENGTH,
      `新编年 ${year}`,
    )

    return [
      {
        id,
        label,
        note: sanitiseAgeChronicleLongText(entry.note, AGE_CHRONICLE_MAX_NOTE_LENGTH),
        year,
      },
    ]
  })

  const characterProfiles = characterProfilesSource.flatMap((profile, index) => {
    if (!profile || typeof profile !== 'object') {
      return []
    }

    const id = sanitiseAgeChronicleShortText(profile.id, 96, `char_${index + 1}`)
    return [
      {
        anchorAge: Math.max(0, normaliseAgeChronicleNumber(profile.anchorAge, 0)),
        anchorYear: normaliseAgeChronicleNumber(profile.anchorYear, 0),
        color: sanitiseAgeChronicleShortText(profile.color, AGE_CHRONICLE_MAX_COLOR_LENGTH, '#a46245'),
        id,
        name: sanitiseAgeChronicleShortText(
          profile.name,
          AGE_CHRONICLE_MAX_CHARACTER_DISPLAY_NAME_LENGTH,
          '未命名角色',
        ),
      },
    ]
  })

  const validEntryIds = new Set(chronicleEntries.map((entry) => entry.id))
  const validProfileIds = new Set(characterProfiles.map((profile) => profile.id))
  const hiddenCharacterIds = Array.isArray(input.hiddenCharacterIds)
    ? input.hiddenCharacterIds.flatMap((profileId) =>
        typeof profileId === 'string' && validProfileIds.has(profileId) ? [profileId] : [],
      )
    : []

  const cellDescriptions = {}

  if (input.cellDescriptions && typeof input.cellDescriptions === 'object') {
    for (const [key, value] of Object.entries(input.cellDescriptions)) {
      if (typeof value !== 'string') {
        continue
      }

      const [profileId, entryId] = key.split('::')

      if (!validProfileIds.has(profileId) || !validEntryIds.has(entryId)) {
        continue
      }

      const description = sanitiseAgeChronicleLongText(value, AGE_CHRONICLE_MAX_CELL_DESCRIPTION_LENGTH)

      if (description !== '') {
        cellDescriptions[`${profileId}::${entryId}`] = description
      }
    }
  }

  return {
    cellDescriptions,
    characterProfiles,
    chronicleEntries,
    hiddenCharacterIds,
    nextCharacterIndex: resolveAgeChronicleNextIndex(
      input.nextCharacterIndex,
      'char_custom_',
      characterProfiles.map((profile) => profile.id),
      characterProfiles.length,
    ),
    nextChronicleIndex: resolveAgeChronicleNextIndex(
      input.nextChronicleIndex,
      'chronicle_custom_',
      chronicleEntries.map((entry) => entry.id),
      chronicleEntries.length,
    ),
  }
}

function normaliseAgeChronicleVisibility(value) {
  return value === AGE_CHRONICLE_VISIBILITY_PUBLIC
    ? AGE_CHRONICLE_VISIBILITY_PUBLIC
    : AGE_CHRONICLE_VISIBILITY_PRIVATE
}

function sanitiseAgeChronicleStructure(input) {
  if (!input || typeof input !== 'object') {
    return null

   }

  const characterProfilesSource = Array.isArray(input.characterProfiles)
    ? input.characterProfiles.slice(0, AGE_CHRONICLE_MAX_CHARACTER_COUNT)
    : []

  const characterProfiles = characterProfilesSource.flatMap((profile, index) => {
    if (!profile || typeof profile !== 'object') {
      return []
    }

    const id = sanitiseAgeChronicleShortText(profile.id, 96, `char_${index + 1}`)
    return [
      {
        anchorAge: Math.max(0, normaliseAgeChronicleNumber(profile.anchorAge, 0)),
        anchorYear: normaliseAgeChronicleNumber(profile.anchorYear, 0),
        color: sanitiseAgeChronicleShortText(profile.color, AGE_CHRONICLE_MAX_COLOR_LENGTH, '#a46245'),
        id,
        name: sanitiseAgeChronicleShortText(
          profile.name,
          AGE_CHRONICLE_MAX_CHARACTER_DISPLAY_NAME_LENGTH,
          '未命名角色',
        ),
      },
    ]
  })

  const safeProfiles = characterProfiles.length > 0
    ? characterProfiles
    : DEFAULT_AGE_CHARACTER_PROFILES.map((profile) => ({ ...profile }))

  return {
    characterProfiles: safeProfiles,
    nextCharacterIndex: resolveAgeChronicleNextIndex(
      input.nextCharacterIndex,
      'char_custom_',
      safeProfiles.map((profile) => profile.id),
      safeProfiles.length,
    ),
  }
}

function createDefaultAgeChronicleStructure() {
  return {
    characterProfiles: DEFAULT_AGE_CHARACTER_PROFILES.map((profile) => ({ ...profile })),
    nextCharacterIndex: DEFAULT_AGE_CHARACTER_PROFILES.length,
  }
}

function createDefaultAgeChronicleEntries(ownerUserId = ADMIN_USER.id, timestamp = Date.now()) {
  return DEFAULT_AGE_CHRONICLE_ENTRIES.map((entry) => ({
    createdAt: timestamp,
    createdByUserId: ownerUserId,
    id: entry.id,
    label: entry.label,
    note: entry.note,
    updatedAt: timestamp,
    visibility: AGE_CHRONICLE_VISIBILITY_PUBLIC,
    worldviewName: '',
    year: entry.year,
  }))
}

function serialiseAgeChronicleEntry(row) {
  return {
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId ?? null,
    id: row.id,
    label: row.label,
    note: row.note,
    updatedAt: row.updatedAt,
    visibility: normaliseAgeChronicleVisibility(row.visibility),
    year: row.year,
  }
}

function serialiseAgeChronicleCellNote(row) {
  return {
    authorDisplayName: row.authorDisplayName ?? row.authorHandle ?? '未知用户',
    authorUserId: row.authorUserId,
    body: row.body,
    createdAt: row.createdAt,
    entryId: row.entryId,
    profileId: row.profileId,
    updatedAt: row.updatedAt,
  }
}

function createAgeChronicleEntryId() {
  return `chronicle_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function extractAgeChronicleStructureFromCompatState(input) {
  if (input && typeof input === 'object' && 'characterProfiles' in input) {
    return sanitiseAgeChronicleStructure(input)
  }

  const legacyState = sanitiseAgeChronicleState(input)

  if (!legacyState) {
    return null
  }

  return {
    characterProfiles: legacyState.characterProfiles,
    nextCharacterIndex: legacyState.nextCharacterIndex,
  }
}

function upsertAgeChronicleStructure(worldviewName, structure, updatedByUserId, updatedAt = Date.now()) {
  statementUpsertAgeChronicleStructure.run({
    structureJson: JSON.stringify(structure),
    updatedAt,
    updatedByUserId,
    worldviewName,
  })
}

function getAgeChronicleStructure(worldviewName) {
  const row = statementSelectAgeChronicleStructure.get(worldviewName)

  if (!row) {
    return createDefaultAgeChronicleStructure()
  }

  try {
    return sanitiseAgeChronicleStructure(JSON.parse(row.structureJson)) ?? createDefaultAgeChronicleStructure()
  } catch {
    return createDefaultAgeChronicleStructure()
  }
}

function seedDefaultAgeChronicleWorldview(worldviewName) {
  const now = Date.now()
  const structure = createDefaultAgeChronicleStructure()

  upsertAgeChronicleStructure(worldviewName, structure, ADMIN_USER.id, now)

  for (const entry of createDefaultAgeChronicleEntries(ADMIN_USER.id, now)) {
    statementInsertAgeChronicleEntry.run({
      ...entry,
      worldviewName,
    })
  }
}

function migrateLegacyAgeChronicleWorldview(worldviewName, row) {
  let legacyState = null

  try {
    legacyState = sanitiseAgeChronicleState(JSON.parse(row.stateJson))
  } catch {
    legacyState = null
  }

  if (!legacyState) {
    seedDefaultAgeChronicleWorldview(worldviewName)
    return
  }

  const ownerUserId = row.updatedByUserId ?? ADMIN_USER.id
  const updatedAt = row.updatedAt ?? Date.now()

  upsertAgeChronicleStructure(
    worldviewName,
    {
      characterProfiles: legacyState.characterProfiles,
      nextCharacterIndex: legacyState.nextCharacterIndex,
    },
    ownerUserId,
    updatedAt,
  )

  for (const entry of legacyState.chronicleEntries) {
    statementInsertAgeChronicleEntry.run({
      createdAt: updatedAt,
      createdByUserId: ownerUserId,
      id: entry.id,
      label: entry.label,
      note: entry.note,
      updatedAt,
      visibility: AGE_CHRONICLE_VISIBILITY_PUBLIC,
      worldviewName,
      year: entry.year,
    })
  }

  for (const [key, body] of Object.entries(legacyState.cellDescriptions)) {
    const [profileId, entryId] = key.split('::')

    if (profileId === '' || entryId === '' || body.trim() === '') {
      continue
    }

    statementUpsertAgeChronicleCellNote.run({
      authorUserId: ADMIN_USER.id,
      body,
      createdAt: updatedAt,
      entryId,
      profileId,
      updatedAt,
      worldviewName,
    })
  }
}

function ensureAgeChronicleWorldviewInitialised(worldviewName) {
  const hasEntries = Number(statementCountAgeChronicleEntriesForWorldview.get(worldviewName)?.count ?? 0) > 0
  const hasStructure = Boolean(statementSelectAgeChronicleStructure.get(worldviewName))

  if (hasEntries || hasStructure) {
    if (!hasStructure) {
      upsertAgeChronicleStructure(
        worldviewName,
        createDefaultAgeChronicleStructure(),
        ADMIN_USER.id,
        Date.now(),
      )
    }
    return
  }

  const legacyRow = statementSelectAgeChronicleState.get(worldviewName)

  if (legacyRow) {
    migrateLegacyAgeChronicleWorldview(worldviewName, legacyRow)
    return
  }

  seedDefaultAgeChronicleWorldview(worldviewName)
}

function isAgeChronicleEntryVisibleToUser(entry, userId) {
  if (entry.visibility === AGE_CHRONICLE_VISIBILITY_PUBLIC) {
    return true
  }

  if (userId && isAdminUser(userId)) {
    return true
  }

  return Boolean(userId) && entry.createdByUserId === userId
}

function buildAgeChronicleCapabilities(authContext) {
  const isAdmin = authContext?.user.role === 'admin'
  const isAuthenticated = Boolean(authContext?.user)

  return {
    canCreateEntry: isAuthenticated,
    canEditOwnCellNote: isAuthenticated,
    canEditSharedStructure: isAdmin,
    canManageEntry: isAdmin,
  }
}

function buildAgeChronicleStateForViewer(worldviewName, authContext) {
  if (!hasManagedWorldview(worldviewName)) {
    return null
  }

  ensureAgeChronicleWorldviewInitialised(worldviewName)

  const structureRow = statementSelectAgeChronicleStructure.get(worldviewName)
  const structure = getAgeChronicleStructure(worldviewName)
  const allEntries = statementSelectAgeChronicleEntriesForWorldview
    .all(worldviewName)
    .map(serialiseAgeChronicleEntry)
  const viewerUserId = authContext?.user.id ?? ''
  const visibleEntries = allEntries.filter((entry) => isAgeChronicleEntryVisibleToUser(entry, viewerUserId))
  const visibleEntryIds = new Set(visibleEntries.map((entry) => entry.id))
  const validProfileIds = new Set(structure.characterProfiles.map((profile) => profile.id))
  const ownCellDescriptions = {}
  const adminCellNotes = {}
  const isAdmin = viewerUserId !== '' && isAdminUser(viewerUserId)

  for (const noteRow of statementSelectAgeChronicleCellNotesForWorldview.all(worldviewName)) {
    const note = serialiseAgeChronicleCellNote(noteRow)

    if (!visibleEntryIds.has(note.entryId) || !validProfileIds.has(note.profileId)) {
      continue
    }

    const key = `${note.profileId}::${note.entryId}`

    if (note.authorUserId === viewerUserId) {
      ownCellDescriptions[key] = note.body
    }

    if (isAdmin) {
      if (!adminCellNotes[key]) {
        adminCellNotes[key] = []
      }

      adminCellNotes[key].push({
        authorDisplayName: note.authorDisplayName,
        authorUserId: note.authorUserId,
        body: note.body,
        updatedAt: note.updatedAt,
      })
    }
  }

  return {
    capabilities: buildAgeChronicleCapabilities(authContext),
    state: {
      adminCellNotes,
      characterProfiles: structure.characterProfiles,
      chronicleEntries: visibleEntries,
      nextCharacterIndex: structure.nextCharacterIndex,
      ownCellDescriptions,
    },
    updatedAt: Math.max(
      ...visibleEntries.map((entry) => entry.updatedAt),
      Number(structureRow?.updatedAt ?? 0),
    ),
  }
}

function cloneVerticalTimelineBubble(bubble) {
  return bubble && typeof bubble === 'object'
    ? {
        id: bubble.id,
        title: bubble.title,
      }
    : null
}

function cloneVerticalTimelineBubbles(bubblesByLane) {
  return Object.fromEntries(
    Object.entries(bubblesByLane).map(([laneId, bubble]) => [laneId, cloneVerticalTimelineBubble(bubble)]),
  )
}

function cloneVerticalTimelineState(state) {
  return {
    events: state.events.map((event) => ({
      ...event,
      tags: [...event.tags],
    })),
    lanes: state.lanes.map((lane) => ({ ...lane })),
    years: state.years.map((year) => ({
      ...year,
      bubblesByLane: cloneVerticalTimelineBubbles(year.bubblesByLane),
      months: year.months.map((month) => ({
        ...month,
        bubblesByLane: cloneVerticalTimelineBubbles(month.bubblesByLane),
        days: month.days.map((day) => ({
          ...day,
          bubblesByLane: cloneVerticalTimelineBubbles(day.bubblesByLane),
        })),
      })),
    })),
  }
}

function createVerticalTimelineBubbleMapTemplate(lanes) {
  return Object.fromEntries(lanes.map((lane) => [lane.id, null]))
}

function syncVerticalTimelineBubbleMapKeys(bubblesByLane, laneIds) {
  return Object.fromEntries(
    laneIds.map((laneId) => [laneId, cloneVerticalTimelineBubble(bubblesByLane?.[laneId] ?? null)]),
  )
}

function syncVerticalTimelineYearsWithLanes(years, lanes) {
  const laneIds = lanes.map((lane) => lane.id)

  return years.map((year) => ({
    ...year,
    bubblesByLane: syncVerticalTimelineBubbleMapKeys(year.bubblesByLane, laneIds),
    months: year.months.map((month) => ({
      ...month,
      bubblesByLane: syncVerticalTimelineBubbleMapKeys(month.bubblesByLane, laneIds),
      days: month.days.map((day) => ({
        ...day,
        bubblesByLane: syncVerticalTimelineBubbleMapKeys(day.bubblesByLane, laneIds),
      })),
    })),
  }))
}

function flattenVerticalTimelineNodes(years) {
  return years.flatMap((year) => [
    {
      id: year.id,
      kind: 'year',
      label: year.label,
      parentMonthId: null,
      parentYearId: null,
    },
    ...year.months.flatMap((month) => [
      {
        id: month.id,
        kind: 'month',
        label: month.label,
        parentMonthId: null,
        parentYearId: year.id,
      },
      ...month.days.map((day) => ({
        id: day.id,
        kind: 'day',
        label: day.label,
        parentMonthId: month.id,
        parentYearId: year.id,
      })),
    ]),
  ])
}

function findVerticalTimelineNode(years, nodeId) {
  for (const year of years) {
    if (year.id === nodeId) {
      return {
        day: null,
        kind: 'year',
        month: null,
        year,
      }
    }

    for (const month of year.months) {
      if (month.id === nodeId) {
        return {
          day: null,
          kind: 'month',
          month,
          year,
        }
      }

      for (const day of month.days) {
        if (day.id === nodeId) {
          return {
            day,
            kind: 'day',
            month,
            year,
          }
        }
      }
    }
  }

  return null
}

function getVerticalTimelineBubbleAtNode(years, nodeId, laneId) {
  const node = findVerticalTimelineNode(years, nodeId)

  if (!node) {
    return null
  }

  if (node.kind === 'year') {
    return node.year.bubblesByLane[laneId] ?? null
  }

  if (node.kind === 'month' && node.month) {
    return node.month.bubblesByLane[laneId] ?? null
  }

  if (node.kind === 'day' && node.day) {
    return node.day.bubblesByLane[laneId] ?? null
  }

  return null
}

function setVerticalTimelineBubbleAtNode(years, nodeId, laneId, bubble) {
  return years.map((year) => {
    if (year.id === nodeId) {
      return {
        ...year,
        bubblesByLane: {
          ...year.bubblesByLane,
          [laneId]: cloneVerticalTimelineBubble(bubble),
        },
      }
    }

    return {
      ...year,
      months: year.months.map((month) => {
        if (month.id === nodeId) {
          return {
            ...month,
            bubblesByLane: {
              ...month.bubblesByLane,
              [laneId]: cloneVerticalTimelineBubble(bubble),
            },
          }
        }

        return {
          ...month,
          days: month.days.map((day) =>
            day.id === nodeId
              ? {
                  ...day,
                  bubblesByLane: {
                    ...day.bubblesByLane,
                    [laneId]: cloneVerticalTimelineBubble(bubble),
                  },
                }
              : day,
          ),
        }
      }),
    }
  })
}

function clearVerticalTimelineEventReferences(years, eventId) {
  const clearBubbleMap = (bubblesByLane) =>
    Object.fromEntries(
      Object.entries(bubblesByLane).map(([laneId, bubble]) => [
        laneId,
        bubble?.id === eventId ? null : cloneVerticalTimelineBubble(bubble),
      ]),
    )

  return years.map((year) => ({
    ...year,
    bubblesByLane: clearBubbleMap(year.bubblesByLane),
    months: year.months.map((month) => ({
      ...month,
      bubblesByLane: clearBubbleMap(month.bubblesByLane),
      days: month.days.map((day) => ({
        ...day,
        bubblesByLane: clearBubbleMap(day.bubblesByLane),
      })),
    })),
  }))
}

function deriveVerticalTimelineSummary(bodyText, title) {
  const trimmed = String(bodyText ?? '').trim().replace(/\s+/g, ' ')

  if (trimmed === '') {
    return `${title} 的预览内容暂未填写。`
  }

  return trimmed.slice(0, 72)
}

function parseVerticalTimelinePointValue(label) {
  const digits = String(label ?? '').replace(/[^\d]+/g, '')
  const parsed = Number(digits)

  return Number.isFinite(parsed) ? parsed : 0
}

function compareVerticalTimelineNodesByLabel(left, right) {
  const pointDifference = parseVerticalTimelinePointValue(left?.label) - parseVerticalTimelinePointValue(right?.label)

  if (pointDifference !== 0) {
    return pointDifference
  }

  const labelDifference = String(left?.label ?? '').localeCompare(String(right?.label ?? ''), 'zh-CN', {
    numeric: true,
  })

  if (labelDifference !== 0) {
    return labelDifference
  }

  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
}

function sortVerticalTimelineYears(years) {
  return [...years]
    .map((year) => ({
      ...year,
      months: [...year.months]
        .map((month) => ({
          ...month,
          days: [...month.days].sort(compareVerticalTimelineNodesByLabel),
        }))
        .sort(compareVerticalTimelineNodesByLabel),
    }))
    .sort(compareVerticalTimelineNodesByLabel)
}

function createVerticalTimelineId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function createVerticalTimelineLaneId() {
  return createVerticalTimelineId('lane')
}

function createVerticalTimelineNodeId(kind) {
  return createVerticalTimelineId(kind)
}

function createVerticalTimelineEventId() {
  return createVerticalTimelineId('event')
}

function sanitiseVerticalTimelineState(input, worldviewName = '') {
  if (!input || typeof input !== 'object') {
    return null
  }

  const lanesSource = Array.isArray(input.lanes)
    ? input.lanes.slice(0, VERTICAL_TIMELINE_MAX_LANE_COUNT)
    : []
  const seenLaneIds = new Set()
  const lanes = lanesSource.flatMap((lane, index) => {
    if (!lane || typeof lane !== 'object') {
      return []
    }

    const id = sanitiseVerticalTimelineShortText(lane.id, 96, `lane_${index + 1}`)
    const name = sanitiseVerticalTimelineShortText(
      lane.name,
      VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
      '未命名角色',
    )

    if (id === '' || seenLaneIds.has(id)) {
      return []
    }

    seenLaneIds.add(id)

    return [
      {
        color: sanitiseVerticalTimelineColor(lane.color, '#64748b'),
        id,
        name,
      },
    ]
  })

  const laneIds = lanes.map((lane) => lane.id)
  const nodeIds = new Set()
  let monthCount = 0
  let dayCount = 0
  const sanitiseBubbleMap = (value) =>
    Object.fromEntries(
      lanes.map((lane) => {
        const candidate = value && typeof value === 'object' ? value[lane.id] : null

        if (!candidate || typeof candidate !== 'object') {
          return [lane.id, null]
        }

        const id = sanitiseVerticalTimelineShortText(candidate.id, 96)

        if (id === '') {
          return [lane.id, null]
        }

        return [
          lane.id,
          {
            id,
            title: sanitiseVerticalTimelineShortText(
              candidate.title,
              VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
              '未命名事件',
            ),
          },
        ]
      }),
    )
  const yearsSource = Array.isArray(input.years)
    ? input.years.slice(0, VERTICAL_TIMELINE_MAX_YEAR_COUNT)
    : []
  const years = yearsSource.flatMap((year, yearIndex) => {
    if (!year || typeof year !== 'object') {
      return []
    }

    const yearId = sanitiseVerticalTimelineShortText(year.id, 96, `year_${yearIndex + 1}`)
    const yearLabel = sanitiseVerticalTimelineShortText(
      year.label,
      VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
      `第 ${yearIndex + 1} 年`,
    )

    if (yearId === '' || nodeIds.has(yearId)) {
      return []
    }

    nodeIds.add(yearId)
    const monthsSource = Array.isArray(year.months) ? year.months : []
    const months = []

    for (const month of monthsSource) {
      if (monthCount >= VERTICAL_TIMELINE_MAX_MONTH_COUNT) {
        break
      }

      if (!month || typeof month !== 'object') {
        continue
      }

      const monthId = sanitiseVerticalTimelineShortText(month.id, 96, `month_${monthCount + 1}`)
      const monthLabel = sanitiseVerticalTimelineShortText(
        month.label,
        VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
        `第 ${monthCount + 1} 月`,
      )

      if (monthId === '' || nodeIds.has(monthId)) {
        continue
      }

      nodeIds.add(monthId)
      monthCount += 1
      const daysSource = Array.isArray(month.days) ? month.days : []
      const days = []

      for (const day of daysSource) {
        if (dayCount >= VERTICAL_TIMELINE_MAX_DAY_COUNT) {
          break
        }

        if (!day || typeof day !== 'object') {
          continue
        }

        const dayId = sanitiseVerticalTimelineShortText(day.id, 96, `day_${dayCount + 1}`)
        const dayLabel = sanitiseVerticalTimelineShortText(
          day.label,
          VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
          `第 ${dayCount + 1} 日`,
        )

        if (dayId === '' || nodeIds.has(dayId)) {
          continue
        }

        nodeIds.add(dayId)
        dayCount += 1
        days.push({
          bubblesByLane: sanitiseBubbleMap(day.bubblesByLane),
          id: dayId,
          label: dayLabel,
        })
      }

      months.push({
        bubblesByLane: sanitiseBubbleMap(month.bubblesByLane),
        days,
        id: monthId,
        label: monthLabel,
      })
    }

    return [
      {
        bubblesByLane: sanitiseBubbleMap(year.bubblesByLane),
        id: yearId,
        label: yearLabel,
        months,
      },
    ]
  })
  const safeYears = sortVerticalTimelineYears(syncVerticalTimelineYearsWithLanes(years, lanes))
  const nodeIdSet = new Set(flattenVerticalTimelineNodes(safeYears).map((node) => node.id))
  const laneIdSet = new Set(laneIds)
  const seenEventIds = new Set()
  const eventsSource = Array.isArray(input.events)
    ? input.events.slice(0, VERTICAL_TIMELINE_MAX_EVENT_COUNT)
    : []
  const events = eventsSource.flatMap((event) => {
    if (!event || typeof event !== 'object') {
      return []
    }

    const id = sanitiseVerticalTimelineShortText(event.id, 96)
    const nodeId = sanitiseVerticalTimelineShortText(event.nodeId, 96)
    const laneId = sanitiseVerticalTimelineShortText(event.laneId, 96)
    const title = sanitiseVerticalTimelineShortText(
      event.title,
      VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
      '未命名事件',
    )

    if (
      id === '' ||
      nodeId === '' ||
      laneId === '' ||
      !nodeIdSet.has(nodeId) ||
      !laneIdSet.has(laneId) ||
      seenEventIds.has(id)
    ) {
      return []
    }

    seenEventIds.add(id)
    const label = getVerticalTimelinePointLabelByNodeId(safeYears, nodeId)
    const pointValue = parseVerticalTimelinePointValue(label)

    return [
      {
        body: sanitiseVerticalTimelineLongText(event.body, VERTICAL_TIMELINE_MAX_BODY_LENGTH),
        detailHtml: typeof event.detailHtml === 'string'
          ? sanitiseVerticalTimelineLongText(
              event.detailHtml,
              VERTICAL_TIMELINE_MAX_BODY_LENGTH * 2,
            )
          : undefined,
        detailImage: typeof event.detailImage === 'string'
          ? sanitiseVerticalTimelineShortText(event.detailImage, 400)
          : undefined,
        endTime: Number.isFinite(Number(event.endTime)) ? Number(event.endTime) : pointValue,
        id,
        laneId,
        nodeId,
        startTime: Number.isFinite(Number(event.startTime)) ? Number(event.startTime) : pointValue,
        summary: sanitiseVerticalTimelineShortText(
          event.summary,
          VERTICAL_TIMELINE_MAX_SUMMARY_LENGTH,
          deriveVerticalTimelineSummary(event.body, title),
        ),
        tags: sanitiseVerticalTimelineTags(event.tags),
        title,
        worldview: sanitiseVerticalTimelineWorldview(event.worldview) || worldviewName,
      },
    ]
  })
  const eventsById = new Map(events.map((event) => [event.id, event]))
  let syncedYears = safeYears

  for (const event of events) {
    const bubble = getVerticalTimelineBubbleAtNode(syncedYears, event.nodeId, event.laneId)

    if (!bubble || bubble.id === event.id) {
      syncedYears = setVerticalTimelineBubbleAtNode(syncedYears, event.nodeId, event.laneId, {
        id: event.id,
        title: event.title,
      })
    }
  }

  for (const node of flattenVerticalTimelineNodes(syncedYears)) {
    for (const lane of lanes) {
      const bubble = getVerticalTimelineBubbleAtNode(syncedYears, node.id, lane.id)

      if (!bubble) {
        continue
      }

      const sourceEvent = eventsById.get(bubble.id)

      if (!sourceEvent || sourceEvent.nodeId !== node.id || sourceEvent.laneId !== lane.id) {
        syncedYears = setVerticalTimelineBubbleAtNode(syncedYears, node.id, lane.id, null)
      }
    }
  }

  return {
    events,
    lanes,
    years: syncedYears,
  }
}

function createDefaultVerticalTimelineState(worldviewName = '') {
  return sanitiseVerticalTimelineState(
    {
      events: [],
      lanes: [],
      years: DEFAULT_VERTICAL_TIMELINE_YEARS.map((year) => ({
        ...year,
        bubblesByLane: cloneVerticalTimelineBubbles(year.bubblesByLane),
        months: year.months.map((month) => ({
          ...month,
          bubblesByLane: cloneVerticalTimelineBubbles(month.bubblesByLane),
          days: month.days.map((day) => ({
            ...day,
            bubblesByLane: cloneVerticalTimelineBubbles(day.bubblesByLane),
          })),
        })),
      })),
    },
    worldviewName,
  )
}

function createVerticalTimelineLanesFromCharacterCards(characterCards) {
  return characterCards.map((character) => ({
    color: sanitiseVerticalTimelineColor(character.color, '#64748b'),
    id: character.id,
    name: sanitiseVerticalTimelineShortText(
      character.name,
      VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
      '未命名角色',
    ),
  }))
}

function hydrateVerticalTimelineStateWithCharacterCards(state, worldviewName) {
  const lanes = createVerticalTimelineLanesFromCharacterCards(
    statementSelectCharacterCardsForWorldview.all(worldviewName).map(serialiseCharacter),
  )
  const years = syncVerticalTimelineYearsWithLanes(state.years, lanes)
  const laneIdSet = new Set(lanes.map((lane) => lane.id))
  const nodeIdSet = new Set(flattenVerticalTimelineNodes(years).map((node) => node.id))
  const events = state.events.filter((event) => laneIdSet.has(event.laneId) && nodeIdSet.has(event.nodeId))

  return {
    ...state,
    events,
    lanes,
    years,
  }
}

function upsertVerticalTimelineState(worldviewName, state, updatedByUserId, updatedAt = Date.now()) {
  const safeState = sanitiseVerticalTimelineState(state, worldviewName) ?? createDefaultVerticalTimelineState(worldviewName)

  statementUpsertVerticalTimelineState.run({
    stateJson: JSON.stringify(safeState),
    updatedAt,
    updatedByUserId,
    worldviewName,
  })
}

function getVerticalTimelineState(worldviewName) {
  const row = statementSelectVerticalTimelineState.get(worldviewName)

  if (!row) {
    return hydrateVerticalTimelineStateWithCharacterCards(
      createDefaultVerticalTimelineState(worldviewName),
      worldviewName,
    )
  }

  try {
    const safeState = sanitiseVerticalTimelineState(JSON.parse(row.stateJson), worldviewName)
      ?? createDefaultVerticalTimelineState(worldviewName)

    return hydrateVerticalTimelineStateWithCharacterCards(safeState, worldviewName)
  } catch {
    return hydrateVerticalTimelineStateWithCharacterCards(
      createDefaultVerticalTimelineState(worldviewName),
      worldviewName,
    )
  }
}

function ensureVerticalTimelineWorldviewInitialised(worldviewName) {
  const row = statementSelectVerticalTimelineState.get(worldviewName)

  if (row) {
    return
  }

  upsertVerticalTimelineState(
    worldviewName,
    createDefaultVerticalTimelineState(worldviewName),
    ADMIN_USER.id,
    Date.now(),
  )
}

function buildVerticalTimelineCapabilities(authContext, manageableLaneCount = 0) {
  const isAdmin = authContext?.user.role === 'admin'

  return {
    canCreateEvent: isAdmin || manageableLaneCount > 0,
    canManageLanePermissions: isAdmin,
    canManageLanes: isAdmin,
    canManageStructure: isAdmin,
  }
}

function canManageVerticalTimelineLane(userId, laneId, worldviewName) {
  if (!userId || laneId === '') {
    return false
  }

  if (isAdminUser(userId)) {
    return true
  }

  return statementSelectVerticalTimelineLanePermissionsForLane
    .all(worldviewName, laneId)
    .some((row) => row.userId === userId)
}

function buildVerticalTimelineLanePermissionsForViewer(worldviewName, lanes, isAdmin) {
  if (!isAdmin) {
    return []
  }

  const permissionsByLane = new Map(lanes.map((lane) => [lane.id, []]))

  for (const row of statementSelectVerticalTimelineLanePermissionsForWorldview.all(worldviewName)) {
    const userIds = permissionsByLane.get(row.laneId)

    if (userIds) {
      userIds.push(row.userId)
    }
  }

  return lanes.map((lane) => ({
    laneId: lane.id,
    userIds: permissionsByLane.get(lane.id) ?? [],
  }))
}

function buildVerticalTimelineStateForViewer(worldviewName, authContext) {
  if (!hasManagedWorldview(worldviewName)) {
    return null
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)

  const row = statementSelectVerticalTimelineState.get(worldviewName)
  const state = getVerticalTimelineState(worldviewName)
  const viewerUserId = authContext?.user.id ?? ''
  const isAdmin = viewerUserId !== '' && isAdminUser(viewerUserId)
  const visibleLanes = viewerUserId === ''
    ? []
    : state.lanes
        .filter((lane) => canManageVerticalTimelineLane(viewerUserId, lane.id, worldviewName))
  const manageableLaneIds = visibleLanes.map((lane) => lane.id)
  const visibleYears = syncVerticalTimelineYearsWithLanes(state.years, visibleLanes)
  const visibleNodeIds = new Set(flattenVerticalTimelineNodes(visibleYears).map((node) => node.id))
  const visibleEvents = state.events
    .filter((event) => manageableLaneIds.includes(event.laneId))
    .filter((event) => visibleNodeIds.has(event.nodeId))
  const editableEventIds = visibleEvents.map((event) => event.id)
  const editableNodeIds = isAdmin
    ? flattenVerticalTimelineNodes(visibleYears).map((node) => node.id)
    : []

  return {
    capabilities: buildVerticalTimelineCapabilities(authContext, manageableLaneIds.length),
    lanePermissions: buildVerticalTimelineLanePermissionsForViewer(worldviewName, state.lanes, isAdmin),
    manageableUsers: isAdmin ? getManageableUsers() : [],
    permissions: {
      editableEventIds,
      editableNodeIds,
      manageableLaneIds,
    },
    state: cloneVerticalTimelineState({
      ...state,
      events: visibleEvents,
      lanes: visibleLanes,
      years: visibleYears,
    }),
    updatedAt: Number(row?.updatedAt ?? 0),
  }
}

function buildVerticalTimelineResponseHeaders(request, authContext, headers) {
  return authContext?.shouldRefreshCookie
    ? {
        ...headers,
        'Set-Cookie': buildSetCookieHeader(
          request,
          authContext.sessionToken,
          Math.floor(AUTH_SESSION_TTL_MS / 1000),
        ),
      }
    : headers
}

function writeVerticalTimelineViewerState(response, request, worldviewName, authContext, statusCode = 200) {
  const headers = appendCorsHeaders(request)
  const viewerState = buildVerticalTimelineStateForViewer(worldviewName, authContext)

  writeJson(
    response,
    statusCode,
    {
      authenticated: Boolean(authContext?.user),
      capabilities: viewerState.capabilities,
      currentUser: authContext?.user ?? null,
      lanePermissions: viewerState.lanePermissions,
      manageableUsers: viewerState.manageableUsers,
      ok: true,
      permissions: viewerState.permissions,
      state: viewerState.state,
      updatedAt: viewerState.updatedAt,
    },
    {
      headers: buildVerticalTimelineResponseHeaders(request, authContext, headers),
    },
  )
}

function getVerticalTimelinePointLabelByNodeId(years, nodeId) {
  const node = findVerticalTimelineNode(years, nodeId)

  if (!node) {
    return ''
  }

  if (node.kind === 'year') {
    return node.year.label
  }

  if (node.kind === 'month') {
    return node.month?.label ?? ''
  }

  return node.day?.label ?? ''
}

function updateVerticalTimelineNodeLabel(years, nodeId, label) {
  return years.map((year) => {
    if (year.id === nodeId) {
      return {
        ...year,
        label,
      }
    }

    return {
      ...year,
      months: year.months.map((month) => {
        if (month.id === nodeId) {
          return {
            ...month,
            label,
          }
        }

        return {
          ...month,
          days: month.days.map((day) =>
            day.id === nodeId
              ? {
                  ...day,
                  label,
                }
              : day,
          ),
        }
      }),
    }
  })
}

function rebaseVerticalTimelineEventsForNode(events, years, nodeId) {
  const label = getVerticalTimelinePointLabelByNodeId(years, nodeId)
  const pointValue = parseVerticalTimelinePointValue(label)

  return events.map((event) =>
    event.nodeId === nodeId
      ? {
          ...event,
          endTime: pointValue,
          startTime: pointValue,
        }
      : event,
  )
}

function removeVerticalTimelineLaneFromState(state, laneId) {
  if (!state.lanes.some((lane) => lane.id === laneId)) {
    return cloneVerticalTimelineState(state)
  }

  const nextLanes = state.lanes.filter((lane) => lane.id !== laneId)
  const nextEvents = state.events.filter((event) => event.laneId !== laneId)
  const nextYears = syncVerticalTimelineYearsWithLanes(state.years, nextLanes)

  return {
    ...cloneVerticalTimelineState(state),
    events: nextEvents,
    lanes: nextLanes,
    years: nextYears,
  }
}

function removeVerticalTimelineNodeFromState(state, nodeId) {
  const removedNodeIds = new Set()

  const collectMonthNodeIds = (month) => {
    removedNodeIds.add(month.id)

    for (const day of month.days) {
      removedNodeIds.add(day.id)
    }
  }

  const nextYears = state.years.flatMap((year) => {
    if (year.id === nodeId) {
      removedNodeIds.add(year.id)

      for (const month of year.months) {
        collectMonthNodeIds(month)
      }

      return []
    }

    const nextMonths = year.months.flatMap((month) => {
      if (month.id === nodeId) {
        collectMonthNodeIds(month)
        return []
      }

      const nextDays = month.days.filter((day) => {
        if (day.id === nodeId) {
          removedNodeIds.add(day.id)
          return false
        }

        return true
      })

      return [
        {
          ...month,
          days: nextDays,
        },
      ]
    })

    return [
      {
        ...year,
        months: nextMonths,
      },
    ]
  })

  if (removedNodeIds.size === 0) {
    return null
  }

  const removedEventIds = state.events
    .filter((event) => removedNodeIds.has(event.nodeId))
    .map((event) => event.id)
  const nextEvents = state.events.filter((event) => !removedNodeIds.has(event.nodeId))
  let cleanedYears = nextYears

  for (const eventId of removedEventIds) {
    cleanedYears = clearVerticalTimelineEventReferences(cleanedYears, eventId)
  }

  return {
    ...cloneVerticalTimelineState(state),
    events: nextEvents,
    years: cleanedYears,
  }
}

function normaliseAvatarDataUrl(value) {
  const avatarDataUrl = String(value ?? '').trim()

  if (avatarDataUrl === '') {
    return {
      avatarDataUrl: null,
      error: null,
    }
  }

  if (avatarDataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return {
      avatarDataUrl: null,
      error: '头像图片过大，请换一张更小的图片。',
    }
  }

  if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/iu.test(avatarDataUrl)) {
    return {
      avatarDataUrl: null,
      error: '头像数据无效，请重新上传图片。',
    }
  }

  return {
    avatarDataUrl,
    error: null,
  }
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

function normalisePresentationMode(value) {
  return value === CHAT_PRESENTATION_KP_NARRATION
    ? CHAT_PRESENTATION_KP_NARRATION
    : CHAT_PRESENTATION_BUBBLE
}

function serialiseMessage(row) {
  return {
    body: row.body,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt ?? null,
    deletedByUserId: row.deletedByUserId ?? null,
    id: row.id,
    kind: row.kind,
    nickname: row.nickname,
    replyToBody: row.replyToBody ?? null,
    replyToMessageId: row.replyToMessageId ?? null,
    replyToSpeakerName: row.replyToSpeakerName ?? null,
    roomId: row.roomId,
    sequence: row.sequence,
    sessionId: row.sessionId ?? null,
    userId: row.userId ?? null,
    speakerAvatarDataUrl: row.speakerAvatarDataUrl ?? null,
    speakerCharacterId: row.speakerCharacterId ?? null,
    speakerDisplayMode: normalisePresentationMode(row.speakerDisplayMode),
    speakerName: row.speakerName ?? row.nickname,
  }
}

function getMessageById(messageId) {
  const safeMessageId = String(messageId ?? '').trim()

  if (safeMessageId === '') {
    return null
  }

  const row = statementSelectMessageById.get(safeMessageId)
  return row ? serialiseMessage(row) : null
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
    avatarDataUrl: row.avatarDataUrl ?? null,
    color: sanitiseVerticalTimelineColor(row.color, '#64748b'),
    id: row.id,
    isDefault: row.isDefault === 1,
    name: row.name,
    presentationMode: normalisePresentationMode(row.presentationMode),
    status: row.status,
    userId: row.userId ?? null,
    worldview: sanitiseVerticalTimelineWorldview(row.worldview),
  }
}

function serialiseAdminCharacter(row) {
  return {
    ...serialiseCharacter(row),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
    user: {
      displayName: row.userDisplayName,
      handle: row.userHandle,
      id: row.userId,
      role: row.userRole,
      status: row.userStatus,
    },
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

function isAdminUser(userId) {
  return getCurrentUser(userId)?.role === 'admin'
}

function canRevokeMessage(message, state) {
  if (!message || message.deletedAt !== null) {
    return false
  }

  if (state.userId !== '' && isAdminUser(state.userId)) {
    return true
  }

  if (state.userId !== '' && message.userId === state.userId) {
    return true
  }

  return state.sessionId !== '' && message.sessionId === state.sessionId
}

function getRoomList() {
  return statementSelectRooms.all(PUBLIC_ROOM.id).map(serialiseRoom)
}

function getManageableUsers() {
  return statementSelectManageableUsers.all().map(serialiseUser)
}

function getRoomPermissionState() {
  const rooms = getRoomList()
  const rows = statementSelectRoomMembershipsForPermissions.all()
  const permissionsByRoomId = new Map(rooms.map((room) => [room.id, []]))

  for (const row of rows) {
    const allowedUserIds = permissionsByRoomId.get(row.roomId)

    if (allowedUserIds) {
      allowedUserIds.push(row.userId)
      continue
    }

    permissionsByRoomId.set(row.roomId, [row.userId])
  }

  return rooms.map((room) => ({
    roomId: room.id,
    userIds: permissionsByRoomId.get(room.id) ?? [],
  }))
}

function getRoomListForUser(userId) {
  if (isAdminUser(userId)) {
    return getRoomList()
  }

  return statementSelectRoomsForUser.all(userId, PUBLIC_ROOM.id).map(serialiseRoom)
}

function getAccessibleRoomForUser(userId, roomId) {
  if (isAdminUser(userId)) {
    const room = statementSelectRoom.get(roomId)
    return room ? serialiseRoom(room) : null
  }

  const room = statementSelectAccessibleRoomForUser.get(userId, roomId)
  return room ? serialiseRoom(room) : null
}

function broadcastRoomPermissionStateToAdmins() {
  const manageableUsers = getManageableUsers()
  const roomPermissions = getRoomPermissionState()

  for (const connection of sessionConnections.values()) {
    if (!isAdminUser(connection.userId)) {
      continue
    }

    sendJson(connection.socket, {
      manageableUsers,
      roomPermissions,
      type: 'room_permissions_state',
    })
  }
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

function getCharacterCardsForWorldview(worldviewName) {
  return statementSelectCharacterCardsForWorldview
    .all(sanitiseVerticalTimelineWorldview(worldviewName))
    .map(serialiseCharacter)
}

function ensureUserHasDefaultCharacter(userId) {
  if (String(userId ?? '').trim() === '') {
    return
  }

  const hasActiveCharacter = Number(statementCountActiveCharacterCardsForUser.get(userId)?.count ?? 0) > 0

  if (!hasActiveCharacter) {
    return
  }

  if (statementSelectDefaultCharacterCardForUser.get(userId)) {
    return
  }

  const nextDefault = statementSelectFirstActiveCharacterCardForUser.get(userId)

  if (!nextDefault) {
    return
  }

  const updatedAt = Date.now()
  statementClearDefaultCharacterCardsForUser.run({ updatedAt, userId })
  statementSetDefaultCharacterCard.run({ id: nextDefault.id, updatedAt })
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
  const worldview = sanitiseVerticalTimelineWorldview(payload?.worldview)

  if (name === '') {
    return {
      error: '角色卡名称不能为空。',
    }
  }

  if (worldview === '') {
    return {
      error: '角色卡必须绑定世界观。',
    }
  }

  const avatarState = normaliseAvatarDataUrl(payload?.avatarDataUrl)

  if (avatarState.error) {
    return {
      error: avatarState.error,
    }
  }

  const existingCharacters = getCharacterCardsForUser(userId)
  const attributes = normaliseCharacterAttributes(payload?.attributes)
  const characterId = createCharacterId()
  const now = Date.now()

  if (!statementSelectWorldviewByName.get(worldview)) {
    return {
      error: '目标世界观不存在，请先由管理员创建后再使用。',
    }
  }

  statementInsertCharacterCard.run({
    createdAt: now,
    color: sanitiseVerticalTimelineColor(payload?.color, '#64748b'),
    id: characterId,
    isDefault: existingCharacters.length === 0 ? 1 : 0,
    name,
    avatarDataUrl: avatarState.avatarDataUrl,
    presentationMode: normalisePresentationMode(payload?.presentationMode),
    status: 'active',
    updatedAt: now,
    userId,
    worldview,
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
  const worldview = sanitiseVerticalTimelineWorldview(payload?.worldview)

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

  if (worldview === '') {
    return {
      error: '角色卡必须绑定世界观。',
    }
  }

  const avatarState = normaliseAvatarDataUrl(payload?.avatarDataUrl)

  if (avatarState.error) {
    return {
      error: avatarState.error,
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

  if (!statementSelectWorldviewByName.get(worldview)) {
    return {
      error: '目标世界观不存在，请先由管理员创建后再使用。',
    }
  }

  statementUpdateCharacterCard.run({
    color: sanitiseVerticalTimelineColor(payload?.color, existingCharacter.color),
    id: characterId,
    name,
    avatarDataUrl: avatarState.avatarDataUrl,
    presentationMode: normalisePresentationMode(payload?.presentationMode ?? existingCharacter.presentationMode),
    updatedAt,
    userId,
    worldview,
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

function updateCharacterCardAsAdmin(characterId, payload) {
  const safeCharacterId = String(characterId ?? '').trim()
  const existingCharacter = statementSelectCharacterCardById.get(safeCharacterId)

  if (!existingCharacter) {
    return {
      error: '目标角色卡不存在。',
    }
  }

  const userId = String(payload?.userId ?? existingCharacter.userId ?? '').trim()
  const name = sanitiseCharacterName(payload?.name)
  const worldview = sanitiseVerticalTimelineWorldview(payload?.worldview)

  if (userId === '' || !statementSelectUser.get(userId)) {
    return {
      error: '角色归属用户不存在。',
    }
  }

  if (name === '') {
    return {
      error: '角色卡名称不能为空。',
    }
  }

  if (worldview === '') {
    return {
      error: '角色卡必须绑定世界观。',
    }
  }

  if (existingCharacter.worldview !== worldview) {
    return {
      error: '已有角色卡暂不支持直接切换世界观，请在目标世界观新建角色卡后再迁移使用。',
    }
  }

  const avatarState = normaliseAvatarDataUrl(payload?.avatarDataUrl)

  if (avatarState.error) {
    return {
      error: avatarState.error,
    }
  }

  const updatedAt = Date.now()
  const attributes = normaliseCharacterAttributes(payload?.attributes)
  const nextStatus = payload?.delete === true || payload?.status === 'archived' ? 'archived' : 'active'

  statementAdminUpdateCharacterCard.run({
    avatarDataUrl: avatarState.avatarDataUrl,
    color: sanitiseVerticalTimelineColor(payload?.color, existingCharacter.color),
    id: safeCharacterId,
    name,
    presentationMode: normalisePresentationMode(payload?.presentationMode ?? existingCharacter.presentationMode),
    status: nextStatus,
    updatedAt,
    userId,
    worldview,
  })

  statementUpdateCharacterAttributes.run({
    ...attributes,
    characterId: safeCharacterId,
    updatedAt,
  })

  if (payload?.isDefault === true && nextStatus !== 'archived') {
    statementClearDefaultCharacterCardsForUser.run({ updatedAt, userId })
    statementSetDefaultCharacterCard.run({ id: safeCharacterId, updatedAt })
  } else {
    ensureUserHasDefaultCharacter(existingCharacter.userId)
    ensureUserHasDefaultCharacter(userId)
  }

  return {
    characterId: safeCharacterId,
  }
}

function archiveCharacterCardAsAdmin(characterId) {
  const safeCharacterId = String(characterId ?? '').trim()
  const existingCharacter = statementSelectCharacterCardById.get(safeCharacterId)

  if (!existingCharacter) {
    return {
      error: '目标角色卡不存在。',
    }
  }

  statementArchiveCharacterCard.run({
    id: safeCharacterId,
    updatedAt: Date.now(),
  })
  ensureUserHasDefaultCharacter(existingCharacter.userId)

  return {
    characterId: safeCharacterId,
    worldview: existingCharacter.worldview,
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

function persistMessage({
  roomId,
  sessionId = null,
  userId = null,
  nickname,
  kind,
  body,
  deletedAt = null,
  deletedByUserId = null,
  replyToBody = null,
  replyToMessageId = null,
  replyToSpeakerName = null,
  speakerAvatarDataUrl = null,
  speakerCharacterId = null,
  speakerDisplayMode = CHAT_PRESENTATION_BUBBLE,
  speakerName,
}) {
  const messageId = crypto.randomUUID()
  const createdAt = Date.now()

  const result = statementInsertMessage.run({
    id: messageId,
    roomId,
    sessionId,
    userId,
    nickname,
    speakerAvatarDataUrl,
    speakerCharacterId,
    speakerDisplayMode,
    replyToMessageId,
    replyToSpeakerName,
    replyToBody,
    deletedAt,
    deletedByUserId,
    speakerName,
    kind,
    body,
    createdAt,
  })

  return {
    body,
    createdAt,
    deletedAt,
    deletedByUserId,
    id: messageId,
    kind,
    nickname,
    replyToBody,
    replyToMessageId,
    replyToSpeakerName,
    roomId,
    sequence: Number(result.lastInsertRowid),
    sessionId,
    userId,
    speakerAvatarDataUrl,
    speakerCharacterId,
    speakerDisplayMode,
    speakerName,
  }
}

function resolveActiveSpeakerSnapshot(state) {
  const fallbackSpeakerName = state.nickname === '' ? '未设置角色' : state.nickname

  if (state.userId === '' || state.activeCharacterId === '') {
    return {
      speakerAvatarDataUrl: null,
      speakerCharacterId: null,
      speakerDisplayMode: CHAT_PRESENTATION_BUBBLE,
      speakerName: fallbackSpeakerName,
    }
  }

  const character = statementSelectCharacterCardByIdForUser.get(state.activeCharacterId, state.userId)

  if (!character) {
    return {
      speakerAvatarDataUrl: null,
      speakerCharacterId: null,
      speakerDisplayMode: CHAT_PRESENTATION_BUBBLE,
      speakerName: fallbackSpeakerName,
    }
  }

  return {
    speakerAvatarDataUrl: character.avatarDataUrl ?? null,
    speakerCharacterId: character.id,
    speakerDisplayMode: normalisePresentationMode(character.presentationMode),
    speakerName: character.name,
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
  for (const connection of sessionConnections.values()) {
    sendJson(connection.socket, {
      rooms: getRoomListForUser(connection.userId),
      type: 'rooms',
    })
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
  let roomId = String(payload.roomId ?? '').trim() || PUBLIC_ROOM.id

  if (state.userId === '') {
    sendJson(socket, {
      message: '当前访问密钥未通过验证，请先重新输入密钥。',
      type: 'auth_required',
    })
    return
  }

  if (nickname === '' || sessionId === '') {
    sendJson(socket, {
      message: '加入群聊前需要提供昵称和会话标识。',
      type: 'error',
    })
    return
  }

  let room = getAccessibleRoomForUser(state.userId, roomId)

  if (!room) {
    const fallbackRoom = getRoomListForUser(state.userId)[0] ?? null

    if (fallbackRoom) {
      room = fallbackRoom
      roomId = fallbackRoom.id
    }
  }

  if (!room) {
    sendJson(socket, {
      message: '当前账号还没有任何可进入的群聊权限。',
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
    userId: state.userId,
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

  const rooms = getRoomListForUser(state.userId)
  const activeRoom = rooms.find((entry) => entry.id === roomId) ?? room

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

  if (isAdminUser(state.userId)) {
    sendJson(socket, {
      manageableUsers: getManageableUsers(),
      roomPermissions: getRoomPermissionState(),
      type: 'room_permissions_state',
    })
  }

  if (previousRoomId !== '' && previousRoomId !== roomId) {
    broadcastPresence(previousRoomId)
  }

  broadcastPresence(roomId)
  broadcastRooms()
}

function handleCreateRoom(state, socket, payload) {
  if (!state.joined) {
    sendJson(socket, {
      message: '请先进入群聊，再创建房间。',
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
      message: '已存在同名群聊，请换一个名称。',
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
  ensureRoomMembership(roomId, state.userId, 'owner')

  attachSessionToRoom(state, socket, {
    afterSequence: 0,
    nickname: state.nickname,
    roomId,
    sessionId: state.sessionId,
  })
  broadcastRoomPermissionStateToAdmins()
}

function revokeRoomAccessForUsers(roomId, removedUserIds) {
  if (removedUserIds.size === 0) {
    return
  }

  const roomName = statementSelectRoom.get(roomId)?.name ?? '当前房间'

  for (const connection of sessionConnections.values()) {
    if (connection.roomId !== roomId || !removedUserIds.has(connection.userId)) {
      continue
    }

    sendJson(connection.socket, {
      message: `你已失去对「${roomName}」的访问权限，连接将自动刷新到可进入的房间。`,
      type: 'error',
    })
    connection.socket.close(4003, 'Room access revoked')
  }
}

function handleUpdateRoomPermissions(state, socket, payload) {
  if (state.userId === '') {
    sendJson(socket, {
      message: '请先完成管理员身份验证，再修改房间权限。',
      type: 'error',
    })
    return
  }

  if (!isAdminUser(state.userId)) {
    sendJson(socket, {
      message: '只有管理员可以修改房间权限。',
      type: 'error',
    })
    return
  }

  const roomId = String(payload.roomId ?? '').trim()

  if (roomId === '') {
    sendJson(socket, {
      message: '目标房间不存在。',
      type: 'error',
    })
    return
  }

  const room = statementSelectRoom.get(roomId)

  if (!room) {
    sendJson(socket, {
      message: '目标房间不存在。',
      type: 'error',
    })
    return
  }

  const manageableUsers = getManageableUsers()
  const manageableUserIds = new Set(manageableUsers.map((user) => user.id))
  const nextAllowedUserIds = new Set(
    Array.isArray(payload.userIds)
      ? payload.userIds
          .map((value) => String(value ?? '').trim())
          .filter((value) => manageableUserIds.has(value))
      : [],
  )
  const existingMemberships = statementSelectRoomMembershipsForRoom.all(roomId)
  const existingUserIds = new Set(existingMemberships.map((entry) => entry.userId))
  const removedUserIds = new Set()

  for (const membership of existingMemberships) {
    if (membership.role === 'owner') {
      continue
    }

    if (nextAllowedUserIds.has(membership.userId)) {
      continue
    }

    statementDeleteRoomMembership.run({
      roomId,
      userId: membership.userId,
    })
    removedUserIds.add(membership.userId)
  }

  for (const userId of nextAllowedUserIds) {
    if (existingUserIds.has(userId)) {
      continue
    }

    ensureRoomMembership(roomId, userId, 'member')
  }

  revokeRoomAccessForUsers(roomId, removedUserIds)
  broadcastRooms()
  broadcastRoomPermissionStateToAdmins()
}

function handleClearRoomHistory(state, socket, payload) {
  if (state.userId === '') {
    sendJson(socket, {
      message: '请先完成管理员身份验证，再清空聊天记录。',
      type: 'error',
    })
    return
  }

  if (!isAdminUser(state.userId)) {
    sendJson(socket, {
      message: '只有管理员可以清空聊天记录。',
      type: 'error',
    })
    return
  }

  const roomId = String(payload.roomId ?? '').trim()

  if (roomId === '') {
    sendJson(socket, {
      message: '目标房间不存在。',
      type: 'error',
    })
    return
  }

  const room = statementSelectRoom.get(roomId)

  if (!room) {
    sendJson(socket, {
      message: '目标房间不存在。',
      type: 'error',
    })
    return
  }

  statementDeleteMessagesForRoom.run({ roomId })

  if (!state.joined || state.roomId !== roomId) {
    sendJson(socket, {
      roomId,
      type: 'room_history_cleared',
    })
  }

  broadcastToRoom(roomId, {
    roomId,
    type: 'room_history_cleared',
  })
  broadcastRooms()
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
      message: '请先进入群聊，再创建角色卡。',
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
      message: '请先进入群聊，再编辑角色卡。',
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
      message: '请先进入群聊，再切换角色。',
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
  const speakerSnapshot = resolveActiveSpeakerSnapshot(state)

  const message = persistMessage({
    body: `${command.attributeLabel} 检定：1d100=${rollValue} / ${targetValue}\n结果：${resultRank}`,
    kind: 'dice',
    nickname: state.nickname,
    roomId: state.roomId,
    sessionId: state.sessionId,
    userId: state.userId,
    ...speakerSnapshot,
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
      message: '请先加入群聊。',
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

  const speakerSnapshot = resolveActiveSpeakerSnapshot(state)
  const replySourceMessage = getMessageById(payload.replyToMessageId)
  const replyToMessageId =
    replySourceMessage && replySourceMessage.roomId === state.roomId ? replySourceMessage.id : null
  const replyToSpeakerName =
    replyToMessageId !== null
      ? replySourceMessage.speakerName.trim() || replySourceMessage.nickname
      : null
  const replyToBody =
    replyToMessageId !== null
      ? buildReplyPreviewBody(replySourceMessage.deletedAt === null ? replySourceMessage.body : '该消息已撤回')
      : null

  const message = persistMessage({
    body,
    kind: 'user',
    nickname: state.nickname,
    replyToBody,
    replyToMessageId,
    replyToSpeakerName,
    roomId: state.roomId,
    sessionId: state.sessionId,
    userId: state.userId,
    ...speakerSnapshot,
  })

  broadcastToRoom(state.roomId, {
    message,
    type: 'message',
  })
  broadcastRooms()
}

function handleRevokeMessage(state, socket, payload) {
  if (!state.joined) {
    sendJson(socket, {
      message: '请先加入群聊。',
      type: 'error',
    })
    return
  }

  const message = getMessageById(payload.messageId)

  if (!message || message.roomId !== state.roomId || message.kind === 'system') {
    sendJson(socket, {
      message: '目标消息不存在。',
      type: 'error',
    })
    return
  }

  if (message.deletedAt !== null) {
    sendJson(socket, {
      message: '该消息已经撤回。',
      type: 'error',
    })
    return
  }

  if (!canRevokeMessage(message, state)) {
    sendJson(socket, {
      message: '只有消息发送者或管理员可以撤回这条消息。',
      type: 'error',
    })
    return
  }

  const deletedAt = Date.now()
  statementRevokeMessage.run({
    deletedAt,
    deletedByUserId: state.userId || null,
    id: message.id,
  })

  const nextMessage = {
    ...message,
    deletedAt,
    deletedByUserId: state.userId || null,
  }

  broadcastToRoom(state.roomId, {
    message: nextMessage,
    type: 'message_updated',
  })
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

function handleWorldviewsGet(request, response) {
  const headers = appendCorsHeaders(request)

  try {
    syncWorldviewRecordsFromData()
    writeJson(response, 200, {
      ok: true,
      worldviews: statementSelectWorldviews.all().map(serialiseWorldview),
    }, { headers })
  } catch (error) {
    writeJson(response, 500, { message: String(error), ok: false }, { headers })
  }
}

async function handleWorldviewCreate(request, response) {
  const headers = appendCorsHeaders(request)
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })

  if (!authContext) {
    writeJson(response, 401, { message: '创建世界观需要先登录。', ok: false }, { headers })
    return
  }

  if (authContext.user.role !== 'admin') {
    writeJson(response, 403, { message: '只有管理员可以创建世界观。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 64 * 1024)
  } catch (error) {
    const message = error instanceof Error && error.message === 'BODY_TOO_LARGE'
      ? '世界观内容过大，请删减后再试。'
      : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const name = sanitiseWorldviewName(body?.name)

  if (name === '') {
    writeJson(response, 400, { message: '世界观名称不能为空。', ok: false }, { headers })
    return
  }

  if (statementSelectWorldviewByName.get(name)) {
    writeJson(response, 409, { message: `世界观“${name}”已经存在。`, ok: false }, { headers })
    return
  }

  const worldview = ensureWorldviewRecord(name, {
    coverImage: body?.coverImage,
    createdByUserId: authContext.user.id,
    description: body?.description,
    tags: body?.tags,
    updatedAt: Date.now(),
  })

  writeJson(response, 200, {
    ok: true,
    worldview,
  }, { headers })
}

async function handleWorldviewUpdate(request, response, worldviewId) {
  const headers = appendCorsHeaders(request)
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })

  if (!authContext) {
    writeJson(response, 401, { message: '修改世界观需要先登录。', ok: false }, { headers })
    return
  }

  if (authContext.user.role !== 'admin') {
    writeJson(response, 403, { message: '只有管理员可以管理世界观。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 64 * 1024)
  } catch (error) {
    const message = error instanceof Error && error.message === 'BODY_TOO_LARGE'
      ? '世界观内容过大，请删减后再试。'
      : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const result = renameWorldviewReferences(String(worldviewId ?? '').trim(), body, authContext.user.id)

  if (result.error) {
    writeJson(response, result.status ?? 400, { message: result.error, ok: false }, { headers })
    return
  }

  writeJson(response, 200, {
    ok: true,
    previousName: result.previousName,
    worldview: result.worldview,
  }, { headers })
}

function buildAgeChronicleResponseHeaders(request, authContext, headers) {
  return authContext?.shouldRefreshCookie
    ? {
        ...headers,
        'Set-Cookie': buildSetCookieHeader(
          request,
          authContext.sessionToken,
          Math.floor(AUTH_SESSION_TTL_MS / 1000),
        ),
      }
    : headers
}

function writeAgeChronicleViewerState(response, request, worldviewName, authContext, statusCode = 200) {
  const headers = appendCorsHeaders(request)
  const viewerState = buildAgeChronicleStateForViewer(worldviewName, authContext)

  writeJson(
    response,
    statusCode,
    {
      authenticated: Boolean(authContext?.user),
      capabilities: viewerState.capabilities,
      currentUser: authContext?.user ?? null,
      ok: true,
      state: viewerState.state,
      updatedAt: viewerState.updatedAt,
    },
    {
      headers: buildAgeChronicleResponseHeaders(request, authContext, headers),
    },
  )
}

function handleAgeChronicleStateGet(request, response, requestUrl) {
  const worldviewName = sanitiseAgeChronicleWorldview(requestUrl.searchParams.get('worldview'))

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers: appendCorsHeaders(request) })
    return
  }

  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  writeAgeChronicleViewerState(response, request, worldviewName, authContext)
}

async function handleAgeChronicleStateSave(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '共享编年保存需要先登录。', ok: false }, { headers })
    return
  }

  if (!isAdminUser(authContext.user.id)) {
    writeJson(response, 403, { message: '只有管理员可以维护共享结构。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 1024 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '共享编年内容过大，请删减后再试。'
      : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseAgeChronicleWorldview(body?.worldview)
  const structure = sanitiseAgeChronicleStructure(body?.structure) ?? extractAgeChronicleStructureFromCompatState(body?.state)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  if (!structure) {
    writeJson(response, 400, { message: '共享编年结构数据无效。', ok: false }, { headers })
    return
  }

  const updatedAt = Date.now()

  ensureAgeChronicleWorldviewInitialised(worldviewName)
  upsertAgeChronicleStructure(worldviewName, structure, authContext.user.id, updatedAt)
  writeAgeChronicleViewerState(response, request, worldviewName, authContext)
}

async function handleAgeChronicleEntryCreate(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '创建编年节点需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 16 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '编年节点内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseAgeChronicleWorldview(body?.worldview)
  const label = sanitiseAgeChronicleShortText(body?.label, AGE_CHRONICLE_MAX_LABEL_LENGTH)
  const note = sanitiseAgeChronicleLongText(body?.note, AGE_CHRONICLE_MAX_NOTE_LENGTH)
  const year = normaliseAgeChronicleNumber(body?.year, 0)
  const visibility = normaliseAgeChronicleVisibility(body?.visibility)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  if (!Number.isFinite(year)) {
    writeJson(response, 400, { message: '编年值无效。', ok: false }, { headers })
    return
  }

  ensureAgeChronicleWorldviewInitialised(worldviewName)

  const now = Date.now()
  statementInsertAgeChronicleEntry.run({
    createdAt: now,
    createdByUserId: authContext.user.id,
    id: createAgeChronicleEntryId(),
    label: label === '' ? `新编年 ${year}` : label,
    note,
    updatedAt: now,
    visibility,
    worldviewName,
    year,
  })

  writeAgeChronicleViewerState(response, request, worldviewName, authContext)
}

async function handleAgeChronicleEntryUpdate(request, response, entryId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '更新编年节点需要先登录。', ok: false }, { headers })
    return
  }

  if (!isAdminUser(authContext.user.id)) {
    writeJson(response, 403, { message: '只有管理员可以管理编年节点。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 16 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '编年节点内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseAgeChronicleWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureAgeChronicleWorldviewInitialised(worldviewName)
  const entry = statementSelectAgeChronicleEntry.get(worldviewName, entryId)

  if (!entry) {
    writeJson(response, 404, { message: '目标编年节点不存在。', ok: false }, { headers })
    return
  }

  if (body?.delete === true) {
    statementDeleteAgeChronicleCellNotesForEntry.run(worldviewName, entryId)
    statementDeleteAgeChronicleEntry.run(worldviewName, entryId)
    writeAgeChronicleViewerState(response, request, worldviewName, authContext)
    return
  }

  const year = normaliseAgeChronicleNumber(body?.year, entry.year)
  const label = sanitiseAgeChronicleShortText(body?.label, AGE_CHRONICLE_MAX_LABEL_LENGTH, entry.label)
  const note = sanitiseAgeChronicleLongText(body?.note, AGE_CHRONICLE_MAX_NOTE_LENGTH)
  const visibility = normaliseAgeChronicleVisibility(body?.visibility ?? entry.visibility)

  statementUpdateAgeChronicleEntry.run({
    id: entryId,
    label,
    note,
    updatedAt: Date.now(),
    visibility,
    worldviewName,
    year,
  })

  writeAgeChronicleViewerState(response, request, worldviewName, authContext)
}

async function handleAgeChronicleCellNoteSave(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '保存年度备注需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 16 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '年度备注内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseAgeChronicleWorldview(body?.worldview)
  const profileId = sanitiseAgeChronicleShortText(body?.profileId, 96)
  const entryId = sanitiseAgeChronicleShortText(body?.entryId, 96)
  const noteBody = sanitiseAgeChronicleLongText(body?.body, AGE_CHRONICLE_MAX_CELL_DESCRIPTION_LENGTH)

  if (worldviewName === '' || profileId === '' || entryId === '') {
    writeJson(response, 400, { message: '缺少必要的备注定位信息。', ok: false }, { headers })
    return
  }

  ensureAgeChronicleWorldviewInitialised(worldviewName)
  const entry = statementSelectAgeChronicleEntry.get(worldviewName, entryId)

  if (!entry || !isAgeChronicleEntryVisibleToUser(serialiseAgeChronicleEntry(entry), authContext.user.id)) {
    writeJson(response, 404, { message: '目标编年节点不存在。', ok: false }, { headers })
    return
  }

  const structure = getAgeChronicleStructure(worldviewName)

  if (!structure.characterProfiles.some((profile) => profile.id === profileId)) {
    writeJson(response, 404, { message: '目标角色不存在。', ok: false }, { headers })
    return
  }

  if (noteBody === '') {
    statementDeleteAgeChronicleCellNote.run(worldviewName, profileId, entryId, authContext.user.id)
    writeAgeChronicleViewerState(response, request, worldviewName, authContext)
    return
  }

  const existingNote = statementSelectAgeChronicleCellNote.get(
    worldviewName,
    profileId,
    entryId,
    authContext.user.id,
  )
  const now = Date.now()

  statementUpsertAgeChronicleCellNote.run({
    authorUserId: authContext.user.id,
    body: noteBody,
    createdAt: existingNote?.createdAt ?? now,
    entryId,
    profileId,
    updatedAt: now,
    worldviewName,
  })

  writeAgeChronicleViewerState(response, request, worldviewName, authContext)
}

function handleVerticalTimelineStateGet(request, response, requestUrl) {
  const worldviewName = sanitiseVerticalTimelineWorldview(requestUrl.searchParams.get('worldview'))

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers: appendCorsHeaders(request) })
    return
  }

  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

function handleAdminCharacterCardsGet(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext || authContext.user.role !== 'admin') {
    writeJson(response, 401, { message: '无权访问', ok: false }, { headers })
    return
  }

  try {
    const worldviewName = sanitiseVerticalTimelineWorldview(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('worldview'))
    const userId = String(new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams.get('userId') ?? '').trim()
    const cards = statementSelectAllCharacterCardsForAdmin
      .all()
      .map(serialiseAdminCharacter)
      .filter((card) => worldviewName === '' || card.worldview === worldviewName)
      .filter((card) => userId === '' || card.user.id === userId)

    writeJson(response, 200, {
      cards,
      ok: true,
      users: statementSelectAllActiveUsersForAdmin.all().map(serialiseUser),
    }, { headers })
  } catch (error) {
    writeJson(response, 500, { message: String(error), ok: false }, { headers })
  }
}

async function handleAdminCharacterCardsCreate(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext || authContext.user.role !== 'admin') {
    writeJson(response, 401, { message: '无权访问', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 512 * 1024)
  } catch (error) {
    const message = error instanceof Error && error.message === 'BODY_TOO_LARGE'
      ? '角色卡内容过大，请删减后再试。'
      : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const userId = String(body?.userId ?? '').trim()

  if (userId === '' || !statementSelectUser.get(userId)) {
    writeJson(response, 400, { message: '角色归属用户不存在。', ok: false }, { headers })
    return
  }

  const result = createCharacterCardForUser(userId, body)

  if (result.error) {
    writeJson(response, 400, { message: result.error, ok: false }, { headers })
    return
  }

  writeJson(response, 200, {
    characterId: result.characterId,
    ok: true,
  }, { headers })
}

async function handleAdminCharacterCardUpdate(request, response, characterId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext || authContext.user.role !== 'admin') {
    writeJson(response, 401, { message: '无权访问', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 512 * 1024)
  } catch (error) {
    const message = error instanceof Error && error.message === 'BODY_TOO_LARGE'
      ? '角色卡内容过大，请删减后再试。'
      : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const result = updateCharacterCardAsAdmin(characterId, body)

  if (result.error) {
    writeJson(response, 400, { message: result.error, ok: false }, { headers })
    return
  }

  writeJson(response, 200, {
    characterId: result.characterId,
    ok: true,
  }, { headers })
}

function handleAdminCharacterCardDelete(request, response, characterId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext || authContext.user.role !== 'admin') {
    writeJson(response, 401, { message: '无权访问', ok: false }, { headers })
    return
  }

  const result = archiveCharacterCardAsAdmin(characterId)

  if (result.error) {
    writeJson(response, 404, { message: result.error, ok: false }, { headers })
    return
  }

  if (result.worldview) {
    const nextState = removeVerticalTimelineLaneFromState(getVerticalTimelineState(result.worldview), result.characterId)
    statementDeleteVerticalTimelineLanePermissionsForLane.run(result.worldview, result.characterId)
    upsertVerticalTimelineState(result.worldview, nextState, authContext.user.id, Date.now())
  }

  writeJson(response, 200, { characterId: result.characterId, ok: true }, { headers })
}

async function handleVerticalTimelineLaneCreate(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '创建角色轨道需要先登录。', ok: false }, { headers })
    return
  }

  if (!isAdminUser(authContext.user.id)) {
    writeJson(response, 403, { message: '只有管理员可以创建角色轨道。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 32 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '角色轨道内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)

  if (state.lanes.length >= VERTICAL_TIMELINE_MAX_LANE_COUNT) {
    writeJson(response, 400, { message: '角色轨道数量已达到上限。', ok: false }, { headers })
    return
  }

  const result = createCharacterCardForUser(authContext.user.id, {
    attributes: body?.attributes,
    color: body?.color,
    name: body?.name,
    worldview: worldviewName,
  })

  if (result.error) {
    writeJson(response, 400, { message: result.error, ok: false }, { headers })
    return
  }

  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineLaneUpdate(request, response, laneId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '修改角色轨道需要先登录。', ok: false }, { headers })
    return
  }

  if (!isAdminUser(authContext.user.id)) {
    writeJson(response, 403, { message: '只有管理员可以修改角色轨道。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 32 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '角色轨道内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)
  const currentLane = state.lanes.find((lane) => lane.id === laneId)

  if (!currentLane) {
    writeJson(response, 404, { message: '目标角色轨道不存在。', ok: false }, { headers })
    return
  }

  if (body?.delete === true) {
    const archiveResult = archiveCharacterCardAsAdmin(laneId)

    if (archiveResult.error) {
      writeJson(response, 404, { message: archiveResult.error, ok: false }, { headers })
      return
    }

    const nextState = removeVerticalTimelineLaneFromState(state, laneId)
    statementDeleteVerticalTimelineLanePermissionsForLane.run(worldviewName, laneId)
    upsertVerticalTimelineState(worldviewName, nextState, authContext.user.id, Date.now())
    writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
    return
  }

  const updateResult = updateCharacterCardAsAdmin(laneId, {
    color: body?.color,
    name: body?.name,
    worldview: worldviewName,
  })

  if (updateResult.error) {
    writeJson(response, 400, { message: updateResult.error, ok: false }, { headers })
    return
  }

  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineLanePermissionsUpdate(request, response, laneId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '修改轨道权限需要先登录。', ok: false }, { headers })
    return
  }

  if (!isAdminUser(authContext.user.id)) {
    writeJson(response, 403, { message: '只有管理员可以修改轨道权限。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 32 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '轨道权限内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)

  if (!state.lanes.some((lane) => lane.id === laneId)) {
    writeJson(response, 404, { message: '目标角色轨道不存在。', ok: false }, { headers })
    return
  }

  const manageableUsers = getManageableUsers()
  const manageableUserIds = new Set(manageableUsers.map((user) => user.id))
  const nextUserIds = new Set(
    Array.isArray(body?.userIds)
      ? body.userIds
          .map((value) => String(value ?? '').trim())
          .filter((value) => manageableUserIds.has(value))
      : [],
  )
  const existingRows = statementSelectVerticalTimelineLanePermissionsForLane.all(worldviewName, laneId)
  const existingUserIds = new Set(existingRows.map((row) => row.userId))

  for (const row of existingRows) {
    if (nextUserIds.has(row.userId)) {
      continue
    }

    statementDeleteVerticalTimelineLanePermission.run({
      laneId,
      userId: row.userId,
      worldviewName,
    })
  }

  for (const userId of nextUserIds) {
    if (existingUserIds.has(userId)) {
      continue
    }

    statementInsertVerticalTimelineLanePermission.run({
      createdAt: Date.now(),
      laneId,
      userId,
      worldviewName,
    })
  }

  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineTimePointCreate(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '创建时间点需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 32 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '时间点内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)
  const kind = ['year', 'month', 'day'].includes(body?.kind) ? body.kind : ''
  const parentId = sanitiseVerticalTimelineShortText(body?.parentId, 96)

  if (worldviewName === '' || kind === '') {
    writeJson(response, 400, { message: '缺少必要的时间点信息。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)
  const viewerState = buildVerticalTimelineStateForViewer(worldviewName, authContext)

  if (!viewerState.capabilities.canManageStructure) {
    writeJson(response, 403, { message: '当前账号没有创建时间点的权限。', ok: false }, { headers })
    return
  }

  const label = sanitiseVerticalTimelineShortText(
    body?.label,
    VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
    kind === 'year' ? '新年份' : kind === 'month' ? '新月份' : '新日期',
  )
  const bubbleMap = createVerticalTimelineBubbleMapTemplate(state.lanes)
  let nextYears = state.years

  if (kind === 'year') {
    nextYears = [
      ...state.years,
      {
        bubblesByLane: bubbleMap,
        id: createVerticalTimelineNodeId('year'),
        label,
        months: [],
      },
    ]
  } else if (kind === 'month') {
    const parentYear = state.years.find((year) => year.id === parentId)

    if (!parentYear) {
      writeJson(response, 404, { message: '目标年份不存在。', ok: false }, { headers })
      return
    }

    nextYears = state.years.map((year) =>
      year.id === parentId
        ? {
            ...year,
            months: [
              ...year.months,
              {
                bubblesByLane: bubbleMap,
                days: [],
                id: createVerticalTimelineNodeId('month'),
                label,
              },
            ],
          }
        : year,
    )
  } else {
    const parentNode = findVerticalTimelineNode(state.years, parentId)

    if (!parentNode || parentNode.kind !== 'month' || !parentNode.month) {
      writeJson(response, 404, { message: '目标月份不存在。', ok: false }, { headers })
      return
    }

    nextYears = state.years.map((year) => ({
      ...year,
      months: year.months.map((month) =>
        month.id === parentId
          ? {
              ...month,
              days: [
                ...month.days,
                {
                  bubblesByLane: bubbleMap,
                  id: createVerticalTimelineNodeId('day'),
                  label,
                },
              ],
            }
          : month,
      ),
    }))
  }

  upsertVerticalTimelineState(
    worldviewName,
    {
      ...state,
      years: nextYears,
    },
    authContext.user.id,
    Date.now(),
  )
  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineTimePointUpdate(request, response, nodeId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '修改时间点需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 32 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '时间点内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)
  const node = findVerticalTimelineNode(state.years, nodeId)

  if (!node) {
    writeJson(response, 404, { message: '目标时间点不存在。', ok: false }, { headers })
    return
  }

  const viewerState = buildVerticalTimelineStateForViewer(worldviewName, authContext)
  const isAdmin = isAdminUser(authContext.user.id)

  if (body?.delete === true && !isAdmin) {
    writeJson(response, 403, { message: '只有管理员可以删除时间点。', ok: false }, { headers })
    return
  }

  if (
    !isAdmin &&
    !viewerState.permissions.editableNodeIds.includes(nodeId)
  ) {
    writeJson(response, 403, { message: '当前账号没有修改这个时间点的权限。', ok: false }, { headers })
    return
  }

  if (body?.delete === true) {
    const nextState = removeVerticalTimelineNodeFromState(state, nodeId)

    if (!nextState) {
      writeJson(response, 404, { message: '目标时间点不存在。', ok: false }, { headers })
      return
    }

    upsertVerticalTimelineState(worldviewName, nextState, authContext.user.id, Date.now())
    writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
    return
  }

  const currentLabel =
    node.kind === 'year' ? node.year.label : node.kind === 'month' ? node.month?.label ?? '' : node.day?.label ?? ''
  const nextLabel = sanitiseVerticalTimelineShortText(
    body?.label,
    VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
    currentLabel,
  )
  const nextYears = updateVerticalTimelineNodeLabel(state.years, nodeId, nextLabel)
  const nextEvents = rebaseVerticalTimelineEventsForNode(state.events, nextYears, nodeId)

  upsertVerticalTimelineState(
    worldviewName,
    {
      ...state,
      events: nextEvents,
      years: nextYears,
    },
    authContext.user.id,
    Date.now(),
  )
  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineEventCreate(request, response) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '创建事件需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 512 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '事件内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)
  const laneId = sanitiseVerticalTimelineShortText(body?.laneId, 96)
  const nodeId = sanitiseVerticalTimelineShortText(body?.nodeId, 96)

  if (worldviewName === '' || laneId === '' || nodeId === '') {
    writeJson(response, 400, { message: '缺少事件定位信息。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)

  if (!canManageVerticalTimelineLane(authContext.user.id, laneId, worldviewName)) {
    writeJson(response, 403, { message: '当前账号没有在这个轨道创建事件的权限。', ok: false }, { headers })
    return
  }

  if (!findVerticalTimelineNode(state.years, nodeId)) {
    writeJson(response, 404, { message: '目标时间点不存在。', ok: false }, { headers })
    return
  }

  const occupiedBubble = getVerticalTimelineBubbleAtNode(state.years, nodeId, laneId)

  if (occupiedBubble) {
    writeJson(response, 409, { message: '这个时间点与轨道上已经存在事件。', ok: false }, { headers })
    return
  }

  const title = sanitiseVerticalTimelineShortText(
    body?.title,
    VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
    '未命名事件',
  )
  const bodyText = sanitiseVerticalTimelineLongText(body?.body, VERTICAL_TIMELINE_MAX_BODY_LENGTH)
  const nodeLabel = getVerticalTimelinePointLabelByNodeId(state.years, nodeId)
  const pointValue = parseVerticalTimelinePointValue(nodeLabel)
  const event = {
    body: bodyText,
    detailHtml: typeof body?.detailHtml === 'string'
      ? sanitiseVerticalTimelineLongText(body.detailHtml, VERTICAL_TIMELINE_MAX_BODY_LENGTH * 2)
      : undefined,
    detailImage: typeof body?.detailImage === 'string'
      ? sanitiseVerticalTimelineShortText(body.detailImage, 400)
      : undefined,
    endTime: pointValue,
    id: createVerticalTimelineEventId(),
    laneId,
    nodeId,
    startTime: pointValue,
    summary: sanitiseVerticalTimelineShortText(
      body?.summary,
      VERTICAL_TIMELINE_MAX_SUMMARY_LENGTH,
      deriveVerticalTimelineSummary(bodyText, title),
    ),
    tags: sanitiseVerticalTimelineTags(body?.tags),
    title,
    worldview: worldviewName,
  }
  const nextYears = setVerticalTimelineBubbleAtNode(state.years, nodeId, laneId, {
    id: event.id,
    title: event.title,
  })

  upsertVerticalTimelineState(
    worldviewName,
    {
      ...state,
      events: [...state.events, event],
      years: nextYears,
    },
    authContext.user.id,
    Date.now(),
  )
  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

async function handleVerticalTimelineEventUpdate(request, response, eventId) {
  const authContext = resolveAuthContextFromRequest(request, { forceCookieRefresh: true })
  const headers = appendCorsHeaders(request)

  if (!authContext) {
    writeJson(response, 401, { message: '修改事件需要先登录。', ok: false }, { headers })
    return
  }

  let body

  try {
    body = await readJsonBody(request, 128 * 1024)
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'BODY_TOO_LARGE'
        ? '事件内容过大，请删减后再试。'
        : '请求体格式无效。'
    writeJson(response, 400, { message, ok: false }, { headers })
    return
  }

  const worldviewName = sanitiseVerticalTimelineWorldview(body?.worldview)

  if (worldviewName === '') {
    writeJson(response, 400, { message: '缺少世界观名称。', ok: false }, { headers })
    return
  }

  ensureVerticalTimelineWorldviewInitialised(worldviewName)
  const state = getVerticalTimelineState(worldviewName)
  const sourceEvent = state.events.find((event) => event.id === eventId)

  if (!sourceEvent) {
    writeJson(response, 404, { message: '目标事件不存在。', ok: false }, { headers })
    return
  }

  if (!canManageVerticalTimelineLane(authContext.user.id, sourceEvent.laneId, worldviewName)) {
    writeJson(response, 403, { message: '当前账号没有修改这个事件的权限。', ok: false }, { headers })
    return
  }

  if (body?.delete === true) {
    const nextYears = clearVerticalTimelineEventReferences(state.years, eventId)
    upsertVerticalTimelineState(
      worldviewName,
      {
        ...state,
        events: state.events.filter((event) => event.id !== eventId),
        years: nextYears,
      },
      authContext.user.id,
      Date.now(),
    )
    writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
    return
  }

  const targetLaneId = sanitiseVerticalTimelineShortText(body?.laneId, 96, sourceEvent.laneId)
  const targetNodeId = sanitiseVerticalTimelineShortText(body?.nodeId, 96, sourceEvent.nodeId)

  if (!canManageVerticalTimelineLane(authContext.user.id, targetLaneId, worldviewName)) {
    writeJson(response, 403, { message: '当前账号没有移动到目标轨道的权限。', ok: false }, { headers })
    return
  }

  if (!findVerticalTimelineNode(state.years, targetNodeId)) {
    writeJson(response, 404, { message: '目标时间点不存在。', ok: false }, { headers })
    return
  }

  const occupiedBubble = getVerticalTimelineBubbleAtNode(state.years, targetNodeId, targetLaneId)

  if (occupiedBubble && occupiedBubble.id !== eventId) {
    writeJson(response, 409, { message: '目标时间点与轨道上已经存在其它事件。', ok: false }, { headers })
    return
  }

  const title = sanitiseVerticalTimelineShortText(
    body?.title,
    VERTICAL_TIMELINE_MAX_LABEL_LENGTH,
    sourceEvent.title,
  )
  const nextBody = body?.body === undefined
    ? sourceEvent.body
    : sanitiseVerticalTimelineLongText(body.body, VERTICAL_TIMELINE_MAX_BODY_LENGTH)
  const nextSummary = sanitiseVerticalTimelineShortText(
    body?.summary,
    VERTICAL_TIMELINE_MAX_SUMMARY_LENGTH,
    deriveVerticalTimelineSummary(nextBody, title),
  )
  const nextPointValue = parseVerticalTimelinePointValue(
    getVerticalTimelinePointLabelByNodeId(state.years, targetNodeId),
  )
  const nextDetailHtml = body?.detailHtml === undefined
    ? sourceEvent.detailHtml
    : sanitiseVerticalTimelineLongText(body.detailHtml, VERTICAL_TIMELINE_MAX_BODY_LENGTH * 2)
  const nextDetailImage = body?.detailImage === undefined
    ? sourceEvent.detailImage
    : sanitiseVerticalTimelineShortText(body.detailImage, 400)
  let nextYears = clearVerticalTimelineEventReferences(state.years, eventId)
  nextYears = setVerticalTimelineBubbleAtNode(nextYears, targetNodeId, targetLaneId, {
    id: eventId,
    title,
  })
  const nextEvents = state.events.map((event) =>
    event.id === eventId
      ? {
          ...event,
          body: nextBody,
          detailHtml: nextDetailHtml,
          detailImage: nextDetailImage,
          endTime: nextPointValue,
          laneId: targetLaneId,
          nodeId: targetNodeId,
          startTime: nextPointValue,
          summary: nextSummary,
          tags: body?.tags === undefined ? event.tags : sanitiseVerticalTimelineTags(body.tags),
          title,
          worldview: worldviewName,
        }
      : event,
  )

  upsertVerticalTimelineState(
    worldviewName,
    {
      ...state,
      events: nextEvents,
      years: nextYears,
    },
    authContext.user.id,
    Date.now(),
  )
  writeVerticalTimelineViewerState(response, request, worldviewName, authContext)
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${getRequestHost(request)}`)

  if (
    request.method === 'OPTIONS' &&
    requestUrl.pathname.startsWith('/api/')
  ) {
    writeEmpty(response, 204, { headers: appendCorsHeaders(request) })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/access-key') {
    void handleAccessKeyLogin(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/auth/me') {
    handleAuthMe(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
    handleLogout(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/worldviews') {
    handleWorldviewsGet(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/worldviews') {
    void handleWorldviewCreate(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/age-chronicle/state') {
    handleAgeChronicleStateGet(request, response, requestUrl)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/age-chronicle/state') {
    void handleAgeChronicleStateSave(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/age-chronicle/entries') {
    void handleAgeChronicleEntryCreate(request, response)
    return
  }

  if (request.method === 'PUT' && requestUrl.pathname === '/api/age-chronicle/cell-note') {
    void handleAgeChronicleCellNoteSave(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/vertical-timeline/state') {
    handleVerticalTimelineStateGet(request, response, requestUrl)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/vertical-timeline/lanes') {
    void handleVerticalTimelineLaneCreate(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/vertical-timeline/time-points') {
    void handleVerticalTimelineTimePointCreate(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/vertical-timeline/events') {
    void handleVerticalTimelineEventCreate(request, response)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/admin/character-cards') {
    handleAdminCharacterCardsGet(request, response)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/admin/character-cards') {
    void handleAdminCharacterCardsCreate(request, response)
    return
  }

  const adminCharacterCardMatch = /^\/api\/admin\/character-cards\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && adminCharacterCardMatch) {
    void handleAdminCharacterCardUpdate(
      request,
      response,
      decodeURIComponent(adminCharacterCardMatch[1]),
    )
    return
  }

  if (request.method === 'DELETE' && adminCharacterCardMatch) {
    handleAdminCharacterCardDelete(
      request,
      response,
      decodeURIComponent(adminCharacterCardMatch[1]),
    )
    return
  }

  const worldviewMatch = /^\/api\/worldviews\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && worldviewMatch) {
    void handleWorldviewUpdate(
      request,
      response,
      decodeURIComponent(worldviewMatch[1]),
    )
    return
  }

  const ageChronicleEntryMatch = /^\/api\/age-chronicle\/entries\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && ageChronicleEntryMatch) {
    void handleAgeChronicleEntryUpdate(
      request,
      response,
      decodeURIComponent(ageChronicleEntryMatch[1]),
    )
    return
  }

  const verticalTimelineLaneMatch = /^\/api\/vertical-timeline\/lanes\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && verticalTimelineLaneMatch) {
    void handleVerticalTimelineLaneUpdate(
      request,
      response,
      decodeURIComponent(verticalTimelineLaneMatch[1]),
    )
    return
  }

  const verticalTimelineLanePermissionsMatch =
    /^\/api\/vertical-timeline\/lanes\/([^/]+)\/permissions$/u.exec(requestUrl.pathname)

  if (request.method === 'PUT' && verticalTimelineLanePermissionsMatch) {
    void handleVerticalTimelineLanePermissionsUpdate(
      request,
      response,
      decodeURIComponent(verticalTimelineLanePermissionsMatch[1]),
    )
    return
  }

  const verticalTimelineTimePointMatch =
    /^\/api\/vertical-timeline\/time-points\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && verticalTimelineTimePointMatch) {
    void handleVerticalTimelineTimePointUpdate(
      request,
      response,
      decodeURIComponent(verticalTimelineTimePointMatch[1]),
    )
    return
  }

  const verticalTimelineEventMatch = /^\/api\/vertical-timeline\/events\/([^/]+)$/u.exec(requestUrl.pathname)

  if (request.method === 'PATCH' && verticalTimelineEventMatch) {
    void handleVerticalTimelineEventUpdate(
      request,
      response,
      decodeURIComponent(verticalTimelineEventMatch[1]),
    )
    return
  }

  if (requestUrl.pathname === '/') {
    writeJson(response, 200, {
      endpoints: {
        ageChronicleCellNote: '/api/age-chronicle/cell-note',
        ageChronicleEntries: '/api/age-chronicle/entries',
        ageChronicleState: '/api/age-chronicle/state',
        authAccessKey: '/api/auth/access-key',
        authMe: '/api/auth/me',
        health: '/api/health',
        verticalTimelineEvents: '/api/vertical-timeline/events',
        verticalTimelineLanes: '/api/vertical-timeline/lanes',
        verticalTimelineState: '/api/vertical-timeline/state',
        verticalTimelineTimePoints: '/api/vertical-timeline/time-points',
        websocket: '/ws',
      },
      message: '群聊服务正在运行。请通过前端页面访问群聊，或用 /api/health 检查服务状态。',
      ok: true,
      roomId: PUBLIC_ROOM.id,
      roomCount: statementCountRooms.get().count,
    })
    return
  }

  if (requestUrl.pathname === '/api/health') {
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

    if (payload.type === 'revoke_message') {
      handleRevokeMessage(state, socket, payload)
      return
    }

    if (payload.type === 'create_room') {
      handleCreateRoom(state, socket, payload)
      return
    }

    if (payload.type === 'update_room_permissions') {
      handleUpdateRoomPermissions(state, socket, payload)
      return
    }

    if (payload.type === 'clear_room_history') {
      handleClearRoomHistory(state, socket, payload)
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

  console.log(`群聊服务已启动: http://${origin}:${CHAT_PORT}`)
  console.log(`管理员账号: ${ADMIN_USER.handle}`)

  if (adminAccessKeySeed.source === 'env') {
    console.log('管理员访问密钥来源: 环境变量 CHAT_ADMIN_ACCESS_KEY')
  } else if (adminAccessKeySeed.filePath) {
    console.log(`管理员访问密钥文件: ${adminAccessKeySeed.filePath}`)
  } else {
    console.log('管理员访问密钥已存在于数据库中；如需重置，请设置 CHAT_ADMIN_ACCESS_KEY 后重启服务。')
  }

  if (seededUserAccessKeys.filePath) {
    console.log(`种子用户访问密钥文件: ${seededUserAccessKeys.filePath}`)
  } else {
    console.log('种子用户访问密钥已存在于数据库中；如需调整，请显式更新种子用户配置。')
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
