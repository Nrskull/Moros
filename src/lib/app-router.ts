export type AppPage =
  | 'home'
  | 'timeline'
  | 'vertical-timeline'
  | 'tools-overview'
  | 'age-chronicle'
  | 'character-sheet'
  | 'log-workbench'
  | 'chat-room'
  | 'event-detail'
  | 'admin-character'
  | 'admin-sticker'
  | 'admin-worldview'

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
      page: 'vertical-timeline',
      worldviewName,
    }
  }

  if (pathname === '/vertical-timeline') {
    return {
      eventId: '',
      page: 'vertical-timeline',
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

  if (pathname === '/tools') {
    return {
      eventId: '',
      page: 'tools-overview',
      worldviewName: null,
    }
  }

  if (pathname === '/tools/character-sheet') {
    return {
      eventId: '',
      page: 'character-sheet',
      worldviewName: null,
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

  if (pathname === '/admin/characters') {
    return {
      eventId: '',
      page: 'admin-character',
      worldviewName: null,
    }
  }

  if (pathname === '/admin/stickers') {
    return {
      eventId: '',
      page: 'admin-sticker',
      worldviewName: null,
    }
  }

  if (pathname === '/admin/worldviews') {
    return {
      eventId: '',
      page: 'admin-worldview',
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
    pathname = '/vertical-timeline'
  } else if (route.page === 'vertical-timeline') {
    pathname = '/vertical-timeline'
  } else if (route.page === 'tools-overview') {
    pathname = '/tools'
  } else if (route.page === 'age-chronicle') {
    pathname = '/chronicle'
  } else if (route.page === 'character-sheet') {
    pathname = '/tools/character-sheet'
  } else if (route.page === 'log-workbench') {
    pathname = '/logs'
  } else if (route.page === 'chat-room') {
    pathname = '/chat'
  } else if (route.page === 'admin-character') {
    pathname = '/admin/characters'
  } else if (route.page === 'admin-sticker') {
    pathname = '/admin/stickers'
  } else if (route.page === 'admin-worldview') {
    pathname = '/admin/worldviews'
  } else if (route.page === 'event-detail') {
    const safeEventId = String(route.eventId ?? '').trim()
    pathname = safeEventId === '' ? '/vertical-timeline' : `/events/${encodeURIComponent(safeEventId)}`
  }

  const searchParams = new URLSearchParams()
  const worldviewName = decodeWorldviewName(route.worldviewName ?? null)

  if (
    !['home', 'chat-room', 'admin-character', 'admin-sticker', 'admin-worldview', 'tools-overview', 'character-sheet'].includes(route.page) &&
    worldviewName
  ) {
    searchParams.set('worldview', worldviewName)
  }

  const search = searchParams.toString()
  return search === '' ? pathname : `${pathname}?${search}`
}
