import { useEffect, useMemo, useState } from 'react'
import {
  DayFlowCalendar,
  ViewType,
  createMonthView,
  createWeekView,
  useCalendarApp,
} from '@dayflow/react'
import { Temporal } from 'temporal-polyfill'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

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
    year: '年',
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
  return (
    <div className="course-detail">
      <div className="course-detail__heading">
        <span className="course-detail__mark" aria-hidden="true" />
        <div>
          <h3>{event.title}</h3>
          <p>{formatDateTime(event.start)} — {formatDateTime(event.end).split(' ').at(-1)}</p>
        </div>
      </div>
      <dl className="course-detail__list">
        {meta.location && <><dt>地点</dt><dd>{meta.location}</dd></>}
        {meta.campus && <><dt>校区</dt><dd>{meta.campus}</dd></>}
        {meta.semester && <><dt>学期</dt><dd>{meta.semester}</dd></>}
        {meta.lessonText && <><dt>课次</dt><dd>{meta.lessonText}</dd></>}
        {event.description && <><dt>备注</dt><dd className="course-detail__description">{event.description}</dd></>}
      </dl>
      {onClose && <button className="course-detail__close" type="button" onClick={onClose}>关闭</button>}
    </div>
  )
}

function ScheduleCalendar({ events }) {
  const calendarEvents = useMemo(() => toCalendarEvents(events), [events])
  const calendar = useCalendarApp({
    views: [
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
    ],
    events: calendarEvents,
    defaultView: ViewType.WEEK,
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
        primary: '#0075de',
        primaryForeground: '#ffffff',
        card: '#ffffff',
        cardForeground: '#0f0f0f',
      },
    },
  })

  return (
    <DayFlowCalendar
      calendar={calendar}
      eventDetailContent={CourseDetail}
    />
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
      <a className="primary-button" href={webcalUrl}>一键订阅</a>
      <button className="secondary-button" type="button" onClick={copyUrl}>
        {copied ? '已复制' : '复制订阅地址'}
      </button>
      <a className="secondary-button" href={calendarUrl} download="zjut-course-schedule.ics">下载 ICS</a>
      {copyError && <span className="workspace-actions__error">复制失败</span>}
    </div>
  )
}

export default function ScheduleWorkspace({ result, onReset }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, message: '' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null, message: '' })

    async function loadSchedule() {
      try {
        const response = await fetch(`${API_BASE}/api/schedule`, {
          headers: { Authorization: `Bearer ${result.token}` },
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
  }, [attempt, result.token])

  const updatedAt = state.data?.updatedAt
    ? new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }).format(new Date(state.data.updatedAt))
    : ''

  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div className="workspace-heading__copy">
          <button className="back-button" type="button" onClick={onReset}>返回登录</button>
          <p className="workspace-kicker">浙工大研究生</p>
          <h1>我的课程表</h1>
          <p className="workspace-subtitle">
            {state.status === 'ready' && state.data.stale
              ? '学校系统暂时不可用，当前显示上次成功更新的课程表。'
              : updatedAt
                ? `最近更新于 ${updatedAt}`
                : '正在从学校系统读取课程安排'}
          </p>
        </div>
        <SubscriptionActions calendarUrl={result.calendarUrl} />
      </div>

      <section className="schedule-frame" aria-label="课程表">
        {state.status === 'loading' && (
          <div className="schedule-state schedule-state--loading">
            <span className="spinner spinner--blue" aria-hidden="true" />
            <strong>正在加载课程表</strong>
            <small>会同时整理全部学期的课程安排</small>
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
