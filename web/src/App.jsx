import { lazy, Suspense, useId, useState } from 'react'

const ScheduleWorkspace = lazy(() => import('./ScheduleWorkspace.jsx'))

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const GITHUB_URL = 'https://github.com/5nix/zjut-grad-schedule'
const ICP_URL = 'https://beian.miit.gov.cn/'
const ICP_RECORD = (import.meta.env.VITE_ICP_RECORD || '').trim()

function Icon({ name, size = 20 }) {
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
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.1 2.9" /><path d="M6.2 6.2C3.4 8 2 12 2 12s3.5 6 10 6a9.8 9.8 0 0 0 3.8-.7" /></>,
    alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /></>,
  }

  return <svg {...common}>{paths[name]}</svg>
}

function getErrorState(response, payload) {
  const message = typeof payload?.message === 'string' ? payload.message : ''

  switch (response.status) {
    case 400:
      return { type: 'error', title: '输入信息有误', message: message || '请检查学号和密码格式后重试。' }
    case 401:
      return { type: 'error', title: '登录失败', message: message || '学号或密码不正确，请核对后重试。' }
    case 409:
      return { type: 'warning', title: '学校要求验证码', message: message || '请先在学校系统完成验证，然后返回此页重试。' }
    case 429: {
      const retryAfter = response.headers.get('Retry-After')
      const suffix = retryAfter ? `请在 ${retryAfter} 秒后重试。` : '请稍后再试。'
      return { type: 'warning', title: '尝试次数过多', message: message || suffix }
    }
    case 503:
      return { type: 'warning', title: '学校服务暂时不可用', message: message || '校务系统可能正在维护，请稍后再试。' }
    default:
      return { type: 'error', title: '暂时无法登录', message: message || '请检查网络连接后重试。' }
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function Notice({ notice }) {
  if (!notice) return null
  return (
    <div className={`notice notice--${notice.type}`} role="alert">
      <span className="notice__icon"><Icon name="alert" size={18} /></span>
      <span>
        <strong>{notice.title}</strong>
        <small>{notice.message}</small>
      </span>
    </div>
  )
}

function LoginForm({ onSuccess }) {
  const studentIdId = useId()
  const passwordId = useId()
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    const cleanStudentId = studentId.trim()

    if (!cleanStudentId || !password) {
      setNotice({ type: 'error', title: '请完整填写', message: '学号和密码都是必填项。' })
      return
    }

    setLoading(true)
    setNotice(null)

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: cleanStudentId, password }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        setNotice(getErrorState(response, payload))
        return
      }

      if (!payload?.token || !payload?.calendarUrl) {
        setNotice({ type: 'error', title: '返回数据不完整', message: '服务未返回有效的订阅地址，请稍后重试。' })
        return
      }

      setPassword('')
      onSuccess({
        studentId: payload.studentId || cleanStudentId,
        token: payload.token,
        calendarUrl: payload.calendarUrl,
      })
    } catch {
      setNotice({ type: 'error', title: '无法连接服务', message: '请确认网络正常，或稍后再试。' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor={studentIdId}>学号</label>
        <input
          id={studentIdId}
          name="studentId"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          placeholder="请输入学号"
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          disabled={loading}
        />
      </div>

      <div className="field">
        <label htmlFor={passwordId}>密码</label>
        <div className="password-wrap">
          <input
            id={passwordId}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
          />
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            disabled={loading}
          >
            <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} />
          </button>
        </div>
      </div>

      <Notice notice={notice} />

      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? (
          <><span className="spinner" aria-hidden="true" />登录中…</>
        ) : (
          <>登录</>
        )}
      </button>

    </form>
  )
}

export default function App() {
  const [result, setResult] = useState(null)

  return (
    <div className={`site-shell ${result ? 'site-shell--workspace' : ''}`}>
      <header className="site-header">
        <a className="brand" href="/" aria-label="浙工大研究生课程表订阅首页">
          <BrandMark />
        </a>
        <a className="github-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      <main className={result ? 'workspace-main' : 'hero'}>
        {result ? (
          <Suspense fallback={<div className="workspace-load-fallback"><span className="spinner spinner--blue" aria-hidden="true" />正在打开课程表</div>}>
            <ScheduleWorkspace result={result} onReset={() => setResult(null)} />
          </Suspense>
        ) : (
          <>
            <section className="hero-copy" aria-labelledby="page-title">
              <h1 id="page-title">
                <span>浙工大研究生</span>
                <em>课程表订阅</em>
              </h1>
            </section>

            <section className="auth-card" aria-label="登录">
              <div className="calendar-accent" aria-hidden="true">
                <i />
                <i />
                <span /><span /><span /><span /><span /><span />
              </div>
              <div className="card-heading">
                <h2>登录浙江工业大学<br />研究生账号</h2>
              </div>
              <LoginForm onSuccess={setResult} />
            </section>
          </>
        )}
      </main>

      {ICP_RECORD && (
        <footer className="site-footer">
          <a href={ICP_URL} target="_blank" rel="noreferrer">
            {ICP_RECORD}
          </a>
        </footer>
      )}

    </div>
  )
}
