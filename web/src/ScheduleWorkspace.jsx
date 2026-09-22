import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DayFlowCalendar,
  ViewType,
  createAgendaView,
  createDayView,
  createMonthView,
  createWeekView,
  formatEventTimeRange,
  useCalendarApp,
} from '@dayflow/react'
import { Temporal } from 'temporal-polyfill'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const GITHUB_URL = 'https://github.com/5nix/zjut-grad-schedule'
const SUBSCRIPTION_VISIBILITY_COOKIE = 'zjut_subscription_visible'
const MENU_CLOSE_MS = 150
const SURFACE_CLOSE_MS = 220
const DRAWER_CLOSE_MS = 300
const SEARCH_CLOSE_MS = 220
const DETAIL_CLOSE_MS = 220

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`
  const item = document.cookie.split('; ').find((entry) => entry.startsWith(prefix))
  return item ? decodeURIComponent(item.slice(prefix.length)) : ''
}

function readSubscriptionVisibility() {
  return readCookie(SUBSCRIPTION_VISIBILITY_COOKIE) !== '0'
}

function writeSubscriptionVisibility(visible) {
  document.cookie = `${SUBSCRIPTION_VISIBILITY_COOKIE}=${visible ? '1' : '0'}; Max-Age=31536000; Path=/; SameSite=Lax`
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  const paths = {
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>,
    menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M21 19V5a2 2 0 0 0-2-2h-4" /><path d="M15 21h4a2 2 0 0 0 2-2" /></>,
    github: <><path d="M15 22v-4c0-1.1-.4-1.8-1-2.2 3.3-.4 6.8-1.6 6.8-7.1 0-1.6-.6-2.9-1.6-3.9.2-.4.7-2-.2-3.8 0 0-1.3-.4-4.1 1.5a14 14 0 0 0-7.5 0C5.6.6 4.3 1 4.3 1c-.9 1.8-.4 3.4-.2 3.8-1 1-1.6 2.3-1.6 3.9 0 5.5 3.5 6.7 6.8 7.1-.4.4-.8 1.1-1 2.2v4" /><path d="M8 20c-3 .9-3-1.5-4.2-1.9" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.7 4L20 15" /><path d="M20 20v-5h-5" /></>,
    chevronUp: <path d="m6 15 6-6 6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 10v6" /><path d="M12 7h.01" /></>,
    moon: <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    previous: <path d="m15 18-6-6 6-6" />,
    next: <path d="m9 18 6-6-6-6" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  }

  return <svg {...common}>{paths[name]}</svg>
}

const ZH_LOCALE = {
  code: 'zh-CN',
  messages: {
    allDay: '全天',
    noEvents: '当天没有课程',
    more: '更多',
    today: '今天',
    day: '日',
    week: '周',
    month: '月',
    agenda: '列表',
    viewEvent: '课程详情',
    done: '完成',
    cancel: '取消',
    search: '搜索',
    noResults: '没有结果',
    starts: '开始',
    ends: '结束',
    notes: '备注',
  },
}

const COURSE_CALENDAR = {
  id: 'courses',
  name: '课程表',
  isDefault: true,
  isVisible: true,
  readOnly: true,
  colors: {
    eventColor: '#e6f3fe',
    eventSelectedColor: '#0075de',
    lineColor: '#0075de',
    textColor: '#075a9f',
  },
}

function toZonedDateTime(value) {
  return Temporal.ZonedDateTime.from(`${value}[Asia/Shanghai]`)
}

function toCalendarEvents(events) {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    start: toZonedDateTime(event.start),
    end: toZonedDateTime(event.end),
    calendarId: 'courses',
    allDay: false,
    meta: {
      displayTitle: event.title,
      location: event.location,
      campus: event.campus,
      semester: event.semester,
      lessonText: event.lessonText,
    },
  }))
}

function formatDateTime(value) {
  const date = value?.epochMilliseconds !== undefined
    ? new Date(value.epochMilliseconds)
    : new Date(value)

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(date)
}

function CourseDetail({ event, onClose }) {
  const meta = event.meta || {}
  const title = meta.displayTitle || event.title
  const repeatedFields = [meta.location, meta.campus, meta.semester, meta.lessonText]
    .filter(Boolean)
    .map((value) => String(value).trim())
  const description = String(event.description || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const value = line.replace(/^(地点|校区|学期|课次|备注)\s*[：:]\s*/, '').trim()
      return !repeatedFields.includes(line) && !repeatedFields.includes(value)
    })
    .map((line) => line.replace(/^备注\s*[：:]\s*/, '').trim())
    .join('\n')
  return (
    <div className="course-detail">
      <div className="course-detail__heading">
        <span className="course-detail__mark" aria-hidden="true" />
        <div>
          <h3>{title}</h3>
          <p>{formatDateTime(event.start)} — {formatDateTime(event.end).split(' ').at(-1)}</p>
        </div>
      </div>
      <dl className="course-detail__list">
        {meta.location && <><dt>地点</dt><dd>{meta.location}</dd></>}
        {meta.campus && <><dt>校区</dt><dd>{meta.campus}</dd></>}
        {meta.semester && <><dt>学期</dt><dd>{meta.semester}</dd></>}
        {meta.lessonText && <><dt>课次</dt><dd>{meta.lessonText}</dd></>}
        {description && <><dt>备注</dt><dd className="course-detail__description">{description}</dd></>}
      </dl>
      {onClose && <button className="course-detail__close" type="button" onClick={onClose}>关闭</button>}
    </div>
  )
}

function CourseTimedEventContent({ event }) {
  const meta = event.meta || {}
  const title = meta.displayTitle || event.title.split('\n')[0]
  const durationHours = (event.end.epochMilliseconds - event.start.epochMilliseconds) / 3_600_000
  const density = durationHours <= 0.25 ? 'compact' : 'default'

  return (
    <>
      <div
        className="df-event-color-bar"
        style={{ backgroundColor: COURSE_CALENDAR.colors.lineColor }}
      />
      <div className="df-event-timed-content" data-density={density}>
        <div className={`df-event-title ${density === 'compact' ? 'df-event-title-tight' : ''}`}>
          {title}
        </div>
        {durationHours > 0.5 && (
          <div className="df-event-time">{formatEventTimeRange(event, '24h')}</div>
        )}
        {meta.location && <div className="df-event-time">{meta.location}</div>}
      </div>
    </>
  )
}

// DayFlow uses this slot name for its mobile path; the presentation here is selected only by viewport width.
function getDetailSurface() {
  if (typeof window === 'undefined') return 'mobile'
  if (window.innerWidth > 1024) return 'desktop'
  if (window.innerWidth > 760) return 'tablet'
  return 'mobile'
}

function MobileCourseDetail({ isOpen, draftEvent, onClose }) {
  const surface = getDetailSurface()
  if (surface === 'desktop') return null
  return <MobileCourseDetailRenderer surface={surface} isOpen={isOpen} draftEvent={draftEvent} onClose={onClose} />
}

function MobileCourseDetailRenderer({ surface, isOpen, draftEvent, onClose }) {
  const [visibleEvent, setVisibleEvent] = useState(() => (isOpen && draftEvent ? draftEvent : null))
  const [isClosing, setIsClosing] = useState(false)
  const closeTimerRef = useRef(null)
  const closeDuration = surface === 'tablet' ? DETAIL_CLOSE_MS : DRAWER_CLOSE_MS

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current)

    if (isOpen && draftEvent) {
      setVisibleEvent(draftEvent)
      setIsClosing(false)
      return undefined
    }

    if (!visibleEvent) return undefined

    setIsClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setVisibleEvent(null)
      setIsClosing(false)
    }, closeDuration)

    return () => window.clearTimeout(closeTimerRef.current)
  }, [isOpen, draftEvent, visibleEvent, closeDuration])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  if (!visibleEvent) return null

  if (surface === 'tablet') {
    return (
      <div
        className={`df-portal schedule-tablet-event-detail${isClosing ? ' is-closing' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="schedule-tablet-event-detail__panel" role="dialog" aria-label="课程详情">
          <button
            className="schedule-tablet-event-detail__close"
            type="button"
            aria-label="关闭课程详情"
            title="关闭"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
          <CourseDetail event={visibleEvent} />
        </div>
      </div>
    )
  }

  return (
    <div className={`df-portal df-mobile-event-drawer${isClosing ? ' is-closing' : ''}`}>
      <div className="df-mobile-event-drawer-backdrop" onClick={onClose} />
      <div className="df-mobile-event-drawer-panel df-animate-slide-up" onClick={(event) => event.stopPropagation()}>
        <div className="df-mobile-event-drawer-header">
          <button className="df-mobile-event-drawer-header-action" type="button" onClick={onClose}>
            取消
          </button>
          <span className="df-mobile-event-drawer-title">课程详情</span>
          <span className="df-mobile-event-drawer-header-spacer" />
        </div>
        <div className="df-mobile-event-drawer-body">
          <CourseDetail event={visibleEvent} />
        </div>
      </div>
    </div>
  )
}

