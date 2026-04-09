export type AppPage =
  | 'home'
  | 'timeline'
  | 'age-chronicle'
  | 'log-workbench'
  | 'chat-room'
  | 'event-detail'

export interface AppRoute {
  eventId: string
  page: AppPage
  worldviewName: string | null
}

function normalisePathname(pathname: string): string {
  if (pathname === '' || pathname === '/') {
    return '/'
  }

  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function decodeWorldviewName(value: string | null): string | null {
  if (value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function parseAppRoute(url: URL | Location): AppRoute {
  const pathname = normalisePathname(url.pathname)
  const worldviewName = decodeWorldviewName(new URLSearchParams(url.search).get('worldview'))

  if (pathname === '/') {
    return {
      eventId: '',
      page: 'home',
      worldviewName: null,
    }
  }

  if (pathname === '/timeline') {
    return {
      eventId: '',
      page: 'timeline',
      worldviewName,
    }
  }

  if (pathname === '/chronicle') {
    return {
      eventId: '',
      page: 'age-chronicle',
      worldviewName,
    }
  }

  if (pathname === '/logs') {
    return {
      eventId: '',
      page: 'log-workbench',
      worldviewName,
    }
  }

  if (pathname === '/chat') {
    return {
      eventId: '',
      page: 'chat-room',
      worldviewName: null,
    }
  }

  const matchedEventPath = /^\/events\/([^/]+)$/u.exec(pathname)

  if (matchedEventPath) {
    return {
      eventId: decodeURIComponent(matchedEventPath[1]),
      page: 'event-detail',
      worldviewName,
    }
  }

  return {
    eventId: '',
    page: 'home',
    worldviewName: null,
  }
}

export function buildAppRouteHref(route: {
  eventId?: string | null
  page: AppPage
  worldviewName?: string | null
}): string {
  let pathname = '/'

  if (route.page === 'timeline') {
    pathname = '/timeline'
  } else if (route.page === 'age-chronicle') {
    pathname = '/chronicle'
  } else if (route.page === 'log-workbench') {
    pathname = '/logs'
  } else if (route.page === 'chat-room') {
    pathname = '/chat'
  } else if (route.page === 'event-detail') {
    const safeEventId = String(route.eventId ?? '').trim()
    pathname = safeEventId === '' ? '/timeline' : `/events/${encodeURIComponent(safeEventId)}`
  }

  const searchParams = new URLSearchParams()
  const worldviewName = decodeWorldviewName(route.worldviewName ?? null)

  if (!['home', 'chat-room'].includes(route.page) && worldviewName) {
    searchParams.set('worldview', worldviewName)
  }

  const search = searchParams.toString()
  return search === '' ? pathname : `${pathname}?${search}`
}
