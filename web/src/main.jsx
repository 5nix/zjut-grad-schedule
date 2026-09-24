import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@dayflow/core/dist/styles.css'
import '@dayflow/core/dist/styles.components.css'
import './styles.css'

const RELOAD_KEY = 'zjut-grad-schedule-preload-retry'

window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === import.meta.url) return
    sessionStorage.setItem(RELOAD_KEY, import.meta.url)
    event.preventDefault()
    window.location.reload()
  } catch {
    // Let the error boundary offer a manual reload if storage is unavailable.
  }
})

class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="workspace-load-fallback">
          页面加载失败，请重试。
          <button className="secondary-button" type="button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )
    }
    return this.props.children
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