function ScheduleCalendar({ events, themeDark }) {
  const [activeView, setActiveView] = useState(ViewType.WEEK)
  const [dayHeaderHost, setDayHeaderHost] = useState(null)
  const calendarRootRef = useRef(null)
  const searchClosingRef = useRef(false)
  const searchReplayRef = useRef(false)
  const searchCloseTimerRef = useRef(null)
  const detailClosingRef = useRef(false)
  const detailReplayRef = useRef(false)
  const detailCloseTimerRef = useRef(null)
  const calendarEvents = useMemo(() => toCalendarEvents(events), [events])
  const calendar = useCalendarApp({
    views: [
      createDayView({
        label: '日',
        firstHour: 7,
        lastHour: 23,
        hourHeight: 56,
        timeFormat: '24h',
        showAllDay: false,
        scrollToCurrentTime: false,
      }),
      createWeekView({
        label: '周',
        firstHour: 7,
        lastHour: 23,
        hourHeight: 56,
        timeFormat: '24h',
        startOfWeek: 1,
        showWeekends: true,
        showAllDay: false,
        scrollToCurrentTime: false,
        gridDateClick: 'none',
        gridDateDoubleClick: 'none',
      }),
      createMonthView({
        label: '月',
        timeFormat: '24h',
        startOfWeek: 1,
        showWeekNumbers: false,
        showMonthIndicator: true,
      }),
      createAgendaView({
        label: '列表',
        daysToShow: 14,
        showEmptyDays: false,
        gridDateClick: 'none',
        gridDateDoubleClick: 'none',
      }),
    ],
    events: calendarEvents,
    defaultView: ViewType.MONTH,
    defaultCalendar: 'courses',
    calendars: [COURSE_CALENDAR],
    initialDate: new Date(),
    eventDetailTrigger: 'click',
    useEventDetailPanel: true,
    useCalendarHeader: true,
    readOnly: { draggable: false, viewable: true },
    locale: ZH_LOCALE,
    timeZone: 'Asia/Shanghai',
    timeFormat: '24h',
    theme: {
      mode: themeDark ? 'dark' : 'light',
      colors: {
        background: '#ffffff',
        foreground: '#0f0f0f',
        border: 'rgba(15, 15, 15, 0.12)',
        muted: '#f6f5f4',
        mutedForeground: '#68635f',
        primary: '#ffb110',
        primaryForeground: '#0f0f0f',
        card: '#ffffff',
        cardForeground: '#0f0f0f',
      },
    },
  })

  useEffect(() => {
    calendar.app.setTheme(themeDark ? 'dark' : 'light')
  }, [calendar.app, themeDark])

  useEffect(() => {
    if (activeView !== ViewType.DAY) {
      setDayHeaderHost(null)
      return undefined
    }

    let frameId = window.requestAnimationFrame(() => {
      setDayHeaderHost(calendarRootRef.current?.querySelector('.df-day-content-header-wrap .df-view-header-container') || null)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [activeView])

  useEffect(() => {
    function handleMobileSearchBack(event) {
      if (!(event.target instanceof Element)) return
      if (searchReplayRef.current) {
        searchReplayRef.current = false
        return
      }
      const button = event.target.closest('.df-mobile-fullscreen .df-search-dialog-back-btn')
      if (!button || searchClosingRef.current) return

      const fullscreen = button.closest('.df-mobile-fullscreen')
      if (!fullscreen) return

      event.preventDefault()
      event.stopPropagation()
      searchClosingRef.current = true
      fullscreen.classList.add('is-closing')
      window.clearTimeout(searchCloseTimerRef.current)
      searchCloseTimerRef.current = window.setTimeout(() => {
        searchReplayRef.current = true
        searchClosingRef.current = false
        button.click()
      }, SEARCH_CLOSE_MS)
    }

    document.addEventListener('click', handleMobileSearchBack, true)
    return () => {
      document.removeEventListener('click', handleMobileSearchBack, true)
      window.clearTimeout(searchCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    function handleDesktopDetailClose(event) {
      if (detailReplayRef.current) {
        detailReplayRef.current = false
        return
      }
      if (window.innerWidth < 768 || detailClosingRef.current) return
      if (!(event.target instanceof Element)) return

      const panel = document.querySelector('[data-event-detail-panel]')
      if (!panel) return

      const target = event.target
      const insideEvent = target.closest('[data-event-id]')
      const insidePanel = target.closest('[data-event-detail-panel]')
      const insideDialog = target.closest('[data-event-detail-dialog]')
      const insidePopup = target.closest('[data-range-picker-popup], [data-calendar-picker-dropdown]')
      if (insideEvent || insidePanel || insideDialog || insidePopup) return

      event.preventDefault()
      event.stopPropagation()
      detailClosingRef.current = true
      panel.classList.add('is-closing')
      window.clearTimeout(detailCloseTimerRef.current)
      detailCloseTimerRef.current = window.setTimeout(() => {
        detailReplayRef.current = true
        detailClosingRef.current = false
        const replayTarget = target.isConnected ? target : document.body
        replayTarget.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: event.detail,
          screenX: event.screenX,
          screenY: event.screenY,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          button: event.button,
          buttons: event.buttons,
        }))
      }, DETAIL_CLOSE_MS)
    }

    document.addEventListener('mousedown', handleDesktopDetailClose, true)
    return () => {
      document.removeEventListener('mousedown', handleDesktopDetailClose, true)
      window.clearTimeout(detailCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let activePanel = null
    let panelResizeObserver = null
    let repositionFrame = 0

    function requestPanelReposition() {
      window.cancelAnimationFrame(repositionFrame)
      repositionFrame = window.requestAnimationFrame(() => {
        const panel = document.querySelector('[data-event-detail-panel]')
        if (panel && panel === activePanel && !panel.classList.contains('is-closing')) {
          window.dispatchEvent(new Event('resize'))
        }
      })
    }

    function observeDetailPanel() {
      const panel = document.querySelector('[data-event-detail-panel]')
      if (panel === activePanel) return

      panelResizeObserver?.disconnect()
      activePanel = panel
      if (!panel) return

      panelResizeObserver = new ResizeObserver(requestPanelReposition)
      panelResizeObserver.observe(panel)
      requestPanelReposition()
    }

    const mutationObserver = new MutationObserver(observeDetailPanel)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    observeDetailPanel()

    return () => {
      mutationObserver.disconnect()
      panelResizeObserver?.disconnect()
      window.cancelAnimationFrame(repositionFrame)
    }
  }, [])

  function handleSearchResultClick({ defaultAction, source }) {
    if (source !== 'mobile') {
      defaultAction()
      return
    }

    const fullscreen = document.querySelector('.df-mobile-fullscreen')
    if (!fullscreen || searchClosingRef.current) {
      defaultAction()
      return
    }

    searchClosingRef.current = true
    fullscreen.classList.add('is-closing')
    window.clearTimeout(searchCloseTimerRef.current)
    searchCloseTimerRef.current = window.setTimeout(() => {
      searchClosingRef.current = false
      defaultAction()
    }, SEARCH_CLOSE_MS)
  }

  useEffect(() => {
    const app = calendar.app
    let frameId = 0

    function syncAgendaTitle() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        if (app.state.currentView !== ViewType.AGENDA) return

        const title = calendarRootRef.current?.querySelector('.df-agenda-view .df-view-header-title')
        if (!title) return

        const start = new Date(app.getCurrentDate())
        start.setHours(0, 0, 0, 0)
        const end = new Date(start)
        end.setDate(end.getDate() + 13)
        const range = `${start.getMonth() + 1}.${start.getDate()}-${end.getMonth() + 1}.${end.getDate()}`
        const year = `${end.getFullYear()}年`
        const titleKey = `${range}|${year}`

        if (title.dataset.scheduleAgendaTitle === titleKey) return

        title.dataset.scheduleAgendaTitle = titleKey
        title.replaceChildren()

        const rangeNode = document.createElement('span')
        rangeNode.className = 'schedule-agenda-title-range'
        rangeNode.textContent = range

        const yearNode = document.createElement('span')
        yearNode.className = 'schedule-agenda-title-year'
        yearNode.textContent = year

        title.append(rangeNode, yearNode)
      })
    }

    const unsubscribe = app.subscribe(() => {
      const nextView = app.state.currentView
      setActiveView((currentView) => currentView === nextView ? currentView : nextView)
      syncAgendaTitle()
    })

    syncAgendaTitle()
    return () => {
      window.cancelAnimationFrame(frameId)
      unsubscribe()
    }
  }, [calendar.app])

  useEffect(() => {
    const sourceById = new Map(events.map((event) => [event.id, event]))
    const updates = calendar.app.getAllEvents()
      .flatMap((event) => {
        const source = sourceById.get(event.id)
        if (!source) return []
        const title = activeView === ViewType.AGENDA && source.location
          ? `${source.title}\n${source.location}`
          : source.title
        return event.title === title ? [] : [{ id: event.id, updates: { title } }]
      })

    if (updates.length) calendar.app.applyEventsChanges({ update: updates }, false, 'local')
  }, [activeView, calendar.app, events])

  const mobileDayNavigation = dayHeaderHost && createPortal(
    <div className="df-view-header-nav schedule-mobile-day-nav" aria-label="日视图日期导航">
      <div className="df-navigation">
        <button
          className="df-calendar-nav-button"
          type="button"
          aria-label="上一天"
          title="上一天"
          onClick={() => calendar.app.goToPrevious()}
        >
          <Icon name="previous" size={16} />
        </button>
        <button
          className="df-today-button df-calendar-today-button"
          type="button"
          onClick={() => calendar.app.goToToday()}
        >
          今天
        </button>
        <button
          className="df-calendar-nav-button"
          type="button"
          aria-label="下一天"
          title="下一天"
          onClick={() => calendar.app.goToNext()}
        >
          <Icon name="next" size={16} />
        </button>
      </div>
    </div>,
    dayHeaderHost,
  )

  return (
    <div className="schedule-calendar" ref={calendarRootRef}>
      <DayFlowCalendar
        calendar={calendar}
        search={{ timeFormat: '24h', onResultClick: handleSearchResultClick }}
        eventDetailContent={CourseDetail}
        mobileEventDetail={MobileCourseDetail}
        eventContentDay={CourseTimedEventContent}
        eventContentWeek={CourseTimedEventContent}
      />
      {mobileDayNavigation}
    </div>
  )
}

function SubscriptionActions({ calendarUrl, isClosing = false }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const webcalUrl = useMemo(() => calendarUrl.replace(/^https?:/, 'webcal:'), [calendarUrl])

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(calendarUrl)
      setCopied(true)
      setCopyError(false)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className={`workspace-actions${isClosing ? ' is-closing' : ''}`}>
      <a className="primary-button" href={webcalUrl}>
        <Icon name="calendar" />
        一键订阅
      </a>
      <button className="secondary-button" type="button" onClick={copyUrl}>
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? '已复制' : '复制订阅地址'}
      </button>
      <a className="secondary-button" href={calendarUrl} download="zjut-course-schedule.ics">
        <Icon name="download" />
        下载 ICS
      </a>
      {copyError && <span className="workspace-actions__error">复制失败</span>}
    </div>
  )
}

