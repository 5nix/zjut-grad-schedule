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

function MobileCourseDetail({ isOpen, draftEvent, onClose }) {
  if (!isOpen || !draftEvent) return null

  return (
    <div className="df-portal df-mobile-event-drawer">
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
          <CourseDetail event={draftEvent} />
        </div>
      </div>
    </div>
  )
}

function ScheduleCalendar({ events }) {
  const [activeView, setActiveView] = useState(ViewType.WEEK)
  const [dayHeaderHost, setDayHeaderHost] = useState(null)
  const calendarRootRef = useRef(null)
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
      mode: 'light',
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
        eventDetailContent={CourseDetail}
        mobileEventDetail={MobileCourseDetail}
        eventContentDay={CourseTimedEventContent}
        eventContentWeek={CourseTimedEventContent}
      />
      {mobileDayNavigation}
    </div>
  )
}

function SubscriptionActions({ calendarUrl }) {
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
    <div className="workspace-actions">
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

export default function ScheduleWorkspace({ result, onLogout }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, message: '' })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined

    function closeMenu(event) {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') setMenuOpen(false)
        return
      }
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [menuOpen])

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, message: '' })

    async function loadSchedule() {
      try {
        const response = await fetch(`${API_BASE}/api/schedule`, {
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
  }, [attempt])

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
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Icon name="menu" size={20} />
          </button>
          {menuOpen && (
            <div className="workspace-menu__popover" role="menu">
              <a
                className="workspace-menu__item"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                <Icon name="github" size={18} />
                GitHub
              </a>
              <button
                className="workspace-menu__item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
              >
                <Icon name="logout" size={18} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
      <SubscriptionActions calendarUrl={result.calendarUrl} />

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
            <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
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
          <ScheduleCalendar events={state.data.events} />
        )}
      </section>
    </div>
  )
}