export default function ScheduleWorkspace({ result, onLogout, themeDark, onToggleTheme }) {
  const [loadRequest, setLoadRequest] = useState({ id: 0, forceRefresh: false })
  const [state, setState] = useState({ status: 'loading', data: null, message: '' })
  const [menuOpen, setMenuOpen] = useState(false)
  const [subscriptionVisible, setSubscriptionVisible] = useState(readSubscriptionVisibility)
  const [subscriptionMounted, setSubscriptionMounted] = useState(subscriptionVisible)
  const [subscriptionClosing, setSubscriptionClosing] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [aboutClosing, setAboutClosing] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [logoutConfirmClosing, setLogoutConfirmClosing] = useState(false)
  const [menuClosing, setMenuClosing] = useState(false)
  const menuRef = useRef(null)
  const menuCloseTimerRef = useRef(null)
  const subscriptionCloseTimerRef = useRef(null)
  const aboutCloseTimerRef = useRef(null)
  const logoutConfirmCloseTimerRef = useRef(null)

  function reloadSchedule(forceRefresh = false) {
    setLoadRequest(({ id }) => ({ id: id + 1, forceRefresh }))
  }

  function openMenu() {
    window.clearTimeout(menuCloseTimerRef.current)
    setMenuClosing(false)
    setMenuOpen(true)
  }

  function closeMenu() {
    if (!menuOpen || menuClosing) return

    setMenuClosing(true)
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false)
      setMenuClosing(false)
    }, MENU_CLOSE_MS)
  }

  function toggleMenu() {
    if (menuOpen && !menuClosing) {
      closeMenu()
      return
    }
    openMenu()
  }

  function toggleSubscription() {
    window.clearTimeout(subscriptionCloseTimerRef.current)

    if (subscriptionVisible) {
      setSubscriptionVisible(false)
      setSubscriptionClosing(true)
      writeSubscriptionVisibility(false)
      subscriptionCloseTimerRef.current = window.setTimeout(() => {
        setSubscriptionMounted(false)
        setSubscriptionClosing(false)
      }, SURFACE_CLOSE_MS)
    } else {
      setSubscriptionMounted(true)
      setSubscriptionClosing(false)
      setSubscriptionVisible(true)
      writeSubscriptionVisibility(true)
    }

    closeMenu()
  }

  function openAbout() {
    window.clearTimeout(aboutCloseTimerRef.current)
    setAboutClosing(false)
    setAboutOpen(true)
  }

  function closeAbout() {
    if (!aboutOpen || aboutClosing) return

    setAboutClosing(true)
    aboutCloseTimerRef.current = window.setTimeout(() => {
      setAboutOpen(false)
      setAboutClosing(false)
    }, MENU_CLOSE_MS)
  }

  function openLogoutConfirm() {
    window.clearTimeout(logoutConfirmCloseTimerRef.current)
    setLogoutConfirmClosing(false)
    setLogoutConfirmOpen(true)
  }

  function closeLogoutConfirm() {
    if (!logoutConfirmOpen || logoutConfirmClosing) return

    setLogoutConfirmClosing(true)
    logoutConfirmCloseTimerRef.current = window.setTimeout(() => {
      setLogoutConfirmOpen(false)
      setLogoutConfirmClosing(false)
    }, MENU_CLOSE_MS)
  }

  function confirmLogout() {
    if (!logoutConfirmOpen || logoutConfirmClosing) return

    setLogoutConfirmClosing(true)
    logoutConfirmCloseTimerRef.current = window.setTimeout(() => {
      setLogoutConfirmOpen(false)
      setLogoutConfirmClosing(false)
      onLogout()
    }, MENU_CLOSE_MS)
  }

  useEffect(() => {
    if (!menuOpen) return undefined

    function handleDocumentMenuClose(event) {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') closeMenu()
        return
      }
      if (!menuRef.current?.contains(event.target)) closeMenu()
    }

    document.addEventListener('pointerdown', handleDocumentMenuClose)
    document.addEventListener('keydown', handleDocumentMenuClose)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentMenuClose)
      document.removeEventListener('keydown', handleDocumentMenuClose)
    }
  }, [menuOpen, menuClosing])

  useEffect(() => {
    if (!aboutOpen) return undefined

    function handleDocumentAboutClose(event) {
      if (event.key === 'Escape') closeAbout()
    }

    document.addEventListener('keydown', handleDocumentAboutClose)
    return () => document.removeEventListener('keydown', handleDocumentAboutClose)
  }, [aboutOpen, aboutClosing])

  useEffect(() => {
    if (!logoutConfirmOpen) return undefined

    function handleDocumentLogoutConfirmClose(event) {
      if (event.key === 'Escape') closeLogoutConfirm()
    }

    document.addEventListener('keydown', handleDocumentLogoutConfirmClose)
    return () => document.removeEventListener('keydown', handleDocumentLogoutConfirmClose)
  }, [logoutConfirmOpen, logoutConfirmClosing])

  useEffect(() => () => {
    window.clearTimeout(menuCloseTimerRef.current)
    window.clearTimeout(subscriptionCloseTimerRef.current)
    window.clearTimeout(aboutCloseTimerRef.current)
    window.clearTimeout(logoutConfirmCloseTimerRef.current)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, message: '' })

    async function loadSchedule() {
      try {
        const scheduleUrl = `${API_BASE}/api/schedule${loadRequest.forceRefresh ? '?refresh=1' : ''}`
        const response = await fetch(scheduleUrl, {
          credentials: 'include',
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.message || (response.status === 401 ? '登录状态已失效，请重新登录。' : '课程表暂时无法加载。'))
        }
        if (!Array.isArray(payload.events)) throw new Error('服务未返回有效的课程数据。')
        setState({ status: 'ready', data: payload, message: '' })
      } catch (error) {
        if (error.name === 'AbortError') return
        setState({ status: 'error', data: null, message: error.message || '课程表暂时无法加载。' })
      }
    }

    loadSchedule()
    return () => controller.abort()
  }, [loadRequest])

  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div className="workspace-heading__copy">
          <h1>我的课程表</h1>
        </div>
        <div className="workspace-menu" ref={menuRef}>
          <button
            className="workspace-menu__trigger"
            type="button"
            aria-label="打开菜单"
            aria-haspopup="menu"
            aria-expanded={menuOpen && !menuClosing}
            onClick={toggleMenu}
          >
            <Icon name="menu" size={20} />
          </button>
          {menuOpen && (
            <div className={`workspace-menu__popover${menuClosing ? ' is-closing' : ''}`} role="menu">
              <button
                className="workspace-menu__item"
                type="button"
                role="menuitem"
                onClick={toggleSubscription}
              >
                <Icon name={subscriptionVisible ? 'chevronUp' : 'chevronDown'} size={18} />
                {subscriptionVisible ? '隐藏订阅' : '展示订阅'}
              </button>
              <button
                className="workspace-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  reloadSchedule(true)
                }}
              >
                <Icon name="refresh" size={18} />
                刷新课表
              </button>
              <button
                className="workspace-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  onToggleTheme()
                }}
              >
                <Icon name={themeDark ? 'sun' : 'moon'} size={18} />
                {themeDark ? '浅色模式' : '深色模式'}
              </button>
              <a
                className="workspace-menu__item"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={closeMenu}
              >
                <Icon name="github" size={18} />
                GitHub
              </a>
              <button
                className="workspace-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  openAbout()
                }}
              >
                <Icon name="info" size={18} />
                关于
              </button>
              <div className="workspace-menu__separator" role="separator" />
              <button
                className="workspace-menu__item workspace-menu__item--danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  window.setTimeout(openLogoutConfirm, MENU_CLOSE_MS)
                }}
              >
                <Icon name="logout" size={18} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
      {subscriptionMounted && (
        <SubscriptionActions
          calendarUrl={result.calendarUrl}
          isClosing={subscriptionClosing}
        />
      )}

      <section className="schedule-frame" aria-label="课程表">
        {state.status === 'loading' && (
          <div className="schedule-state schedule-state--loading">
            <span className="spinner spinner--blue" aria-hidden="true" />
            <strong>正在加载课程表</strong>
          </div>
        )}
        {state.status === 'error' && (
          <div className="schedule-state">
            <div className="schedule-state__icon">!</div>
            <strong>课程表没有加载出来</strong>
            <small>{state.message}</small>
            <button className="primary-button" type="button" onClick={() => reloadSchedule(true)}>
              重新加载
            </button>
          </div>
        )}
        {state.status === 'ready' && state.data.events.length === 0 && (
          <div className="schedule-state">
            <strong>暂时没有课程</strong>
            <small>学校系统没有返回可展示的课程安排。</small>
          </div>
        )}
        {state.status === 'ready' && state.data.events.length > 0 && (
          <ScheduleCalendar events={state.data.events} themeDark={themeDark} />
        )}
      </section>

      {aboutOpen && createPortal(
        <div
          className={`about-dialog${aboutClosing ? ' is-closing' : ''}`}
          role="presentation"
          onClick={closeAbout}
        >
          <section
            className="about-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="about-dialog__heading">
              <h2 id="about-dialog-title">关于</h2>
              <button
                className="about-dialog__close"
                type="button"
                aria-label="关闭关于"
                onClick={closeAbout}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="about-dialog__body">
              <p><a className="about-dialog__repo" href={GITHUB_URL} target="_blank" rel="noreferrer">zjut-grad-schedule</a></p>
              <p>课程表订阅与日历展示工具。</p>
              <p>本项目从属于个人，与浙江工业大学无关。</p>
              <p>日历视图基于 <a href="https://github.com/dayflow-js/calendar" target="_blank" rel="noreferrer">DayFlow</a>，遵循 MIT License。</p>
              <p>© 2026 Zihan S.</p>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {logoutConfirmOpen && createPortal(
        <div
          className={`about-dialog logout-dialog${logoutConfirmClosing ? ' is-closing' : ''}`}
          role="presentation"
          onClick={closeLogoutConfirm}
        >
          <section
            className="about-dialog__panel logout-dialog__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="about-dialog__heading">
              <h2 id="logout-dialog-title">退出登录</h2>
              <button
                className="about-dialog__close"
                type="button"
                aria-label="取消退出登录"
                onClick={closeLogoutConfirm}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="about-dialog__body">
              <p>确定要退出当前浏览器吗？</p>
              <p>退出只会清除本地登录状态，不会影响服务端记录和订阅链接。</p>
            </div>
            <div className="logout-dialog__actions">
              <button className="logout-dialog__cancel" type="button" onClick={closeLogoutConfirm}>
                取消
              </button>
              <button className="logout-dialog__confirm" type="button" onClick={confirmLogout}>
                <Icon name="logout" size={17} />
                退出登录
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
